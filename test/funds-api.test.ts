/**
 * 公共工具「基金观察」的接口测试（GET /api/funds、POST /api/funds/refresh）。**测试会话先写（agents C154 试行）**，研发不改断言（底线 6）。
 * 纯函数在 test/funds.test.ts，页面在 scripts/e2e-funds.mjs。
 *
 * 外部取数全部用替身（CI 不能联网，也不许在测试里真的调 Yahoo / 东方财富）：
 *   替身同时塞给 handle() 的第 4 个参数 fetcher（仓库里已有的注入口）和 globalThis.fetch——实现用哪一个都会走到替身；
 *   发往本机（127.0.0.1 / localhost，本地 D1 代理）的请求原样放行、不计数；发往别处的一律计数，认不出来的地址记进 unknown（必须为空）。
 *   Yahoo：…finance.yahoo.com/v7|v8/finance/chart/<symbol>；东方财富：…eastmoney.com/…lsjz…?fundCode=<code>&pageIndex=<n>&pageSize=<m>（按日期从新到旧分页）。
 * 替身的数据：ES3、BYJ、XWR、UPD 用 test/fixtures/funds/reference.json 里的实抓 series（2026-11-10），
 *   511880.SS 在 Yahoo 只回 1 个点（11/10 实抓就是这样）、东方财富回实抓 series → 必须回退；000171 东方财富回实抓 series；
 *   其余 38 只用按代码固定种子生成的合成走势（约 420 天的工作日）。
 *
 * 守的事（规格原文：每次调用发出的对外请求 ≤ 45 个（Cloudflare 免费版每次请求 50 个子请求，留余量）；页面循环调直到 next 为 null；
 *   某只取失败时保留上次的数据并标出失败；都要求登录）：
 *   1. 没登录：GET /api/funds、POST /api/funds/refresh 都 401，而且一个对外请求都没发
 *   2. 从没刷新过时 GET 也能用（200、items 是数组，C32 空状态）
 *   3. 用 cursor 一路调到 next 为 null：每一次对外请求 ≤ 45；45 只全部出现在 updated 里；total = 45、最后 done = true；中间没有 failed
 *   4. 刷新后 GET：45 只都有快照（定义字段 + last、date、series…），ES3 / BYJ / XWR / UPD / 000171 的各期收益和回撤和参考一致（误差 0.01）
 *   5. 511880：Yahoo 清洗后少于 30 点 → 改用东方财富（请求里出现 fundCode=511880），数值和参考一致
 *   6. 某只失败（VOO 回 500）：VOO 出现在 failed（带原因）、不在 updated；GET 里 VOO 保留上一次的数据并带 error；别的照常更新；
 *      下一次 VOO 取成功了，error 消失
 *   7.（超出任务清单，依据 agents C81「外部调用至少测一次慢响应」）某只一直不回：这一次 refresh 不会卡住（测试超时 120 秒内返回），那只进 failed
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import { ROOT } from './helpers';

const PASS = 'ci_only_copilot_password_01';
const HOST = 'https://copilot.example.test';
const MIG = path.join(ROOT, 'migrations');
const NOW = Date.UTC(2026, 10, 10, 10, 0, 0); // 2026-11-10 18:00 台湾时间，和参考数据同一天
const LIMIT = 45;

const stmtsOf = (files: string[]) =>
  files.map((f) => readFileSync(path.join(MIG, f), 'utf8').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n'))
    .join(';\n').split(';').map((s) => s.trim()).filter(Boolean);

// ---------------- 45 只（只要 symbol / code / 来源；完整清单的断言在 test/funds.test.ts） ----------------
const SYMBOLS = ['ES3.SI', 'CFA.SI', 'HST.SI', 'XUS.SI', 'XWR.SI', 'A35.SI', 'MBH.SI', 'SBO.SI', 'O9P.SI', '0P00006FY6.SI', 'CLR.SI', 'SRT.SI', 'BYJ.SI', 'UPD.SI',
  'VOO', 'IVV', 'SPY', 'VTI', 'QQQ', 'AGG', 'BND', 'TLT', 'BSV', 'LQD', 'VIG', 'SCHD', 'VYM', 'DGRO', 'SDY',
  '510300.SS', '510310.SS', '510050.SS', '510500.SS', '588000.SS', '511990.SS', '511880.SS', '511010.SS', '511360.SS', '000171', '217003', '510880.SS', '515100.SS', '515080.SS', '515180.SS', '562060.SS'];
const CODES = SYMBOLS.map((s) => s.replace(/\.(SI|SS)$/, ''));

type Expect = Record<'d1' | 'w1' | 'm1' | 'ytd' | 'y1' | 'dd_w1' | 'dd_m1' | 'dd_ytd' | 'dd_y1' | 'dd_all' | 'ret_all', number | null> & { last: number; date: string };
const REF: Record<string, { expect: Expect; series: [string, number][] }> = JSON.parse(readFileSync(path.join(ROOT, 'test/fixtures/funds/reference.json'), 'utf8')).funds;

/** 合成走势：2025-09-16 起到 2026-11-10 的工作日，按代码做种子的确定性随机游走 */
function synth(code: string): [string, number][] {
  let s = [...code].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const out: [string, number][] = [];
  let v = 10 + rnd() * 90;
  for (let t = Date.UTC(2025, 8, 16); t <= Date.UTC(2026, 10, 10); t += 86400_000) {
    const w = new Date(t).getUTCDay();
    if (w === 0 || w === 6) continue;
    v *= 1 + (rnd() - 0.5) * 0.02;
    out.push([new Date(t).toISOString().slice(0, 10), Math.round(v * 1e4) / 1e4]);
  }
  return out;
}
const seriesOf = (code: string): [string, number][] => (REF[code] ? REF[code].series : synth(code));
/** 东方财富的单位净值：参考里有就按参考最新价 / 最新复权价的比例倒推，否则等于复权价 */
const navRatio = (code: string) => (REF[code] ? REF[code].expect.last / REF[code].series.at(-1)![1] : 1);

