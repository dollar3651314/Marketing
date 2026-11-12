/**
 * 基金观察第四版（Amos 2026-11-11「都按建议」）研发自测：A. 美国 15 只走 Tiingo（新加坡 CFA / SRT 绝不去 Tiingo）、退回 Yahoo；
 * B. /health 的 tiingo 字段；D. ② 估值（xls 解析、口径、每个来源每天最多 1 次、请求间隔 ≥ 2 秒、不重试、取不到保留上次、页面卡片和市场切换）。
 * 外部接口一律用替身（不连网）；D1 用 getPlatformProxy 的本地 SQLite。xls 用 test/funds-val-xls.ts 现拼（不放中证 / Shiller 的真文件）。
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import { FUNDS, parseTiingo, TIINGO_CODES, usesTiingo, type Point } from '../src/funds';
import { fetchFund, Http, refreshBatch, refreshValuation, SHILLER_KNOWN_XLS, tiingoToken, VAL_BLOB, VAL_GAP_MS, VAL_MAX_STEPS, valuationList, valKeys, type FetchLike, type ValStepResult } from '../src/funds-api';
import { cfbStream, median, mergeMonths, monthEnds, parseCsIndicator, parseCsPerf, parseShiller, readXls, shillerXlsUrl, valCard, VAL_INDEXES, type ValStored } from '../src/funds-val';
import { buildXls } from './funds-val-xls';
import { ROOT } from './helpers';

const PASS = 'ci_only_copilot_password_01';
const HOST = 'https://copilot.example.test';
const MIG = path.join(ROOT, 'migrations');
const NOW = Date.UTC(2026, 10, 11, 2, 0, 0); // 新加坡 2026-11-11 10:00
const DAY = 86_400_000;
const TOKEN = 'tiingo_test_token_should_never_leak_0123456789';

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
beforeEach(async () => { await db.batch(['fund_snapshot', 'fund_valuation', 'fund_val_fetch', 'fund_val_work', 'fund_val_blob'].map((t) => db.prepare(`DELETE FROM ${t}`))); });
const env = (over: Partial<Env> = {}): Env => ({ DB: db, ENVIRONMENT: 'test', COPILOT_PASSWORD: PASS, ...over });
const noSleep = async () => {};
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

function days(n: number, end: string, f: (i: number) => number): Point[] {
  const e = Date.parse(end + 'T00:00:00Z');
  return Array.from({ length: n }, (_, i) => { const d = new Date(e - (n - 1 - i) * DAY).toISOString().slice(0, 10); return [d, f(i), f(i)] as Point; });
}
const tiingoJson = (pts: Point[]) => pts.map((p) => ({ date: p[0] + 'T00:00:00.000Z', close: p[1], adjClose: p[2] * 0.9, open: p[1], volume: 1 }));
const yahooJson = (pts: Point[]) => ({ chart: { result: [{ meta: { currency: 'USD', gmtoffset: -18000 }, timestamp: pts.map((p) => Date.parse(p[0] + 'T14:30:00Z') / 1000 + 18000), indicators: { quote: [{ close: pts.map((p) => p[1]) }], adjclose: [{ adjclose: pts.map((p) => p[2]) }] } }] } });
const good = days(300, '2026-11-10', (i) => 100 + i * 0.1);
const ALL_CS = VAL_INDEXES.filter((d) => d.src === 'csindex').flatMap(valKeys);

describe('A. 美国 15 只走 Tiingo', () => {
  it('白名单正好是那 15 只、都是美国；新加坡 CFA、SRT 不走 Tiingo（同名美国证券）', () => {
    expect([...TIINGO_CODES].sort()).toEqual(FUNDS.filter((f) => f.market === '美国').map((f) => f.code).sort());
    expect(FUNDS.filter(usesTiingo).map((f) => f.code)).toEqual(FUNDS.filter((f) => f.market === '美国').map((f) => f.code));
    for (const c of ['CFA', 'SRT']) expect(usesTiingo(FUNDS.find((f) => f.code === c)!)).toBe(false);
    // 就算有人把 CFA 写进白名单，市场不是美国也不走
    expect(usesTiingo({ ...FUNDS.find((f) => f.code === 'CFA')!, code: 'VOO', symbol: 'VOO' })).toBe(false);
  });
  it('parseTiingo：adjClose 当复权价、close 当收盘、日期取前 10 位，坏值跳过、升序去重', () => {
    expect(parseTiingo([{ date: '2026-11-10T00:00:00.000Z', close: 10, adjClose: 9 }, { date: '2026-11-09T00:00:00.000Z', close: 8, adjClose: 7 }, { date: 'x', close: 1, adjClose: 1 }, { date: '2026-11-08T00:00:00.000Z', close: null, adjClose: 1 }]))
      .toEqual([['2026-11-09', 8, 7], ['2026-11-10', 10, 9]]);
    expect(parseTiingo({ detail: 'not found' })).toEqual([]);
  });
  it('配了 key：1 个请求、key 只在 Authorization 头里（不在地址里），source = tiingo，复权价用 adjClose', async () => {
    const seen: { u: string; h: Record<string, string> }[] = [];
    const f: FetchLike = async (u, init) => { seen.push({ u, h: init?.headers as Record<string, string> }); return ok(tiingoJson(good)); };
    const http = new Http(f, 45, noSleep);
    const s = await fetchFund(FUNDS.find((x) => x.code === 'VOO')!, http, NOW, null, { tiingo: TOKEN });
    expect(http.used).toBe(1);
    expect(seen[0].u).toMatch(/^https:\/\/api\.tiingo\.com\/tiingo\/daily\/voo\/prices\?startDate=2024-11-11$/);
    expect(seen[0].u).not.toContain(TOKEN);
    expect(seen[0].h.authorization).toBe(`Token ${TOKEN}`);
    expect(s.source).toBe('tiingo');
    expect(s.last).toBe(good[good.length - 1][1]);
    expect(s.series[s.series.length - 1][1]).toBeCloseTo(good[good.length - 1][2] * 0.9, 6);
    expect(s.fallback).toBeUndefined();
  });
  it('Tiingo 回 401 / 500：退回 Yahoo，source = yahoo、fallback 写原因（不含 key）；两边都没取到时原因两边都写', async () => {
    for (const st of [401, 500]) {
      const f: FetchLike = async (u) => (u.includes('tiingo') ? new Response(JSON.stringify({ detail: 'bad ' + TOKEN }), { status: st }) : ok(yahooJson(good)));
      const s = await fetchFund(FUNDS.find((x) => x.code === 'SCHD')!, new Http(f, 45, noSleep), NOW, null, { tiingo: TOKEN });
      expect(s.source).toBe('yahoo');
      expect(s.fallback).toMatch(new RegExp(`^Tiingo回 ${st}`));
      expect(JSON.stringify(s)).not.toContain(TOKEN);
    }
    const f: FetchLike = async () => new Response('{}', { status: 404 });
    const e = await fetchFund(FUNDS.find((x) => x.code === 'SCHD')!, new Http(f, 45, noSleep), NOW, null, { tiingo: TOKEN }).catch((x: Error) => x) as Error;
    expect(e.message).toBe('Tiingo回 404；Yahoo回 404'); // 404 不重试，和第三版 Yahoo 404 的写法一样
  });
  it('没配置：不请求 Tiingo，直接 Yahoo（和第三版一样，没有 fallback 字段）', async () => {
    const urls: string[] = [];
    const s = await fetchFund(FUNDS.find((x) => x.code === 'VOO')!, new Http(async (u) => { urls.push(u); return ok(yahooJson(good)); }, 45, noSleep), NOW, null, {});
    expect(urls.some((u) => u.includes('tiingo'))).toBe(false);
    expect(s.source).toBe('yahoo');
    expect(s.fallback).toBeUndefined();
  });
  it('整轮刷新配了 key：只有美国 15 只请求 Tiingo（CFA、SRT 走 Yahoo），每批对外请求 ≤ 45，GET 里 source = tiingo、不含 key', async () => {
    const urls: string[] = [];
    const em = (code: string) => ({ Data: { LSJZList: Array.from({ length: 20 }, (_, i) => ({ FSRQ: new Date(Date.UTC(2026, 10, 10) - i * DAY).toISOString().slice(0, 10), DWJZ: '1.1', LJJZ: String(1.5 - i * 0.001) })) }, TotalCount: 20, code });
    const f: FetchLike = async (u) => { urls.push(u); if (u.includes('tiingo')) return ok(tiingoJson(good)); if (u.includes('eastmoney')) return ok(em(u)); if (u.includes('yahoo')) return ok(yahooJson(good)); return new Response('x', { status: 404 }); };
    let cur: number | null = 0;
    for (let k = 0; k < 60 && cur !== null; k++) { const r = await refreshBatch(env({ TIINGO_API_TOKEN: TOKEN }), cur, NOW, f, noSleep); expect(r.requests).toBeLessThanOrEqual(45); cur = r.next; }
    expect(cur).toBeNull();
    const tiingoSyms = urls.filter((u) => u.includes('api.tiingo.com')).map((u) => /daily\/([^/]+)\//.exec(u)![1].toUpperCase());
    expect(tiingoSyms.sort()).toEqual([...TIINGO_CODES].sort());
    expect(urls.filter((u) => /yahoo.*(CFA|SRT)\.SI/.test(u)).length).toBe(2);
    expect(urls.some((u) => u.includes(TOKEN))).toBe(false);
    const login = await handle(new Request(HOST + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: HOST, 'cf-connecting-ip': '203.0.113.9' }, body: JSON.stringify({ password: PASS }) }), env({ TIINGO_API_TOKEN: TOKEN }), NOW);
    const ck = login.headers.get('set-cookie')!.split(';')[0];
    const res = await handle(new Request(HOST + '/api/funds', { headers: { cookie: ck } }), env({ TIINGO_API_TOKEN: TOKEN }), NOW);
    const txt = await res.text();
    expect(txt).not.toContain(TOKEN);
    const j = JSON.parse(txt);
    expect(j.items.find((x: { code: string }) => x.code === 'VOO').source).toBe('tiingo');
    expect(j.items.find((x: { code: string }) => x.code === 'CFA').source).toBe('yahoo');
  });
});

describe('B. /health 的 tiingo 字段', () => {
  it('有值 → ok；没有 / 空 / 只有空格 → not_configured；不输出值的任何部分', async () => {
    const h = async (over: Partial<Env>) => (await handle(new Request(HOST + '/health'), env(over), NOW)).text();
    const a = await h({ TIINGO_API_TOKEN: TOKEN });
    expect(JSON.parse(a).tiingo).toBe('ok');
    expect(a).not.toContain(TOKEN.slice(0, 8));
    expect(a).not.toContain(String(TOKEN.length));
    for (const v of [undefined, '', '   ']) expect(JSON.parse(await h({ TIINGO_API_TOKEN: v })).tiingo).toBe('not_configured');
    expect(tiingoToken({ TIINGO_API_TOKEN: ' x ' })).toBe('x');
  });
});

// ---------------------------------------------------------------- D. 估值
/** 中证 indicator.xls 的样子：第一行表头（中文），下面每天一行，日期是字符串 */
function csXls(rows: [string, number][], opts: { small?: boolean; splitSstAt?: number } = {}) {
  const head = ['日期Date', '指数代码Index Code', '指数中文全称Chinese Name(Full)', '指数中文简称Index Chinese Name', '指数英文全称English Name(Full)', '指数英文简称Index English Name', '市盈率1（总股本）P/E1', '市盈率2（计算用股本）P/E2', '股息率1（总股本）D/P1', '股息率2（计算用股本）D/P2'];
  return buildXls([{ name: '000300indicator.xls', rows: [[0, head], ...rows.map(([d, dy], i) => [i + 1, [d, '000300', '沪深300指数', '沪深300', 'CSI 300 Index', 'CSI 300', 13.8, 15.2, dy, dy - 0.3]] as [number, (string | number)[]])] }], opts);
}
/** Shiller ie_data.xls「Data」表的样子：前几张表无关；第 7 行表头；1871.01 起每月一行；最后几个月 D 是空的、CAPE 有的是公式 */
function shillerXls(months: number, capeOf: (i: number) => number, y0 = 2010) {
  const rows: [number, (string | number | { rk: number } | { f: number } | { fs: string } | undefined)[]][] = [[5, [undefined, 'S&P']], [7, ['Date', 'P', 'D', 'E', 'CPI', 'Fraction', 'Rate GS10', 'Real', 'Real', 'Return', 'Real', 'Scaled', 'CAPE']]];
  for (let i = 0; i < months; i++) {
    const y = y0 + Math.floor(i / 12), m = (i % 12) + 1;
    const last3 = i >= months - 3;
    rows.push([8 + i, [Number(`${y}.${String(m).padStart(2, '0')}`), { rk: 1000 + i }, last3 ? undefined : 20 + i * 0.01, last3 ? undefined : 50, 300, 2000, 4, 1, 1, 1, 1, 1, i < 5 ? 'NA' : i % 2 ? { f: capeOf(i) } : capeOf(i)]]);
  }
  rows.push([8 + months + 1, [undefined, { fs: 'Oct price is Oct 2nd close' }]]);
  return buildXls([{ name: 'Notes', rows: [[0, ['hello']]] }, { name: 'Data', rows: rows as never }]);
}

