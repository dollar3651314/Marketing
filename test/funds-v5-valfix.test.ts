/**
 * 基金观察「估值取数修复」（2026-11-11 正式版第一次刷新：中证约 22 次请求后开始 403「中证拒绝了访问」，Shiller 首页 8 秒没回应，估值只取到沪深300；
 * Amos 选直接上生产）——接口一侧。**测试会话先写（agents C154）**，研发不改断言（底线 6）。页面文案一侧在 scripts/e2e-funds.mjs 的 VD 段。
 * 规格（主会话派工单，逐条）：
 *   1. 中证 perf 每段 ≤ 5 年，首次每个指数 ≤ 3 段（5 个指数合计 ≤ 15 个 perf 请求）；同一来源两个请求间隔 ≥ 5 秒（从上一个请求结束算，跨调用也算，按虚拟时间量；
 *      中证 www + oss-ch 算一个来源，Shiller 首页 + 下载算一个来源）。
 *   2. 遇到 403 或 429：这一轮立刻停止对该来源的所有后续请求（替身让第 N 个请求回 403 / 429，之后对 csindex 0 个请求）；其它来源（Shiller）照常。
 *   3. 断点续取：第一轮在第 k 段被 403，同一天第二轮（或第二天）只请求剩余的段，已取到的段不重取（同一指数的 perf 日期区间不重叠）；
 *      最终拼出的序列和一次取完的标准答案一致（test/fixtures/funds/valuation/val-ref.json，误差 ≤ 0.05）。
 *   4. Shiller：下载成功后把 xls 链接存进 D1，下一次（下个月）直接请求这个链接、不请求首页；这个链接失败才回退首页（再用首页上的新链接）；
 *      首页等 ≥ 20 秒（虚拟时间）没回应才算失败。
 *   4b.（主会话补充，研发交付 a1dfb5d 之后）用存的链接下载解析后，最新月份没比库里前进 → 同一轮再请求一次首页找新链接：有新链接就下载新的；
 *      没有就保留旧数据，页面注明"Shiller 本月还没更新"。每次调用 ≤ 1 个对外请求、同源间隔 ≥ 5 秒。
 *      （前进了的那种：存的链接给的是更新到下个月的表 → 不请求首页。合成表用 test/funds-val-xls.ts 现拼，最新月份比夹具晚。）
 *   5. 文案（只在 e2e 测）。
 *   6. 每天最多 2 轮不变；首次补齐后每天每个指数 ≤ 1 个 perf 请求（中证请求合计每个指数 ≤ 2：perf + 股息率表）。
 * 测试会话的理解（研发有异议走主会话，不私下改）：
 *   - "一轮" = 一次刷新（POST /api/funds/valuation/refresh 从 cursor 0 一路调到 next 为 null）。被 403 / 429 打断的那一轮也算一轮：
 *     同一天已经有 2 轮碰过中证，第 3 轮对中证 0 个请求（按来源数，不按指数分别数）。
 *   - "首页超时 ≥ 20 秒才算失败"：首页 12 秒（虚拟）才回 → 要等到并取完；首页一直不回 → 从发出首页请求到那次调用返回 ≥ 20 秒（虚拟）。
 * 做法：本地 D1（Miniflare 真 SQLite，每个 describe 一个新库）+ 替身 fetch（test/funds-v4-fake.ts 的实抓夹具）+ 虚拟时钟：
 *   只接管 src/ 里发起的 ≥ 200ms 的 setTimeout / AbortSignal.timeout（sleep、请求超时）；被测代码空等时直接把时间拨到最早到期的那个，Date.now 同步往前跳。
 *   不连网、不真等（中证今天已经拦了，绝不连真网络）。
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
import { buildXls } from './funds-val-xls';

const PASS = 'ci_only_copilot_password_01';
const HOST = 'https://copilot.example.test';
const MIG = path.join(ROOT, 'migrations');
const END = '2026-11-10';
const D1A = Date.UTC(2026, 10, 11, 3, 0, 0); // 11/11 11:00 (UTC+8)
const D2 = Date.UTC(2026, 10, 12, 3, 0, 0); // 第二天
const D4 = Date.UTC(2026, 11, 2, 3, 0, 0); // 下个月
const D5 = Date.UTC(2027, 0, 5, 3, 0, 0); // 再下个月
const HOUR = 3600_000;
const GAP = 5_000;
const SEG_DAYS = 5 * 366; // 一段最长 5 年
const TOL = 0.05;
const NUMS = ['pe_now', 'pe_pct10y', 'pe_median10y', 'pe_min10y', 'pe_max10y', 'dy_now', 'exp_a', 'exp_b'] as const;
const REF = Object.fromEntries(VAL_REF.items.map((x) => [x.code, x]));
const HOME_HTML = new TextDecoder().decode(fxBytes('shiller-home.html.gz'));
const OLD_LINK = shillerXlsUrl(HOME_HTML)!; // 夹具首页上的下载链接（img1.wsimg.com/…/ie_data.xls?ver=…）
const NEW_LINK = 'https://img1.wsimg.com/blobby/go/qa-new/downloads/qa-new-2/ie_data.xls?ver=2';
const linkKey = (u: string) => new URL(u).pathname; // 存进 D1 时只认路径（查询串怎么存不管）
const NEW_LINK2 = 'https://img1.wsimg.com/blobby/go/qa-new/downloads/qa-new-3/ie_data.xls?ver=3';
const homeWith = (link: string) => HOME_HTML.split(OLD_LINK.replace(/^https:/, '')).join(link.replace(/^https:/, '')).split(OLD_LINK).join(link);
/** 合成的 Shiller ie_data.xls：2012-01 起到 last（YYYY-MM）每月一行，CAPE = 30 + 月序号 / 100，最后一个月 CAPE = capeLast */
function synthShiller(last: string, capeLast: number): Uint8Array {
  const rows: [number, (string | number | undefined)[]][] = [[5, [undefined, 'S&P']], [7, ['Date', 'P', 'D', 'E', 'CPI', 'Fraction', 'Rate GS10', 'Real', 'Real', 'Return', 'Real', 'Scaled', 'CAPE']]];
  const [ly, lm] = last.split('-').map(Number);
  const n = (ly - 2012) * 12 + lm;
  for (let i = 0; i < n; i++) {
    const y = 2012 + Math.floor(i / 12), m = (i % 12) + 1;
    rows.push([8 + i, [Number(`${y}.${String(m).padStart(2, '0')}`), 3000 + i, 60, 200, 300, 2000, 4, 1, 1, 1, 1, 1, i === n - 1 ? capeLast : 30 + i / 100]]);
  }
  return buildXls([{ name: 'Notes', rows: [[0, ['hello']]] }, { name: 'Data', rows: rows as never }]);
}
const xlsRes = (b: Uint8Array) => new Response(b as unknown as BodyInit, { status: 200, headers: { 'content-type': 'application/vnd.ms-excel' } });
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
type Plan = (url: string, n: { cs: number; perf: number; sh: number }) => Response | { delay: number; res?: Response } | 'hang' | null;
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
    if (p === 'hang' || (p && !(p instanceof Response))) {
      await new Promise<void>((ok, bad) => {
        const tm = p === 'hang' ? null : vAdd(p.delay, ok);
        const fail = () => { if (tm) vClear(tm); bad(new DOMException('This operation was aborted', 'AbortError')); };
        if (sig?.aborted) return fail();
        sig?.addEventListener('abort', fail);
      });
    }
    const res = p instanceof Response ? p : p && p !== 'hang' && p.res ? p.res : await fakeResponse(input, init, { end: END, token: 'unused' });
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
const csOf = (cs: Call[]) => recsOf(cs).filter((r) => isCsindex(r.url));
const perfOf = (cs: Call[]) => csOf(cs).filter((r) => /perf/i.test(new URL(r.url).pathname));
const shOf = (cs: Call[]) => recsOf(cs).filter((r) => isShAny(r.url));
const codeOf = (u: string) => new URL(u).searchParams.get('indexCode') ?? /(\d{6})/.exec(new URL(u).pathname)?.[1] ?? '';
const rangeOf = (u: string) => { const q = new URL(u).searchParams; return [q.get('startDate') ?? '', q.get('endDate') ?? ''] as const; };
const ymd = (s: string) => (/^\d{8}$/.test(s) ? Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)) : NaN);
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
/** 每个指数的 perf 请求数 */
const perfPer = (recs: Rec[]) => Object.fromEntries(VAL_CN.map((c) => [c, recs.filter((r) => codeOf(r.url) === c).length]));

