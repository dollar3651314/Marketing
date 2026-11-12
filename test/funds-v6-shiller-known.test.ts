/**
 * 基金观察「标普500 修复」（2026-11-12：正式版上 Shiller 首页从 Cloudflare 连不上——"Shiller 首页 20 秒没回应"，
 * 但 ie_data.xls 的下载链接本身可以直接下载）——接口 + 页面文字。**测试会话先写（agents C154）**，研发不改断言（底线 6）。
 * 规格（主会话派工单，逐条）：
 *   ① 库里没有存过 Shiller 链接时，第一次直接请求已知链接 KNOWN（下面常量），**不请求 shillerdata.com 首页**；
 *      下载解析成功后链接存进 D1、标普500 卡有数据（和标准答案 val-ref.json 一致，≤ 0.05）。
 *   ② 已知链接失败（不是 403 / 429）才回退首页；首页也失败照旧写原因、不显示 0。
 *   ③ 下个月存的链接数据没前进 → 请求首页；首页连不上 → 保留旧数据，页面注明含"Shiller 本月还没更新"。
 *   ④ 原有规则不变：同源间隔 ≥ 5 秒（虚拟时间）、每次调用 ≤ 1 个对外请求、每天最多 2 轮、403 / 429 立刻停。
 * 测试会话的理解（研发有异议走主会话，不私下改）：
 *   - "库里没有存过链接"包括两种：全新的库；正式版现在的样子（SPX 那行只有上次的失败原因、没有数据，Shiller 今天前已经试过）。
 *   - 已知链接"失败"：404、500、超时不回、网络错误、回的不是 xls（200 但内容是网页）都算；403 / 429 是"被拦"，立刻停，不去首页。
 *   - ② 回退首页后用首页上给的链接下载（替身首页给一个新链接），成功后 D1 存的是这个新链接。
 *   - ③ "连不上"按正式版的样子：首页一直不回（等满 20 秒）；另测一种网络错误。保留的旧数据和标准答案一致。
 *   - 已知链接的 ver 参数也要一样（原样请求这个链接）。
 * 做法照 test/funds-v5-valfix.test.ts：本地 D1（Miniflare 真 SQLite，每个 describe 一个新库）+ 替身 fetch（test/funds-v4-fake.ts 的实抓夹具）+ 虚拟时钟。不连网、不真等。
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import { shillerXlsUrl } from '../src/funds-val';
import { fakeResponse, fxBytes, isCsindex, isShiller, urlOf, VAL_CN, VAL_CODES, VAL_REF } from './funds-v4-fake';
import { ROOT } from './helpers';

const PASS = 'ci_only_copilot_password_01';
const HOST = 'https://copilot.example.test';
const MIG = path.join(ROOT, 'migrations');
const END = '2026-11-10';
const D1A = Date.UTC(2026, 10, 11, 3, 0, 0); // 11/11 11:00 (UTC+8)
const D2 = Date.UTC(2026, 10, 12, 3, 0, 0); // 第二天
const D4 = Date.UTC(2026, 11, 2, 3, 0, 0); // 下个月
const HOUR = 3600_000;
const GAP = 5_000;
const TOL = 0.05;
const NUMS = ['pe_now', 'pe_pct10y', 'pe_median10y', 'pe_min10y', 'pe_max10y', 'dy_now', 'exp_a', 'exp_b'] as const;
const REF = Object.fromEntries(VAL_REF.items.map((x) => [x.code, x]));
const HOME_HTML = new TextDecoder().decode(fxBytes('shiller-home.html.gz'));
const OLD_LINK = shillerXlsUrl(HOME_HTML)!; // 夹具首页上的下载链接（img1.wsimg.com/…/ie_data.xls?ver=…）
const NEW_LINK = 'https://img1.wsimg.com/blobby/go/qa-new/downloads/qa-new-2/ie_data.xls?ver=2';
const linkKey = (u: string) => new URL(u).pathname; // 存进 D1 时只认路径（查询串怎么存不管）
const homeWith = (link: string) => HOME_HTML.split(OLD_LINK.replace(/^https:/, '')).join(link.replace(/^https:/, '')).split(OLD_LINK).join(link);
const htmlRes = (h: string) => new Response(h, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });

// ---------------------------------------------------------------- 虚拟时钟
const SRC = path.join(ROOT, 'src') + path.sep;
const realST = globalThis.setTimeout, realCT = globalThis.clearTimeout, realNow = Date.now.bind(Date);
const realSigTimeout = AbortSignal.timeout.bind(AbortSignal);
class VT { constructor(public id: number) {} unref() { return this; } ref() { return this; } hasRef() { return true; } refresh() { return this; } [Symbol.toPrimitive]() { return this.id; } }
const vc = { skew: 0, seq: 0, ver: 0, timers: new Map<number, { due: number; fn: () => void }>() };
const vnow = () => realNow() + vc.skew;
function vAdd(ms: number, fn: () => void): VT { const id = ++vc.seq; vc.timers.set(id, { due: vnow() + ms, fn }); vc.ver++; return new VT(id); }
function vClear(h: unknown): boolean { if (h instanceof VT) { if (vc.timers.delete(h.id)) vc.ver++; return true; } return false; }
const fromSrc = () => (new Error().stack ?? '').includes(SRC);
let driver: ReturnType<typeof setInterval> | undefined;
function installClock() {
  vi.spyOn(Date, 'now').mockImplementation(vnow);
  globalThis.setTimeout = ((cb: (...a: unknown[]) => void, ms?: number, ...a: unknown[]) =>
    (typeof ms === 'number' && ms >= 200 && fromSrc() ? vAdd(ms, () => cb(...a)) : realST(cb, ms, ...a))) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((h: unknown) => { if (!vClear(h)) realCT(h as ReturnType<typeof setTimeout>); }) as typeof clearTimeout;
  AbortSignal.timeout = (ms: number) => {
    if (!fromSrc()) return realSigTimeout(ms);
    const ac = new AbortController();
    vAdd(ms, () => ac.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError')));
    return ac.signal;
  };
  // 被测代码在等计时器（别的都停了，连续几次检查计时器表没变）→ 把时间拨到最早到期的那个，触发它
  let seen = -1, still = 0;
  driver = setInterval(() => {
    if (!vc.timers.size) { still = 0; return; }
    if (vc.ver !== seen) { seen = vc.ver; still = 0; return; }
    if (++still < 3) return;
    still = 0;
    let best: [number, { due: number; fn: () => void }] | null = null;
    for (const e of vc.timers) if (!best || e[1].due < best[1].due) best = e;
    vc.timers.delete(best![0]); vc.ver++;
    const d = best![1].due - vnow();
    if (d > 0) vc.skew += d;
    best![1].fn();
  }, 8);
}
function uninstallClock() {
  if (driver) clearInterval(driver);
  globalThis.setTimeout = realST; globalThis.clearTimeout = realCT; AbortSignal.timeout = realSigTimeout;
  vi.restoreAllMocks();
}

// ---------------------------------------------------------------- 替身 fetch（按计划回 403 / 429 / 404 / 慢 / 不回）
type Rec = { url: string; t: number; end: number; status: number };
type Plan = (url: string, n: { cs: number; perf: number; sh: number }) => Response | { delay: number } | 'hang' | 'neterr' | null;
let log: Rec[] = [];
let plan: Plan = () => null;
const cnt = { cs: 0, perf: 0, sh: 0 };
const isShAny = (u: string) => isShiller(u) || /(^|\.)shillerdata\.com$/i.test(new URL(u).hostname);
const isHome = (u: string) => /(^|\.)shillerdata\.com$/i.test(new URL(u).hostname) && !/ie_data\.xls/i.test(u);
const realFetch = globalThis.fetch;
const fake = vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
  const url = urlOf(input);
  const h = new URL(url).hostname;
  if (h === '127.0.0.1' || h === 'localhost') return realFetch(input as RequestInfo, init);
  if (isCsindex(url)) { cnt.cs++; if (/perf/i.test(new URL(url).pathname)) cnt.perf++; }
  if (isShAny(url)) cnt.sh++;
  const rec: Rec = { url, t: vnow(), end: 0, status: 0 };
  log.push(rec);
  const p = plan(url, { ...cnt });
  const sig = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  try {
    if (p === 'neterr') throw new TypeError('fetch failed');
    if (p === 'hang' || (p && !(p instanceof Response))) {
      await new Promise<void>((ok, bad) => {
        const tm = p === 'hang' ? null : vAdd(p.delay, ok);
        const fail = () => { if (tm) vClear(tm); bad(new DOMException('This operation was aborted', 'AbortError')); };
        if (sig?.aborted) return fail();
        sig?.addEventListener('abort', fail);
      });
    }
    const res = p instanceof Response ? p : await fakeResponse(input, init, { end: END, token: 'unused' });
    rec.status = res.status;
    return res;
  } catch (e) { rec.status = -1; throw e; } finally { rec.end = vnow(); }
});

// ---------------------------------------------------------------- D1、接口
let db: D1Database;
let dispose: (() => Promise<void>) | null = null;
const stmtsOf = (files: string[]) =>
  files.map((f) => readFileSync(path.join(MIG, f), 'utf8').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n'))
    .join(';\n').split(';').map((s) => s.trim()).filter(Boolean);
async function freshDb() {
  if (dispose) await dispose();
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: path.join(ROOT, 'test/wrangler.test.toml'), persist: false, remoteBindings: false, envFiles: [] });
  db = proxy.env.DB;
  dispose = proxy.dispose;
  await db.batch(stmtsOf(readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort()).map((s) => db.prepare(s)));
  log = []; plan = () => null; cnt.cs = cnt.perf = cnt.sh = 0;
}
const env = (): Env => ({ DB: db, ENVIRONMENT: 'test', COPILOT_PASSWORD: PASS });
let ck = '';
const req = (p: string, init: RequestInit & { cookie?: string } = {}) =>
  new Request(`${HOST}${p}`, { ...init, headers: { 'content-type': 'application/json', origin: HOST, 'cf-connecting-ip': '203.0.113.9', ...(init.cookie ? { cookie: init.cookie } : {}) } });
async function login(now: number) {
  const r = await handle(req('/api/login', { method: 'POST', body: JSON.stringify({ password: PASS }) }), env(), now);
  ck = r.headers.get('set-cookie')!.split(';')[0];
}
type Call = { status: number; body: any; recs: Rec[]; tEnd: number };
/** 一轮：POST /api/funds/valuation/refresh 从 cursor 0 一路调到 next 为 null（硬上限 400 次） */
async function round(now: number): Promise<Call[]> {
  await login(now);
  const calls: Call[] = [];
  let next: unknown;
  for (let i = 0; i < 400; i++) {
    const n0 = log.length;
    const r = await handle(req('/api/funds/valuation/refresh', { method: 'POST', cookie: ck, body: JSON.stringify(next == null ? {} : { cursor: next }) }), env(), now, fake as never);
    let body: any = {};
    try { body = await r.json(); } catch { body = {}; }
    calls.push({ status: r.status, body, recs: log.slice(n0), tEnd: vnow() });
    next = body?.next;
    if (r.status !== 200 || next == null) break;
  }
  return calls;
}
const recsOf = (cs: Call[]) => cs.flatMap((c) => c.recs);
const shOf = (cs: Call[]) => recsOf(cs).filter((r) => isShAny(r.url));
const short = (u: string) => u.replace(/^https?:\/\/[^/]+/, '').slice(0, 90);
const bad5xx = (cs: Call[]) => cs.filter((c) => c.status !== 200).map((c) => [c.status, c.body]);