describe('D1. xls 解析（复合文档 + BIFF8）', () => {
  it('mini stream 小文件 + 共享字符串在中文字符中间切到 CONTINUE：取最新一天的 D/P1', () => {
    for (const opts of [{ small: true }, { small: true, splitSstAt: 100 }, { small: false, splitSstAt: 151 }]) {
      const x = csXls([['20261106', 3.01], ['20261110', 3.03], ['20261109', 3.02]], opts);
      expect(cfbStream(x, 'Workbook')).not.toBeNull();
      expect(parseCsIndicator(x), JSON.stringify(opts)).toEqual({ dy: 3.03, date: '2026-11-10' });
      expect(readXls(x)![0].rows.get(0)![8]).toBe('股息率1（总股本）D/P1');
    }
  });
  it('不是 xls / 认不出：回 null，不抛错', () => {
    expect(parseCsIndicator(new Uint8Array(2000))).toBeNull();
    expect(parseCsIndicator(new TextEncoder().encode('<html>blocked</html>'.repeat(100)))).toBeNull();
    expect(parseShiller(csXls([['20261110', 3]]))).toBeNull();
  });
  it('Shiller：找 Data 表和表头，NUMBER / RK / 公式结果都认，NA 跳过；股息率 = 最近有 D 的月份 D / P；只留最后 130 个月', () => {
    const s = parseShiller(shillerXls(200, (i) => 20 + i / 10))!;
    expect(s.series.length).toBe(130);
    expect(s.series[s.series.length - 1]).toEqual(['2026-08', 39.9]);
    expect(s.series[0]).toEqual(['2015-11', 27]); // i = 70
    // 最后 3 个月 D 是空的 → 第 197 行（i = 196，2026-05）：D = 20 + 1.96、P = 1000 + 196
    expect(s.dyDate).toBe('2026-05');
    expect(s.dy).toBe(Math.round(((20 + 1.96) / 1196) * 10000) / 100);
    const all = parseShiller(shillerXls(30, (i) => 10 + i), 1000)!;
    expect(all.series[0]).toEqual(['2010-06', 15]); // 前 5 个月是 NA
  });
  it('Shiller 首页找下载链接：// 开头补 https；只认 shillerdata.com / wsimg.com', () => {
    expect(shillerXlsUrl('<a href="//img1.wsimg.com/blobby/go/x/downloads/y/ie_data.xls?ver=1&amp;a=2">x</a>')).toBe('https://img1.wsimg.com/blobby/go/x/downloads/y/ie_data.xls?ver=1&a=2');
    expect(shillerXlsUrl('<a href="https://evil.example.com/ie_data.xls">x</a>')).toBeNull();
    expect(shillerXlsUrl('<a href="http://img1.wsimg.com/ie_data.xls">x</a>')).toBeNull();
    expect(shillerXlsUrl('<a href="/files/ie_data.xls">x</a>')).toBe('https://shillerdata.com/files/ie_data.xls');
    expect(shillerXlsUrl('nothing')).toBeNull();
  });
});

