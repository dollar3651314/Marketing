/**
 * 基金观察（src/funds.ts、src/funds-api.ts、migrations/0016_funds.sql）研发自测：口径、清洗、分批额度、取不到保留上次数据、要登录。
 * 外部接口一律用替身（不连网）；D1 用 getPlatformProxy 的本地真实 SQLite。测试会话另写的测试见同目录其他 funds 测试文件。
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import { cleanPoints, eastmoneyMoneyIndex, FUNDS, maxDrawdown, parseEastmoney, parseYahoo, periodReturn, summarize, type Point } from '../src/funds';
import { fetchFund, Http, MAX_REQUESTS, mergePoints, prevPoints, refreshBatch, TimeUp, type FetchLike } from '../src/funds-api';
import { ROOT } from './helpers';

const PASS = 'ci_only_copilot_password_01';
const HOST = 'https://copilot.example.test';
const MIG = path.join(ROOT, 'migrations');
const NOW = Date.UTC(2026, 10, 10, 9, 0, 0);
const DAY = 86_400_000;

const stmtsOf = (files: string[]) =>
  files.map((f) => readFileSync(path.join(MIG, f), 'utf8').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n'))
    .join(';\n').split(';').map((s) => s.trim()).filter(Boolean);

let db: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: path.join(ROOT, 'test/wrangler.test.toml'), persist: false, remoteBindings: false, envFiles: [] });
  db = proxy.env.DB;
  dispose = proxy.dispose;
  await db.batch(stmtsOf(readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort()).map((s) => db.prepare(s)));
});
afterAll(async () => dispose());
beforeEach(async () => { await db.prepare('DELETE FROM fund_snapshot').run(); });
const env = (): Env => ({ DB: db, ENVIRONMENT: 'test', COPILOT_PASSWORD: PASS });

/** 从 end 往前每天一个点（不跳周末），adj 由 f(i) 给 */
function series(n: number, end: string, f: (i: number) => number): Point[] {
  const e = Date.parse(end + 'T00:00:00Z');
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(e - (n - 1 - i) * DAY).toISOString().slice(0, 10);
    return [d, f(i), f(i)] as Point;
  });
}
const yahooJson = (pts: Point[]) => ({ chart: { result: [{ meta: { currency: 'USD', gmtoffset: -18000 }, timestamp: pts.map((p) => Date.parse(p[0] + 'T14:30:00Z') / 1000 + 18000), indicators: { quote: [{ close: pts.map((p) => p[1]) }], adjclose: [{ adjclose: pts.map((p) => p[2]) }] } }] } });
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const noSleep = async () => {};

describe('1. 清单', () => {
  // 第三版（Amos 2026-11-11）：中国 16 只都走东方财富（原来只有场外两只），断言随规格改
  it('45 只：新加坡 14、美国 15、中国 16；代码去掉 .SI / .SS；中国 16 只都是东方财富', () => {
    expect(FUNDS.length).toBe(45);
    expect(['新加坡', '美国', '中国'].map((m) => FUNDS.filter((f) => f.market === m).length)).toEqual([14, 15, 16]);
    expect(FUNDS.every((f) => !/\.(SI|SS)$/.test(f.code))).toBe(true);
    expect(FUNDS.filter((f) => f.source === 'eastmoney').map((f) => f.code)).toEqual(FUNDS.filter((f) => f.market === '中国').map((f) => f.code));
    expect(new Set(FUNDS.map((f) => f.code)).size).toBe(45);
  });
});