beforeAll(() => { vi.stubGlobal('fetch', fake); installClock(); });
afterAll(async () => { uninstallClock(); vi.unstubAllGlobals(); if (dispose) await dispose(); });

// ================================================================
describe('V5-1 首次一轮、第二天、下个月 Shiller 用存的链接、链接失败才回退首页（规格 1、4、6）', () => {
  beforeAll(freshDb, 60_000);
  let r1: Call[] = [];
  it('首次一轮：中证 perf 每段 ≤ 5 年、每个指数 ≤ 3 段、5 个指数合计 ≤ 15 个；6 个指数和标准答案差 ≤ 0.05', async () => {
    r1 = await round(D1A);
    expect(bad5xx(r1)).toEqual([]);
    const perf = perfOf(r1);
    const long = perf.map((r) => { const [a, b] = rangeOf(r.url); return [short(r.url), (ymd(b) - ymd(a)) / 86400_000] as const; }).filter(([, d]) => !(d >= 0 && d <= SEG_DAYS));
    expect(long, '每段都带 startDate / endDate、不超过 5 年').toEqual([]);
    const per = perfPer(perf);
    expect(Object.entries(per).filter(([, n]) => n > 3 || n < 1), `首次每个指数 1～3 段：${JSON.stringify(per)}`).toEqual([]);
    expect(perf.length, '首次 perf 合计 ≤ 15').toBeLessThanOrEqual(15);
    expect(await compare(D1A)).toEqual([]);
  }, 180_000);
  it('同一来源相邻请求隔 ≥ 5 秒（从上一个结束算；虚拟时间；跨调用也算）', () => {
    expect(gapViolations(log)).toEqual([]);
  });
  it('Shiller 下载成功后，xls 链接存进了 D1', async () => {
    expect(shOf(r1).some((r) => r.url.includes(linkKey(OLD_LINK)) && r.status === 200), '前提：这一轮从首页给的链接下载了 ie_data.xls').toBe(true);
    expect(await dbHas(linkKey(OLD_LINK)), 'D1 里找不到这个链接').not.toEqual([]);
  });
  it('第二天：每个指数 ≤ 1 个 perf 请求、中证合计每个指数 ≤ 2（perf + 股息率表）；Shiller 0 个；数值照旧', async () => {
    const rs = await round(D2);
    expect(bad5xx(rs)).toEqual([]);
    const per = perfPer(perfOf(rs));
    expect(Object.entries(per).filter(([, n]) => n > 1), JSON.stringify(per)).toEqual([]);
    const all = perfPer(csOf(rs));
    expect(Object.entries(all).filter(([, n]) => n > 2), JSON.stringify(all)).toEqual([]);
    expect(shOf(rs).map((r) => short(r.url))).toEqual([]);
    expect(await compare(D2)).toEqual([]);
  }, 120_000);
  it('下个月：Shiller 直接请求存着的 xls 链接（这次表更新到了 2026-11），不请求首页；SPX 前进到 2026-11', async () => {
    // 4b 补充后：存的链接给的表要比库里新，才"不请求首页"（没前进的那种在 V5-5）
    plan = (u) => (u.includes(linkKey(OLD_LINK)) ? xlsRes(synthShiller('2026-11', 41.11)) : null);
    try {
      const rs = await round(D4);
      expect(bad5xx(rs)).toEqual([]);
      const sh = shOf(rs);
      expect(sh.filter((r) => isHome(r.url)).map((r) => r.url), '不该请求 Shiller 首页').toEqual([]);
      expect(sh.length > 0 && sh[0].url.includes(linkKey(OLD_LINK)), `第一个 Shiller 请求应是存着的链接：${JSON.stringify(sh.map((r) => short(r.url)))}`).toBe(true);
      const spx = (await getVal(D4)).items.find((x) => x.code === 'SPX');
      expect([spx?.pe_now_date, spx?.pe_now]).toEqual(['2026-11', 41.11]);
    } finally { plan = () => null; }
  }, 180_000);
  it('再下个月：存着的链接回 404 → 才去首页 → 用首页上的新链接下载（表更新到 2026-12）；D1 里换成新链接', async () => {
    plan = (u) => {
      if (u.includes(linkKey(OLD_LINK))) return new Response('Not Found', { status: 404 });
      if (isHome(u)) return htmlRes(homeWith(NEW_LINK));
      if (u.includes(linkKey(NEW_LINK))) return xlsRes(synthShiller('2026-12', 42.22));
      return null;
    };
    try {
      expect(shillerXlsUrl(homeWith(NEW_LINK)), '前提：替身首页换成了新链接').toBe(NEW_LINK);
      const rs = await round(D5);
      expect(bad5xx(rs)).toEqual([]);
      const seq = shOf(rs).map((r) => (r.url.includes(linkKey(OLD_LINK)) ? 'old' : isHome(r.url) ? 'home' : r.url.includes(linkKey(NEW_LINK)) ? 'new' : short(r.url)));
      expect(seq, '顺序：存着的链接 → 首页 → 首页上的新链接').toEqual(['old', 'home', 'new']);
      const spx = (await getVal(D5)).items.find((x) => x.code === 'SPX');
      expect([spx?.pe_now_date, spx?.pe_now]).toEqual(['2026-12', 42.22]);
      expect(await dbHas(linkKey(NEW_LINK)), 'D1 里应换成新链接').not.toEqual([]);
    } finally { plan = () => null; }
  }, 180_000);
  it('全程（4 轮、跨调用、跨天）同一来源相邻请求隔 ≥ 5 秒', () => {
    expect(gapViolations(log)).toEqual([]);
  });
});