describe('D2. 口径', () => {
  it('月末取样、合并（同月以新为准）、中位数（偶数取中间两个平均）', () => {
    expect(monthEnds([['2026-10-30', 10], ['2026-10-31', 11], ['2026-11-03', 12], ['2026-10-02', 9]])).toEqual([['2026-10', 11], ['2026-11', 12]]);
    expect(mergeMonths([['2026-09', 1], ['2026-10', 2]], [['2026-10', 3], ['2026-11', 4]], 2)).toEqual([['2026-10', 3], ['2026-11', 4]]);
    expect(median([3, 1, 2, 4])).toBe(2.5);
    expect(parseCsPerf({ code: '200', data: [{ tradeDate: '20261110', peg: 13.13 }, { tradeDate: '20110101', peg: null }, { tradeDate: '20261109', peg: '13.2' }] })).toEqual([['2026-11-09', 13.2], ['2026-11-10', 13.13]]);
    expect(parseCsPerf({ msg: 'x' })).toBeNull();
  });
  it('分位 = 最近 120 个月里 ≤ 当前值的占比；两种预期年化（A 股 5%、美国 4%；标普 1/CAPE）', () => {
    const series = Array.from({ length: 130 }, (_, i) => [`${2016 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`, 10 + (i % 10)] as [string, number]);
    const st: ValStored = { code: '000300', series, pe_now: 14, pe_now_date: '2026-11-10', dy_now: 3, dy_date: '2026-11-10' };
    const c = valCard(VAL_INDEXES[0], st)!;
    const win = series.slice(-120).map((x) => x[1]);
    expect(c.n_months).toBe(120);
    expect(c.pe_pct10y).toBe(Math.round((win.filter((v) => v <= 14).length / 120) * 1000) / 10);
    expect(c.pe_median10y).toBe(14.5);
    expect([c.pe_min10y, c.pe_max10y]).toEqual([10, 19]);
    expect(c.exp_a).toBe(Math.round((100 / 14) * 100) / 100);
    expect(c.exp_b).toBe(Math.round((0.03 + 0.05 + (Math.pow(14.5 / 14, 0.1) - 1)) * 10000) / 100);
    const spx = valCard(VAL_INDEXES[5], { ...st, code: 'SPX', pe_now: 40, dy_now: null })!;
    expect(spx.metric).toBe('CAPE');
    expect(spx.exp_a).toBe(2.5);
    expect(spx.exp_b).toBeNull();
    // 历史不到 24 个月：不给分位
    expect(valCard(VAL_INDEXES[0], { ...st, series: series.slice(0, 10) })!.pe_pct10y).toBeNull();
  });
  it('11 只基金都在 45 只清单里；其余 18 只 = 45 − 16 只债券 − 11 只', () => {
    const codes = VAL_INDEXES.flatMap((d) => d.funds);
    expect(codes.length).toBe(11);
    expect(codes.every((c) => FUNDS.some((f) => f.code === c && f.category !== '债券'))).toBe(true);
    expect(FUNDS.filter((f) => f.category !== '债券' && !codes.includes(f.code)).length).toBe(18);
  });
});

