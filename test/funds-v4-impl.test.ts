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
import { fetchFund, Http, refreshBatch, refreshValuation, tiingoToken, VAL_GAP_MS, valuationList, type FetchLike } from '../src/funds-api';
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
beforeEach(async () => { await db.batch(['fund_snapshot', 'fund_valuation', 'fund_val_fetch'].map((t) => db.prepare(`DELETE FROM ${t}`))); });
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
    const e = await fetchFund(FUNDS.find((x) => x.code === 'SCHD')!, new Http(f, 45, noSleep), NOW, null, { tiingo: TOKEN }).catch((x) => x as Error);
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
function shillerXls(months: number, capeOf: (i: number) => number) {
  const rows: [number, (string | number | { rk: number } | { f: number } | { fs: string } | undefined)[]][] = [[5, [undefined, 'S&P']], [7, ['Date', 'P', 'D', 'E', 'CPI', 'Fraction', 'Rate GS10', 'Real', 'Real', 'Return', 'Real', 'Scaled', 'CAPE']]];
  for (let i = 0; i < months; i++) {
    const y = 2010 + Math.floor(i / 12), m = (i % 12) + 1;
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
  const log: { u: string; slept: number }[] = [];
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
    log.push({ u, slept });
    const o = over(u);
    if (o) return o;
    const m = /indexCode=(\d+)/.exec(u);
    if (m) return perf(m[1], u);
    if (u.includes('indicator.xls')) return new Response(csXls([['20261110', 3.03]], { small: true }));
    if (u === 'https://shillerdata.com/') return new Response('<a href="//img1.wsimg.com/blobby/go/a/downloads/b/ie_data.xls?ver=9">ie_data.xls</a>');
    if (u.includes('ie_data.xls')) return new Response(shillerXls(200, (i) => 20 + i / 10));
    return new Response('no', { status: 404 });
  };
  return { f, log, sleep };
}