// ---------------- 替身 fetch ----------------
type Mode = { scale: number; fail: Set<string>; hang: Set<string> };
const mode: Mode = { scale: 1, fail: new Set(), hang: new Set() };
let outbound: string[] = [];
const unknown: string[] = [];
const realFetch = globalThis.fetch;
const urlOf = (input: unknown) => (typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url);
const jsonRes = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

function yahooBody(sym: string) {
  const code = sym.replace(/\.(SI|SS)$/, '');
  let ser = seriesOf(code);
  if (sym === '511880.SS') ser = ser.slice(-1); // 11/10 实抓：Yahoo 只回 1 条
  const ts = ser.map(([d]) => Date.parse(d + 'T01:00:00Z') / 1000); // 当地（+8）上午 9 点
  const adj = ser.map(([, a]) => a * mode.scale);
  const currency = sym.endsWith('.SI') ? 'SGD' : sym.endsWith('.SS') ? 'CNY' : 'USD';
  return { chart: { result: [{ meta: { currency, symbol: sym, gmtoffset: 28800, timezone: 'SGT', range: '2y' }, timestamp: ts, indicators: { quote: [{ close: adj.slice() }], adjclose: [{ adjclose: adj }] } }], error: null } };
}
function emBody(code: string, pageIndex: number, pageSize: number) {
  const ser = [...seriesOf(code)].reverse();
  const r = navRatio(code);
  const rows = ser.map(([d, a]) => ({ FSRQ: d, DWJZ: (a * r * mode.scale).toFixed(4), LJJZ: (a * mode.scale).toFixed(6), SDATE: null, JZZZL: '0.00' }));
  return { Data: { LSJZList: rows.slice((pageIndex - 1) * pageSize, pageIndex * pageSize), FundType: '002' }, ErrCode: 0, ErrMsg: null, TotalCount: rows.length, PageSize: pageSize, PageIndex: pageIndex };
}
const fake = vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
  const url = urlOf(input);
  const u = new URL(url);
  if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') return realFetch(input as RequestInfo, init);
  outbound.push(url);
  const y = /finance\.yahoo\.com\/v[78]\/finance\/chart\/([^/?]+)/.exec(url);
  const e = /eastmoney\.com/.test(u.hostname) && /lsjz/i.test(url) ? u.searchParams.get('fundCode') : null;
  const key = y ? decodeURIComponent(y[1]) : e;
  if (!key) { unknown.push(url); return new Response('not found', { status: 404 }); }
  const code = key.replace(/\.(SI|SS)$/, '');
  if (mode.hang.has(code)) {
    return new Promise<Response>((_, rej) => { init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))); });
  }
  if (mode.fail.has(code)) return new Response('upstream error', { status: 500 });
  if (y) return jsonRes(yahooBody(key));
  return jsonRes(emBody(code, Number(u.searchParams.get('pageIndex') ?? 1), Number(u.searchParams.get('pageSize') ?? 20)));
});

// ---------------- 本地 D1 + 登录 ----------------
let db: D1Database;
let dispose: () => Promise<void>;
let ck = '';
const env = (): Env => ({ DB: db, ENVIRONMENT: 'test', COPILOT_PASSWORD: PASS });
const req = (p: string, init: RequestInit & { cookie?: string } = {}) =>
  new Request(`${HOST}${p}`, { ...init, headers: { 'content-type': 'application/json', origin: HOST, 'cf-connecting-ip': '203.0.113.9', ...(init.cookie ? { cookie: init.cookie } : {}) } });