describe('2. 解析和清洗', () => {
  it('parseYahoo：日期按 gmtoffset 算、跳过 null', () => {
    const j = { chart: { result: [{ meta: { currency: 'SGD', gmtoffset: 28800 }, timestamp: [1794211200, 1794297600, 1794384000], indicators: { quote: [{ close: [1, null, 3] }], adjclose: [{ adjclose: [1, 2, 3] }] } }] } };
    const r = parseYahoo(j);
    expect(r.currency).toBe('SGD');
    expect(r.points.map((p) => p[0])).toEqual(['2026-11-09', '2026-11-11']);
    expect(parseYahoo({ chart: { result: null } }).points).toEqual([]);
  });
  it('parseEastmoney：多页合并、升序、去重、空值跳过', () => {
    const pts = parseEastmoney([{ Data: { LSJZList: [{ FSRQ: '2026-11-09', DWJZ: '1.9', LJJZ: '2.4' }, { FSRQ: '2026-11-06', DWJZ: '', LJJZ: '2.3' }] } }, { Data: { LSJZList: [{ FSRQ: '2026-11-05', DWJZ: '1.8', LJJZ: '2.2' }] } }]);
    expect(pts).toEqual([['2026-11-05', 1.8, 2.2], ['2026-11-09', 1.9, 2.4]]);
  });
  it('cleanPoints：首日差 >20% 去掉、单日坏报价去掉、只留 375 天', () => {
    const base = series(400, '2026-11-10', () => 100);
    base[0] = [base[0][0], 70, 70]; // 首日异常
    base[200] = [base[200][0], 89, 89]; // 单日坏报价（两边都差 11%，同侧）
    const c = cleanPoints(base);
    expect(c.some((p) => p[2] === 70 || p[2] === 89)).toBe(false);
    expect(c[0][0]).toBe('2025-10-31'); // 2026-11-10 往前 375 天
  });
});

describe('3. 各期收益和最大回撤', () => {
  // 400 个点：先从 100 涨到 120，再跌到 90，再涨到 109.8
  const pts = series(400, '2026-11-10', (i) => (i < 200 ? 100 + i * 0.1 : i < 300 ? 120 - (i - 200) * 0.3 : 90 + (i - 300) * 0.2));
  it('d1 = 最后两点；y1 基准 = ≤ 最后一天减 365 天的最后一点', () => {
    const last = pts[pts.length - 1][2];
    expect(periodReturn(pts, 'd1')).toBeCloseTo((last / pts[pts.length - 2][2] - 1) * 100, 9);
    expect(periodReturn(pts, 'y1')).toBeCloseTo((last / pts.find((p) => p[0] === '2025-11-10')![2] - 1) * 100, 9);
  });
  it('ytd 基准 = ≤ 上年 12/31；历史不够返回 null', () => {
    const b = pts.find((p) => p[0] === '2025-12-31')!;
    expect(periodReturn(pts, 'ytd')).toBeCloseTo((pts[pts.length - 1][2] / b[2] - 1) * 100, 9);
    expect(periodReturn(pts.slice(-20), 'm1')).toBeNull();
    expect(maxDrawdown(pts.slice(-20), 'y1')).toBeNull();
  });
  it('最大回撤：120 → 90 = −25%；只在涨的一段是 0（不是 −0）', () => {
    expect(maxDrawdown(pts, 'y1')).toBeCloseTo(-25, 9);
    expect(maxDrawdown(pts, 'all')).toBeCloseTo(-25, 9);
    expect(Object.is(maxDrawdown(pts.slice(-10), 'all'), 0)).toBe(true);
  });
  it('summarize：字段齐全、series 是 [日期, 复权价]', () => {
    const s = summarize(FUNDS[0], 'SGD', pts);
    for (const k of ['last', 'date', 'd1', 'w1', 'm1', 'ytd', 'y1', 'dd_w1', 'dd_m1', 'dd_ytd', 'dd_y1', 'ret_all', 'dd_all', 'first', 'series']) expect(s).toHaveProperty(k);
    expect(s.series[s.series.length - 1]).toEqual(['2026-11-10', 109.8]);
    expect(() => summarize(FUNDS[0], null, [])).toThrow();
  });
});