/** 估值来源的替身：中证 JSON、中证 xls、Shiller 首页、ie_data.xls；记下每个请求和那时 sleep 过的总毫秒数 */
function valFake(over: (u: string) => Response | null = () => null) {
  const log: { u: string; slept: number; t: number }[] = [];
  let slept = 0;
  const sleep = async (ms: number) => { slept += ms; };
  const perf = (code: string, u: string) => {
    const sp = new URL(u).searchParams;
    const start = sp.get('startDate')!, end = sp.get('endDate')!;
    const data = [];
    for (let t = Date.UTC(+start.slice(0, 4), +start.slice(4, 6) - 1, +start.slice(6, 8)); t <= Date.UTC(+end.slice(0, 4), +end.slice(4, 6) - 1, +end.slice(6, 8)); t += 5 * DAY) {
      const d = new Date(t).toISOString().slice(0, 10).replace(/-/g, '');
      data.push({ tradeDate: d, indexCode: code, peg: 10 + (t / DAY) % 7 });
    }
    return ok({ code: '200', msg: 'Success', data, success: true });
  };
  const f: FetchLike = async (u) => {
    log.push({ u, slept, t: Date.now() });
    const o = over(u);
    if (o) return o;
    const m = /indexCode=(\d+)/.exec(u);
    if (m) return perf(m[1], u);
    if (u.includes('indicator.xls')) return new Response(csXls([['20261110', 3.03]], { small: true }) as unknown as BodyInit);
    if (u === 'https://shillerdata.com/') return new Response('<a href="//img1.wsimg.com/blobby/go/a/downloads/b/ie_data.xls?ver=9">ie_data.xls</a>');
    if (u.includes('ie_data.xls')) return new Response(shillerXls(200, (i) => 20 + i / 10) as unknown as BodyInit);
    return new Response('no', { status: 404 });
  };
  return { f, log, sleep };
}