beforeAll(async () => {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: path.join(ROOT, 'test/wrangler.test.toml'), persist: false, remoteBindings: false, envFiles: [] });
  db = proxy.env.DB;
  dispose = proxy.dispose;
  await db.batch(stmtsOf(readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort()).map((s) => db.prepare(s)));
  const r = await handle(req('/api/login', { method: 'POST', body: JSON.stringify({ password: PASS }) }), env(), NOW);
  ck = r.headers.get('set-cookie')!.split(';')[0];
  vi.stubGlobal('fetch', fake);
});
afterAll(async () => { vi.unstubAllGlobals(); await dispose(); });

type Refresh = { next: number | null; done: boolean | number; total: number; updated: string[]; failed: { code: string; reason: string }[] };
type Item = Record<string, any> & { code: string };
const getFunds = async (cookie = ck, now = NOW) => {
  const r = await handle(req('/api/funds', cookie ? { cookie } : {}), env(), now, fake as never);
  return { status: r.status, body: (await r.json().catch(() => null)) as { fetched_at: unknown; items: Item[] } };
};
const refreshOnce = async (cursor?: number, now = NOW) => {
  outbound = [];
  const t0 = Date.now();
  const r = await handle(req('/api/funds/refresh', { method: 'POST', cookie: ck, body: JSON.stringify(cursor === undefined ? {} : { cursor }) }), env(), now, fake as never);
  return { status: r.status, body: (await r.json()) as Refresh, sent: outbound.length, ms: Date.now() - t0 };
};
/** 从头调到 next 为 null；记每次的对外请求数 */
async function refreshAll(now = NOW) {
  const rounds: { cursor: number | undefined; sent: number; ms: number; body: Refresh; status: number }[] = [];
  let cursor: number | undefined;
  for (let i = 0; i < 30; i++) {
    const r = await refreshOnce(cursor, now);
    rounds.push({ cursor, ...r });
    if (r.status !== 200 || r.body.next === null || r.body.next === undefined) break;
    cursor = r.body.next;
  }
  return rounds;
}
const near = (got: unknown, want: number | null, tol = 0.01) => {
  if (want === null) expect(got).toBeNull();
  else { expect(typeof got).toBe('number'); expect(Math.abs((got as number) - want)).toBeLessThanOrEqual(tol); }
};