describe('4. 取数：额度、重试、回退', () => {
  const good = series(300, '2026-11-09', (i) => 100 + i * 0.01);
  it('Http：失败最多试 2 次、每次都计数；404 不重试', async () => {
    let n = 0;
    const h = new Http(async () => { n++; return new Response('', { status: 503 }); }, 45, noSleep);
    await expect(h.get('https://x', {}, 'Yahoo')).rejects.toThrow('Yahoo回 503（试了 2 次）');
    expect([n, h.used]).toEqual([2, 2]);
    let m = 0;
    const h2 = new Http(async () => { m++; return new Response('', { status: 404 }); }, 45, noSleep);
    await expect(h2.get('https://x', {}, 'Yahoo')).rejects.toThrow('Yahoo回 404');
    expect(m).toBe(1);
  });
  it('一批对外请求不超过 45，next 接着取，全部取完 next 为 null', async () => {
    const urls: string[] = [];
    const f: FetchLike = async (u) => {
      urls.push(u);
      if (u.includes('eastmoney')) return ok({ Data: { LSJZList: Number(new URL(u).searchParams.get('pageIndex')) > 15 ? [] : series(20, new Date(Date.parse('2026-11-09') - (Number(new URL(u).searchParams.get('pageIndex')) - 1) * 28 * DAY).toISOString().slice(0, 10), () => 1).map((p) => ({ FSRQ: p[0], DWJZ: '1', LJJZ: '1.5' })) } });
      return ok(yahooJson(good));
    };
    let cur: number | null = 0, calls = 0, updated = 0;
    while (cur !== null) {
      const before = urls.length;
      const r = await refreshBatch(env(), cur, NOW, f, noSleep);
      expect(urls.length - before).toBeLessThanOrEqual(MAX_REQUESTS);
      expect(r.requests).toBe(urls.length - before);
      updated += r.updated.length; cur = r.next; calls++;
      // 第三版：中国 16 只首次都要全量翻东方财富（替身每只约 16 页），批数比原来多；上限按 16 × 16 / 45 ≈ 6 批 + Yahoo 29 只估，仍远低于页面的 45 次上限
      expect(calls).toBeLessThan(15);
    }
    expect(updated).toBe(45);
    const em = urls.filter((u) => u.includes('eastmoney'));
    expect(em.length).toBeGreaterThan(0);
    const g = await (await handle(new Request(HOST + '/api/funds'), env(), NOW)).status;
    expect(g).toBe(401); // 没登录
  });
  it('.SS 在 Yahoo 只有 1 个点 → 改用东方财富（去掉 .SS），source 记 eastmoney', async () => {
    const i = FUNDS.findIndex((x) => x.code === '511880');
    const f: FetchLike = async (u) => {
      if (u.includes('eastmoney')) {
        const pg = Number(new URL(u).searchParams.get('pageIndex'));
        expect(new URL(u).searchParams.get('fundCode')).toBe('511880');
        return ok({ Data: { LSJZList: pg > 20 ? [] : series(20, new Date(Date.parse('2026-11-09') - (pg - 1) * 20 * DAY).toISOString().slice(0, 10), () => 100).map((p) => ({ FSRQ: p[0], DWJZ: '100', LJJZ: '100' })) } });
      }
      return ok(yahooJson(good.slice(-1)));
    };
    const r = await refreshBatch(env(), i, NOW, f, noSleep);
    expect(r.failed.map((x) => x.code)).not.toContain('511880');
    const row = await db.prepare('SELECT data FROM fund_snapshot WHERE code = ?1').bind('511880').first<{ data: string }>();
    expect(JSON.parse(row!.data).source).toBe('eastmoney');
  });
  it('取不到：保留上次数据，GET /api/funds 带 stale', async () => {
    const i = FUNDS.findIndex((x) => x.code === 'VOO');
    await refreshBatch(env(), i, NOW, async () => ok(yahooJson(good)), noSleep);
    const r = await refreshBatch(env(), i, NOW + 3600e3, async () => new Response('', { status: 500 }), noSleep);
    expect(r.failed[0].code).toBe('VOO');
    const login = await handle(new Request(HOST + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: HOST, 'cf-connecting-ip': '203.0.113.7' }, body: JSON.stringify({ password: PASS }) }), env(), NOW);
    const ck = login.headers.get('set-cookie')!.split(';')[0];
    const g = (await (await handle(new Request(HOST + '/api/funds', { headers: { cookie: ck } }), env(), NOW)).json()) as any;
    expect(g.items.length).toBe(45);
    const voo = g.items.find((x: any) => x.code === 'VOO');
    expect(voo.last).toBeCloseTo(good[good.length - 1][1], 9);
    expect(voo.error).toContain('500');
    expect(g.items.find((x: any) => x.code === 'ES3').error).toBe('还没取过');
    const bad = await handle(new Request(HOST + '/api/funds/refresh', { method: 'POST', headers: { 'content-type': 'application/json', origin: HOST, cookie: ck }, body: JSON.stringify({ cursor: 45 }) }), env(), NOW);
    expect(bad.status).toBe(400);
  });
});