// ================================================================
describe('V5-2 403 / 429：这一轮立刻停止对中证的所有后续请求，Shiller 照常；每天最多 2 轮（规格 2、6）', () => {
  beforeAll(freshDb, 60_000);
  it('第 3 个中证请求回 403：之后这一轮对 csindex 0 个请求；Shiller 照常取完（SPX 对得上）；接口不回 5xx', async () => {
    plan = (u, n) => (isCsindex(u) && n.cs === 3 ? new Response('<html>403 Forbidden</html>', { status: 403 }) : null);
    try {
      const rs = await round(D1A);
      expect(bad5xx(rs)).toEqual([]);
      const recs = recsOf(rs);
      const at = recs.findIndex((r) => r.status === 403);
      expect(at, '前提：有一个请求回了 403').toBeGreaterThanOrEqual(0);
      expect(recs.slice(at + 1).filter((r) => isCsindex(r.url)).map((r) => short(r.url)), '403 之后对中证 0 个请求').toEqual([]);
      expect(shOf(rs).length, 'Shiller 照常请求').toBeGreaterThan(0);
      expect(await compare(D1A, ['SPX'])).toEqual([]);
    } finally { plan = () => null; }
  }, 180_000);
  it('同一天第 2 轮：这一轮第 1 个中证请求回 429 → 之后这一轮对 csindex 0 个请求', async () => {
    const base = cnt.cs;
    plan = (u, n) => (isCsindex(u) && n.cs === base + 1 ? new Response('Too Many Requests', { status: 429, headers: { 'retry-after': '3600' } }) : null);
    try {
      const rs = await round(D1A + HOUR);
      expect(bad5xx(rs)).toEqual([]);
      const cs = csOf(rs);
      expect(cs.length, '第 2 轮还要再试中证（第 1 轮没取完）').toBeGreaterThan(0);
      expect(cs[0].status).toBe(429);
      expect(cs.slice(1).map((r) => short(r.url)), '429 之后对中证 0 个请求').toEqual([]);
    } finally { plan = () => null; }
  }, 120_000);
  it('同一天第 3 轮：今天已经有 2 轮碰过中证（都被拦了），对 csindex 0 个请求', async () => {
    const rs = await round(D1A + 2 * HOUR);
    expect(bad5xx(rs)).toEqual([]);
    expect(csOf(rs).map((r) => short(r.url))).toEqual([]);
  }, 120_000);
  it('第二天不再拦：中证取齐，6 个指数和标准答案差 ≤ 0.05；全程同一来源隔 ≥ 5 秒', async () => {
    const rs = await round(D2);
    expect(bad5xx(rs)).toEqual([]);
    expect(await compare(D2)).toEqual([]);
    expect(gapViolations(log)).toEqual([]);
  }, 180_000);
});

