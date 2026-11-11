/**
 * 基金观察第四版测试用的替身 fetch（不连网）：价格（Yahoo、东方财富、Tiingo）+ 债券收益率（test/funds-yield-fake.ts）+ ② 估值来源（中证、Shiller）。
 * 给 test/funds-v4-tiingo.test.ts、test/funds-v4-valuation.test.ts 用。**测试会话先写（agents C154）**。
 *
 * Tiingo（按官方文档 https://www.tiingo.com/documentation/end-of-day 的格式构造，**没有连过 Tiingo**——没有 key）：
 *   GET https://api.tiingo.com/tiingo/daily/<ticker>/prices?startDate=YYYY-MM-DD[&endDate=…][&token=…]，或请求头 Authorization: Token <token>；
 *   回 JSON 数组，每天一项 { date: "2026-11-10T00:00:00.000Z", close, high, low, open, volume, adjClose, adjHigh, adjLow, adjOpen, adjVolume, divCash, splitFactor }；
 *   **不带 startDate 只回最近一天**（文档原话：If no startDate is specified, only the latest price is returned）；
 *   token 不对 → 401 {"detail":"Invalid token. …"}；不认识的代码 → 404 {"detail":"Error: Ticker '…' not found"}。
 *   替身里 adjClose = 合成走势，close = adjClose / 0.9（看得出 close / adjClose 有没有接反）；同一代码的 Yahoo 回包 = 合成走势 × 1.5（看得出用的是哪个来源）。
 *   401 的回包故意把收到的 token 原样写进 detail（守"token 不出现在给页面的 JSON / 错误文字里"）。
 *
 * ② 估值来源（夹具 test/fixtures/funds/valuation/，agents 调研会话 2026-11-11 实抓，和标准答案 val-ref.json 是同一批原始文件）：
 *   www.csindex.com.cn / csindex.com.cn，地址里带 indexCode=<代码>（或路径里有代码）、路径含 perf → csindex-perf-<代码>.json.gz
 *     （实抓的 index-perf 回包，为控制体积只留 2015 年起每月最后 3 个交易日 + 最后一个月全部交易日；按地址里的 startDate / endDate（YYYYMMDD）过滤）；
 *   oss-ch.csindex.com.cn，路径以 <代码>indicator.xls 结尾 → <代码>indicator.xls（原样二进制）；
 *   shillerdata.com / www.shillerdata.com → shiller-home.html.gz（首页，里面的下载链接指向 img1.wsimg.com/…/ie_data.xls）；
 *   img1.wsimg.com，路径含 ie_data.xls → shiller-ie_data.xls.gz（原样二进制）。
 *   down 里的来源（'csindex' | 'shiller'）一律回 500。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { vi } from 'vitest';
import { ROOT } from './helpers';
import { yieldResponse } from './funds-yield-fake';

const FX = path.join(ROOT, 'test/fixtures/funds/valuation');
const bin = new Map<string, Uint8Array>();
export const fxBytes = (f: string): Uint8Array => {
  if (!bin.has(f)) { const b = readFileSync(path.join(FX, f)); bin.set(f, f.endsWith('.gz') ? new Uint8Array(gunzipSync(b)) : new Uint8Array(b)); }
  return bin.get(f)!;
};
export const VAL_REF = JSON.parse(readFileSync(path.join(FX, 'val-ref.json'), 'utf8')) as { asOf: string; items: Record<string, any>[] };
export const VAL_CN = ['000300', '000016', '000905', '000015', '000922'];
export const VAL_CODES = [...VAL_CN, 'SPX'];

export const US15 = ['VOO', 'IVV', 'SPY', 'VTI', 'QQQ', 'AGG', 'BND', 'TLT', 'BSV', 'LQD', 'VIG', 'SCHD', 'VYM', 'DGRO', 'SDY'];
export const SG14 = ['ES3', 'CFA', 'HST', 'XUS', 'XWR', 'A35', 'MBH', 'SBO', 'O9P', '0P00006FY6', 'CLR', 'SRT', 'BYJ', 'UPD'];

export const urlOf = (input: unknown) => (typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url);
const host = (u: string) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };
const under = (u: string, d: string) => { const h = host(u); return h === d || h.endsWith('.' + d); };
export const isYahoo = (u: string) => under(u, 'yahoo.com');
export const isTiingo = (u: string) => under(u, 'tiingo.com');
export const isEm = (u: string) => under(u, 'eastmoney.com');
export const isCsindex = (u: string) => under(u, 'csindex.com.cn');
export const isShiller = (u: string) => under(u, 'shillerdata.com') || (host(u) === 'img1.wsimg.com' && /ie_data\.xls/i.test(u));
/** 规格明令不许请求的估值来源 */
export const isBannedVal = (u: string) => ['danjuanfunds.com', 'multpl.com', 'msci.com', 'ftse.com', 'ftserussell.com', 'lseg.com'].some((d) => under(u, d)) || /danjuan|multpl|msci|ftse/i.test(host(u));
export const yahooSym = (u: string) => decodeURIComponent(/\/chart\/([^/?]+)/.exec(u)?.[1] ?? '');
export const tiingoSym = (u: string) => decodeURIComponent(/\/tiingo\/daily\/([^/?]+)\/prices/i.exec(new URL(u).pathname)?.[1] ?? '').toUpperCase();
export const emCode = (u: string) => (isEm(u) && /lsjz/i.test(u) ? new URL(u).searchParams.get('fundCode') : null);