async function getVal(now: number): Promise<{ items: Record<string, any>[]; missing: Record<string, any>[] }> {
  const r = await handle(req('/api/funds', { cookie: ck }), env(), now, fake as never);
  expect(r.status).toBe(200);
  const j = (await r.json()) as any;
  return { items: j?.valuation?.items ?? [], missing: j?.valuation?.missing ?? [] };
}
/** 和标准答案比（只比 codes 里的） */
async function compare(now: number, codes: string[] = VAL_CODES): Promise<string[]> {
  const { items } = await getVal(now);
  const by = Object.fromEntries(items.map((x) => [x.code, x]));
  const bad: string[] = [];
  for (const code of codes) {
    const x = by[code], ref = REF[code];
    if (!x) { bad.push(`${code}：没有`); continue; }
    for (const k of NUMS) if (!(typeof x[k] === 'number' && Math.abs(x[k] - ref[k]) <= TOL)) bad.push(`${code}.${k} = ${x[k]}，标准答案 ${ref[k]}`);
    if (x.n_months !== 120) bad.push(`${code}.n_months = ${x.n_months}`);
    const s = (x.pe_series ?? []) as [string, number][];
    const r120 = ref.pe_series as [string, number][];
    const off = s.slice(-120).map((p, i) => [p[0], p[1], r120[i]] as const).filter(([m, v, r]) => !r || m !== r[0] || Math.abs(v - r[1]) > TOL);
    if (s.length < 120 || off.length) bad.push(`${code}.pe_series 有 ${s.length} 个月，最近 120 个月 ${off.length} 个对不上，例如 ${JSON.stringify(off.slice(0, 2))}`);
  }
  return bad;
}
/** D1 里任何业务表的任何一格（按文本）含 s */
async function dbHas(s: string): Promise<string[]> {
  const ts = ((await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'").all<{ name: string }>()).results ?? []).map((x) => x.name);
  const hit: string[] = [];
  for (const t of ts) {
    const cols = ((await db.prepare(`PRAGMA table_info("${t}")`).all<{ name: string; type: string }>()).results ?? []).filter((c) => !/blob/i.test(c.type)).map((c) => c.name);
    for (const c of cols) {
      const r = await db.prepare(`SELECT COUNT(*) AS n FROM "${t}" WHERE typeof("${c}") = 'text' AND instr("${c}", ?1) > 0`).bind(s).first<{ n: number }>();
      if (Number(r?.n ?? 0) > 0) hit.push(`${t}.${c}`);
    }
  }
  return hit;
}
/** 同一来源相邻两个请求：后一个的开始 − 前一个的结束 < 5 秒的（虚拟时间） */
function gapViolations(recs: Rec[]): string[] {
  const out: string[] = [];
  for (const [name, is] of [['中证', isCsindex], ['Shiller', isShAny]] as const) {
    const xs = recs.filter((r) => is(r.url));
    for (let i = 1; i < xs.length; i++) {
      const g = xs[i].t - (xs[i - 1].end || xs[i - 1].t);
      if (g < GAP - 5) out.push(`${name}：${short(xs[i - 1].url)} → ${short(xs[i].url)} 只隔 ${g} ms`);
    }
  }
  return out;
}

// ---------------------------------------------------------------- 第六版：已知链接
/** 派工单给的已知链接（正式版上可以直接下载） */
const KNOWN = 'https://img1.wsimg.com/blobby/go/e5e77e0b-59d1-44d9-ab25-4763ac982e53/downloads/1449043e-a1ed-4e2e-8e9c-7b9a2a064493/ie_data.xls?ver=1791297298731';
const isKnown = (u: string) => { const a = new URL(u), b = new URL(KNOWN); return a.hostname === b.hostname && a.pathname === b.pathname && a.searchParams.get('ver') === b.searchParams.get('ver'); };
const tag = (u: string) => (isKnown(u) ? 'known' : isHome(u) ? 'home' : u.includes(linkKey(NEW_LINK)) ? 'new' : short(u));
const shSeq = (cs: Call[]) => shOf(cs).map((r) => tag(r.url));
/** 每次调用 ≤ 1 个对外请求 */
const multi = (cs: Call[]) => cs.map((c, i) => [i, c.recs.map((r) => short(r.url))] as const).filter(([, u]) => u.length > 1);
/** 页面（jsdom 跑 FUNDS_JS，数据是真接口 GET /api/funds 的回包）里某张估值卡的文字 */
async function pageCard(now: number, code: string): Promise<string> {
  const g = await handle(req('/api/funds', { cookie: ck }), env(), now, fake as never);
  const snap = await g.json();
  const jsdomName = 'jsdom';
  const { JSDOM } = await import(jsdomName);
  const { FUNDS_MOD, FUNDS_JS } = await import('../src/funds-page');
  const dom = new JSDOM(`<!doctype html><body><main id="app">${FUNDS_MOD}</main></body>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window as any;
  w.fetch = async () => ({ status: 200, ok: true, json: async () => JSON.parse(JSON.stringify(snap)) });
  w.matchMedia = () => ({ matches: false });
  w.eval(FUNDS_JS);
  w.document.getElementById('v-funds').hidden = false;
  w.fundsOpen();
  for (let k = 0; k < 200 && !w.document.querySelector(`[data-val-code="${code}"]`); k++) await new Promise((r) => realST(r, 5));
  const t = (w.document.querySelector(`[data-val-code="${code}"]`)?.textContent ?? '').replace(/\s+/g, ' ');
  w.close();
  return t;
}
/** 正式版现在的样子：SPX 只有上次的失败原因、没有数据；Shiller 前一天试过 2 轮（没成功） */
async function seedProd(now: number) {
  await db.batch([
    db.prepare('INSERT INTO fund_valuation (code, data, ok_at, err, err_at) VALUES (?1, NULL, NULL, ?2, ?3)').bind('SPX', '首页：Shiller 首页 20 秒没回应', now - 24 * HOUR),
    db.prepare('INSERT INTO fund_val_fetch (src, day, tries, at, ok_day) VALUES (?1, ?2, 2, ?3, NULL)').bind('shiller', '2026-11-10', now - 24 * HOUR),
  ]);
}
const spxItem = async (now: number) => (await getVal(now)).items.find((x) => x.code === 'SPX');
const spxMiss = async (now: number) => (await getVal(now)).missing.find((x) => x.code === 'SPX');

beforeAll(() => { vi.stubGlobal('fetch', fake); installClock(); });
afterAll(async () => { uninstallClock(); vi.unstubAllGlobals(); if (dispose) await dispose(); });

// ================================================================
for (const [label, seed] of [['全新的库', null], ['正式版现在的样子（SPX 只有失败原因、没有数据）', seedProd]] as const) {
  describe(`V6-1 ${label}：第一次直接请求已知链接，不请求首页（规格 ①）`, () => {
    beforeAll(async () => { await freshDb(); if (seed) await seed(D1A); }, 60_000);
    let rs: Call[] = [];
    it('前提：D1 里没有存过 Shiller 链接；替身首页上的链接就是已知链接', async () => {
      expect(await dbHas('ie_data.xls')).toEqual([]);
      expect(isKnown(OLD_LINK)).toBe(true);
    });
    it('这一轮 Shiller 只请求已知链接（原样，含 ver）1 次，0 次首页；标普500 卡和标准答案差 ≤ 0.05', async () => {
      rs = await round(D1A);
      expect(bad5xx(rs)).toEqual([]);
      expect(shSeq(rs), 'Shiller 请求顺序').toEqual(['known']);
      expect(shOf(rs).filter((r) => isHome(r.url)).map((r) => r.url), '不该请求 shillerdata.com 首页').toEqual([]);
      expect(rs.filter((c) => c.body?.code === 'SPX' && c.body?.status === 'failed').map((c) => c.body.reason)).toEqual([]);
      expect(await compare(D1A, ['SPX'])).toEqual([]);
    }, 180_000);
    it('已知链接存进了 D1；SPX 没有失败原因、不在 missing 里', async () => {
      expect(await dbHas(linkKey(KNOWN)), 'D1 里找不到这个链接').not.toEqual([]);
      expect(await spxMiss(D1A)).toBeUndefined();
      expect((await spxItem(D1A))?.error).toBeUndefined();
    });
    it('中证 5 个照常；每次调用 ≤ 1 个对外请求；同一来源相邻请求隔 ≥ 5 秒', async () => {
      expect(await compare(D1A, VAL_CN)).toEqual([]);
      expect(multi(rs)).toEqual([]);
      expect(gapViolations(log)).toEqual([]);
    }, 60_000);
  });
}

// ================================================================
const FAILS: [string, (u: string) => ReturnType<Plan>][] = [
  ['404', () => new Response('Not Found', { status: 404 })],
  ['500', () => new Response('upstream error', { status: 500 })],
  ['一直不回（超时）', () => 'hang'],
  ['网络错误', () => 'neterr'],
  ['200 但回的是网页、不是 xls', () => htmlRes('<html><body>moved</body></html>')],
];
for (const [label, failKnown] of FAILS) {
  describe(`V6-2 已知链接失败（${label}）→ 才回退首页，用首页上的链接下载（规格 ②）`, () => {
    beforeAll(freshDb, 60_000);
    it('Shiller 顺序：已知链接 → 首页 → 首页上的新链接；标普500 和标准答案差 ≤ 0.05；D1 存的是新链接', async () => {
      plan = (u) => (isKnown(u) ? failKnown(u) : isHome(u) ? htmlRes(homeWith(NEW_LINK)) : null); // 新链接走夹具（真 ie_data.xls）
      try {
        expect(shillerXlsUrl(homeWith(NEW_LINK)), '前提：替身首页换成了新链接').toBe(NEW_LINK);
        const rs = await round(D1A);
        expect(bad5xx(rs)).toEqual([]);
        expect(shSeq(rs)).toEqual(['known', 'home', 'new']);
        expect(await compare(D1A, ['SPX'])).toEqual([]);
        expect(await dbHas(linkKey(NEW_LINK)), 'D1 里应存首页上的新链接').not.toEqual([]);
        expect(multi(rs)).toEqual([]);
        expect(gapViolations(log)).toEqual([]);
      } finally { plan = () => null; }
    }, 180_000);
  });
}

// ================================================================
for (const st of [403, 429] as const) {
  describe(`V6-3 已知链接回 ${st}：立刻停，不去首页（规格 ②、④）`, () => {
    beforeAll(freshDb, 60_000);
    it(`这一轮 Shiller 只有已知链接 1 个请求；SPX 没有数据、写了原因（不是 0）；中证照常`, async () => {
      plan = (u) => (isKnown(u) ? new Response('blocked', { status: st }) : null);
      try {
        const rs = await round(D1A);
        expect(bad5xx(rs)).toEqual([]);
        expect(shSeq(rs)).toEqual(['known']);
        expect(await spxItem(D1A), '没取到就不该有标普500 的数值卡').toBeUndefined();
        expect(String((await spxMiss(D1A))?.error ?? ''), 'missing 里要写原因').toMatch(/\S/);
        expect(await compare(D1A, VAL_CN)).toEqual([]);
        expect(multi(rs)).toEqual([]);
        expect(gapViolations(log)).toEqual([]);
      } finally { plan = () => null; }
    }, 180_000);
  });
}

// ================================================================
describe('V6-4 已知链接 404、首页也连不上：写原因、不显示 0；每天最多 2 轮（规格 ②、④）', () => {
  beforeAll(freshDb, 60_000);
  const all: Call[] = [];
  it('第 1 轮：已知链接 404 → 首页一直不回（等满 20 秒）→ 失败；SPX 没有数值卡，页面上标普500 写"还没有估值数据：原因"', async () => {
    plan = (u) => (isKnown(u) ? new Response('Not Found', { status: 404 }) : isHome(u) ? 'hang' : null);
    try {
      const rs = await round(D1A);
      all.push(...rs);
      expect(bad5xx(rs)).toEqual([]);
      expect(shSeq(rs)).toEqual(['known', 'home']);
      const ci = rs.findIndex((c) => c.recs.some((r) => isHome(r.url)));
      const home = rs[ci].recs.find((r) => isHome(r.url))!;
      expect(rs[ci].tEnd - home.t, '首页要等满 20 秒才算失败').toBeGreaterThanOrEqual(20_000);
      expect(rs[ci].body?.status).toBe('failed');
      expect(await spxItem(D1A)).toBeUndefined();
      expect(String((await spxMiss(D1A))?.error ?? '')).toMatch(/\S/);
      const t = await pageCard(D1A, 'SPX');
      expect(t).toContain('还没有估值数据：');
      expect(t, '不该显示数值').not.toMatch(/CAPE 现在|分位/);
      expect(await compare(D1A, VAL_CN)).toEqual([]);
    } finally { plan = () => null; }
  }, 180_000);
  it('同一天第 2 轮：还是先请求已知链接（失败）→ 首页（500）→ 失败；SPX 照旧写原因', async () => {
    plan = (u) => (isKnown(u) ? new Response('Not Found', { status: 404 }) : isHome(u) ? new Response('upstream error', { status: 500 }) : null);
    try {
      const rs = await round(D1A + HOUR);
      all.push(...rs);
      expect(bad5xx(rs)).toEqual([]);
      expect(shSeq(rs)).toEqual(['known', 'home']);
      expect(await spxItem(D1A + HOUR)).toBeUndefined();
      expect(String((await spxMiss(D1A + HOUR))?.error ?? '')).toMatch(/\S/);
    } finally { plan = () => null; }
  }, 180_000);
  it('同一天第 3 轮：Shiller 0 个请求（每天最多 2 轮）', async () => {
    const rs = await round(D1A + 2 * HOUR);
    all.push(...rs);
    expect(bad5xx(rs)).toEqual([]);
    expect(shSeq(rs)).toEqual([]);
  }, 120_000);
  it('第二天：已知链接恢复 → 只请求已知链接、不请求首页，SPX 和标准答案差 ≤ 0.05', async () => {
    const rs = await round(D2);
    all.push(...rs);
    expect(bad5xx(rs)).toEqual([]);
    expect(shSeq(rs)).toEqual(['known']);
    expect(await compare(D2, ['SPX'])).toEqual([]);
  }, 180_000);
  it('这一组全部调用：每次调用 ≤ 1 个对外请求；同一来源相邻请求隔 ≥ 5 秒', () => {
    expect(multi(all)).toEqual([]);
    expect(gapViolations(log)).toEqual([]);
  });
});

// ================================================================
for (const [label, homeFail] of [['一直不回（正式版的样子）', 'hang'], ['网络错误', 'neterr']] as const) {
  describe(`V6-5 下个月存的链接没前进、首页连不上（${label}）：保留旧数据，页面注明"Shiller 本月还没更新"（规格 ③）`, () => {
    beforeAll(freshDb, 60_000);
    const all: Call[] = [];
    it('前提：这个月第一轮用已知链接取齐（夹具表，最新 2026-10），存下链接', async () => {
      const rs = await round(D1A);
      all.push(...rs);
      expect(bad5xx(rs)).toEqual([]);
      expect(shSeq(rs)).toEqual(['known']);
      expect(await compare(D1A, ['SPX'])).toEqual([]);
      expect(await dbHas(linkKey(KNOWN))).not.toEqual([]);
    }, 180_000);
    it('下个月：存的链接还是 2026-10 → 请求首页 → 首页连不上；SPX 保留旧数据（和标准答案一致），页面标普500 卡注明"Shiller 本月还没更新"', async () => {
      plan = (u) => (isHome(u) ? homeFail : null);
      try {
        const rs = await round(D4);
        all.push(...rs);
        expect(bad5xx(rs)).toEqual([]);
        expect(shSeq(rs), '存的链接 → 首页').toEqual(['known', 'home']);
        expect(await compare(D4, ['SPX'])).toEqual([]);
        const t = await pageCard(D4, 'SPX');
        expect(t, '标普500 卡要注明').toContain('Shiller 本月还没更新');
        expect(t, '旧数据照常显示').toMatch(/CAPE 现在/);
        expect(await dbHas(linkKey(KNOWN)), '存的链接还留着').not.toEqual([]);
      } finally { plan = () => null; }
    }, 180_000);
    it('这一组全部调用：每次调用 ≤ 1 个对外请求；同一来源相邻请求隔 ≥ 5 秒', () => {
      expect(multi(all)).toEqual([]);
      expect(gapViolations(log)).toEqual([]);
    });
  });
}