// ================================================================
for (const [label, again] of [['同一天第二轮', D1A + HOUR], ['第二天', D2]] as const) {
  describe(`V5-3 断点续取：第一轮在第 2 段被 403，${label}只取剩下的段（规格 3）`, () => {
    beforeAll(freshDb, 60_000);
    let okR1: Rec[] = [];
    it('第一轮：第 2 个 perf 请求回 403；之前取到的段算数；之后对中证 0 个请求', async () => {
      plan = (u, n) => (isCsindex(u) && /perf/i.test(new URL(u).pathname) && n.perf === 2 ? new Response('Forbidden', { status: 403 }) : null);
      try {
        const rs = await round(D1A);
        expect(bad5xx(rs)).toEqual([]);
        const recs = recsOf(rs);
        const at = recs.findIndex((r) => r.status === 403);
        expect(at).toBeGreaterThanOrEqual(0);
        expect(recs.slice(at + 1).filter((r) => isCsindex(r.url)).map((r) => short(r.url))).toEqual([]);
        okR1 = perfOf(rs).filter((r) => r.status === 200);
        expect(okR1.length, '前提：403 之前取到了 1 段').toBe(1);
      } finally { plan = () => null; }
    }, 180_000);
    it(`${label}：已取到的段不重取（同一指数 perf 日期区间不和第一轮取到的重叠）；每个指数两轮合计 ≤ ${label === '第二天' ? 4 : 3} 段；6 个指数和标准答案差 ≤ 0.05`, async () => {
      const rs = await round(again);
      expect(bad5xx(rs)).toEqual([]);
      const p2 = perfOf(rs);
      const overlap = p2.filter((r) => okR1.some((o) => {
        if (codeOf(o.url) !== codeOf(r.url)) return false;
        const [a, b] = rangeOf(o.url), [c, d] = rangeOf(r.url);
        return c <= b && a <= d;
      })).map((r) => short(r.url));
      expect(overlap, `第一轮已取到：${okR1.map((r) => short(r.url)).join('，')}`).toEqual([]);
      // 第二天多一天新数据，允许多 1 段（只取新的那几天）
      const lim = label === '第二天' ? 4 : 3;
      const per = perfPer([...okR1, ...p2]);
      expect(Object.entries(per).filter(([, n]) => n > lim), JSON.stringify(per)).toEqual([]);
      expect(await compare(again)).toEqual([]);
      expect(gapViolations(log)).toEqual([]);
    }, 180_000);
  });
}

