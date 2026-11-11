/**
 * 基金观察第四版 D：② 估值"现在贵不贵"（Amos 2026-11-11「都按建议」）——接口一侧。**测试会话先写（agents C154）**，研发不改断言（底线 6）。页面一侧在 scripts/e2e-funds.mjs 的 VA 段。
 * 规格：
 *   6 个指数：000300 沪深300、000016 上证50、000905 中证500、000015 上证红利、000922 中证红利（中证指数官网 PE + 股息率）、SPX 标普500（Shiller CAPE）。
 *   计算：过去 120 个月（每月取该月最后一个有值的交易日；A 股当月取最新交易日）的分位（≤ 当前值的月份占比，0～100）、中位数、最低、最高；
 *     预期年化 a = 1/PE（标普 1/CAPE）；b = 股息率 + 增长假设（A 股 5%、美国 4%）+ ((中位数 / 当前)^(1/10) − 1)；都是百分数。
 *     标准答案：test/fixtures/funds/valuation/val-ref.json（agents 调研会话 scripts/calc.py 用同一批实抓原始文件算的），误差 ≤ 0.05。
 *   来源只请求 csindex.com.cn（含 oss-ch.csindex.com.cn）和 shillerdata.com（以及 shillerdata.com 首页下载链接指向的 ie_data.xls，实抓在 img1.wsimg.com）；
 *     不请求 danjuanfunds、multpl、msci、ftse。
 *   **同一来源同一天第二次刷新不再请求**（中证按 UTC+8 的日期；Shiller 当月不再请求）。
 *   无定时任务（wrangler 无 crons，src/index.ts 不导出 scheduled）。
 * 接口约定（研发照做；两种都认，要改就在同一个提交里改这里并写明）：
 *   取：GET /api/funds 回包顶层 valuation = { items: ValItem[], fetched_at? }；或者单独 GET /api/funds/valuation 回 { items: ValItem[] }（或 { valuation: { items } }）。
 *   刷新：在 POST /api/funds/refresh 循环里顺带取（每次仍 ≤ 45 个对外请求）；或者单独 POST /api/funds/valuation/refresh（页面在价格循环之后调，可回 next 分批）。
 *     本文件的"一次完整刷新" = refresh 一路调到 next 为 null，再调 POST /api/funds/valuation/refresh（回 404 就当没有这个接口）直到没有 next。
 *   ValItem：{ code: '000300' | '000016' | '000905' | '000015' | '000922' | 'SPX', name, market: '中国' | '美国', funds: string[],
 *     pe_now, pe_now_date, pe_pct10y（0～100）, pe_median10y, pe_min10y, pe_max10y, n_months（120）, dy_now（股息率 %）, exp_a（%）, exp_b（%）,
 *     pe_series: [月份 'YYYY-MM', 值][]（至少最近 120 个月）, source（来源文字） }——字段名照调研的 val.json。
 * 做法：本地 D1（Miniflare 真 SQLite）+ 替身 fetch（test/funds-v4-fake.ts，回 test/fixtures/funds/valuation/ 的实抓夹具），不连网。
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import { fakeResponse, isBannedVal, isCsindex, isEm, isShiller, isTiingo, isYahoo, urlOf, VAL_CN, VAL_CODES, VAL_REF } from './funds-v4-fake';
import { yieldHost } from './funds-yield-fake';
import { ROOT } from './helpers';

const PASS = 'ci_only_copilot_password_01';
const HOST = 'https://copilot.example.test';
const MIG = path.join(ROOT, 'migrations');
// 时间都选在 UTC 和 UTC+8 同一天里
const D1A = Date.UTC(2026, 10, 11, 3, 0, 0); // 11/11 11:00 (UTC+8)
const D1B = Date.UTC(2026, 10, 11, 5, 30, 0); // 同一天再刷
const D2 = Date.UTC(2026, 10, 12, 3, 0, 0); // 第二天（同一个月）
const D3 = Date.UTC(2026, 10, 13, 3, 0, 0); // 第三天：中证坏了
const D4 = Date.UTC(2026, 11, 2, 3, 0, 0); // 下个月
const END = '2026-11-10';
const LIMIT = 45;
const TOL = 0.05;
const NUMS = ['pe_now', 'pe_pct10y', 'pe_median10y', 'pe_min10y', 'pe_max10y', 'dy_now', 'exp_a', 'exp_b'] as const;
const REF = Object.fromEntries(VAL_REF.items.map((x) => [x.code, x]));

const stmtsOf = (files: string[]) =>
  files.map((f) => readFileSync(path.join(MIG, f), 'utf8').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n'))
    .join(';\n').split(';').map((s) => s.trim()).filter(Boolean);

let outbound: string[] = [];
let down = new Set<'csindex' | 'shiller'>();
const realFetch = globalThis.fetch;
const fake = vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
  const url = urlOf(input);
  const h = new URL(url).hostname;
  if (h === '127.0.0.1' || h === 'localhost') return realFetch(input as RequestInfo, init);
  outbound.push(url);
  return fakeResponse(input, init, { end: END, token: 'unused', down });
});

let db: D1Database;
let dispose: () => Promise<void>;
let ck = '';
const env = (): Env => ({ DB: db, ENVIRONMENT: 'test', COPILOT_PASSWORD: PASS });
const req = (p: string, init: RequestInit & { cookie?: string } = {}) =>
  new Request(`${HOST}${p}`, { ...init, headers: { 'content-type': 'application/json', origin: HOST, 'cf-connecting-ip': '203.0.113.9', ...(init.cookie ? { cookie: init.cookie } : {}) } });
async function login(now: number) {
  const r = await handle(req('/api/login', { method: 'POST', body: JSON.stringify({ password: PASS }) }), env(), now);
  ck = r.headers.get('set-cookie')!.split(';')[0];
}
beforeAll(async () => {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: path.join(ROOT, 'test/wrangler.test.toml'), persist: false, remoteBindings: false, envFiles: [] });
  db = proxy.env.DB;
  dispose = proxy.dispose;
  await db.batch(stmtsOf(readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort()).map((s) => db.prepare(s)));
  vi.stubGlobal('fetch', fake);
});
afterAll(async () => { vi.unstubAllGlobals(); await dispose(); });

type Round = { urls: string[]; status: number; body: any; path: string };
/** 一次完整刷新（见文件头的约定） */
async function refreshAll(now: number): Promise<Round[]> {
  await login(now);
  const rounds: Round[] = [];
  let cursor: number | undefined;
  for (let i = 0; i < 60; i++) {
    outbound = [];
    const r = await handle(req('/api/funds/refresh', { method: 'POST', cookie: ck, body: JSON.stringify(cursor === undefined ? {} : { cursor }) }), env(), now, fake as never);
    const body = (await r.json()) as any;
    rounds.push({ urls: outbound.slice(), status: r.status, body, path: 'refresh' });
    if (r.status !== 200 || body.next == null) break;
    cursor = body.next;
  }
  let next: unknown;
  for (let i = 0; i < 10; i++) {
    outbound = [];
    const r = await handle(req('/api/funds/valuation/refresh', { method: 'POST', cookie: ck, body: JSON.stringify(next == null ? {} : { cursor: next }) }), env(), now, fake as never);
    if (r.status === 404) break;
    let body: any = {};
    try { body = await r.json(); } catch { body = {}; }
    rounds.push({ urls: outbound.slice(), status: r.status, body, path: 'valuation/refresh' });
    next = body?.next;
    if (r.status !== 200 || next == null) break;
  }
  return rounds;
}
/** 读估值（两种接口都认） */
async function getVal(now: number): Promise<Record<string, any>[] | null> {
  const r = await handle(req('/api/funds', { cookie: ck }), env(), now, fake as never);
  expect(r.status).toBe(200);
  const j = (await r.json()) as any;
  if (Array.isArray(j?.valuation?.items)) return j.valuation.items;
  const r2 = await handle(req('/api/funds/valuation', { cookie: ck }), env(), now, fake as never);
  if (r2.status !== 200) return null;
  const j2 = (await r2.json()) as any;
  return Array.isArray(j2?.items) ? j2.items : Array.isArray(j2?.valuation?.items) ? j2.valuation.items : null;
}
const valUrls = (rs: Round[]) => rs.flatMap((r) => r.urls).filter((u) => !isYahoo(u) && !isEm(u) && !isTiingo(u) && !yieldHost(u));
const csUrls = (rs: Round[]) => rs.flatMap((r) => r.urls).filter(isCsindex);
const shUrls = (rs: Round[]) => rs.flatMap((r) => r.urls).filter(isShiller);