describe('5. 截止打断和失败原因（第二轮修改 9、10）', () => {
  const good = series(300, '2026-11-09', (i) => 100 + i * 0.01);
  /** 一直不回、直到被 abort 的替身 */
  const hang: FetchLike = (_u, init) => new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
  it('Http：被截止截短的请求抛 TimeUp（不当成数据源没回应），来不及再试一次也抛 TimeUp', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const h = new Http(hang, 45, noSleep, Date.now() + 3_000); // 只剩 3 秒：第一次就被截短
      const p = h.get('https://x', {}, 'Yahoo').catch((e) => e);
      await vi.advanceTimersByTimeAsync(3_100);
      const e = await p;
      expect(e).toBeInstanceOf(TimeUp);
      expect(h.used).toBe(1);
      const h2 = new Http(hang, 45, noSleep, Date.now() + 8_500); // 第一次等满 8 秒，剩 0.5 秒不够再试
      const p2 = h2.get('https://x', {}, 'Yahoo').catch((e) => e);
      await vi.advanceTimersByTimeAsync(8_600);
      const e2 = await p2;
      expect(e2).toBeInstanceOf(TimeUp);
      expect((e2 as TimeUp).detail).toBe('Yahoo 8 秒没回应（试了 1 次）');
    } finally { vi.useRealTimers(); }
  });
  it('Http：两次都等满才算失败，原因写实际秒数和次数（不出现 0 秒 / 1 秒）', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const h = new Http(hang, 45, noSleep);
      const p = h.get('https://x', {}, 'Yahoo').catch((e) => e);
      await vi.advanceTimersByTimeAsync(17_000);
      expect(String(((await p) as Error).message)).toBe('Yahoo 8 秒没回应（试了 2 次）');
    } finally { vi.useRealTimers(); }
  });
  it('批中被 25 秒截止打断的那只留给下一批：不进 failed、不写 err', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const i = FUNDS.findIndex((x) => x.code === 'VOO');
      const second = FUNDS[i + 1].symbol;
      // 第一只 14 秒才回（还没到 15 秒，会开第二只）；第二只一直不回 → 8 秒 + 1 秒 + 被截止截短
      const f: FetchLike = (u, init) => (u.includes(encodeURIComponent(second)) ? hang(u, init) : new Promise((res) => setTimeout(() => res(ok(yahooJson(good))), 14_000)));
      let out: any;
      const p = refreshBatch(env(), i, NOW, f).then((r) => (out = r));
      for (let k = 0; k < 4000 && !out; k++) await vi.advanceTimersByTimeAsync(10);
      await p;
      expect(out.updated).toEqual(['VOO']);
      expect(out.failed).toEqual([]);
      expect(out.next).toBe(i + 1);
      const row = await db.prepare('SELECT err FROM fund_snapshot WHERE code = ?1').bind(FUNDS[i + 1].code).first();
      expect(row).toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it('Yahoo 回 chart.error：失败原因带上 description', async () => {
    const i = FUNDS.findIndex((x) => x.code === 'VOO');
    const body = { chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } } };
    const r404 = await refreshBatch(env(), i, NOW, async () => new Response(JSON.stringify(body), { status: 404 }), noSleep);
    expect(r404.failed[0]).toEqual({ code: 'VOO', reason: 'Yahoo回 404：No data found, symbol may be delisted' });
    const r200 = await refreshBatch(env(), i, NOW, async () => ok(body), noSleep);
    expect(r200.failed[0].reason).toBe('Yahoo 没有这只的数据：No data found, symbol may be delisted');
  });
});