// ================================================================
describe('V5-4 Shiller 首页慢：≥ 20 秒没回应才算失败（规格 4）', () => {
  beforeAll(freshDb, 60_000);
  // 第六版（标普500 修复规格 ①②）：没存过链接时先直接请求已知链接，它失败才去首页 → 这里让首页给的那个链接（就是已知链接）回 404，才会请求首页
  it('首页一直不回：从发出首页请求到那次调用返回 ≥ 20 秒（虚拟）才算失败；中证 5 个照常取完', async () => {
    plan = (u) => (isHome(u) ? 'hang' : u.includes(linkKey(OLD_LINK)) ? new Response('Not Found', { status: 404 }) : null);
    try {
      const rs = await round(D1A);
      expect(bad5xx(rs)).toEqual([]);
      const ci = rs.findIndex((c) => c.recs.some((r) => isHome(r.url)));
      expect(ci, '前提：请求了首页').toBeGreaterThanOrEqual(0);
      const home = rs[ci].recs.find((r) => isHome(r.url))!;
      const waited = rs[ci].tEnd - home.t;
      expect(waited, `首页只等了 ${waited} ms 就放弃`).toBeGreaterThanOrEqual(20_000);
      expect(rs[ci].body?.status, '那次调用这一轮 Shiller 记失败').toBe('failed');
      expect(await compare(D1A, VAL_CN)).toEqual([]);
    } finally { plan = () => null; }
  }, 180_000);
  it('同一天第 2 轮：首页 12 秒（虚拟）才回 → 等到、下载、SPX 和标准答案差 ≤ 0.05', async () => {
    // 第六版：已知链接 404 → 首页（12 秒才回，给一个新链接）→ 新链接走夹具（真 ie_data.xls）
    plan = (u) => (isHome(u) ? { delay: 12_000, res: htmlRes(homeWith(NEW_LINK)) } : u.includes(linkKey(OLD_LINK)) ? new Response('Not Found', { status: 404 }) : null);
    try {
      const rs = await round(D1A + HOUR);
      expect(bad5xx(rs)).toEqual([]);
      expect(shOf(rs).filter((r) => isHome(r.url)).length, '首页只请求 1 次').toBe(1);
      expect(rs.filter((c) => c.body?.status === 'failed').map((c) => [c.body.code, c.body.reason])).toEqual([]);
      expect(await compare(D1A + HOUR, ['SPX'])).toEqual([]);
      expect(gapViolations(log)).toEqual([]);
    } finally { plan = () => null; }
  }, 180_000);
});