function compare(items: Record<string, any>[] | null): string[] {
  if (!items) return ['没有估值数据（GET /api/funds 的 valuation.items，或 GET /api/funds/valuation）'];
  const bad: string[] = [];
  const by = Object.fromEntries(items.map((x) => [x.code, x]));
  for (const code of VAL_CODES) {
    const x = by[code], ref = REF[code];
    if (!x) { bad.push(`${code}：没有`); continue; }
    for (const k of NUMS) if (!(typeof x[k] === 'number' && Math.abs(x[k] - ref[k]) <= TOL)) bad.push(`${code}.${k} = ${x[k]}，标准答案 ${ref[k]}`);
    if (x.n_months !== 120) bad.push(`${code}.n_months = ${x.n_months}`);
    if (x.market !== (code === 'SPX' ? '美国' : '中国')) bad.push(`${code}.market = ${x.market}`);
    const s = x.pe_series as [string, number][];
    if (!Array.isArray(s) || s.length < 120) { bad.push(`${code}.pe_series 只有 ${s?.length} 个`); continue; }
    const last120 = s.slice(-120), r120 = ref.pe_series as [string, number][];
    const off = last120.map((p, i) => [p[0], p[1], r120[i]] as const).filter(([m, v, r]) => m !== r[0] || Math.abs(v - r[1]) > TOL);
    if (off.length) bad.push(`${code}.pe_series 最近 120 个月有 ${off.length} 个对不上，例如 ${JSON.stringify(off.slice(0, 2))}`);
  }
  if (items.length !== 6) bad.push(`一共 ${items.length} 个（应为 6 个）`);
  return bad;
}