// 第五版估值取数修复（主会话 11/11 派工：规格变了，不是放宽）：中证 perf 首次每段 ≤ 41 个月（3 段 / 指数，原来按年 11 段）；同源间隔 2 → 5 秒（断言用 VAL_GAP_MS）；
// Shiller 首页单独一步（原来首页 + 下载在同一步「下载」里）。每次调用对外请求 ≤ 2 → ≤ 1（更严）。
describe('D3. 取数：每天最多一轮、分段 / 分步、同一来源间隔 ≥ 5 秒、不自动重试、保留上次', () => {
  /** 一次刷新：cursor 从 0 一直调到 next 为 null（硬上限 VAL_MAX_STEPS + 1） */
  async function round(now: number, fk: ReturnType<typeof valFake>, stopAfter = Infinity) {
    const out: ValStepResult[] = [];
    for (let c: number | null = 0, k = 0; c !== null && k <= VAL_MAX_STEPS && k < stopAfter; k++) { const r = await refreshValuation(env(), c, now, fk.f, fk.sleep); out.push(r); expect(r.requests).toBeLessThanOrEqual(1); c = r.next; }
    return out;
  }
  // 第六版（11/12 正式版 Shiller 首页连接被重置）研发自测改动原因：规格变了——库里没存过链接时第一次直接下载代码里的已知链接、不先请求首页，
  // 所以首次 Shiller 只有 1 个请求（下载）、步骤里没有「首页」；用存的链接的那条，第一轮的链接从首页给的换成已知链接；白名单那条要先让已知链接失败才会去首页。
  it('首次：中证每个指数分 3 段（每段 ≤ 41 个月）+ 股息率 1 步，Shiller 直接下载已知链接 1 步 + 目录 1 步 + 逐块解析（不请求首页）；同一来源相邻请求都等够 5 秒；同一天再刷 0 个请求；第二天中证只取最近一段', async () => {
    const fk = valFake();
    const rs = await round(NOW, fk);
    expect(rs.filter((r) => r.status === 'failed')).toEqual([]);
    expect(rs.filter((r) => r.status === 'ok').map((r) => r.code)).toEqual(['000300', '000300', '000016', '000016', '000905', '000905', '000015', '000015', '000922', '000922', 'SPX']);
    const perf = fk.log.filter((x) => x.u.includes('index-perf'));
    expect(perf.length).toBe(15);
    // 首尾相接、不重叠，覆盖 2016-09-01 ～ 今天
    expect(perf.slice(0, 3).map((x) => new URL(x.u).searchParams.get('startDate') + '-' + new URL(x.u).searchParams.get('endDate'))).toEqual(['20160901-20200131', '20200201-20230630', '20230701-20261111']);
    expect(fk.log.filter((x) => x.u.includes('indicator.xls')).length).toBe(5);
    expect(fk.log.filter((x) => /shillerdata|wsimg/.test(x.u)).map((x) => x.u)).toEqual([SHILLER_KNOWN_XLS]);
    // 页面进度：done 逐步加一，total ≥ done
    rs.forEach((r, i) => { expect(r.done).toBe(i + 1); expect(r.total).toBeGreaterThanOrEqual(r.done); });
    // 同一来源前后两个请求之间都等过（≥ VAL_GAP_MS = 5 秒）（第一个中证请求、第一个 Shiller 请求前面没有同一来源的请求，不用等）
    const fam = (u: string) => (u.includes('csindex') ? 'cs' : 'sh');
    fk.log.forEach((x, i) => {
      const prev = fk.log.slice(0, i).reverse().find((y) => fam(y.u) === fam(x.u));
      if (prev) expect(x.slept - prev.slept + (x.t - prev.t), `${i} ${x.u}`).toBeGreaterThanOrEqual(VAL_GAP_MS - 5);
    });
    const v = (await valuationList(env(), NOW))!;
    expect(v.due).toBe(false);
    expect(v.items.map((x) => x.code)).toEqual(VAL_INDEXES.map((d) => d.code));
    expect(v.items[0].dy_now).toBe(3.03);
    expect(v.items[5]).toMatchObject({ metric: 'CAPE', pe_now: 39.9, pe_now_date: '2026-08', n_months: 120 });
    // 解析完：块删掉、进行中的状态只剩 run
    expect((await db.prepare('SELECT COUNT(*) AS n FROM fund_val_blob').first<{ n: number }>())!.n).toBe(0);
    expect(((await db.prepare('SELECT src FROM fund_val_work').all<{ src: string }>()).results ?? []).map((x) => x.src)).toEqual(['run']);
    // 同一天再刷：一步就完、0 个请求
    const n0 = fk.log.length;
    const again = await round(NOW + 3600_000, fk);
    expect(again.map((r) => [r.status, r.next, r.requests])).toEqual([['done', null, 0]]);
    expect(fk.log.length).toBe(n0);
    // 第二天：中证每个指数只取最近一段（从库里最后一个月的 1 号起）+ 股息率；Shiller 这个月不再取
    const d2 = await round(NOW + DAY, fk);
    const p2 = fk.log.slice(n0).filter((x) => x.u.includes('index-perf'));
    expect(p2.length).toBe(5);
    expect(p2[0].u).toContain('startDate=20261101&endDate=20261112');
    expect(fk.log.slice(n0).filter((x) => /shillerdata|wsimg/.test(x.u))).toEqual([]);
    expect(d2.filter((r) => r.status !== 'done').length).toBe(10);
    // 下个月 Shiller 又要取
    expect((await valuationList(env(), Date.UTC(2026, 11, 2, 2)))!.due).toBe(true);
  });
  it('Shiller 大文件拆成 ≤ 128KB 的块分多步解析；中途停下，同一天再点接着解析（不重新下载、不多算一轮）', async () => {
    const big = shillerXls(2000, (i) => 10 + (i % 300) / 10, 1860);
    const fk = valFake((u) => (u.includes('ie_data.xls') ? new Response(big as unknown as BodyInit) : null));
    // 先把中证这一轮做完（跳过它们：今天记成已成功）
    await db.batch(ALL_CS.map((k) => db.prepare("INSERT INTO fund_val_fetch (src, day, tries, at, ok_day) VALUES (?1, '2026-11-11', 1, 0, '2026-11-11')").bind(k)));
    const first = await round(NOW, fk, 3); // 下载 + 目录 + 1 块就停（像页面被关掉）
    // 第六版：库里没存过链接，直接下载已知链接（1 个请求），再目录、逐块解析
    expect(first.map((r) => r.part)).toEqual(['下载（已知链接）', '目录', expect.stringMatching(/^解析第 \d+ \/ \d+ 块$/)]);
    const blobs = (await db.prepare('SELECT idx, length(data) AS n FROM fund_val_blob ORDER BY idx').all<{ idx: number; n: number }>()).results ?? [];
    expect(blobs.length).toBeGreaterThan(3);
    expect(blobs.every((b) => b.n <= VAL_BLOB)).toBe(true);
    const n0 = fk.log.length;
    expect(n0).toBe(1);
    const rest = await round(NOW + 60_000, fk);
    expect(fk.log.length).toBe(n0); // 接着解析，不再下载
    expect(rest.at(-1)!.status).toBe('ok');
    expect((await db.prepare("SELECT tries FROM fund_val_fetch WHERE src = 'shiller'").first<{ tries: number }>())!.tries).toBe(1);
    const spx = (await valuationList(env(), NOW))!.items.find((x) => x.code === 'SPX')!;
    expect(spx.pe_now_date).toBe('2026-08');
    expect(spx.pe_now).toBe(10 + (1999 % 300) / 10);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM fund_val_blob').first<{ n: number }>())!.n).toBe(0);
  });
  it('中证回 500：这一轮失败、保留上次的值、这次刷新里不再碰它；同一天再点还能再试一轮，第 3 轮不再试；第二天又能取', async () => {
    const a = valFake();
    await round(NOW - DAY, a);
    const before = (await valuationList(env(), NOW - DAY))!.items[0];
    const b = valFake((u) => (u.includes('index-perf') && u.includes('000300') ? new Response('x', { status: 500 }) : null));
    const r1 = await round(NOW, b);
    expect(r1.filter((r) => r.status === 'failed').map((r) => [r.code, r.reason])).toEqual([['000300', expect.stringContaining('中证回 500')]]);
    expect(b.log.filter((x) => x.u.includes('index-perf') && x.u.includes('000300')).length).toBe(1);
    const v = (await valuationList(env(), NOW))!;
    expect(v.items[0]).toMatchObject({ code: '000300', error: expect.stringContaining('中证回 500') });
    expect([v.items[0].pe_now_date, v.items[0].pe_now, v.items[0].dy_now]).toEqual([before.pe_now_date, before.pe_now, 3.03]);
    expect(v.due).toBe(true);
    // 第 2 轮：只剩 000300 的市盈率
    const n1 = b.log.length;
    await round(NOW + 60_000, b);
    expect(b.log.slice(n1).map((x) => x.u.includes('index-perf') && x.u.includes('000300'))).toEqual([true]);
    // 第 3 轮：今天已经开过 2 轮，不再请求
    const r3 = await round(NOW + 120_000, b);
    expect(r3.map((r) => [r.status, r.requests])).toEqual([['done', 0]]);
    expect((await valuationList(env(), NOW + 120_000))!.due).toBe(false);
    // 第二天又能取
    const c = valFake();
    const d2 = await round(NOW + DAY, c);
    expect(d2.filter((r) => r.status === 'failed')).toEqual([]);
  });
  it('（第五版）Shiller 用存的链接：最新月份没前进 → 同一轮再看首页；首页还是那个链接 → 保留旧数据、注明"本月还没更新"；首页有新链接 → 换新链接下载、不再注明', async () => {
    await db.batch(ALL_CS.map((k) => db.prepare("INSERT INTO fund_val_fetch (src, day, tries, at, ok_day) VALUES (?1, '2026-11-11', 1, 0, '2026-11-11')").bind(k)));
    const OLD = SHILLER_KNOWN_XLS, NEW = 'https://img1.wsimg.com/blobby/go/a/downloads/b/ie_data.xls?ver=10';
    const xOld = shillerXls(200, (i) => 20 + i / 10), xNew = shillerXls(201, (i) => 20 + i / 10);
    const sh = (u: string) => /shillerdata|wsimg/.test(u);
    const a = valFake();
    await round(NOW, a);
    expect(a.log.map((x) => x.u)).toEqual([OLD]); // 第六版：第一次直接下载已知链接，存进库
    const spx0 = (await valuationList(env(), NOW))!.items.find((x) => x.code === 'SPX')!;
    expect(spx0.note).toBeUndefined();
    // 下个月：存的链接（还是旧文件）→ 没前进 → 首页（还是那个链接）→ 不再下载；保留旧数据、注明
    const DEC = Date.UTC(2026, 11, 2, 2);
    await db.batch(ALL_CS.map((k) => db.prepare("UPDATE fund_val_fetch SET day = '2026-12-02', ok_day = '2026-12-02' WHERE src = ?1").bind(k)));
    const b = valFake((u) => (u === 'https://shillerdata.com/' ? new Response(`<a href="${OLD}">ie_data.xls</a>`) : null)); // 第六版：首页给的还是已知链接
    const rb = await round(DEC, b);
    expect(b.log.map((x) => x.u)).toEqual([OLD, 'https://shillerdata.com/']);
    expect(b.log[1].slept - b.log[0].slept + (b.log[1].t - b.log[0].t)).toBeGreaterThanOrEqual(VAL_GAP_MS - 5);
    expect(rb.filter((r) => r.status === 'failed')).toEqual([]);
    const spx1 = (await valuationList(env(), DEC))!.items.find((x) => x.code === 'SPX')!;
    expect([spx1.pe_now_date, spx1.pe_now]).toEqual([spx0.pe_now_date, spx0.pe_now]);
    expect(spx1.note).toMatch(/Shiller 本月还没更新/);
    expect((await valuationList(env(), DEC))!.due).toBe(false); // 这个月这一轮算完
    expect((await db.prepare('SELECT COUNT(*) AS n FROM fund_val_blob').first<{ n: number }>())!.n).toBe(0);
    // 再下个月：存的链接没前进 → 首页给了新链接 → 下载新文件（多一个月）→ 不再注明、链接换成新的
    const JAN = Date.UTC(2027, 0, 5, 2);
    await db.batch(ALL_CS.map((k) => db.prepare("UPDATE fund_val_fetch SET day = '2027-01-05', ok_day = '2027-01-05' WHERE src = ?1").bind(k)));
    const c = valFake((u) => (u === 'https://shillerdata.com/' ? new Response(`<a href="${NEW}">ie_data.xls</a>`) : u === NEW ? new Response(xNew as unknown as BodyInit) : u === OLD ? new Response(xOld as unknown as BodyInit) : null));
    await round(JAN, c);
    expect(c.log.filter((x) => sh(x.u)).map((x) => x.u)).toEqual([OLD, 'https://shillerdata.com/', NEW]);
    const spx2 = (await valuationList(env(), JAN))!.items.find((x) => x.code === 'SPX')!;
    expect(spx2.pe_now_date > spx0.pe_now_date).toBe(true);
    expect(spx2.note).toBeUndefined();
    expect(JSON.parse((await db.prepare("SELECT data FROM fund_valuation WHERE code = 'SPX'").first<{ data: string }>())!.data).xls_url).toBe(NEW);
    // 下个月的注明只在那个月显示
    expect((await valuationList(env(), JAN))!.items.find((x) => x.code === 'SPX')!.note).toBeUndefined();
  });
  it('Shiller 首页上的链接不在白名单：不去取，记原因（已知链接先失败才会去首页）', async () => {
    await db.batch(ALL_CS.map((k) => db.prepare("INSERT INTO fund_val_fetch (src, day, tries, at, ok_day) VALUES (?1, '2026-11-11', 1, 0, '2026-11-11')").bind(k)));
    const fk = valFake((u) => (u === 'https://shillerdata.com/' ? new Response('<a href="https://evil.example.com/ie_data.xls">x</a>') : u === SHILLER_KNOWN_XLS ? new Response('gone', { status: 404 }) : null));
    const rs = await round(NOW, fk);
    expect(rs.map((r) => r.status)).toEqual(['working', 'failed']);
    expect(fk.log.map((x) => x.u)).toEqual([SHILLER_KNOWN_XLS, 'https://shillerdata.com/']);
    const err = (await valuationList(env(), NOW))!.missing.find((m) => m.code === 'SPX')!.error!;
    expect(err).toContain('没找到 ie_data.xls');
    expect(err).toContain('已知链接没取到：Shiller 数据回 404');
  });
  // ---- 第六版研发自测（11/12：首页连接被重置，已知 xls 链接本身能下载）
  it('（第六版）已知链接回 500：同一轮回退首页 → 下载首页给的链接 → 成功，存的是首页给的链接；同源间隔 ≥ 5 秒、每次调用 ≤ 1 个请求', async () => {
    await db.batch(ALL_CS.map((k) => db.prepare("INSERT INTO fund_val_fetch (src, day, tries, at, ok_day) VALUES (?1, '2026-11-11', 1, 0, '2026-11-11')").bind(k)));
    const HOME_LINK = 'https://img1.wsimg.com/blobby/go/a/downloads/b/ie_data.xls?ver=9';
    const fk = valFake((u) => (u === SHILLER_KNOWN_XLS ? new Response('x', { status: 500 }) : null));
    const rs = await round(NOW, fk);
    expect(rs.at(-1)!.status).toBe('ok');
    expect(rs[0].part).toMatch(/^下载（已知链接没取到：Shiller 数据回 500/);
    expect(fk.log.map((x) => x.u)).toEqual([SHILLER_KNOWN_XLS, 'https://shillerdata.com/', HOME_LINK]);
    fk.log.forEach((x, i) => { if (i) expect(x.slept - fk.log[i - 1].slept + (x.t - fk.log[i - 1].t)).toBeGreaterThanOrEqual(VAL_GAP_MS - 5); });
    expect(JSON.parse((await db.prepare("SELECT data FROM fund_valuation WHERE code = 'SPX'").first<{ data: string }>())!.data).xls_url).toBe(HOME_LINK);
  });
  it('（第六版）已知链接回 403 / 429：立刻停，不再请求首页，记原因', async () => {
    for (const code of [403, 429]) {
      await db.exec('DELETE FROM fund_val_fetch; DELETE FROM fund_val_work; DELETE FROM fund_valuation;');
      await db.batch(ALL_CS.map((k) => db.prepare("INSERT INTO fund_val_fetch (src, day, tries, at, ok_day) VALUES (?1, '2026-11-11', 1, 0, '2026-11-11')").bind(k)));
      const fk = valFake((u) => (u === SHILLER_KNOWN_XLS ? new Response('x', { status: code }) : null));
      const rs = await round(NOW, fk);
      expect(rs.map((r) => r.status)).toEqual(['failed']);
      expect(fk.log.map((x) => x.u)).toEqual([SHILLER_KNOWN_XLS]);
      expect(rs[0].reason).toContain(`Shiller 数据回 ${code}`);
      expect(rs[0].reason).toContain('这一轮不再请求Shiller');
    }
  });
  it('（第六版）已知链接和首页都失败：照旧写原因（两个都写），没有数据', async () => {
    await db.batch(ALL_CS.map((k) => db.prepare("INSERT INTO fund_val_fetch (src, day, tries, at, ok_day) VALUES (?1, '2026-11-11', 1, 0, '2026-11-11')").bind(k)));
    const fk = valFake((u) => (u === SHILLER_KNOWN_XLS ? new Response('x', { status: 502 }) : u === 'https://shillerdata.com/' ? (() => { throw new TypeError('connection reset'); })() : null));
    const rs = await round(NOW, fk);
    expect(rs.map((r) => r.status)).toEqual(['working', 'failed']);
    const m = (await valuationList(env(), NOW))!.missing.find((x) => x.code === 'SPX')!;
    expect(m.error).toContain('已知链接没取到：Shiller 数据回 502');
    expect(m.error).toContain('首页：连不上 Shiller 首页');
  });
  it('（第六版）库里存了链接：直接用存的，不用已知链接', async () => {
    await db.batch(ALL_CS.map((k) => db.prepare("INSERT INTO fund_val_fetch (src, day, tries, at, ok_day) VALUES (?1, '2026-11-11', 1, 0, '2026-11-11')").bind(k)));
    const SAVED = 'https://img1.wsimg.com/blobby/go/s/downloads/t/ie_data.xls?ver=5';
    await db.prepare("INSERT INTO fund_valuation (code, data, ok_at) VALUES ('SPX', ?1, 0)").bind(JSON.stringify({ code: 'SPX', series: [['2026-01', 30]], pe_now: 30, pe_now_date: '2026-01', dy_now: null, dy_date: null, xls_url: SAVED })).run();
    const fk = valFake();
    const rs = await round(NOW, fk);
    expect(rs.at(-1)!.status).toBe('ok');
    expect(fk.log.map((x) => x.u)).toEqual([SAVED]);
  });
  it('（第六版）存的链接数据没前进、再看首页时首页连不上：保留旧数据，注明"Shiller 本月还没更新（首页连不上）"，不记错误；这个月还算没取成（下次刷新再试）', async () => {
    await db.batch(ALL_CS.map((k) => db.prepare("INSERT INTO fund_val_fetch (src, day, tries, at, ok_day) VALUES (?1, '2026-11-11', 1, 0, '2026-11-11')").bind(k)));
    await round(NOW, valFake());
    const spx0 = (await valuationList(env(), NOW))!.items.find((x) => x.code === 'SPX')!;
    const DEC = Date.UTC(2026, 11, 2, 2);
    await db.batch(ALL_CS.map((k) => db.prepare("UPDATE fund_val_fetch SET day = '2026-12-02', ok_day = '2026-12-02' WHERE src = ?1").bind(k)));
    // 主会话补充：第 1 次（网络错误）先用存的链接下载、没前进、再看首页；之后的轮次（503）不再重下存的链接，只请求首页
    let k = 0;
    for (const bad of [() => { throw new TypeError('connection reset'); }, () => new Response('x', { status: 503 })]) {
      await db.prepare("UPDATE fund_val_fetch SET day = '2026-12-01', tries = 0 WHERE src = 'shiller'").run();
      const b = valFake((u) => (u === 'https://shillerdata.com/' ? bad() : null));
      const rb = await round(DEC, b);
      expect(b.log.map((x) => x.u)).toEqual(k++ === 0 ? [SHILLER_KNOWN_XLS, 'https://shillerdata.com/'] : ['https://shillerdata.com/']);
      expect(rb.every((r) => r.requests <= 1)).toBe(true);
      expect(rb.at(-1)).toMatchObject({ code: 'SPX', status: 'failed', reason: expect.stringContaining('Shiller 本月还没更新，首页连不上') });
      const v = (await valuationList(env(), DEC))!;
      const spx1 = v.items.find((x) => x.code === 'SPX')!;
      expect([spx1.pe_now_date, spx1.pe_now]).toEqual([spx0.pe_now_date, spx0.pe_now]);
      expect(spx1.note).toContain('Shiller 本月还没更新（首页连不上）');
      expect(spx1.error).toBeUndefined();
      expect(v.due).toBe(true);
      expect((await db.prepare('SELECT COUNT(*) AS n FROM fund_val_blob').first<{ n: number }>())!.n).toBe(0);
    }
    // 同一天第 2 轮（首页还是连不上）：也只请求首页；第 3 轮不再请求
    const same = valFake((u) => (u === 'https://shillerdata.com/' ? new Response('x', { status: 502 }) : null));
    await round(DEC + 60_000, same);
    expect(same.log.map((x) => x.u)).toEqual(['https://shillerdata.com/']);
    await round(DEC + 120_000, same);
    expect(same.log.length).toBe(1);
    // 首页恢复、还是那个链接：只请求首页、不重下；注明变回普通的"本月还没更新"，这个月算完
    await db.prepare("UPDATE fund_val_fetch SET day = '2026-12-01', tries = 0 WHERE src = 'shiller'").run();
    const ok = valFake((u) => (u === 'https://shillerdata.com/' ? new Response(`<a href="${SHILLER_KNOWN_XLS}">ie_data.xls</a>`) : null));
    await round(DEC, ok);
    expect(ok.log.map((x) => x.u)).toEqual(['https://shillerdata.com/']);
    const v2 = (await valuationList(env(), DEC))!;
    expect(v2.items.find((x) => x.code === 'SPX')!.note).toMatch(/^Shiller 本月还没更新（最新是/);
    expect(v2.due).toBe(false);
  });
  it('（第六版补充）本月已下载、待找新链接：首页恢复并给出新链接 → 只下载新文件（不重下存的链接），数据前进、不再注明、链接换新', async () => {
    await db.batch(ALL_CS.map((k) => db.prepare("INSERT INTO fund_val_fetch (src, day, tries, at, ok_day) VALUES (?1, '2026-11-11', 1, 0, '2026-11-11')").bind(k)));
    await round(NOW, valFake());
    const spx0 = (await valuationList(env(), NOW))!.items.find((x) => x.code === 'SPX')!;
    const DEC = Date.UTC(2026, 11, 2, 2);
    await db.batch(ALL_CS.map((k) => db.prepare("UPDATE fund_val_fetch SET day = '2026-12-02', ok_day = '2026-12-02' WHERE src = ?1").bind(k)));
    const down = valFake((u) => (u === 'https://shillerdata.com/' ? new Response('x', { status: 503 }) : null));
    await round(DEC, down);
    expect(down.log.map((x) => x.u)).toEqual([SHILLER_KNOWN_XLS, 'https://shillerdata.com/']);
    const NEW = 'https://img1.wsimg.com/blobby/go/a/downloads/c/ie_data.xls?ver=11';
    const up = valFake((u) => (u === 'https://shillerdata.com/' ? new Response(`<a href="${NEW}">ie_data.xls</a>`) : u === NEW ? new Response(shillerXls(201, (i) => 20 + i / 10) as unknown as BodyInit) : null));
    const rs = await round(DEC + 60_000, up);
    expect(up.log.map((x) => x.u)).toEqual(['https://shillerdata.com/', NEW]);
    expect(up.log[1].slept - up.log[0].slept + (up.log[1].t - up.log[0].t)).toBeGreaterThanOrEqual(VAL_GAP_MS - 5);
    expect(rs.every((r) => r.requests <= 1)).toBe(true);
    const v = (await valuationList(env(), DEC + 60_000))!;
    const spx1 = v.items.find((x) => x.code === 'SPX')!;
    expect(spx1.pe_now_date > spx0.pe_now_date).toBe(true);
    expect(spx1.note).toBeUndefined();
    expect(v.due).toBe(false);
    expect(JSON.parse((await db.prepare("SELECT data FROM fund_valuation WHERE code = 'SPX'").first<{ data: string }>())!.data).xls_url).toBe(NEW);
  });
  it('接口：POST /api/funds/valuation/refresh 要登录、cursor 越界 400；GET /api/funds 带 valuation', async () => {
    expect((await handle(new Request(HOST + '/api/funds/valuation/refresh', { method: 'POST', body: '{}' }), env(), NOW)).status).toBe(401);
    const login = await handle(new Request(HOST + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: HOST, 'cf-connecting-ip': '203.0.113.8' }, body: JSON.stringify({ password: PASS }) }), env(), NOW);
    const ck = login.headers.get('set-cookie')!.split(';')[0];
    const bad = await handle(new Request(HOST + '/api/funds/valuation/refresh', { method: 'POST', headers: { cookie: ck, origin: HOST, 'content-type': 'application/json' }, body: JSON.stringify({ cursor: VAL_MAX_STEPS }) }), env(), NOW);
    expect(bad.status).toBe(400);
    const g = await (await handle(new Request(HOST + '/api/funds', { headers: { cookie: ck } }), env(), NOW)).json() as { valuation: { due: boolean; items: unknown[]; missing: unknown[] } };
    expect(g.valuation).toMatchObject({ due: true, items: [] });
    expect(g.valuation.missing.length).toBe(6);
  });
});