// ================================================================
/** 页面（jsdom 跑 FUNDS_JS，数据是真接口 GET /api/funds 的回包）估值板块的文字 */
async function pageValText(now: number): Promise<string> {
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
  for (let k = 0; k < 200 && !w.document.querySelector('[data-val-code="SPX"]'); k++) await new Promise((r) => realST(r, 5));
  const t = (w.document.getElementById('fu-va')?.textContent ?? '').replace(/\s+/g, ' ');
  w.close();
  return t;
}
const D6 = Date.UTC(2027, 1, 3, 3, 0, 0); // 2027-02
describe('V5-5 Shiller 用存的链接下载后最新月份没前进：同一轮再看一次首页（规格 4b，主会话补充）', () => {
  beforeAll(freshDb, 60_000);
  const all: Call[] = [];
  it('前提：首次一轮取齐（夹具表，最新 2026-10），存下链接', async () => {
    const rs = await round(D1A);
    all.push(...rs);
    expect(bad5xx(rs)).toEqual([]);
    expect(await compare(D1A, ['SPX'])).toEqual([]);
    expect(await dbHas(linkKey(OLD_LINK))).not.toEqual([]);
  }, 180_000);
  it('下个月：存的链接给的还是 2026-10 → 同一轮再请求首页；首页上还是同一个链接 → 不再下载，保留旧数据（和标准答案一致），页面注明"Shiller 本月还没更新"', async () => {
    const rs = await round(D4);
    all.push(...rs);
    expect(bad5xx(rs)).toEqual([]);
    const seq = shOf(rs).map((r) => (r.url.includes(linkKey(OLD_LINK)) ? 'old' : isHome(r.url) ? 'home' : short(r.url)));
    expect(seq, '存的链接 → 首页（首页上没有新链接，就到此为止）').toEqual(['old', 'home']);
    expect(await compare(D4, ['SPX'])).toEqual([]);
    const t = await pageValText(D4);
    expect(t, '估值板块要注明').toContain('Shiller 本月还没更新');
  }, 180_000);
  it('再下个月：存的链接还是 2026-10 → 首页上有新链接 → 下载新的（最新 2026-12），D1 换成新链接；页面不再写"本月还没更新"', async () => {
    plan = (u) => (isHome(u) ? htmlRes(homeWith(NEW_LINK2)) : u.includes(linkKey(NEW_LINK2)) ? xlsRes(synthShiller('2026-12', 43.33)) : null);
    try {
      const rs = await round(D5);
      all.push(...rs);
      expect(bad5xx(rs)).toEqual([]);
      const seq = shOf(rs).map((r) => (r.url.includes(linkKey(OLD_LINK)) ? 'old' : isHome(r.url) ? 'home' : r.url.includes(linkKey(NEW_LINK2)) ? 'new' : short(r.url)));
      expect(seq).toEqual(['old', 'home', 'new']);
      const spx = (await getVal(D5)).items.find((x) => x.code === 'SPX');
      expect([spx?.pe_now_date, spx?.pe_now]).toEqual(['2026-12', 43.33]);
      expect(await dbHas(linkKey(NEW_LINK2)), 'D1 里应换成新链接').not.toEqual([]);
      expect(await pageValText(D5)).not.toContain('本月还没更新');
    } finally { plan = () => null; }
  }, 180_000);
  it('又下个月：存的（新）链接给的表前进到 2027-01 → 不请求首页', async () => {
    plan = (u) => (u.includes(linkKey(NEW_LINK2)) ? xlsRes(synthShiller('2027-01', 44.44)) : null);
    try {
      const rs = await round(D6);
      all.push(...rs);
      expect(bad5xx(rs)).toEqual([]);
      const sh = shOf(rs);
      expect(sh.map((r) => (r.url.includes(linkKey(NEW_LINK2)) ? 'new' : isHome(r.url) ? 'home' : short(r.url)))).toEqual(['new']);
      const spx = (await getVal(D6)).items.find((x) => x.code === 'SPX');
      expect([spx?.pe_now_date, spx?.pe_now]).toEqual(['2027-01', 44.44]);
    } finally { plan = () => null; }
  }, 180_000);
  it('这一组全部调用：每次调用 ≤ 1 个对外请求；同一来源相邻请求隔 ≥ 5 秒', () => {
    expect(all.map((c, i) => [i, c.recs.map((r) => short(r.url))] as const).filter(([, u]) => u.length > 1)).toEqual([]);
    expect(gapViolations(log)).toEqual([]);
  });
});