// ---------------------------------------------------------------- 页面脚本（src/funds-page.ts 的 FUNDS_JS）在 jsdom 里跑：第三轮 1、4
type Win = Window & typeof globalThis & { fundsOpen(): void; eval(s: string): unknown };
type Reply = { status?: number; body: unknown };
/** 开一个只有 #v-funds 的 jsdom 页面，GET / POST 都用替身；返回 api.snap（GET 回什么）、api.posts（POST 的 body）、api.onPost */
async function fundsPage(snap: unknown, onPost: (body: { cursor: number }, n: number) => Reply) {
  const jsdomName = 'jsdom';
  const { JSDOM } = await import(jsdomName);
  const { FUNDS_MOD, FUNDS_JS } = await import('../src/funds-page');
  const dom = new JSDOM(`<!doctype html><body><main id="app">${FUNDS_MOD}</main></body>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window as Win;
  const api = { snap, posts: [] as { cursor: number }[], gets: 0 };
  const res = (r: Reply) => ({ status: r.status ?? 200, ok: (r.status ?? 200) < 400, json: async () => r.body });
  (w as any).fetch = async (_url: string, init: { method: string; body?: string }) => {
    if (init.method === 'POST') { const b = JSON.parse(init.body || '{}'); api.posts.push(b); return res(onPost(b, api.posts.length)); }
    api.gets++;
    return res({ body: JSON.parse(JSON.stringify(api.snap)) });
  };
  (w as any).matchMedia = () => ({ matches: false });
  w.eval(FUNDS_JS);
  w.document.getElementById('v-funds')!.hidden = false;
  const $ = (id: string) => w.document.getElementById(id)!;
  /** 等到 cond 成立（硬上限 400 × 5ms） */
  const until = async (cond: () => boolean) => { for (let k = 0; k < 400 && !cond(); k++) await new Promise((ok) => setTimeout(ok, 5)); return cond(); };
  const oldRows = () => [...w.document.querySelectorAll('#fu-list .fu-old')].map((e) => e.closest('[data-code]')!.getAttribute('data-code'));
  const refresh = async () => { ($('fu-refresh') as HTMLButtonElement).click(); await until(() => !($('fu-refresh') as HTMLButtonElement).disabled && api.gets >= 2); await until(() => $('fu-prog').textContent !== ''); };
  w.fundsOpen();
  await until(() => api.gets >= 1 && w.document.querySelectorAll('#fu-list [data-code]').length > 0);
  return { w, api, $, until, oldRows, refresh, close: () => w.close() };
}
const SNAP = JSON.parse(readFileSync(path.join(ROOT, 'test/fixtures/funds/snapshot.json'), 'utf8')) as { fetched_at: string; items: { code: string; ok_at?: string }[] };
const snapAt = (fetched: string, okAt: (code: string, i: number) => string | undefined) => ({ ...SNAP, fetched_at: fetched, items: SNAP.items.map((x, i) => ({ ...x, ok_at: okAt(x.code, i) })) });

describe('页面：「上次数据」以服务器为准（第三轮 1）', () => {
  it('本窗口中途断 → 别的设备全量刷完 → 切走再回来：标题和行都不再写"上次"', async () => {
    const codes = SNAP.items.map((x) => x.code), first = codes.slice(0, 12), rest = codes.slice(12);
    const p = await fundsPage(SNAP, (_b, n) => (n === 1 ? { body: { next: 12, done: 12, total: 45, updated: first, failed: [] } } : { status: 500, body: { error: 'D1 写库失败' } }));
    try {
      await p.refresh();
      expect(p.api.posts.length).toBe(2);
      expect(p.oldRows().sort()).toEqual(rest.slice().sort()); // 中途断：没轮到的 33 只标"上次数据"（服务器没给 ok_at，靠本窗口兜底）
      expect(p.$('fu-meta').textContent).toMatch(/其中 33 只的取数时间还是上次的/);
      // 别的设备随后全量刷完：服务器每只的 ok_at 都是新的
      const ALL = '2026-11-10T12:00:00Z';
      p.api.snap = snapAt(ALL, () => ALL);
      p.w.fundsOpen();
      await p.until(() => p.api.gets >= 3 && !/上次/.test(p.$('fu-meta').textContent || ''));
      expect(p.$('fu-meta').textContent).not.toMatch(/上次|取数时间/);
      expect(p.oldRows()).toEqual([]);
      expect(p.$('fu-prog').textContent).toBe(''); // 上次那句"其余 33 只还是…"也不再留着
    } finally { p.close(); }
  });
  it('服务器给了 ok_at 时本窗口的记忆不算数：中途断的那几只服务器 ok_at 还是旧的 → 照服务器标；新的 → 不标', async () => {
    const T = '2026-11-10T10:00:00Z', OLD = '2026-11-10T08:00:00Z';
    const codes = SNAP.items.map((x) => x.code), first = codes.slice(0, 12);
    const p = await fundsPage(snapAt(OLD, () => OLD), (_b, n) => {
      if (n === 1) { p0.api.snap = snapAt(T, (c) => (first.includes(c) || c === 'VOO' ? T : OLD)); return { body: { next: 12, done: 12, total: 45, updated: first, failed: [] } }; }
      return { status: 500, body: { error: 'D1 写库失败' } };
    });
    const p0 = p;
    try {
      await p.refresh();
      // VOO 不在第一批，但服务器说它的 ok_at 是新的（别的窗口刚好刷到）→ 不标；其余 32 只照服务器的 ok_at 标
      expect(p.oldRows()).not.toContain('VOO');
      expect(p.oldRows().length).toBe(32);
      expect(p.$('fu-meta').textContent).toMatch(/其中 32 只的取数时间还是上次的 16:00/);
    } finally { p.close(); }
  });
  it('"旧"的门槛是 5 分钟：ok_at 早 6 分钟的标、早 4 分钟的不标；标题写"取数时间"', async () => {
    const T = Date.parse('2026-11-10T10:00:00Z');
    const iso = (ms: number) => new Date(ms).toISOString();
    const p = await fundsPage(snapAt(iso(T), (_c, i) => iso(T - (i < 10 ? 6 : 4) * 60e3)), () => ({ body: {} }));
    try {
      expect(p.oldRows().sort()).toEqual(SNAP.items.slice(0, 10).map((x) => x.code).sort());
      expect(p.$('fu-meta').textContent).toMatch(/其中 10 只的取数时间还是上次的 17:54/);
      expect(p.api.posts.length).toBe(0);
    } finally { p.close(); }
  });
});

describe('页面：刷新循环有硬上限（第三轮 4）', () => {
  it('服务器一直回 next（每次只往前 1）：最多发 45 次 POST 就停下并提示', async () => {
    const p = await fundsPage(SNAP, (b, n) => (n > 60 ? { body: { next: null, total: 1000, updated: [], failed: [] } } : { body: { next: b.cursor + 1, done: b.cursor + 1, total: 1000, updated: [], failed: [] } }));
    try {
      await p.refresh();
      await p.until(() => /失控/.test(p.$('fu-prog').textContent || ''));
      expect(p.api.posts.length).toBe(45);
      expect(p.$('fu-prog').textContent).toMatch(/已经发了 45 次请求还没取完，先停下了/);
      expect((p.$('fu-refresh') as HTMLButtonElement).disabled).toBe(false);
    } finally { p.close(); }
  });
  it('服务器回的 next 没往前走：发 1 次就停下', async () => {
    const p = await fundsPage(SNAP, (b) => ({ body: { next: b.cursor, done: 0, total: 45, updated: [], failed: [] } }));
    try {
      await p.refresh();
      await p.until(() => /失控/.test(p.$('fu-prog').textContent || ''));
      expect(p.api.posts.length).toBe(1);
      expect(p.$('fu-prog').textContent).toMatch(/进度没有往前走/);
    } finally { p.close(); }
  });
});

// 第三版（研发加）：中国场内 ETF 改东方财富 lsjz 后的两个辅助函数
describe('第三版：东方财富货币基金页和增量拼接', () => {
  it('eastmoneyMoneyIndex：SYType 是"每百份收益"时按每天收益连乘（第一天 100，× (1 + 收益 / 10000)），LJJZ（7 日年化）不当价格；普通净值页回 null', () => {
    const pg = { Data: { SYType: '每百份收益', LSJZList: [
      { FSRQ: '2026-11-10', DWJZ: '0.2683', LJJZ: '1.0040' },
      { FSRQ: '2026-11-09', DWJZ: '0.2720', LJJZ: '1.0080' },
      { FSRQ: '2026-11-08', DWJZ: '0.5426', LJJZ: '1.0140' },
    ] } };
    const p = eastmoneyMoneyIndex([pg])!;
    expect(p.map((x) => x[0])).toEqual(['2026-11-08', '2026-11-09', '2026-11-10']);
    expect(p[0][2]).toBe(100);
    expect(p[2][2]).toBeCloseTo(100 * (1 + 0.272 / 10000) * (1 + 0.2683 / 10000), 5);
    expect(p[2][1]).toBe(p[2][2]);
    expect(eastmoneyMoneyIndex([{ Data: { SYType: null, LSJZList: [{ FSRQ: '2026-11-10', DWJZ: '1', LJJZ: '1.5' }] } }])).toBeNull();
  });
  it('prevPoints 只认东方财富快照（Yahoo 复权价口径不同不拼）；最后一天补回单位净值；mergePoints 同一天以新的为准', () => {
    const snap = { source: 'eastmoney', date: '2026-11-09', last: 0.5, series: [['2026-11-06', 1.1], ['2026-11-09', 1.2]] };
    expect(prevPoints(snap)).toEqual([['2026-11-06', 1.1, 1.1], ['2026-11-09', 0.5, 1.2]]);
    expect(prevPoints({ ...snap, source: 'yahoo' })).toEqual([]);
    expect(prevPoints(null)).toEqual([]);
    const m = mergePoints(prevPoints(snap), [['2026-11-09', 0.51, 1.21], ['2026-11-10', 0.52, 1.22]]);
    expect(m).toEqual([['2026-11-06', 1.1, 1.1], ['2026-11-09', 0.51, 1.21], ['2026-11-10', 0.52, 1.22]]);
  });
});

describe('第三版复核 R1：price_kind', () => {
  const page = (money: boolean) => async (u: string) => {
    const pg = Number(new URL(u).searchParams.get('pageIndex'));
    const rows = pg > 1 ? [] : Array.from({ length: 20 }, (_, i) => ({ FSRQ: new Date(Date.parse('2026-11-10') - i * DAY).toISOString().slice(0, 10), DWJZ: money ? '0.27' : '1.5', LJJZ: money ? '1.00' : '2.5' }));
    return ok({ Data: { SYType: money ? '每百份收益' : null, LSJZList: rows } });
  };
  it('货币基金页 → index，序列第一点 = 100；普通净值页 → nav', async () => {
    const def = FUNDS.find((f) => f.code === '511990')!;
    const a = await fetchFund(def, new Http(page(true), 45, noSleep), NOW);
    expect(a.price_kind).toBe('index');
    expect(a.series[0][1]).toBe(100);
    expect(a.last).toBeGreaterThan(100);
    const b = await fetchFund(FUNDS.find((f) => f.code === '510300')!, new Http(page(false), 45, noSleep), NOW);
    expect(b.price_kind).toBe('nav');
    expect(b.last).toBe(1.5);
  });
});