// ---------------------------------------------------------------- 页面（jsdom 跑 FUNDS_JS）
describe('D4. 页面：估值板块', () => {
  it('6 张卡，判词按分位（<30 便宜 / 30–70 中间 / >70 贵）；切市场只显示对应市场；子菜单有"估值"；刷新后 due 才调估值接口', async () => {
    const jsdomName = 'jsdom';
    const { JSDOM } = await import(jsdomName);
    const { FUNDS_MOD, FUNDS_JS } = await import('../src/funds-page');
    const { ADMIN_PAGE } = await import('../src/admin-page');
    expect(ADMIN_PAGE).toMatch(/<a href="#\/funds\/va" data-s="fu-va" data-target="fu-va">估值<\/a>/);
    const mk = (code: string, pct: number) => { const d = VAL_INDEXES.find((x) => x.code === code)!; const series = Array.from({ length: 120 }, (_, i) => [`m${i}`, 10 + (i % 9)] as [string, number]); return { ...valCard(d, { code, series, pe_now: 14, pe_now_date: '2026-11-10', dy_now: 3, dy_date: '2026-11-10' })!, pe_pct10y: pct, ok_at: null }; };
    const snap = JSON.parse(readFileSync(path.join(ROOT, 'test/fixtures/funds/snapshot.json'), 'utf8'));
    snap.valuation = { due: true, missing: [], items: [mk('000300', 49), mk('000016', 79), mk('000905', 20), mk('000015', 97), mk('000922', 83), mk('SPX', 99)] };
    const dom = new JSDOM(`<!doctype html><body><main id="app">${FUNDS_MOD}</main></body>`, { runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window as unknown as Window & typeof globalThis & { fundsOpen(): void; eval(s: string): unknown };
    const posts: { url: string; body: Record<string, unknown> }[] = [];
    (w as any).fetch = async (url: string, init: { method: string; body?: string }) => {
      const res = (b: unknown) => ({ status: 200, ok: true, json: async () => b });
      if (init.method === 'POST') {
        const b = JSON.parse(init.body || '{}'); posts.push({ url, body: b });
        if (url.endsWith('/valuation/refresh')) { const s = b.cursor as number; return res({ next: s < 5 ? s + 1 : null, done: s + 1, total: 6, code: '', name: 'x', part: '', status: s === 2 ? 'failed' : 'ok', reason: s === 2 ? '中证回 500' : undefined, requests: 2 }); }
        return res({ next: null, done: 45, total: 45, updated: ['VOO'], failed: [] });
      }
      return res(JSON.parse(JSON.stringify(snap)));
    };
    (w as any).matchMedia = () => ({ matches: false });
    w.eval(FUNDS_JS);
    w.document.getElementById('v-funds')!.hidden = false;
    w.fundsOpen();
    const until = async (c: () => boolean) => { for (let k = 0; k < 400 && !c(); k++) await new Promise((r) => setTimeout(r, 5)); return c(); };
    const cards = () => [...w.document.querySelectorAll('#fu-va-grid [data-val-code]')].map((e) => e.getAttribute('data-val-code'));
    expect(await until(() => cards().length === 6)).toBe(true);
    const verdict = (code: string) => w.document.querySelector(`[data-val-code="${code}"] .fu-verdict`)!;
    expect(verdict('000300').className).toContain('mid');
    expect(verdict('000905').className).toContain('lo');
    expect(verdict('000905').textContent).toMatch(/^比过去便宜：比过去 10 年 20% 的时间都高$/);
    expect(verdict('SPX').className).toContain('hi');
    const txt = w.document.getElementById('fu-va')!.textContent!;
    for (const s of ['推断', '不是预测', '不是投资建议', '两种口径不能直接比较', '数据来源：中证指数有限公司、Robert Shiller，仅供本人参考，不转载', '还没有估值历史的 34 只']) expect(txt).toContain(s);
    const tab = (m: string) => [...w.document.querySelectorAll('#fu-markets .fu-chip')].find((b) => (b as HTMLElement).dataset.m === m) as HTMLButtonElement;
    tab('中国').click();
    expect(cards()).toEqual(['000300', '000016', '000905', '000015', '000922']);
    tab('美国').click();
    expect(cards()).toEqual(['SPX']);
    tab('新加坡').click();
    expect(cards()).toEqual(['SPX']); // 新加坡：标普500 那张（XUS 在新加坡上市；原型 v3）
    tab('').click();
    // 刷新：45 只取完 → due → 估值 6 批（step 0..5）
    (w.document.getElementById('fu-refresh') as HTMLButtonElement).click();
    expect(await until(() => !(w.document.getElementById('fu-refresh') as HTMLButtonElement).disabled && w.document.getElementById('fu-va-msg')!.textContent !== '' && !/正在取/.test(w.document.getElementById('fu-va-msg')!.textContent!))).toBe(true);
    expect(posts.filter((p) => p.url.endsWith('/valuation/refresh')).map((p) => p.body.cursor)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(w.document.getElementById('fu-va-msg')!.textContent).toContain('1 项这次没取到');
    // due = false：不调估值接口
    snap.valuation.due = false;
    posts.length = 0;
    (w.document.getElementById('fu-refresh') as HTMLButtonElement).click();
    await until(() => posts.length > 0 && !(w.document.getElementById('fu-refresh') as HTMLButtonElement).disabled);
    await new Promise((r) => setTimeout(r, 50));
    expect(posts.filter((p) => p.url.includes('/valuation'))).toEqual([]);
    w.close();
  });
});