describe('D3. 取数：每个来源每天最多 1 次、间隔 ≥ 2 秒、不重试、保留上次', () => {
  it('6 批：中证每批 2 个请求、Shiller 2 个；同一来源前后两个请求之间都等够 2 秒；同一天再刷全部跳过、0 个请求', async () => {
    const { f, log, sleep } = valFake();
    const out = [];
    for (let s: number | null = 0, k = 0; s !== null && k < 10; k++) { const r = await refreshValuation(env(), s, NOW, f, sleep); out.push(r); s = r.next; }
    expect(out.map((r) => [r.code, r.status, r.requests])).toEqual([...VAL_INDEXES.map((d) => [d.code, 'ok', 2])]);
    expect(log.length).toBe(12);
    // 每个请求前都 sleep 过 ≥ 2 秒（替身 sleep 不推进时钟，所以每次都等满 2 秒）
    // （替身 sleep 不推进时钟；两次请求之间真实过去的几毫秒会从要等的里面扣掉，所以是 ≥ 2 秒减几毫秒，且每次都等过）
    // 第 1 个（中证第 1 批）和 Shiller 首页（前面是中证，不是同一来源）不用等；其余每个都等过
    const waited = log.map((x, i) => x.slept - (i ? log[i - 1].slept : 0));
    expect(waited[0]).toBe(0);
    expect(waited[10]).toBe(0);
    waited.forEach((ms, i) => { if (i !== 0 && i !== 10) expect(ms, String(i)).toBeGreaterThan(VAL_GAP_MS - 200); });
    expect(log.map((x) => new URL(x.u).hostname).every((h) => ['www.csindex.com.cn', 'oss-ch.csindex.com.cn', 'shillerdata.com', 'img1.wsimg.com'].includes(h))).toBe(true);
    // 首次全量：从 122 个月前的 1 号起
    expect(log[0].u).toContain('startDate=20160901&endDate=20261111');
    const v = (await valuationList(env(), NOW))!;
    expect(v.due).toBe(false);
    expect(v.items.map((x) => x.code)).toEqual(VAL_INDEXES.map((d) => d.code));
    expect(v.items[0].dy_now).toBe(3.03);
    expect(v.items[5]).toMatchObject({ metric: 'CAPE', pe_now: 39.9, pe_now_date: '2026-08', n_months: 120 });
    // 同一天再来一遍：全部跳过
    const again = await refreshValuation(env(), 0, NOW + 3600_000, f, sleep);
    expect([again.status, again.requests]).toEqual(['skipped', 0]);
    expect(log.length).toBe(12);
    // 第二天：中证又能取（增量：从库里最后一个月的 1 号起），Shiller 这个月不再取
    const d2 = await refreshValuation(env(), 0, NOW + DAY, f, sleep);
    expect(d2.status).toBe('ok');
    expect(log[12].u).toContain('startDate=20261101&endDate=20261112');
    expect((await refreshValuation(env(), 5, NOW + DAY, f, sleep)).status).toBe('skipped');
    // 下个月 Shiller 又能取
    expect((await valuationList(env(), Date.UTC(2026, 11, 2, 2)))!.due).toBe(true);
  });
  it('回 500 不重试（重试也算一次）；没取到保留上次的值、标 error；当天不再去取', async () => {
    const a = valFake();
    await refreshValuation(env(), 0, NOW - DAY, a.f, a.sleep);
    const before = (await valuationList(env(), NOW - DAY))!.items[0];
    const b = valFake((u) => (u.includes('index-perf') ? new Response('x', { status: 500 }) : null));
    const r = await refreshValuation(env(), 0, NOW, b.f, b.sleep);
    expect(r.status).toBe('partial');
    expect(b.log.filter((x) => x.u.includes('index-perf')).length).toBe(1);
    expect(r.reason).toContain('市盈率：中证回 500');
    const v = (await valuationList(env(), NOW))!;
    expect(v.items[0]).toMatchObject({ code: '000300', error: expect.stringContaining('中证回 500') });
    expect([v.items[0].pe_now_date, v.items[0].pe_now]).toEqual([before.pe_now_date, before.pe_now]);
    expect(v.items[0].dy_now).toBe(3.03); // 股息率这次取到了
    expect((await refreshValuation(env(), 0, NOW + 60_000, b.f, b.sleep)).status).toBe('skipped');
  });
  it('Shiller 首页上的链接不在白名单：不去取，记原因', async () => {
    const { f, log, sleep } = valFake((u) => (u === 'https://shillerdata.com/' ? new Response('<a href="https://evil.example.com/ie_data.xls">x</a>') : null));
    const r = await refreshValuation(env(), 5, NOW, f, sleep);
    expect(r.status).toBe('failed');
    expect(log.map((x) => x.u)).toEqual(['https://shillerdata.com/']);
    expect((await valuationList(env(), NOW))!.missing.find((m) => m.code === 'SPX')!.error).toContain('没找到 ie_data.xls');
  });
  it('接口：POST /api/funds/valuation/refresh 要登录、step 越界 400；GET /api/funds 带 valuation', async () => {
    expect((await handle(new Request(HOST + '/api/funds/valuation/refresh', { method: 'POST', body: '{}' }), env(), NOW)).status).toBe(401);
    const login = await handle(new Request(HOST + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: HOST, 'cf-connecting-ip': '203.0.113.8' }, body: JSON.stringify({ password: PASS }) }), env(), NOW);
    const ck = login.headers.get('set-cookie')!.split(';')[0];
    const bad = await handle(new Request(HOST + '/api/funds/valuation/refresh', { method: 'POST', headers: { cookie: ck, origin: HOST, 'content-type': 'application/json' }, body: JSON.stringify({ cursor: 6 }) }), env(), NOW);
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
        if (url.endsWith('/valuation/refresh')) { const s = b.cursor as number; return res({ next: s < 5 ? s + 1 : null, step: s, total: 6, code: '', name: 'x', status: s === 2 ? 'failed' : 'ok', reason: s === 2 ? '中证回 500' : undefined, requests: 2 }); }
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
    expect(cards()).toEqual([]); // 新加坡：没有卡，写一句说明（测试会话 e2e VA 约定）
    expect(w.document.getElementById('fu-va-sg')!.hidden).toBe(false);
    tab('').click();
    // 刷新：45 只取完 → due → 估值 6 批（step 0..5）
    (w.document.getElementById('fu-refresh') as HTMLButtonElement).click();
    expect(await until(() => !(w.document.getElementById('fu-refresh') as HTMLButtonElement).disabled && w.document.getElementById('fu-va-msg')!.textContent !== '' && !/正在取/.test(w.document.getElementById('fu-va-msg')!.textContent!))).toBe(true);
    expect(posts.filter((p) => p.url.endsWith('/valuation/refresh')).map((p) => p.body.cursor)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(w.document.getElementById('fu-va-msg')!.textContent).toContain('1 个指数这次没取全');
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