/** 合成走势：2025-09-16 起到 end 的工作日，按代码做种子（同 test/funds-v3-sources.test.ts） */
export function synth(code: string, end: string): [string, number][] {
  let s = [...code].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const out: [string, number][] = [];
  let v = 10 + rnd() * 90;
  for (let t = Date.UTC(2025, 8, 16); new Date(t).toISOString().slice(0, 10) <= end; t += 86400_000) {
    const w = new Date(t).getUTCDay();
    if (w === 0 || w === 6) continue;
    v *= 1 + (rnd() - 0.5) * 0.02;
    out.push([new Date(t).toISOString().slice(0, 10), Math.round(v * 1e4) / 1e4]);
  }
  return out;
}
/** Tiingo 替身某天的 close（= adjClose / 0.9，4 位小数） */
export const tiingoClose = (adj: number) => Math.round((adj / 0.9) * 1e4) / 1e4;
/** Yahoo 替身给美国 15 只的价格倍数（和 Tiingo 的 adjClose 区分开） */
export const YAHOO_US_MULT = 1.5;

export type TiingoMode = 'ok' | 500 | 404 | 'empty' | 401 | 'hang';
export interface FakeOpts {
  /** 序列最后一天 */
  end: string;
  /** Tiingo 认的 token（请求里带的 token 和它不同 → 401） */
  token: string;
  /** 每只 Tiingo 的表现，没写的按 'ok' */
  tiingo?: (sym: string) => TiingoMode;
  /** 估值来源坏了：'csindex' / 'shiller' 一律回 500 */
  down?: Set<'csindex' | 'shiller'>;
}

const jsonRes = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const binRes = (b: Uint8Array, type: string) => new Response(b as unknown as BodyInit, { status: 200, headers: { 'content-type': type } });

function headerOf(init: RequestInit | undefined, input: unknown, k: string): string {
  try { const h = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)); return h.get(k) ?? ''; } catch { return ''; }
}