// ======================================================================
describe('基金观察接口', () => {
  it('1. 没登录：GET /api/funds 和 POST /api/funds/refresh 都 401，一个对外请求都没发', async () => {
    outbound = [];
    const g = await getFunds('');
    expect(g.status).toBe(401);
    const r = await handle(req('/api/funds/refresh', { method: 'POST', body: '{}' }), env(), NOW, fake as never);
    expect(r.status).toBe(401);
    expect(outbound).toEqual([]);
  });

  it('2. 从没刷新过：GET 200，items 是数组（页面靠它画空状态，C32）', async () => {
    const g = await getFunds();
    expect(g.status).toBe(200);
    expect(Array.isArray(g.body.items)).toBe(true);
  });

  let first: Awaited<ReturnType<typeof refreshAll>> = [];
  it('3. cursor 一路走到 next 为 null：每次对外请求 ≤ 45，45 只全部 updated，没有 failed', async () => {
    first = await refreshAll();
    const last = first.at(-1)!;
    expect(first.map((r) => r.status).every((s) => s === 200)).toBe(true);
    expect(first.map((r) => r.sent).filter((n) => n > LIMIT)).toEqual([]); // 列出超标的那几次
    expect(first.every((r) => r.sent > 0)).toBe(true); // 每次都真的取了数（不是空转）
    expect(last.body.next).toBeNull();
    // done：规格只写了字段名没写类型；布尔 true 或"已处理只数 = total"都认（测试用例修正 1，见提交说明）
    expect(last.body.done === true || last.body.done === last.body.total).toBe(true);
    expect(first.every((r) => r.body.total === 45)).toBe(true);
    expect([...new Set(first.flatMap((r) => r.body.updated))].sort()).toEqual([...CODES].sort());
    expect(first.flatMap((r) => r.body.failed)).toEqual([]);
    expect(unknown).toEqual([]);
    // 一次刷完 45 只至少要 46 个请求（43 只 Yahoo + 511880 回退 + 两只东方财富），所以一定分了批
    expect(first.length).toBeGreaterThan(1);
  });

  it('4. 刷新后 GET：45 只都有快照和定义字段；参考 5 只的各期收益和回撤和 fetch2.py 实算一致', async () => {
    const g = await getFunds();
    expect(g.status).toBe(200);
    expect(g.body.fetched_at).toBeTruthy();
    expect(g.body.items.map((x) => x.code).sort()).toEqual([...CODES].sort());
    for (const it2 of g.body.items) {
      for (const k of ['market', 'category', 'name', 'code', 'symbol', 'source', 'tag']) expect([it2.code, k, k in it2]).toEqual([it2.code, k, true]);
      expect([it2.code, typeof it2.last, Array.isArray(it2.series) && it2.series.length > 0, it2.error ?? null]).toEqual([it2.code, 'number', true, null]);
    }
    const by = Object.fromEntries(g.body.items.map((x) => [x.code, x]));
    for (const code of ['ES3', 'BYJ', 'XWR', 'UPD', '000171']) {
      const e = REF[code].expect;
      expect([code, by[code].date]).toEqual([code, e.date]);
      for (const k of ['d1', 'w1', 'm1', 'ytd', 'y1', 'dd_w1', 'dd_m1', 'dd_ytd', 'dd_y1', 'dd_all', 'ret_all'] as const) near(by[code][k], e[k]);
    }
    near(by['000171'].last, 1.9474, 0.0001); // 东方财富：last 是单位净值 DWJZ
  });

  it('5. 511880：Yahoo 只回 1 个点 → 改用东方财富（fundCode=511880），数值和参考一致', async () => {
    expect(first.length).toBeGreaterThan(0); // 第 3 条已经刷过一轮
    // 再刷一轮，把每次的对外请求攒起来：东方财富的 511880 一定被请求过
    const seen: string[] = [];
    const rounds = await (async () => { const rs = []; let c: number | undefined; for (let i = 0; i < 30; i++) { const r = await refreshOnce(c); seen.push(...outbound); rs.push(r); if (r.body.next == null) break; c = r.body.next; } return rs; })();
    expect(rounds.length).toBeGreaterThan(0);
    expect(seen.some((u) => /eastmoney\.com/.test(u) && /fundCode=511880(&|$)/.test(u))).toBe(true);
    const g = await getFunds();
    const it2 = g.body.items.find((x) => x.code === '511880')!;
    const e = REF['511880'].expect;
    expect(it2.date).toBe(e.date);
    near(it2.last, 100.9502, 0.0001);
    for (const k of ['d1', 'w1', 'm1', 'ytd', 'y1', 'dd_w1', 'dd_m1', 'dd_ytd', 'dd_y1', 'dd_all', 'ret_all'] as const) near(it2[k], e[k]);
  });

  it('6. VOO 取失败（500）：进 failed、不在 updated；GET 里 VOO 保留上次的数据并带 error，别的照常更新；下次取成功 error 消失', async () => {
    const before = Object.fromEntries((await getFunds()).body.items.map((x) => [x.code, x]));
    mode.fail = new Set(['VOO']);
    mode.scale = 1.01;
    const rounds = await refreshAll();
    mode.fail = new Set();
    expect(rounds.map((r) => r.sent).filter((n) => n > LIMIT)).toEqual([]);
    expect(rounds.at(-1)!.body.next).toBeNull();
    const failed = rounds.flatMap((r) => r.body.failed);
    expect(failed.map((f) => f.code)).toEqual(['VOO']);
    expect(typeof failed[0].reason).toBe('string');
    expect(failed[0].reason.length).toBeGreaterThan(0);
    const updated = new Set(rounds.flatMap((r) => r.body.updated));
    expect(updated.has('VOO')).toBe(false);
    expect(updated.size).toBe(44);

    const after = Object.fromEntries((await getFunds()).body.items.map((x) => [x.code, x]));
    expect(after.VOO.error).toBeTruthy();
    expect(after.VOO.last).toBe(before.VOO.last);
    expect(after.VOO.date).toBe(before.VOO.date);
    expect(after.VOO.series).toEqual(before.VOO.series);
    expect(after.ES3.error ?? null).toBeNull();
    near(after.ES3.last, before.ES3.last * 1.01, 1e-4);

    const ok = await refreshAll();
    expect(ok.flatMap((r) => r.body.failed)).toEqual([]);
    const again = Object.fromEntries((await getFunds()).body.items.map((x) => [x.code, x]));
    expect(again.VOO.error ?? null).toBeNull();
    near(again.VOO.last, before.VOO.last * 1.01, 1e-4);
    mode.scale = 1;
  });

  // 测试用例修正 2：原来写"25 秒内返回"，这个数没有规格依据（C81 只要求不卡住、重试有上限），改成"在测试超时 120 秒内返回"
  it('7.（C81）VIG 一直不回：这一次 refresh 不会卡住（120 秒内返回），VIG 进 failed，别的不受影响', async () => {
    mode.hang = new Set(['VIG']);
    const rounds = await refreshAll();
    mode.hang = new Set();
    for (const r of rounds) expect(r.status).toBe(200);
    expect(rounds.at(-1)!.body.next).toBeNull();
    expect(rounds.flatMap((r) => r.body.failed).map((f) => f.code)).toEqual(['VIG']);
    expect(new Set(rounds.flatMap((r) => r.body.updated)).size).toBe(44);
  }, 120_000);
});
