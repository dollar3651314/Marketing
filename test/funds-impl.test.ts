/**
 * 基金观察（src/funds.ts、src/funds-api.ts、migrations/0014_funds.sql）研发自测：口径、清洗、分批额度、取不到保留上次数据、要登录。
 * 外部接口一律用替身（不连网）；D1 用 getPlatformProxy 的本地真实 SQLite。测试会话另写的测试见同目录其他 funds 测试文件。
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import { cleanPoints, FUNDS, maxDrawdown, parseEastmoney, parseYahoo, periodReturn, summarize, type Point } from '../src/funds';
import { Http, MAX_REQUESTS, refreshBatch, TimeUp, type FetchLike } from '../src/funds-api';
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
  it('45 只：新加坡 14、美国 15、中国 16；代码去掉 .SI / .SS；东方财富两只', () => {
    expect(FUNDS.length).toBe(45);
    expect(['新加坡', '美国', '中国'].map((m) => FUNDS.filter((f) => f.market === m).length)).toEqual([14, 15, 16]);
    expect(FUNDS.every((f) => !/\.(SI|SS)$/.test(f.code))).toBe(true);
    expect(FUNDS.filter((f) => f.source === 'eastmoney').map((f) => f.code)).toEqual(['000171', '217003']);
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
      expect(calls).toBeLessThan(10);
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