describe('D 估值：接口', () => {
  let first: Round[] = [];
  it('第一次完整刷新：每次 ≤ 45 个对外请求、都 200；中证 5 个指数的 PE（perf）和股息率（indicator.xls）、Shiller 都请求到了', async () => {
    first = await refreshAll(D1A);
    expect(first.filter((r) => r.status !== 200).map((r) => [r.path, r.status, r.body])).toEqual([]);
    expect(first.map((r) => r.urls.length).filter((n) => n > LIMIT)).toEqual([]);
    const cs = csUrls(first);
    expect(VAL_CN.filter((c) => !cs.some((u) => /perf/i.test(u) && u.includes(c))), '中证 PE（index-perf）').toEqual([]);
    expect(VAL_CN.filter((c) => !cs.some((u) => new URL(u).hostname === 'oss-ch.csindex.com.cn' && new RegExp(`${c}indicator\\.xls`, 'i').test(u))), '中证股息率（indicator.xls）').toEqual([]);
    expect(shUrls(first).length).toBeGreaterThan(0);
  });
  it('来源只有中证、Shiller（及其首页给的 ie_data.xls 下载链接）；不请求蛋卷、multpl、MSCI、富时', () => {
    const v = valUrls(first);
    expect(v.filter(isBannedVal)).toEqual([]);
    expect(first.flatMap((r) => r.urls).filter(isBannedVal)).toEqual([]);
    expect(v.filter((u) => !isCsindex(u) && !isShiller(u)), '估值以外的新来源').toEqual([]);
  });
  it('6 个指数的分位、中位数、最低、最高、当前值、股息率、两种预期年化和标准答案（val-ref.json）差 ≤ 0.05；n_months = 120；最近 120 个月的序列对得上', async () => {
    expect(compare(await getVal(D1A))).toEqual([]);
  });
  it('同一天第二次刷新：中证、Shiller 一个请求都不发；数据照旧', async () => {
    const rs = await refreshAll(D1B);
    expect(rs.filter((r) => r.status !== 200).map((r) => [r.path, r.status])).toEqual([]);
    expect(csUrls(rs), '中证同一天不再请求').toEqual([]);
    expect(shUrls(rs), 'Shiller 当月不再请求').toEqual([]);
    expect(compare(await getVal(D1B))).toEqual([]);
  });
  it('第二天（同一个月）：中证重新请求、Shiller 不请求', async () => {
    const rs = await refreshAll(D2);
    expect(rs.map((r) => r.urls.length).filter((n) => n > LIMIT)).toEqual([]);
    expect(csUrls(rs).length, '新的一天中证要再取').toBeGreaterThan(0);
    expect(shUrls(rs), 'Shiller 当月不再请求').toEqual([]);
    expect(compare(await getVal(D2))).toEqual([]);
  });
  it('（补充）中证这天回 500：估值保留上次的值（6 个都在、数值不变、不变成 0）', async () => {
    down = new Set(['csindex']);
    try {
      const rs = await refreshAll(D3);
      expect(rs.filter((r) => r.status >= 500).map((r) => [r.path, r.status])).toEqual([]);
      expect(compare(await getVal(D3))).toEqual([]);
    } finally { down = new Set(); }
  });
  it('下个月：Shiller 重新请求', async () => {
    const rs = await refreshAll(D4);
    expect(shUrls(rs).length).toBeGreaterThan(0);
    expect(rs.map((r) => r.urls.length).filter((n) => n > LIMIT)).toEqual([]);
  });
});

describe('D 估值：无定时任务', () => {
  it('wrangler.toml 和 test/wrangler.test.toml 都没有 [triggers] / crons；src/index.ts 不导出 scheduled', () => {
    for (const f of ['wrangler.toml', 'test/wrangler.test.toml']) {
      const t = readFileSync(path.join(ROOT, f), 'utf8').split('\n').map((l) => l.replace(/#.*$/, '')).join('\n');
      expect([f, /\[\s*(env\.[\w-]+\.)?triggers\s*\]/.test(t) || /\bcrons\s*=/.test(t)]).toEqual([f, false]);
    }
    const idx = readFileSync(path.join(ROOT, 'src/index.ts'), 'utf8');
    expect(/\bscheduled\s*[(:]/.test(idx) || /export\s+(async\s+)?function\s+scheduled/.test(idx)).toBe(false);
  });
});
