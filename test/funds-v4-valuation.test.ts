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
 *   规格补充（Amos 11/11"表格或文档太大 无法单次解析完成，可以分开成多个小文档，多次解析"，主会话转述）：中证 perf 首次按年分段取、每次调用只处理一段
 *     （每次调用对中证 ≤ 1 个请求，每段 ≤ 1 年），之后每天增量（每个指数 ≤ 1 个 perf 请求、从最近两个月内开始）；Shiller xls 每月下载 1 次、原始字节分块存 D1、
 *     分多次调用逐步解析（下载那次和下一次调用返回时都还没解析完，即之后至少再 2 次）、解析完删块（D1 体积回到估值开始前 + 200 KB 内）；拼起来的结果仍和标准答案差 ≤ 0.05。
 *     "每天最多 1 次"= 每天最多一轮；解析全部成功才记日期；当天最多 2 轮（第 3 轮不再请求）。
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
import { clock, fakeResponse, isBannedVal, virtualGaps, isCsindex, isEm, isShiller, isTiingo, isYahoo, urlOf, VAL_CN, VAL_CODES, VAL_REF } from './funds-v4-fake';
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
/** 每个对外请求的虚拟时间（量同一来源的间隔） */
let stamps: { url: string; t: number }[] = [];
let down = new Set<'csindex' | 'shiller'>();
const realFetch = globalThis.fetch;
const fake = vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
  const url = urlOf(input);
  const h = new URL(url).hostname;
  if (h === '127.0.0.1' || h === 'localhost') return realFetch(input as RequestInfo, init);
  outbound.push(url);
  stamps.push({ url, t: clock() });
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
/** 每次估值调用之后调一次（第一轮量 D1 体积、SPX 何时出现用） */
type AfterCall = (i: number, r: Round) => Promise<void>;
async function refreshAll(now: number, after?: AfterCall, beforeVal?: () => Promise<void>): Promise<Round[]> {
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
  // "同一来源隔 ≥ 5 秒"的等待走虚拟时间（virtualGaps：等待一点不少，只是不真等；CI 不会因为真等约 20 秒而超时）
  if (beforeVal) await beforeVal();
  await virtualGaps(async () => {
    let next: unknown;
    // 规格补充：首次按年分段、Shiller 分多次解析，一轮要调很多次；硬上限 400 次
    for (let i = 0; i < 400; i++) {
      outbound = [];
      const r = await handle(req('/api/funds/valuation/refresh', { method: 'POST', cookie: ck, body: JSON.stringify(next == null ? {} : { cursor: next }) }), env(), now, fake as never);
      if (r.status === 404) break;
      let body: any = {};
      try { body = await r.json(); } catch { body = {}; }
      rounds.push({ urls: outbound.slice(), status: r.status, body, path: 'valuation/refresh' });
      if (after) await after(i, rounds[rounds.length - 1]);
      next = body?.next;
      if (r.status !== 200 || next == null) break;
    }
  });
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
/** D1 里所有业务表（不含 sqlite_ / _cf_ / d1_ 内部表）每一格内容的总字节数（BLOB 按字节、TEXT 按字符） */
async function dbBytes(): Promise<number> {
  const ts = ((await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'").all<{ name: string }>()).results ?? []).map((x) => x.name);
  let n = 0;
  for (const t of ts) {
    const cols = ((await db.prepare(`PRAGMA table_info("${t}")`).all<{ name: string }>()).results ?? []).map((c) => c.name);
    if (!cols.length) continue;
    const r = await db.prepare(`SELECT ${cols.map((c) => `COALESCE(SUM(LENGTH("${c}")), 0)`).join(' + ')} AS n FROM "${t}"`).first<{ n: number }>();
    n += Number(r?.n ?? 0);
  }
  return n;
}
const spxReady = async (now: number) => { const v = await getVal(now); const x = v?.find((i) => i.code === 'SPX'); return !!x && typeof x.pe_now === 'number' && x.pe_now > 0; };
const XLS_BYTES = 1_675_264; // Shiller ie_data.xls 原始大小
const ymd = (s: string | null) => (s && /^\d{8}$/.test(s) ? Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)) : NaN);
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
  /** 第一轮：每次估值调用后 D1 的总字节数；下载 ie_data.xls 的是第几次调用；那次刚返回时 SPX 有没有出来；SPX 第一次出来是第几次调用 */
  let dl = -1, spxAtDl = false, spxAtDl1 = false, spxEnd = false, bytes0 = 0, bytesAtDl = 0, bytesEnd = 0;
  it('第一次完整刷新：每次 ≤ 45 个对外请求、都 200；中证 5 个指数的 PE（perf）和股息率（indicator.xls）、Shiller 都请求到了', async () => {
    stamps = [];
    // 只在关键几步量（D1 全表字节、GET 都很重，每步都量一轮要 35 秒）：估值开始前、下载那次之后、下载后再一次之后、结尾
    first = await refreshAll(D1A, async (i, r) => {
      if (dl < 0 && r.urls.some((u) => /ie_data\.xls/i.test(u))) { dl = i; bytesAtDl = await dbBytes(); spxAtDl = await spxReady(D1A); }
      else if (dl >= 0 && i === dl + 1) spxAtDl1 = await spxReady(D1A);
    }, async () => { bytes0 = await dbBytes(); });
    bytesEnd = await dbBytes();
    spxEnd = await spxReady(D1A);
    expect(first.filter((r) => r.status !== 200).map((r) => [r.path, r.status, r.body])).toEqual([]);
    expect(first.map((r) => r.urls.length).filter((n) => n > LIMIT)).toEqual([]);
    const cs = csUrls(first);
    expect(VAL_CN.filter((c) => !cs.some((u) => /perf/i.test(u) && u.includes(c))), '中证 PE（index-perf）').toEqual([]);
    expect(VAL_CN.filter((c) => !cs.some((u) => new URL(u).hostname === 'oss-ch.csindex.com.cn' && new RegExp(`${c}indicator\\.xls`, 'i').test(u))), '中证股息率（indicator.xls）').toEqual([]);
    expect(shUrls(first).length).toBeGreaterThan(0);
  }, 120_000);
  // 估值取数修复（2026-11-11，主会话派工单规格 1）：间隔从 ≥ 2 秒改成 ≥ 5 秒——规格变化，不是放宽
  it('（估值取数修复规格 1）同一来源相邻两个请求隔 ≥ 5 秒（中证 www 和 oss-ch 算一个来源；Shiller 首页和下载算一个来源；按虚拟时间量）', () => {
    const bad: string[] = [];
    for (const [name, is] of [['中证', isCsindex], ['Shiller', isShiller]] as const) {
      const xs = stamps.filter((x) => is(x.url));
      for (let i = 1; i < xs.length; i++) if (xs[i].t - xs[i - 1].t < 5000 - 5) bad.push(`${name}：${xs[i - 1].url.slice(0, 60)} → ${xs[i].url.slice(0, 60)} 只隔 ${xs[i].t - xs[i - 1].t} ms`);
    }
    expect(bad).toEqual([]);
  });
  // 估值取数修复（2026-11-11，规格 1）：每段从 ≤ 1 年改成 ≤ 5 年、首次每个指数 ≤ 3 段（原来按年 11 段 × 5 个指数 ≈ 55 个请求，中证约 22 个后开始 403）
  it('（规格补充：太大分开解析；估值取数修复规格 1）每次调用对中证最多发 1 个请求；中证 perf 每个请求都带 startDate / endDate、一段不超过 5 年；首次每个指数 ≤ 3 段', () => {
    const many = first.map((r, i) => [i, r.path, r.urls.filter(isCsindex).length] as const).filter(([, , n]) => n > 1);
    expect(many, '每次调用对中证 ≤ 1 个请求').toEqual([]);
    const perf = first.flatMap((r) => r.urls).filter((u) => isCsindex(u) && /perf/i.test(u));
    const bad = perf.map((u) => { const q = new URL(u).searchParams; const a = ymd(q.get('startDate')), b = ymd(q.get('endDate')); return [u.replace(/^https?:\/\/[^/]+/, ''), (b - a) / 86400_000] as const; })
      .filter(([, d]) => !(d >= 0 && d <= 5 * 366));
    expect(bad, '首次每段 ≤ 5 年').toEqual([]);
    const per = VAL_CN.map((c) => [c, perf.filter((u) => new URL(u).searchParams.get('indexCode') === c).length] as const).filter(([, n]) => n > 3);
    expect(per, '首次每个指数 ≤ 3 段').toEqual([]);
  });
  it('（规格补充）Shiller：下载 ie_data.xls 那次调用里不解析完（刚返回时 SPX 还没有），之后至少再调 2 次才解析完；下载后原始字节分块存进 D1（D1 增加 ≥ 一半文件大小），解析完删掉（比估值开始前多不到 200 KB）', () => {
    expect(dl, '这一轮下载了 ie_data.xls').toBeGreaterThanOrEqual(0);
    expect(spxAtDl, '下载那次调用不该同时解析完').toBe(false);
    expect(spxAtDl1, '分多次调用逐步解析：下载后的下一次调用也还没解析完（之后至少再 2 次）').toBe(false);
    expect(spxEnd, 'SPX 最后要解析出来').toBe(true);
    const grow = bytesAtDl - bytes0;
    expect(grow, `下载后 D1 应存着原始块（增加了 ${grow} 字节）`).toBeGreaterThanOrEqual(XLS_BYTES / 2);
    const left = bytesEnd - bytes0;
    expect(left, `解析完原始块应删掉（还比估值开始前多 ${left} 字节）`).toBeLessThan(200_000);
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
    // 之后每天增量：每个指数最多 1 个 perf 请求，从最近两个月内开始
    const perf = csUrls(rs).filter((u) => /perf/i.test(u));
    const per = VAL_CN.map((c) => [c, perf.filter((u) => u.includes(c)).length] as const).filter(([, n]) => n > 1);
    expect(per, '增量：每个指数 ≤ 1 个 perf 请求').toEqual([]);
    expect(perf.filter((u) => !(ymd(new URL(u).searchParams.get('startDate')) >= Date.UTC(2026, 8, 1))).map((u) => u.replace(/^https?:\/\/[^/]+/, '')), '增量：startDate 在最近两个月内').toEqual([]);
    expect(shUrls(rs), 'Shiller 当月不再请求').toEqual([]);
    expect(compare(await getVal(D2))).toEqual([]);
  });
  it('中证这天一直回 500：第 1 轮取不到（保留上次的值、6 个都在、不变成 0）→ 同一天第 2 轮再试（解析全部成功才记日期）→ 第 3 轮当天不再请求中证（每天最多 2 轮）', async () => {
    down = new Set(['csindex']);
    try {
      const r1 = await refreshAll(D3);
      expect(r1.filter((r) => r.status >= 500).map((r) => [r.path, r.status])).toEqual([]);
      expect(csUrls(r1).length, '第 1 轮要请求中证').toBeGreaterThan(0);
      expect(compare(await getVal(D3))).toEqual([]);
      const r2 = await refreshAll(D3 + 3600_000);
      expect(csUrls(r2).length, '第 1 轮没成功，同一天第 2 轮要再试').toBeGreaterThan(0);
      const r3 = await refreshAll(D3 + 2 * 3600_000);
      expect(csUrls(r3), '同一天第 3 轮不再请求中证').toEqual([]);
      expect(compare(await getVal(D3 + 2 * 3600_000))).toEqual([]);
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