/** 替身回包；hang 时回一个永远不 resolve（直到 abort）的 Promise */
export function fakeResponse(input: unknown, init: RequestInit | undefined, o: FakeOpts): Promise<Response> {
  const url = urlOf(input);
  const u = new URL(url);
  const yr = yieldResponse(url, init ?? (input instanceof Request ? { method: input.method } : undefined));
  if (yr) return Promise.resolve(yr);
  if (isTiingo(url)) {
    const sym = tiingoSym(url);
    const given = u.searchParams.get('token') ?? headerOf(init, input, 'authorization').replace(/^Token\s+/i, '');
    if (!sym) return Promise.resolve(jsonRes({ detail: 'Not found.' }, 404));
    if (given !== o.token) return Promise.resolve(jsonRes({ detail: `Invalid token. Please check your token: ${given}` }, 401));
    const mode = o.tiingo?.(sym) ?? 'ok';
    if (mode === 'hang') {
      return new Promise((_res, rej) => {
        const sig = init?.signal;
        if (sig?.aborted) return rej(new DOMException('aborted', 'AbortError'));
        sig?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
      });
    }
    if (mode === 500) return Promise.resolve(new Response('Internal Server Error', { status: 500 }));
    if (mode === 404 || !US15.includes(sym)) return Promise.resolve(jsonRes({ detail: `Error: Ticker '${sym}' not found` }, 404));
    if (mode === 401) return Promise.resolve(jsonRes({ detail: `Invalid token. Please check your token: ${given}` }, 401));
    if (mode === 'empty') return Promise.resolve(jsonRes([]));
    const start = u.searchParams.get('startDate'), endQ = u.searchParams.get('endDate');
    let rows = synth(sym, o.end).filter(([d]) => (!start || d >= start) && (!endQ || d <= endQ));
    if (!start) rows = rows.slice(-1);
    return Promise.resolve(jsonRes(rows.map(([d, a]) => {
      const c = tiingoClose(a);
      return { date: `${d}T00:00:00.000Z`, close: c, high: c, low: c, open: c, volume: 1000000, adjClose: a, adjHigh: a, adjLow: a, adjOpen: a, adjVolume: 1000000, divCash: 0.0, splitFactor: 1.0 };
    })));
  }
  if (isYahoo(url) && /\/chart\//.test(url)) {
    const sym = yahooSym(url);
    const code = sym.replace(/\.(SI|SS)$/, '');
    const k = US15.includes(code) ? YAHOO_US_MULT : 1;
    const ser = synth(code, o.end);
    const adj = ser.map(([, a]) => Math.round(a * k * 1e4) / 1e4);
    return Promise.resolve(jsonRes({ chart: { result: [{ meta: { currency: sym.endsWith('.SI') ? 'SGD' : 'USD', symbol: sym, gmtoffset: 28800 }, timestamp: ser.map(([d]) => Date.parse(d + 'T01:00:00Z') / 1000), indicators: { quote: [{ close: adj.slice() }], adjclose: [{ adjclose: adj }] } }], error: null } }));
  }
  const e = emCode(url);
  if (e) {
    const rows = [...synth(e, o.end)].reverse().map(([d, a]) => ({ FSRQ: d, DWJZ: (a * 0.5).toFixed(4), LJJZ: a.toFixed(4) }));
    const pi = Number(u.searchParams.get('pageIndex') ?? 1), ps = Number(u.searchParams.get('pageSize') ?? 20);
    return Promise.resolve(jsonRes({ Data: { LSJZList: rows.slice((pi - 1) * ps, pi * ps), SYType: null }, ErrCode: 0, TotalCount: rows.length, PageSize: ps, PageIndex: pi }));
  }
  if (isCsindex(url)) {
    if (o.down?.has('csindex')) return Promise.resolve(new Response('upstream error', { status: 500 }));
    const h = host(url);
    if (h === 'oss-ch.csindex.com.cn') {
      const m = /(\d{6})indicator\.xls$/i.exec(u.pathname);
      if (m && VAL_CN.includes(m[1])) return Promise.resolve(binRes(fxBytes(`${m[1]}indicator.xls`), 'application/vnd.ms-excel'));
      return Promise.resolve(new Response('Not Found', { status: 404 }));
    }
    const code = u.searchParams.get('indexCode') ?? /(\d{6})/.exec(u.pathname)?.[1] ?? '';
    if (/perf/i.test(u.pathname) && VAL_CN.includes(code)) {
      const j = JSON.parse(new TextDecoder().decode(fxBytes(`csindex-perf-${code}.json.gz`)));
      const s = u.searchParams.get('startDate'), en = u.searchParams.get('endDate');
      j.data = j.data.filter((r: { tradeDate: string }) => (!s || r.tradeDate >= s) && (!en || r.tradeDate <= en));
      return Promise.resolve(jsonRes(j));
    }
    return Promise.resolve(new Response('Not Found', { status: 404 }));
  }
  if (isShiller(url)) {
    if (o.down?.has('shiller')) return Promise.resolve(new Response('upstream error', { status: 500 }));
    if (host(url) === 'img1.wsimg.com') return Promise.resolve(binRes(fxBytes('shiller-ie_data.xls.gz'), 'application/vnd.ms-excel'));
    return Promise.resolve(new Response(new TextDecoder().decode(fxBytes('shiller-home.html.gz')), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }));
  }
  return Promise.resolve(new Response('not found', { status: 404 }));
}

/** token 的"任何部分"：长度 ≥ 6 的连续片段有没有出现在 text 里，出现了回那一段 */
export function leakOf(text: string, token: string, min = 6): string | null {
  for (let i = 0; i + min <= token.length; i++) { const p = token.slice(i, i + min); if (text.includes(p)) return p; }
  return null;
}

/**
 * 跑 fn 时把"同一来源两个请求之间隔 ≥ 2 秒"那种等待变成虚拟时间：setTimeout 的延时在 [lo, hi] 毫秒之间的，立刻触发，同时让 Date.now 往前跳同样多
 * （被测代码看到的时间照样过去了那么久，等待的逻辑一点没少；测试不用真等约 20 秒）。只在 fn 运行期间生效；8 秒超时、undici 内部计时（< 1.5 秒）不受影响。
 * 回 fn 的结果；clock() 是虚拟的"现在"，替身 fetch 用它记每个请求的时间，好量间隔。
 */
let skew = 0;
export const clock = () => Date.now();
export async function virtualGaps<T>(fn: () => Promise<T>, lo = 1500, hi = 2000): Promise<T> {
  const realST = globalThis.setTimeout;
  const realNow = Date.now.bind(Date);
  const spy = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
  globalThis.setTimeout = ((cb: (...a: unknown[]) => void, ms?: number, ...a: unknown[]) => {
    if (typeof ms === 'number' && ms >= lo && ms <= hi) { skew += ms; return realST(cb, 0, ...a); }
    return realST(cb, ms, ...a);
  }) as unknown as typeof setTimeout;
  try { return await fn(); } finally { globalThis.setTimeout = realST; spy.mockRestore(); }
}
