/**
 * 公共工具「基金观察」的服务端：取数（Yahoo / 东方财富）+ 存 D1（迁移 0016 表 fund_snapshot）+ 两个接口。计算口径在 src/funds.ts。
 *
 *   GET  /api/funds          → { fetched_at, items }：45 只按 FUNDS 的顺序，每只是上次取到的快照 + 清单里的名字 / 标签 + ok_at（这一只上次取到的时间）；
 *                              这一只最近一次没取到时带 error（原因）和 error_at：有旧快照的照样带着旧数值（页面写"没取到，显示的是 <日期> 的数据"），
 *                              从没取到过的只有清单字段 + error。
 *   POST /api/funds/refresh  {cursor?} → { next|null, done, total, updated:[这一批更新了的 code], failed:[{code, reason}], requests }
 *                              从第 cursor 只开始往下取，**这一次对外请求不超过 45 个**（Cloudflare 免费版一次请求最多 50 个对外子请求，留 5 个余量；
 *                              翻页、2y→1y、.SS 回退东方财富、重试都算），取不完就回 next，页面接着调，直到 next 为 null。
 * 和其他 /api 一样要登录（queue.ts adminApi 先验会话再转到这里）。
 *
 * 外部调用（C81）：单次请求连接 + 读取 8 秒超时，失败（网络错、超时、429、5xx）最多试 2 次、间隔 1 秒；一次 refresh 调用总时长控制在约 25 秒内
 * （CALL_BUDGET_MS；15 秒后不再开新的一只，到点还没处理的留给下一批，next 指向它；已经发出的请求照样计入 ≤45）；
 * 被 25 秒截止打断的那只（不是这一批的第一只）整只留给下一批，不记失败；失败原因写实际等了几秒、实际试了几次，Yahoo 回 chart.error 时带上它的 description；
 * 404 之类不重试。取不到的那只**保留上次的数据**，只记原因。不在任何事务里调外部接口（先取完，再写库）。
 * 不花钱（底线 8）：Yahoo、东方财富是公开免费接口；第四版美国 15 只走 Tiingo（免费账号，key = 加密变量 TIINGO_API_TOKEN，
 * 只放在 Authorization 请求头里，不进地址、不下发前端、不写日志、不进错误文字；没配置或取不到退回 Yahoo，快照 source 照实写）。
 */
import type { Env } from './env';
import { cfbStream, mergeMonths, parseCsIndicator, parseCsPerf, shillerCell, shillerDone, shillerInit, shillerLocate, shillerXlsUrl, valCard, VAL_INDEXES, VAL_KEEP, xlsWalk, type ShillerState, type ValCard, type ValIndexDef, type ValStored } from './funds-val';
import { bandCoverage, bondCenter, cleanPoints, eastmoneyMoneyIndex, eastmoneyPageOldest, FUNDS, MIN_POINTS, parseEastmoney, parseTiingo, parseYahoo, rangeBand, summarize, usesTiingo, type FundDef, type FundSnapshot, type Point } from './funds';
import {
  approxYield, autoYield, BOND_YIELDS, parseChinabond, parseEm7d, parseEmNav, parseMasHtml, parseTreasuryCsv, parseVanguard,
  type BondYield, type BondYieldDef, type Curve, type CurvePoints, type ParsedYield,
} from './funds-yield';

/** 一次 /api/funds/refresh 最多发几个对外请求 */
export const MAX_REQUESTS = 45;
/** 一次最多处理几只（免费版每次请求 CPU 时间有限，解析 JSON 也算；分小批更稳） */
export const MAX_FUNDS_PER_CALL = 12;
/** 东方财富翻页上限（每页 20 条，400 天约 14 页） */
const EM_MAX_PAGES = 25;
/** 单次外部请求超时（连接 + 读取） */
export const TIMEOUT_MS = 8_000;
/** 每个外部请求最多试几次（含第一次） */
export const TRIES = 2;
/** 一次 refresh 调用的总时长上限（墙钟）：到点还没处理的留给下一批（next 指向它）；已经发出的请求照样计入 ≤45 */
export const CALL_BUDGET_MS = 25_000;
/** 过了这么久就不再开新的一只（剩下的时间留给手上这只收尾） */
const START_CUTOFF_MS = 15_000;
const UA = 'Mozilla/5.0';
const EM_REFERER = 'https://fundf10.eastmoney.com/';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** 这一次调用的对外请求额度用完了 */
export class BudgetOut extends Error {
  constructor() { super('这一批的对外请求数用完了'); }
}

/** 这一次调用的时间用完了（总时长上限 CALL_BUDGET_MS）。detail：被截止打断前那只已经遇到的情况（批首那只进 failed 时写进原因） */
export class TimeUp extends Error {
  constructor(public detail = '') { super('这一批的时间用完了'); }
}

/** 取数失败的中文原因（页面直接显示）；status = 对方回的 HTTP 状态码（第五版：估值来源回 403 / 429 就结束这一轮对该来源的所有请求） */
export class FetchFail extends Error {
  constructor(message: string, public status?: number) { super(message); }
}

/** Yahoo 出错时回包里的 chart.error.description（例如 "No data found, symbol may be delisted"），没有就空 */
export function yahooErrorText(body: unknown): string {
  const e = (body as { chart?: { error?: { description?: unknown; code?: unknown } } } | null)?.chart?.error;
  if (!e) return '';
  const d = typeof e.description === 'string' && e.description.trim() ? e.description.trim() : typeof e.code === 'string' ? e.code : '';
  return d.slice(0, 120);
}

/**
 * 带计数、超时、重试的 GET。每发一次（含重试）计一个；deadline 之后不再发新请求，单次超时也不超过离 deadline 剩下的时间。
 * 被 deadline 截短、或者没时间再试下一次的，一律抛 TimeUp（refreshBatch 把这只留给下一批；批首那只才记失败），
 * 不当成"数据源没回应"——失败原因只写真正等满的秒数和真正试了的次数。
 */
export class Http {
  used = 0;
  /** 上一个请求结束的时间（第四版 gapMs 用） */
  private lastAt = 0;
  constructor(
    private f: FetchLike,
    public max = MAX_REQUESTS,
    private sleep: (ms: number) => Promise<unknown> = (ms) => new Promise((r) => setTimeout(r, ms)),
    public deadline = Infinity,
    /** 第四版（估值来源，安全经理限制）：gapMs = 两个请求之间至少隔多久（从上一个结束算）；lastAt = 上一次调用里同一来源最后一个请求结束的时间（跨调用也隔得开）；
     *  tries = 每个请求最多试几次（估值来源每天最多 1 次，所以是 1，不重试）；
     *  timeoutMs = 单次请求超时（默认 TIMEOUT_MS 8 秒；第五版 Shiller 首页单独一步放宽到 20 秒，仍受 deadline 截止） */
    private opts: { gapMs?: number; tries?: number; lastAt?: number; timeoutMs?: number } = {},
  ) {
    if (opts.gapMs && opts.lastAt) this.lastAt = opts.lastAt;
  }
  /** 上一个请求结束的时间（估值把它存起来，下一次调用接着隔 2 秒） */
  get lastEnd() { return this.lastAt; }
  get left() { return this.max - this.used; }
  async get(url: string, headers: Record<string, string>, what: string): Promise<unknown> {
    return (await this.send(url, { headers }, what, 'json')).body;
  }
  /** 取网页 / CSV 原文（第二版债券收益率用）；cookie = 回包里 set-cookie 的 name=value 拼好的（MAS 的表单要带回去） */
  async text(url: string, init: { method?: string; headers: Record<string, string>; body?: string }, what: string): Promise<{ text: string; cookie: string }> {
    const r = await this.send(url, init, what, 'text');
    return { text: r.body as string, cookie: r.cookie };
  }
  /** 取二进制（第四版估值：中证 indicator.xls、Shiller ie_data.xls）；超过 maxBytes 算失败 */
  async bin(url: string, init: { headers: Record<string, string> }, what: string, maxBytes = 8 * 1024 * 1024): Promise<Uint8Array> {
    const b = (await this.send(url, init, what, 'bin')).body as Uint8Array;
    if (b.length > maxBytes) throw new FetchFail(`${what}的文件太大（${Math.round(b.length / 1024 / 1024)}MB），没解析`);
    return b;
  }
  private async send(url: string, init: { method?: string; headers: Record<string, string>; body?: string }, what: string, as: 'json' | 'text' | 'bin'): Promise<{ body: unknown; cookie: string }> {
    let last = '', tries = 0, lastStatus: number | undefined;
    const cut = () => new TimeUp(last ? `${last}（试了 ${tries} 次）` : '');
    const TR = this.opts.tries ?? TRIES;
    const TO = this.opts.timeoutMs ?? TIMEOUT_MS;
    for (let i = 0; i < TR; i++) {
      if (this.used >= this.max) throw new BudgetOut();
      if (this.opts.gapMs) {
        // 离上一个同来源请求结束不到 gapMs：整整再等 gapMs（实际间隔 ≥ gapMs；不按剩下多少算，等的时长固定、好量）
        const wait = Date.now() - this.lastAt < this.opts.gapMs ? this.opts.gapMs : 0;
        if (wait > 0) { if (Date.now() + wait >= this.deadline) throw cut(); await this.sleep(wait); }
      }
      const rest = this.deadline - Date.now();
      if (rest <= 0) throw cut();
      const limit = Math.min(TO, rest);
      // 单独放宽了超时的（Shiller 首页 20 秒）：离截止只差不到 1 秒（等完同来源间隔后的零头）也按完整超时算，超时了照实写"N 秒没回应"
      const short = limit < TO - (this.opts.timeoutMs ? 1000 : 0);
      this.used++;
      tries++;
      const t0 = Date.now();
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), limit);
      try {
        const r = await this.f(url, { ...init, signal: ac.signal });
        if (r.ok) {
          if (as === 'bin') return { body: new Uint8Array(await r.arrayBuffer()), cookie: '' };
          const text = await r.text();
          if (as === 'text') return { body: text, cookie: cookieOf(r.headers) };
          let body: unknown;
          try { body = JSON.parse(text); } catch { throw new FetchFail(`${what}回的不是数据（可能被拦了）`); }
          return { body, cookie: '' };
        }
        // 出错的回包里常有说明（Yahoo 的 chart.error.description），带进原因
        let why = '';
        try { why = yahooErrorText(JSON.parse(await r.text())); } catch { why = ''; }
        last = `${what}回 ${r.status}${why ? `：${why}` : ''}`;
        lastStatus = r.status;
        if (r.status !== 429 && r.status < 500) throw new FetchFail(last, r.status);
      } catch (e) {
        if (e instanceof FetchFail || e instanceof BudgetOut || e instanceof TimeUp) throw e;
        if (ac.signal.aborted && short) throw cut(); // 是 25 秒截止把它打断的，不是数据源慢
        last = ac.signal.aborted ? `${what} ${Math.max(1, Math.round((Date.now() - t0) / 1000))} 秒没回应` : `连不上${/^[A-Za-z]/.test(what) ? ' ' : ''}${what}`;
        lastStatus = undefined;
      } finally {
        clearTimeout(timer);
        this.lastAt = Date.now();
      }
      if (i < TR - 1) {
        if (this.deadline - Date.now() <= 1000) throw cut(); // 来不及再试一次：留给下一批
        await this.sleep(1000);
      }
    }
    throw new FetchFail(`${last}（试了 ${tries} 次）`, lastStatus);
  }
}

/** 回包的 set-cookie → "a=1; b=2"（只要 name=value） */
function cookieOf(h: Headers): string {
  const hh = h as Headers & { getSetCookie?: () => string[]; getAll?: (k: string) => string[] };
  let list: string[] = [];
  try { list = hh.getSetCookie ? hh.getSetCookie() : hh.getAll ? hh.getAll('set-cookie') : []; } catch { list = []; }
  if (!list.length) { const one = h.get('set-cookie'); if (one) list = one.split(/,(?=\s*[A-Za-z0-9_.-]+=)/); }
  return list.map((c) => c.split(';')[0].trim()).filter(Boolean).join('; ');
}

const yahooUrl = (sym: string, range: string) => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=1d&events=div`;
const emUrl = (code: string, page: number) => `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${encodeURIComponent(code)}&pageIndex=${page}&pageSize=20`;

async function fromYahoo(http: Http, sym: string): Promise<{ currency: string | null; points: Point[]; why: string }> {
  const b2 = await http.get(yahooUrl(sym, '2y'), { 'user-agent': UA }, 'Yahoo');
  let r = parseYahoo(b2), why = yahooErrorText(b2);
  if (r.points.length < MIN_POINTS) {
    // Yahoo 偶尔 2y 只回一条，退回 1y
    const b1 = await http.get(yahooUrl(sym, '1y'), { 'user-agent': UA }, 'Yahoo');
    const r1 = parseYahoo(b1);
    if (r1.points.length > r.points.length) r = { currency: r1.currency ?? r.currency, points: r1.points };
    why = why || yahooErrorText(b1);
  }
  return { ...r, why };
}

/**
 * 东方财富历史净值（lsjz，每页 20 条，新的在前）。since = 库里已有序列的最后日期（第三版增量取）：翻到某一页最早的日期 ≤ since 就停（通常 1 页）；
 * 没有 since 才全量翻到 400 天前。
 */
async function fromEastmoney(http: Http, code: string, now: number, since?: string): Promise<Point[]> {
  return (await fromEastmoneyPages(http, code, now, since)).points;
}

/** 同上，另外说明这是不是货币基金页（是的话 points 是按每天收益连乘的指数，第一天 = 100，见 eastmoneyMoneyIndex） */
async function fromEastmoneyPages(http: Http, code: string, now: number, since?: string): Promise<{ points: Point[]; money: boolean }> {
  const cut = new Date(now - 400 * 86_400_000).toISOString().slice(0, 10);
  const pages: unknown[] = [];
  for (let n = 1; n <= EM_MAX_PAGES; n++) {
    const pg = await http.get(emUrl(code, n), { 'user-agent': UA, referer: EM_REFERER }, '东方财富');
    const oldest = eastmoneyPageOldest(pg);
    if (oldest === null) break;
    pages.push(pg);
    if (oldest < cut || (since && oldest <= since)) break;
  }
  const mi = eastmoneyMoneyIndex(pages);
  return { points: (mi ?? parseEastmoney(pages)).filter((p) => p[0] >= cut), money: !!mi };
}

/**
 * 第三版增量：库里上次的东方财富快照（只认 source = eastmoney 的；原来 Yahoo 复权价的口径不同，不能拼）→ 旧点。
 * 快照里的 series 只存了 [日期, 累计净值]，旧点的单位净值没有存：用累计净值占位（只有最后一个点的单位净值会显示成"最新价"，
 * 而最新的点总是这次新取的那一页里的）；最后一天用快照里的 last 补回真的单位净值。
 */
export function prevPoints(prev: Record<string, unknown> | null | undefined): Point[] {
  if (!prev || prev.source !== 'eastmoney' || !Array.isArray(prev.series)) return [];
  const pts: Point[] = [];
  for (const x of prev.series as unknown[]) {
    if (!Array.isArray(x) || typeof x[0] !== 'string' || typeof x[1] !== 'number' || !isFinite(x[1]) || x[1] <= 0) continue;
    pts.push([x[0], x[1], x[1]]);
  }
  const last = pts[pts.length - 1];
  if (last && last[0] === prev.date && typeof prev.last === 'number') last[1] = prev.last;
  return pts;
}

/** 旧点 + 新点：同一天以新的为准，按日期升序（375 天窗口由 cleanPoints 截） */
export function mergePoints(old: Point[], fresh: Point[]): Point[] {
  const by = new Map<string, Point>();
  for (const p of old) by.set(p[0], p);
  for (const p of fresh) by.set(p[0], p);
  return [...by.values()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/** Tiingo 的 key（加密变量）；没配置或是空的回 ''。只在服务端用 */
export function tiingoToken(env: Pick<Env, 'TIINGO_API_TOKEN'>): string {
  const t = env.TIINGO_API_TOKEN;
  return typeof t === 'string' ? t.trim() : '';
}

/** Tiingo 日线：从 2 年前起（和 Yahoo 的 range=2y 一样，375 天窗口由 cleanPoints 截）。key 放请求头，不放地址 */
const tiingoUrl = (sym: string, now: number) => `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(sym.toLowerCase())}/prices?startDate=${new Date(now - 730 * 86_400_000).toISOString().slice(0, 10)}`;

async function fromTiingo(http: Http, sym: string, now: number, token: string): Promise<Point[]> {
  return parseTiingo(await http.get(tiingoUrl(sym, now), { authorization: `Token ${token}`, 'content-type': 'application/json', 'user-agent': UA }, 'Tiingo'));
}

/** 估一只最多要几个请求（不够就留到下一批，免得取到一半额度用完白取） */
export function estimateRequests(def: FundDef, incremental = false, tiingo = false): number {
  if (def.source === 'eastmoney') return incremental ? 2 : 16;
  // 第四版：Tiingo 1 个 + 取不到时退回 Yahoo 最多 2 个
  if (tiingo && usesTiingo(def)) return 3;
  return def.symbol.endsWith('.SS') ? 3 : 2;
}

/** 取一只：Yahoo（2y → 1y）；.SS 清洗后不到 30 点或 Yahoo 取不到 → 改用东方财富（去掉 .SS）。返回快照；取不到抛 FetchFail，额度用完抛 BudgetOut */
export async function fetchFund(def: FundDef, http: Http, now: number, prev?: Record<string, unknown> | null, opts: { tiingo?: string } = {}): Promise<FundSnapshot> {
  if (def.source === 'eastmoney') {
    // 第三版：库里已有这只的东方财富序列 → 只取比它新的那一页（通常 1 页）并进旧序列；首次才全量
    const old = prevPoints(prev);
    const since = old.length ? old[old.length - 1][0] : undefined;
    const got = await fromEastmoneyPages(http, def.symbol, now, since);
    let fresh = got.points;
    if (!fresh.length) throw new FetchFail('东方财富没有这只的净值');
    // 货币基金（511990）的新指数从 100 起算：按和旧序列重合的最近一天对齐比例再拼；没有重合的一天就只用这次取到的
    let base = old;
    if (got.money && old.length) {
      const oldBy = new Map(old.map((p) => [p[0], p[2]]));
      const hit = [...fresh].reverse().find((p) => oldBy.has(p[0]));
      if (hit) { const k = oldBy.get(hit[0])! / hit[2]; fresh = fresh.map((p) => [p[0], p[1] * k, p[2] * k] as Point); } else base = [];
    }
    let pts = cleanPoints(mergePoints(base, fresh));
    // 收益指数（511990）：截完一年窗口后把第一点重新定成 100，页面写的"<起点日期> = 100"才是真的
    if (got.money && pts.length) { const k = 100 / pts[0][2]; pts = pts.map((p) => [p[0], r6(p[1] * k), r6(p[2] * k)] as Point); }
    return { ...summarize(def, 'CNY', pts), price_kind: got.money ? 'index' : 'nav' };
  }
  // 第四版：美国 15 只先走 Tiingo（每只 1 个请求，计入 ≤45）；没配置 → 直接 Yahoo；Tiingo 回错 / 认不出 → 退回 Yahoo，快照写 source = 'yahoo' 和 fallback 原因
  let fallback = '';
  if (usesTiingo(def)) {
    const token = opts.tiingo ?? '';
    // 没配置：直接走 Yahoo，快照 source = 'yahoo'（页面来源写"Yahoo 复权价"；/health 的 tiingo 字段是 not_configured）
    if (token) {
      try {
        const tp = cleanPoints(await fromTiingo(http, def.symbol, now, token));
        if (tp.length >= MIN_POINTS) return { ...summarize({ ...def, source: 'tiingo' }, 'USD', tp), price_kind: 'price' };
        fallback = tp.length ? `Tiingo 只回了 ${tp.length} 天` : 'Tiingo 没有这只的数据';
      } catch (e) {
        if (e instanceof BudgetOut || e instanceof TimeUp) throw e;
        // FetchFail 的文字是我们自己拼的（"Tiingo回 401""Tiingo 8 秒没回应"……），不含地址和请求头，不会带出 key
        fallback = e instanceof FetchFail ? e.message : '连不上 Tiingo';
      }
    }
  }
  const tagFb = (s: FundSnapshot): FundSnapshot => (fallback ? { ...s, fallback } : s);
  let yErr: unknown = null;
  let cur: string | null = null, pts: Point[] = [], why = '';
  try {
    const r = await fromYahoo(http, def.symbol);
    cur = r.currency;
    why = r.why;
    pts = cleanPoints(r.points);
  } catch (e) {
    if (e instanceof BudgetOut || e instanceof TimeUp) throw e;
    yErr = e;
  }
  if (pts.length < MIN_POINTS && def.symbol.endsWith('.SS')) {
    // Yahoo 丢了历史（511880 11/10 只回 1 条）→ 改用东方财富净值
    const em = cleanPoints(await fromEastmoney(http, def.symbol.slice(0, -3), now));
    if (em.length) return { ...summarize({ ...def, source: 'eastmoney' }, 'CNY', em), price_kind: 'nav' };
  }
  if (!pts.length) {
    const yw = yErr instanceof Error ? yErr.message : why ? `Yahoo 没有这只的数据：${why}` : 'Yahoo 没有这只的数据';
    // Tiingo 配了却没取到、Yahoo 也没取到：两边的原因都写（没配置时只写 Yahoo 的，和第三版一样）
    throw new FetchFail(fallback ? `${fallback}；${yw}` : yw);
  }
  return tagFb({ ...summarize(def, cur, pts), price_kind: 'price' });
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

export interface RefreshResult {
  next: number | null;
  done: number;
  total: number;
  /** 这一批更新了的 code */
  updated: string[];
  failed: { code: string; reason: string }[];
  /** 这一次实际发了几个对外请求 */
  requests: number;
  /** 第二版：最后一批（45 只都过了一遍的那一批）顺带取债券收益率的结果 */
  yields?: YieldsResult;
}

/** 批首那只被截止打断（只有它会因为时间用完记失败）：写实际等了几秒，有前面的情况一起写 */
function timeUpReason(e: TimeUp, ms: number): string {
  const sec = Math.max(1, Math.round(ms / 1000));
  return e.detail ? `${e.detail}，这一批等了 ${sec} 秒还没取完` : `数据源等了 ${sec} 秒还没取完`;
}

/** 从第 cursor 只开始取一批（≤ 45 个对外请求、≤ 12 只），取到的写 D1，没取到的只记原因 */
export async function refreshBatch(env: Env, cursor: number, now: number, f: FetchLike = (u, i) => fetch(u, i), sleep?: (ms: number) => Promise<unknown>): Promise<RefreshResult> {
  const t0 = Date.now();
  const http = new Http(f, MAX_REQUESTS, sleep, t0 + CALL_BUDGET_MS);
  const total = FUNDS.length;
  const ok: FundSnapshot[] = [];
  const failed: { code: string; reason: string }[] = [];
  // 第三版：东方财富那几只要增量取，先读库里上次的快照（一次查询，不在事务里；读不到就当首次全量）
  const prev = new Map<string, Record<string, unknown>>();
  try {
    const rows = (await env.DB.prepare('SELECT code, data FROM fund_snapshot').all<{ code: string; data: string | null }>())?.results ?? [];
    for (const r of rows) { if (!r?.data) continue; try { prev.set(r.code, JSON.parse(r.data)); } catch { /* 坏行当没有 */ } }
  } catch { /* 读失败：照首次全量取 */ }
  const inc = (def: FundDef) => prevPoints(prev.get(def.code)).length > 0;
  const tiingo = tiingoToken(env);
  let i = cursor, n = 0;
  while (i < total && n < MAX_FUNDS_PER_CALL) {
    const def = FUNDS[i];
    if (n > 0 && (http.left < estimateRequests(def, inc(def), !!tiingo) || Date.now() - t0 > START_CUTOFF_MS)) break;
    // 第二版 ③：最后一只之后要在同一次调用里取债券收益率——额度或时间不够留给它，就把最后一只留给下一批（下一批 = 最后一只 + 收益率）
    if (n > 0 && i === total - 1 && (http.left - estimateRequests(def, inc(def), !!tiingo) < YIELD_RESERVE || Date.now() - t0 > YIELD_START_MS)) break;
    try {
      ok.push(await fetchFund(def, http, now, prev.get(def.code), { tiingo }));
    } catch (e) {
      if ((e instanceof BudgetOut || e instanceof TimeUp) && n > 0) {
        // 额度或时间在这只中途用完：这只整只留给下一批（不算失败）
        break;
      }
      const reason = e instanceof BudgetOut ? '一批的请求数不够取完这一只' : e instanceof TimeUp ? timeUpReason(e, Date.now() - t0) : e instanceof Error ? e.message : String(e);
      failed.push({ code: def.code, reason });
    }
    i++; n++;
  }
  // 第二版 ③：45 只都过了一遍（这是最后一批）→ 用这一次剩下的额度和时间取债券收益率（同一个计数器：价格 + 收益率合计 ≤ 45、25 秒截止照旧）。
  // 收益率那边各自兜底、只写 fund_yield，不影响上面价格的 updated / failed
  let yields: YieldsResult | undefined;
  if (i >= total) {
    try { yields = await refreshYields(env, now, f, sleep, http); } catch (e) { yields = { updated: [], failed: [{ code: '*', reason: why(e) }], requests: 0, curves: { ust: why(e), sgs: why(e), cgb: why(e) } }; }
  }
  // 先取完再写库（不在事务里调外部接口）
  const stmts = [
    ...ok.map((s) => env.DB.prepare('INSERT INTO fund_snapshot (code, data, ok_at, err, err_at) VALUES (?1, ?2, ?3, NULL, NULL) ON CONFLICT (code) DO UPDATE SET data = ?2, ok_at = ?3, err = NULL, err_at = NULL').bind(s.code, JSON.stringify(s), now)),
    ...failed.map((x) => env.DB.prepare('INSERT INTO fund_snapshot (code, data, ok_at, err, err_at) VALUES (?1, NULL, NULL, ?2, ?3) ON CONFLICT (code) DO UPDATE SET err = ?2, err_at = ?3').bind(x.code, x.reason.slice(0, 200), now)),
  ];
  if (stmts.length) await env.DB.batch(stmts);
  return { next: i < total ? i : null, done: i, total, updated: ok.map((x) => x.code), failed, requests: http.used, ...(yields ? { yields } : {}) };
}

interface Row { code: string; data: string | null; ok_at: number | null; err: string | null; err_at: number | null }

/** 债券收益率"过期"的门槛：这一只上次取到的时间比最近一次取到任何一只早 5 分钟以上（同一次刷新里的不算） */
const YIELD_OLD_MS = 5 * 60_000;

/** GET /api/funds 的内容（第二版：每只多 band；债券类多 yield；顶层多 band_coverage、yields_at） */
export async function fundsList(env: Env): Promise<{ fetched_at: string | null; yields_at: string | null; band_coverage: number | null; items: Record<string, unknown>[] }> {
  const rows = (await env.DB.prepare('SELECT code, data, ok_at, err, err_at FROM fund_snapshot').all<Row>()).results ?? [];
  const yrows = (await env.DB.prepare('SELECT code, data, ok_at, err, err_at FROM fund_yield').all<Row>()).results ?? [];
  const by = new Map(rows.map((r) => [r.code, r]));
  const yby = new Map(yrows.map((r) => [r.code, r]));
  const ylatest = yrows.reduce((m, r) => Math.max(m, r.ok_at ?? 0), 0);
  let latest = 0;
  const covs: number[] = [];
  const items = FUNDS.map((def) => {
    const r = by.get(def.code);
    let snap: Record<string, unknown> | null = null;
    if (r?.data) { try { snap = JSON.parse(r.data); } catch { snap = null; } }
    if (r?.ok_at && r.ok_at > latest) latest = r.ok_at;
    // 名字、标签、市场、类别以代码里的清单为准（改名后旧快照也跟着变）；source 用快照里实际用的
    const item: Record<string, unknown> = { ...(snap ?? {}), market: def.market, category: def.category, name: def.name, code: def.code, symbol: def.symbol, tag: def.tag, source: (snap?.source as string) ?? def.source };
    // 这一只上次取到的时间（页面用来标出"上次数据"：分批刷新中途断了，没轮到的几只比标题的数据时间旧）
    if (snap && r?.ok_at) item.ok_at = new Date(r.ok_at).toISOString();
    // 第三版复核 R1：价格是什么（旧快照没有这个字段：东方财富的当净值、Yahoo 的当场内价格）
    if (snap) item.price_kind = snap.price_kind === 'index' || snap.price_kind === 'nav' || snap.price_kind === 'price' ? snap.price_kind : item.source === 'eastmoney' ? 'nav' : 'price';
    if (!snap) item.error = r?.err ?? '还没取过';
    // 取到时会把 err 清空，所以 err 还在 = 最近一次没取到（不比时间：同一毫秒先成功后失败也算失败，C106）
    else if (r?.err) { item.error = r.err; if (r.err_at) item.error_at = new Date(r.err_at).toISOString(); }
    // 第二版 ③：债券类的预期年化（取不到时保留上次的值、标 stale；从没取到过是 null）
    let yv: number | null = null;
    if (def.category === '债券') {
      const yr = yby.get(def.code);
      let y: BondYield | null = null;
      if (yr?.data) { try { y = JSON.parse(yr.data); } catch { y = null; } }
      const cfg = BOND_YIELDS.find((d) => d.code === def.code);
      // kind 按配置（auto / approx）；自动的这次退回了国债近似时 approx = true（页面照样标"近似"、加"≈"）
      if (y && typeof y.value === 'number' && y.value !== 0) {
        yv = y.value;
        const stale = !!yr?.err || (!!yr?.ok_at && ylatest - yr.ok_at > YIELD_OLD_MS);
        item.yield = { ...(cfg?.note ? { note: cfg.note } : {}), value: y.value, kind: cfg?.kind ?? y.kind, approx: y.kind === 'approx', label: y.label, duration: y.duration ?? null, asOf: y.asOf, source: y.source, stale, ...(yr?.err ? { error: yr.err } : {}) };
      } else {
        // 从没取到过：value 为 null（不显示 0），带上口径和没取到的原因
        item.yield = { ...(cfg?.note ? { note: cfg.note } : {}), value: null, kind: cfg?.kind ?? 'approx', approx: cfg?.kind === 'approx', label: cfg?.label ?? '', duration: cfg?.duration ?? null, asOf: null, source: '', stale: !!yr?.err, ...(yr?.err ? { error: yr.err } : {}) };
      }
    }
    // 第二版 ①：未来 1 个月的可能区间（股票类中心 0；债券类中心 = ln(1+预期年化)/12）
    const series = Array.isArray(snap?.series) ? (snap!.series as [string, number][]) : [];
    item.band = series.length ? rangeBand(series, def.category === '债券' ? bondCenter(yv) : 0) : null;
    const cov = series.length ? bandCoverage(series) : null;
    if (cov !== null) covs.push(cov);
    return item;
  });
  return {
    fetched_at: latest ? new Date(latest).toISOString() : null,
    yields_at: ylatest ? new Date(ylatest).toISOString() : null,
    band_coverage: covs.length ? covs.reduce((a, b) => a + b, 0) / covs.length : null,
    items,
  };
}

// ---------------------------------------------------------------- 第二版 ③：债券类预期年化（"刷新数据"循环的最后一批里、45 只取完之后顺带取）
/** 最后一批给收益率留的对外请求数（首轮最多约 14 个：第三版 4 个页面 + 美国 1～2 + MAS 2 + 中债 1～6；仍留 22，不改） */
export const YIELD_RESERVE = 22;
/** 最后一批过了这么久还没轮到最后一只，就把它留给下一批（留约 15 秒给收益率） */
const YIELD_START_MS = 10_000;
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const HTML_HEADERS = { 'user-agent': BROWSER_UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.9' };
const MAS_URL = 'https://eservices.mas.gov.sg/statistics/fdanet/BenchmarkPricesAndYields.aspx';
/** 中债曲线：当天没有就往前退，最多退 5 个自然日（周末、节假日没有曲线）——循环硬上限，最多 6 个请求 */
const CGB_MAX_BACK = 5;
/** 中债国债收益率曲线的 ycDefId */
const CGB_CURVE_ID = '2c9081e50a2f9606010a3068cae70001';

/** UTC+8 的日期（新加坡 / 中国） */
const day8 = (now: number, back = 0) => new Date(now + 8 * 3600_000 - back * 86_400_000).toISOString().slice(0, 10);
const ustUrl = (y: number) => `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${y}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${y}&page&_format=csv`;
/** 中债 searchYc：测试会话 2026-11-10 实测取得到数据的那组参数（workTimes 必须写日期，留空回 []；原来那组 dsmSelect=1&&locale=cn_ZH 回 []） */
const cgbUrl = (d: string) => `https://yield.chinabond.com.cn/cbweb-mn/yc/searchYc?xyzSelect=txy&&workTimes=${d}&&dxbj=0&&qxll=0,&&yqqxN=N&&yqqxK=K&&ycDefIds=${CGB_CURVE_ID}&&wrjxCBFlag=0&&locale=zh_CN`;

async function fetchUst(http: Http, now: number): Promise<CurvePoints> {
  const y = new Date(now).getUTCFullYear();
  let c = parseTreasuryCsv((await http.text(ustUrl(y), { headers: { 'user-agent': BROWSER_UA } }, '美国财政部')).text);
  // 1 月初今年的表可能还是空的，退回上一年（只多 1 个请求）
  if (!c) c = parseTreasuryCsv((await http.text(ustUrl(y - 1), { headers: { 'user-agent': BROWSER_UA } }, '美国财政部')).text);
  if (!c) throw new FetchFail('美国财政部的收益率表认不出来');
  return c;
}

/** MAS：先 GET 取 __VIEWSTATE / __EVENTVALIDATION（和 cookie），再 POST 上月到本月、日频、1/2/5/10 年 */
async function fetchSgs(http: Http, now: number): Promise<CurvePoints> {
  const g = await http.text(MAS_URL, { headers: HTML_HEADERS }, 'MAS');
  const hid = (n: string) => new RegExp(`name="${n}"[^>]*value="([^"]*)"`).exec(g.text)?.[1] ?? null;
  const vs = hid('__VIEWSTATE'), ev = hid('__EVENTVALIDATION');
  if (vs === null || ev === null) throw new FetchFail('MAS 的查询页认不出来');
  const d = new Date(now + 8 * 3600_000), y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  const P = 'ctl00$ContentPlaceHolder1$';
  const form = new URLSearchParams({
    __EVENTTARGET: '', __EVENTARGUMENT: '', __LASTFOCUS: '', __VIEWSTATE: vs, __VIEWSTATEGENERATOR: hid('__VIEWSTATEGENERATOR') ?? '', __EVENTVALIDATION: ev,
    [P + 'StartYearDropDownList']: String(py), [P + 'StartMonthDropDownList']: String(pm), [P + 'EndYearDropDownList']: String(y), [P + 'EndMonthDropDownList']: String(m),
    [P + 'FrequencyDropDownList']: 'D',
    [P + 'OneYearTreasuryBillYieldCheckBox']: 'on', [P + 'TwoYearBondYieldCheckBox']: 'on', [P + 'FiveYearBondYieldCheckBox']: 'on', [P + 'TenYearBondYieldCheckBox']: 'on',
    [P + 'DisplayButton']: 'Display',
  });
  const r = await http.text(MAS_URL, { method: 'POST', headers: { ...HTML_HEADERS, 'content-type': 'application/x-www-form-urlencoded', referer: MAS_URL, ...(g.cookie ? { cookie: g.cookie } : {}) }, body: form.toString() }, 'MAS');
  const c = parseMasHtml(r.text);
  if (!c) throw new FetchFail('MAS 的收益率表认不出来');
  return c;
}

/** 中债：从今天（UTC+8）起，当天没有曲线就往前退一天，最多退 CGB_MAX_BACK 天 */
async function fetchCgb(http: Http, now: number): Promise<CurvePoints> {
  for (let i = 0; i <= CGB_MAX_BACK; i++) {
    const d = day8(now, i);
    const r = await http.text(cgbUrl(d), { method: 'POST', headers: { 'user-agent': BROWSER_UA, referer: 'https://yield.chinabond.com.cn/cbweb-mn/yield_main?locale=zh_CN' } }, '中债');
    let j: unknown = null;
    try { j = JSON.parse(r.text); } catch { throw new FetchFail('中债回的不是数据（可能被拦了）'); }
    const c = parseChinabond(j, d);
    if (c) return c;
  }
  throw new FetchFail(`中债最近 ${CGB_MAX_BACK + 1} 天都没有曲线`);
}

const PARSE: Partial<Record<BondYieldDef['source'], (t: string) => ParsedYield | null>> = {
  // 第三版：iShares / BlackRock 条款禁止自动抓取，AGG / TLT / LQD / O9P 改成美国国债 + 利差近似，不再调用 parseIshares / parseBlackrockSg
  vanguard: parseVanguard,
  'em-7d': (t) => { try { return parseEm7d(JSON.parse(t)); } catch { return null; } },
  'em-nav': (t) => { try { return parseEmNav(JSON.parse(t)); } catch { return null; } },
};
const PAGE_NAME: Record<string, string> = { vanguard: 'Vanguard', 'em-7d': '东方财富', 'em-nav': '东方财富' };

export interface YieldsResult {
  updated: string[];
  failed: { code: string; reason: string }[];
  /** 这一次实际发了几个对外请求（≤ 45） */
  requests: number;
  /** 三条国债曲线各自取到没有：'ok' 或原因 */
  curves: Record<Curve, string>;
}

function why(e: unknown): string {
  if (e instanceof BudgetOut) return '这一次的请求数用完了';
  if (e instanceof TimeUp) return e.detail || '这一次的时间用完了';
  return e instanceof Error ? e.message : String(e);
}

/**
 * 取 16 只债券的预期年化，写 fund_yield。一次调用对外请求 ≤ 45（同一个 Http 计数）、约 25 秒截止（CALL_BUDGET_MS）；
 * 三条曲线和 9 个自动页面并行取。某只没取到：自动的退回"美国同期限国债 + 利差"（标近似），还不行就只记原因、保留上次的值（页面标"过期"）。
 */
export async function refreshYields(env: Env, now: number, f: FetchLike = (u, i) => fetch(u, i), sleep?: (ms: number) => Promise<unknown>, shared?: Http): Promise<YieldsResult> {
  const http = shared ?? new Http(f, MAX_REQUESTS, sleep, Date.now() + CALL_BUDGET_MS);
  const used0 = http.used;
  const curveErr: Record<Curve, string> = { ust: 'ok', sgs: 'ok', cgb: 'ok' };
  const curve = <K extends Curve>(k: K, p: Promise<CurvePoints>) => p.catch((e) => { curveErr[k] = why(e); return null; });
  const autos = BOND_YIELDS.filter((d) => d.kind === 'auto' && d.url);
  const [ust, sgs, cgb, pages] = await Promise.all([
    curve('ust', fetchUst(http, now)),
    curve('sgs', fetchSgs(http, now)),
    curve('cgb', fetchCgb(http, now)),
    Promise.all(autos.map(async (d) => {
      try {
        const headers = d.source.startsWith('em-') ? { 'user-agent': 'Mozilla/5.0', referer: EM_REFERER } : HTML_HEADERS;
        const t = (await http.text(d.url!, { headers }, PAGE_NAME[d.source] ?? d.source)).text;
        const p = PARSE[d.source]?.(t) ?? null;
        return { code: d.code, p, err: p ? '' : `${PAGE_NAME[d.source] ?? d.source}页面认不出收益率`, fetched: true };
      } catch (e) {
        // 回 403（被拦了）和"取到了却认不出"一样处理：直接退回国债近似，不当成一时没取到
        const err = why(e);
        return { code: d.code, p: null, err, fetched: / 403/.test(err) };
      }
    })),
  ]);
  const curves = { ust, sgs, cgb };
  const got = new Map(pages.map((x) => [x.code, x]));
  const ok: { code: string; y: BondYield }[] = [];
  const failed: { code: string; reason: string }[] = [];
  /** 页面没取到（网络错、超时、4xx/5xx）：有上次的值就保留上次的（标过期）；从没取到过才用美国国债近似顶上 */
  const keepOld: { code: string; y: BondYield; reason: string }[] = [];
  for (const d of BOND_YIELDS) {
    if (d.kind === 'auto') {
      const g = got.get(d.code);
      if (g?.p) { ok.push({ code: d.code, y: autoYield(d, g.p) }); continue; }
      const a = approxYield(d, curves, true);
      // 取到了页面但认不出（页面改版，或免费版 CPU 不够解析大页面）→ 退回近似；页面根本没取到 → 优先保留上次的值
      if (a && g?.fetched) { ok.push({ code: d.code, y: a }); continue; }
      if (a) { keepOld.push({ code: d.code, y: a, reason: g?.err || '没取到' }); failed.push({ code: d.code, reason: g?.err || '没取到' }); continue; }
      failed.push({ code: d.code, reason: (g?.err || '没取到') + (d.curve ? `；${d.curve === 'ust' ? '美国国债' : '国债'}也没取到：${curveErr[d.curve]}` : '') });
    } else {
      const a = approxYield(d, curves);
      if (a) ok.push({ code: d.code, y: a });
      else failed.push({ code: d.code, reason: d.curve ? curveErr[d.curve] : '没有配置国债曲线' });
    }
  }
  // 先取完再写库（不在事务里调外部接口）
  const stmts = [
    ...ok.map((x) => env.DB.prepare('INSERT INTO fund_yield (code, data, ok_at, err, err_at) VALUES (?1, ?2, ?3, NULL, NULL) ON CONFLICT (code) DO UPDATE SET data = ?2, ok_at = ?3, err = NULL, err_at = NULL').bind(x.code, JSON.stringify(x.y), now)),
    // 没有上次的值（data 为空）时写近似值、算取到；有上次的值就留着它、只记原因（UPDATE 里右边读的都是旧行）
    ...keepOld.map((x) => env.DB.prepare('INSERT INTO fund_yield (code, data, ok_at, err, err_at) VALUES (?1, ?2, ?3, NULL, NULL) ON CONFLICT (code) DO UPDATE SET data = CASE WHEN fund_yield.data IS NULL THEN ?2 ELSE fund_yield.data END, ok_at = CASE WHEN fund_yield.data IS NULL THEN ?3 ELSE fund_yield.ok_at END, err = CASE WHEN fund_yield.data IS NULL THEN NULL ELSE ?4 END, err_at = CASE WHEN fund_yield.data IS NULL THEN NULL ELSE ?3 END').bind(x.code, JSON.stringify(x.y), now, x.reason.slice(0, 200))),
    ...failed.filter((x) => !keepOld.some((k) => k.code === x.code)).map((x) => env.DB.prepare('INSERT INTO fund_yield (code, data, ok_at, err, err_at) VALUES (?1, NULL, NULL, ?2, ?3) ON CONFLICT (code) DO UPDATE SET err = ?2, err_at = ?3').bind(x.code, x.reason.slice(0, 200), now)),
  ];
  if (stmts.length) await env.DB.batch(stmts);
  return { updated: ok.map((x) => x.code), failed, requests: http.used - used0, curves: curveErr };
}

// ---------------------------------------------------------------- 第四版 ②：估值（6 个指数；"刷新数据"里 45 只和收益率都取完以后，页面按 cursor 一步一步调 POST /api/funds/valuation/refresh）
/**
 * 安全经理限制（Amos 11/11 同意）+ 主会话 11/11 两次更正 + 第五版修复（11/11 正式版第一次刷新中证 22 次请求后回 403、Shiller 首页 8 秒没回应；Amos 选 A 直接上生产）：
 *   - 只在点"刷新数据"时取；**每个来源每天最多一轮**（Shiller 每月一轮）：一轮可以拆成多个小请求（中证首次全量按约 3.4 年分段），
 *     **整轮取完、解析完、存好以后才记 ok_day**；一轮没成功不算取过，但**同一来源同一天最多开始 2 轮**（tries，开一轮先加一，硬上限）。
 *   - 同一来源（中证 www + oss-ch 算一个，Shiller 首页 + 下载算一个）两个请求之间 ≥ 5 秒（第五版从 2 秒改），**跨调用也算**（fund_val_work 的 run 行记着上次请求结束的时间）；不自动重试。
 *   - 第五版：对方回 **403 / 429** 立刻结束这次刷新里对该来源的所有请求（run.blocked；中证 5 个指数都不再碰，页面列出没再请求的指数）。
 *   - 第五版断点续取：中证 perf 一轮没成功时**保留**已经取到的段（fund_val_work 那一行留着，open = false），下一轮（同一天第 2 轮或之后哪天）从断点接着取，
 *     最后一段的结束日改成当天；已取到的月末值按"每月最后一个交易日"合并，和一次取完拼出的序列一样。
 *   - Amos 11/11「表格或文档太大无法单次解析完成，可以分开成多个小文档，多次解析」→ **每次调用只做一小步**（免费版每次请求 CPU 10ms）：
 *       中证 perf：首次全量每段最多 41 个月（约 3.4 年，3 段 / 指数；主会话要 5 年，本地冷启动实测 5 年一段解析最慢 13.7ms、超过 10ms，按约定缩短；
 *         41 个月一段最慢 7.6ms，再短就要 4 段——实测数见《项目地图》），每次调用取一段、解析一段；之后每天只取最近一段（从库里最后一个月的 1 号起）；
 *       中证 indicator.xls：约 8KB，一步；还没有市盈率序列的指数不取（不算一轮、不占请求）；
 *       Shiller：上次成功下载过的 ie_data.xls 链接存在 fund_valuation（SPX 那行 data.xls_url），先直接下载它（失败、不是 403 / 429 就回退首页找）；
 *         第六版（11/12 正式版首页连接被重置）：库里还没存过链接时，第一次直接下载代码里的已知链接 SHILLER_KNOWN_XLS（不先请求首页），失败、不是 403 / 429 才回退首页；
 *         存的链接数据没前进、再看首页时首页连不上 → 保留旧数据，页面注明"Shiller 本月还没更新（首页连不上）"（不记 ok_day，下次刷新再试）；
 *         这个月之后的轮次不再重新下载存的链接，只请求首页（1 个请求）：首页给新链接才下载，还是同一个链接就算本月完成（主会话 11/12 补充）；
 *       首页单独一步（超时放宽到 20 秒，仍受 25 秒截止）；下载一步只把复合文档里的工作簿流拆成 ≤ 128KB 的块存进 D1（fund_val_blob）；
 *       下一步读第一块里的目录和共享字符串表；之后每次只解析一块里的记录（xlsWalk + shillerCell，状态存 fund_val_work）；
 *       读到表尾才算出 CAPE、存 fund_valuation、删掉块。
 *   - 一次调用对外请求 ≤ 1 个（≤ 45）、25 秒截止照旧；只用中证指数官网和 shillerdata.com（下载链接只认 shillerdata.com / wsimg.com）。
 * 存的是中证指数有限公司、Robert Shiller 的数据，只给 Amos 本人看，不转载。
 */
export const VAL_GAP_MS = 5_000;
/** 中证 perf 首次全量每段最多几个月（第五版从 1 年改。5 年一段本地冷启动解析有超过 10ms 的；41 个月 = 122 个月分 3 段，最慢 7.6ms） */
export const VAL_SEG_MONTHS = 41;
/** Shiller 首页单独一步的超时 */
export const SHILLER_HOME_TIMEOUT_MS = 20_000;
/** 一轮刷新最多走多少步（循环硬上限；首次全量约 5 ×（3 + 1）+ 17 = 37 步） */
export const VAL_MAX_STEPS = 200;
/** Shiller 工作簿流拆块的大小（每块一行，远低于 D1 单行上限） */
export const VAL_BLOB = 128 * 1024;
/** 跨块的记录最长 8224 字节：每步多读下一块开头这么多 */
const VAL_TAIL = 9_000;
/** 断点续取最多接多少天前的进度（再老就从头取） */
const VAL_RESUME_DAYS = 31;
const CS_HEADERS = { 'user-agent': BROWSER_UA, accept: 'application/json, text/plain, */*', referer: 'https://www.csindex.com.cn/' };
const csPerfUrl = (code: string, start: string, end: string) => `https://www.csindex.com.cn/csindex-home/perf/index-perf?indexCode=${encodeURIComponent(code)}&startDate=${start}&endDate=${end}`;
const csXlsUrl = (code: string) => `https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/indicator/${encodeURIComponent(code)}indicator.xls`;
const SHILLER_HOME = 'https://shillerdata.com/';
/**
 * 已知的 Shiller ie_data.xls 下载链接（第六版）。来源：主会话 2026-11-12 实测——shillerdata.com 首页连接被重置，
 * 但首页给的这个文件托管链接本身能下载（HEAD 200，application/vnd.ms-excel）。
 * 库里没有存过链接时第一次直接下载它、不先请求首页；成功后照旧存进 fund_valuation（SPX 那行 data.xls_url），以后用存的。
 * 它也失败（不是 403 / 429）才回退首页找。Shiller 换了文件，这个链接可能失效或停在旧数据，不影响：存的链接和首页逻辑照旧。
 */
export const SHILLER_KNOWN_XLS = 'https://img1.wsimg.com/blobby/go/e5e77e0b-59d1-44d9-ab25-4763ac982e53/downloads/1449043e-a1ed-4e2e-8e9c-7b9a2a064493/ie_data.xls?ver=1791297298731';
/** 来源键（fund_val_fetch.src），也是一轮刷新里的先后顺序 */
export const valKeys = (def: ValIndexDef): string[] => (def.src === 'shiller' ? ['shiller'] : [`cs-perf:${def.code}`, `cs-xls:${def.code}`]);
const ALL_KEYS = VAL_INDEXES.flatMap(valKeys);
const keyDef = (key: string) => VAL_INDEXES.find((d) => valKeys(d).includes(key))!;
const family = (key: string): 'cs' | 'sh' => (key === 'shiller' ? 'sh' : 'cs');
const FAMILY_NAME = { cs: '中证', sh: 'Shiller' } as const;
/** 同一来源同一天最多开始几轮 */
export const VAL_MAX_TRIES = 2;
export interface ValLog { day: string; tries: number; ok_day: string | null }
const okToday = (key: string, log: ValLog | undefined, now: number) => {
  const today = day8(now);
  return !!log?.ok_day && (key === 'shiller' ? log.ok_day.slice(0, 7) === today.slice(0, 7) : log.ok_day === today);
};
/** 这个来源还要不要开一轮：今天（Shiller：这个月）已经成功 → 不开；今天已经开过 2 轮 → 不开 */
export function valDue(key: string, log: ValLog | undefined, now: number): boolean {
  if (!log) return true;
  if (okToday(key, log, now)) return false;
  return !(log.day === day8(now) && log.tries >= VAL_MAX_TRIES);
}
/** 首次全量从多少个月前的 1 号开始取（窗口 120 个月，多留 2 个月） */
const VAL_FULL_MONTHS = 122;
function monthStart(now: number, back: number): string {
  const d = new Date(now + 8 * 3600_000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1)).toISOString().slice(0, 10).replace(/-/g, '');
}
const ymd8 = (t: number) => new Date(t).toISOString().slice(0, 10).replace(/-/g, '');
/** [起, 止]（YYYYMMDD）切段，每段最多 months 个月（从起点那个月数起，段尾是月末；最后一段到止点为止）。段和段首尾相接、不重叠 */
export function spanSegments(start: string, end: string, months = VAL_SEG_MONTHS): [string, string][] {
  const out: [string, string][] = [];
  const n = Math.max(1, Math.floor(months));
  let a = start;
  for (let k = 0; a <= end && k < 200; k++) {
    const y = Number(a.slice(0, 4)), m = Number(a.slice(4, 6)) - 1;
    const next = Date.UTC(y, m + n, 1); // 这一段之后那个月的 1 号
    const b0 = ymd8(next - 86_400_000);
    const b = b0 >= end ? end : b0;
    out.push([a, b]);
    a = ymd8(next);
  }
  return out;
}
/** 按自然年切段（每段 1 年；第四版用的，留着给测试和本地核对） */
export function yearSegments(start: string, end: string): [string, string][] {
  const out: [string, string][] = [];
  for (let y = Number(start.slice(0, 4)), k = 0; y <= Number(end.slice(0, 4)) && k < 50; y++, k++) {
    const a = y === Number(start.slice(0, 4)) ? start : `${y}0101`, b = y === Number(end.slice(0, 4)) ? end : `${y}1231`;
    if (a <= b) out.push([a, b]);
  }
  return out;
}

export interface ValStepResult {
  /** 下一步的 cursor；null = 这一轮没有要做的了 */
  next: number | null;
  /** 已经做完几步（含这一步） */
  done: number;
  /** 估计一共几步（已做 + 还剩的估计；页面写"第 n / m 段"） */
  total: number;
  code: string;
  name: string;
  /** 这一步做的是什么（"市盈率 2016～2020 年""解析第 3 / 14 块"……） */
  part: string;
  /** working 这个来源这一轮还没完；ok 这个来源这一轮完成了；failed 这一轮没成功（保留上次的值）；done 没有要做的了 */
  status: 'working' | 'ok' | 'failed' | 'done';
  reason?: string;
  /** 第五版：这一步对方回了 403 / 429，这次刷新里同一来源**没再请求**的其他指数（页面一起列出来） */
  skipped?: { code: string; name: string; reason: string }[];
  requests: number;
}

/** 中证 perf 的进度。open = false：这一轮没成功、进度留着等下一轮接着取（第五版断点续取） */
interface PerfWork { day: string; segs: [string, string][]; i: number; months: Record<string, [string, number]>; last: [string, number] | null; incr: boolean; open?: boolean }
/** Shiller 的进度：home 找下载链接 → dl 下载并拆块 → globals 读目录 → rows 逐块解析。cached = 这次用的是上次存的链接（失败就回退首页） */
interface ShWork { day: string; stage: 'home' | 'dl' | 'globals' | 'rows'; url?: string; cached?: boolean;
  /** 第六版：这次下载的是代码里的已知链接（库里还没存过链接）；dlWhy = 存的 / 已知链接没取到的原因（回退首页也失败时一起写进原因） */
  known?: boolean; dlWhy?: string;
  /** 用存的链接解析完、最新月份没比库里前进：再看一次首页，recheck = 存的那个链接（首页上还是它就不再下载） */
  recheck?: string; n: number; len: number; pos?: number; sst?: string[]; st?: ShillerState; pend?: [number, number] | null }
/** 这次刷新的状态：failed 这次刷新里不再碰的来源键；blocked 回过 403 / 429、这次刷新里不再碰的来源；last 每个来源最后一个请求结束的时间 */
interface RunState { failed: string[]; blocked?: ('cs' | 'sh')[]; last: { cs?: number; sh?: number } }

async function readLog(env: Env): Promise<Map<string, ValLog>> {
  const m = new Map<string, ValLog>();
  try {
    const rows = (await env.DB.prepare('SELECT src, day, tries, ok_day FROM fund_val_fetch').all<{ src: string; day: string; tries: number; ok_day: string | null }>())?.results ?? [];
    for (const r of rows) if (r?.src) m.set(r.src, { day: r.day, tries: Number(r.tries) || 0, ok_day: r.ok_day ?? null });
  } catch { /* 读不到：当没取过 */ }
  return m;
}
async function readWork(env: Env): Promise<Map<string, any>> {
  const m = new Map<string, any>();
  try {
    const rows = (await env.DB.prepare('SELECT src, data FROM fund_val_work').all<{ src: string; data: string }>())?.results ?? [];
    for (const r of rows) { try { m.set(r.src, JSON.parse(r.data)); } catch { /* 坏行当没有 */ } }
  } catch { /* 表没建：当没有 */ }
  return m;
}
const putWork = (env: Env, src: string, data: unknown, now: number) => env.DB.prepare('INSERT INTO fund_val_work (src, data, at) VALUES (?1, ?2, ?3) ON CONFLICT (src) DO UPDATE SET data = ?2, at = ?3').bind(src, JSON.stringify(data), now);
const delWork = (env: Env, src: string) => env.DB.prepare('DELETE FROM fund_val_work WHERE src = ?1').bind(src);
const delBlobs = (env: Env) => env.DB.prepare("DELETE FROM fund_val_blob WHERE src = 'shiller'");
/** 开一轮：今天开过几轮加一（不在事务里；记不上就不发，宁可少取不多取）。换了一天从 1 重新数 */
const tryStmt = (env: Env, key: string, now: number) => env.DB.prepare('INSERT INTO fund_val_fetch (src, day, tries, at, ok_day) VALUES (?1, ?2, 1, ?3, NULL) ON CONFLICT (src) DO UPDATE SET tries = CASE WHEN fund_val_fetch.day = ?2 THEN fund_val_fetch.tries + 1 ELSE 1 END, day = ?2, at = ?3').bind(key, day8(now), now);
async function markTry(env: Env, key: string, now: number) {
  await tryStmt(env, key, now).run();
}
/** 一轮取完、解析完、存好才记"今天取过了" */
const markOk = (env: Env, key: string, now: number) => env.DB.prepare('UPDATE fund_val_fetch SET ok_day = ?2 WHERE src = ?1').bind(key, day8(now));
function readStored(raw: string | null | undefined): ValStored | null {
  if (!raw) return null;
  try { const j = JSON.parse(raw) as ValStored; return j && Array.isArray(j.series) ? j : null; } catch { return null; }
}
/** 存估值；keepErr = 只是补了股息率（市盈率那边这次没取到的原因留着） */
const saveVal = (env: Env, st: ValStored, now: number, keepErr = false) => env.DB.prepare(keepErr
  ? 'INSERT INTO fund_valuation (code, data, ok_at, err, err_at) VALUES (?1, ?2, ?3, NULL, NULL) ON CONFLICT (code) DO UPDATE SET data = ?2, ok_at = ?3'
  : 'INSERT INTO fund_valuation (code, data, ok_at, err, err_at) VALUES (?1, ?2, ?3, NULL, NULL) ON CONFLICT (code) DO UPDATE SET data = ?2, ok_at = ?3, err = NULL, err_at = NULL').bind(st.code, JSON.stringify(st), now);
const saveErr = (env: Env, code: string, reason: string, now: number) => env.DB.prepare('INSERT INTO fund_valuation (code, data, ok_at, err, err_at) VALUES (?1, NULL, NULL, ?2, ?3) ON CONFLICT (code) DO UPDATE SET err = ?2, err_at = ?3').bind(code, reason.slice(0, 200), now);
async function storedOf(env: Env, code: string): Promise<ValStored | null> {
  const row = await env.DB.prepare('SELECT data FROM fund_valuation WHERE code = ?1').bind(code).first<{ data: string | null }>().catch(() => null);
  return readStored(row?.data);
}
/** 这个来源这一轮是不是还在进行（今天开的、还没完；没成功留着等续取的不算） */
const active = (key: string, work: Map<string, any>, now: number) => { const w = work.get(key); return w?.day === day8(now) && w.open !== false; };
const keyDue = (key: string, log: Map<string, ValLog>, work: Map<string, any>, now: number) => active(key, work, now) || valDue(key, log.get(key), now);
/** 股息率要等有了市盈率序列才取（没有就不开这一轮、不发请求） */
const keyReady = (key: string, hasPe: Map<string, boolean>) => !key.startsWith('cs-xls:') || !!hasPe.get(key.slice(7));
/** 上一轮没成功留下的中证 perf 进度，能不能接着取（取过至少一段、还没取完、不太老） */
function resumable(w: PerfWork | undefined, now: number): w is PerfWork {
  if (!w || !Array.isArray(w.segs) || !(w.i > 0) || w.i >= w.segs.length || !w.months || typeof w.day !== 'string') return false;
  const age = (Date.parse(day8(now)) - Date.parse(w.day)) / 86_400_000;
  return isFinite(age) && age >= 0 && age <= VAL_RESUME_DAYS;
}

/** 估计这个来源这一轮还剩几步（页面写"第 n / m 段"用；估不准不要紧，只用来显示） */
function stepsLeft(key: string, work: Map<string, any>, stored: Map<string, boolean>, now: number): number {
  const w = active(key, work, now) ? work.get(key) : null;
  if (key.startsWith('cs-xls:')) return 1;
  if (key.startsWith('cs-perf:')) {
    const p = (w ?? (resumable(work.get(key), now) ? work.get(key) : null)) as PerfWork | null;
    if (p) return Math.max(1, p.segs.length - p.i);
    return stored.get(key.slice(8)) ? 1 : spanSegments(monthStart(now, VAL_FULL_MONTHS), day8(now).replace(/-/g, '')).length;
  }
  const est = Math.ceil(1.7e6 / VAL_BLOB);
  if (!w) return 2 + est; // 第六版：一开始就直接下载（存的链接或已知链接），不先请求首页
  const s = w as ShWork;
  if (s.stage === 'home') return s.recheck ? 1 : 3 + est;
  if (s.stage === 'dl') return 2 + est;
  return s.stage === 'globals' ? 1 + s.n : Math.max(1, s.n - Math.floor((s.pos ?? 0) / VAL_BLOB));
}

/** Shiller 块：第 i 块全部 + 下一块开头 VAL_TAIL 字节（跨块的那条记录） */
async function readBlob(env: Env, i: number): Promise<Uint8Array> {
  const a = await env.DB.prepare("SELECT data FROM fund_val_blob WHERE src = 'shiller' AND idx = ?1").bind(i).first<{ data: unknown }>();
  const b = await env.DB.prepare("SELECT substr(data, 1, ?2) AS data FROM fund_val_blob WHERE src = 'shiller' AND idx = ?1").bind(i + 1, VAL_TAIL).first<{ data: unknown }>();
  const u = (x: unknown) => (x instanceof Uint8Array ? x : x instanceof ArrayBuffer ? new Uint8Array(x) : Array.isArray(x) ? Uint8Array.from(x as number[]) : new Uint8Array(0));
  if (!a) throw new FetchFail(`Shiller 数据的第 ${i + 1} 块不见了`);
  const A = u(a.data), B = b ? u(b.data) : new Uint8Array(0);
  const out = new Uint8Array(A.length + B.length);
  out.set(A); out.set(B, A.length);
  return out;
}

/** 中证 perf 一段 → 并进进度（同一个月留日期最晚的那天；最新一天单独记）。断点续取和一次取完走的是同一个合并，拼出来一样 */
export function perfMerge(w: { months: Record<string, [string, number]>; last: [string, number] | null }, daily: [string, number][]) {
  for (const p of daily) { const m = p[0].slice(0, 7); if (!w.months[m] || p[0] >= w.months[m][0]) w.months[m] = p; if (!w.last || p[0] >= w.last[0]) w.last = p; }
}
/** 一段的进度文字（产品复核 G2：只写哪几年；每天的增量写"最新"） */
const perfPart = (w: PerfWork, a: string, b: string) => (w.segs.length > 1 ? (a.slice(0, 4) === b.slice(0, 4) ? `市盈率 ${a.slice(0, 4)} 年` : `市盈率 ${a.slice(0, 4)}～${b.slice(0, 4)} 年`) : '市盈率 最新');
/** 对方回了 403 / 429（被拦了 / 嫌请求太多） */
const blockedBy = (e: unknown) => e instanceof FetchFail && (e.status === 403 || e.status === 429);

/**
 * 估值的一步（cursor 从 0 数；cursor = 0 开一次新的刷新）。挑顺序里第一个"今天还要取、这次刷新里还没失败、来源没被拦"的来源，做它的下一小步。
 */
export async function refreshValuation(env: Env, cursor: number, now: number, f: FetchLike = (u, i) => fetch(u, i), sleep?: (ms: number) => Promise<unknown>): Promise<ValStepResult> {
  const [log0, work] = await Promise.all([readLog(env), readWork(env)]);
  let log = log0;
  const prevRun = work.get('run') as RunState | undefined;
  const run: RunState = cursor === 0 || !prevRun ? { failed: [], blocked: [], last: prevRun?.last ?? {} } : { ...prevRun, blocked: prevRun.blocked ?? [] };
  const blocked = run.blocked!;
  const rows = (await env.DB.prepare('SELECT code, data FROM fund_valuation').all<{ code: string; data: string | null }>().catch(() => null))?.results ?? [];
  const stored = new Map(rows.map((r) => [r.code, !!readStored(r.data) && (readStored(r.data)!.series.length >= 100)]));
  const hasPe = new Map(rows.map((r) => [r.code, !!readStored(r.data)?.series.length]));
  const todo = () => ALL_KEYS.filter((k) => !run.failed.includes(k) && !blocked.includes(family(k)) && keyReady(k, hasPe) && keyDue(k, log, work, now));
  const left = () => todo().reduce((a, k) => a + stepsLeft(k, work, stored, now), 0);
  const key = cursor < VAL_MAX_STEPS ? todo()[0] : undefined;
  if (!key) {
    await putWork(env, 'run', run, now).run();
    return { next: null, done: cursor, total: cursor, code: '', name: '', part: '', status: 'done', requests: 0 };
  }
  const def = keyDef(key), fam = family(key);
  const mkHttp = (timeoutMs?: number) => new Http(f, MAX_REQUESTS, sleep, Date.now() + CALL_BUDGET_MS, { gapMs: VAL_GAP_MS, tries: 1, lastAt: run.last[fam], ...(timeoutMs ? { timeoutMs } : {}) });
  let http = mkHttp();
  let status: ValStepResult['status'] = 'working', part = '', reason = '';
  let skipped: ValStepResult['skipped'];
  /** 第六版：正在请求 Shiller 首页（这一步失败 = 首页连不上 / 没回应 / 被拦） */
  let homeReq = false;
  try {
    if (key.startsWith('cs-perf:')) {
      let w = active(key, work, now) ? (work.get(key) as PerfWork) : null;
      const old = await storedOf(env, def.code);
      if (!w) {
        await markTry(env, key, now);
        const end = day8(now).replace(/-/g, '');
        const prev = work.get(key) as PerfWork | undefined;
        if (resumable(prev, now)) {
          // 第五版断点续取：已经取到的段不重取，从断点那一段的起点接着取到今天
          w = { ...prev, day: day8(now), open: true, segs: [...prev.segs.slice(0, prev.i), ...spanSegments(prev.segs[prev.i][0], end)] };
        } else {
          const incr = !!old && old.series.length >= 100;
          w = { day: day8(now), segs: incr ? [[old!.series[old!.series.length - 1][0].replace('-', '') + '01', end]] : spanSegments(monthStart(now, VAL_FULL_MONTHS), end), i: 0, months: {}, last: null, incr, open: true };
        }
        work.set(key, w);
      }
      const [a, b] = w.segs[w.i];
      part = perfPart(w, a, b);
      const daily = parseCsPerf(await http.get(csPerfUrl(def.code, a, b), CS_HEADERS, '中证'));
      if (!daily) throw new FetchFail('中证的市盈率数据认不出来');
      perfMerge(w, daily);
      w.i++;
      if (w.i < w.segs.length) { work.set(key, w); await putWork(env, key, w, now).run(); }
      else {
        if (!w.last) throw new FetchFail('中证这几段都没有市盈率');
        const fresh = Object.keys(w.months).sort().map((m) => [m, Math.round(w!.months[m][1] * 100) / 100] as [string, number]);
        const st: ValStored = { ...(old ?? {}), code: def.code, series: mergeMonths(w.incr && old ? old.series : [], fresh, VAL_KEEP), pe_now: w.last[1], pe_now_date: w.last[0], dy_now: old?.dy_now ?? null, dy_date: old?.dy_date ?? null };
        await env.DB.batch([saveVal(env, st, now), markOk(env, key, now), delWork(env, key)]);
        work.delete(key); stored.set(def.code, st.series.length >= 100); hasPe.set(def.code, st.series.length > 0);
        status = 'ok';
      }
    } else if (key.startsWith('cs-xls:')) {
      part = '股息率';
      const old = await storedOf(env, def.code);
      if (!old) { hasPe.set(def.code, false); throw new FetchFail('还没有市盈率序列，股息率先不取'); } // keyReady 已经挡掉，这里是保险
      await markTry(env, key, now);
      const x = parseCsIndicator(await http.bin(csXlsUrl(def.code), { headers: CS_HEADERS }, '中证'));
      if (!x) throw new FetchFail('中证的股息率表认不出来');
      await env.DB.batch([saveVal(env, { ...old, dy_now: x.dy, dy_date: x.date }, now, true), markOk(env, key, now)]);
      status = 'ok';
    } else {
      let w = active(key, work, now) ? (work.get(key) as ShWork) : null;
      if (!w) {
        // 开一轮：上次成功下载过的链接先直接用；库里没有（或存的不像样）就直接下载代码里的已知链接（第六版，不先请求首页）。
        // 两种都是 cached：下载失败、不是 403 / 429 就回退首页找
        await markTry(env, key, now);
        const sOld = await storedOf(env, 'SPX');
        const url = sOld?.xls_url;
        const okUrl = (u: string | undefined): u is string => !!u && shillerXlsUrl(`<a href="${u.replace(/"/g, '')}">`) === u;
        // 第六版（主会话补充）：本月已经用存的链接下载过、数据没前进、首页连不上（stale_month 是本月 + stale_why）→ "本月已下载、待找新链接"：
        // 之后的轮次不再重新下载存的链接，只请求首页（1 个请求）；首页给新链接才下载，还是同一个链接就算本月完成
        const pendingHome = okUrl(url) && sOld?.stale_month === day8(now).slice(0, 7) && !!sOld?.stale_why;
        w = pendingHome ? { day: day8(now), stage: 'home', recheck: url, n: 0, len: 0 } : okUrl(url) ? { day: day8(now), stage: 'dl', url, cached: true, n: 0, len: 0 } : { day: day8(now), stage: 'dl', url: SHILLER_KNOWN_XLS, cached: true, known: true, n: 0, len: 0 };
        work.set(key, w); // 出错处理按 work 里的这一轮判断（只请求首页的那种要认得出 recheck）
      }
      if (w.stage === 'home') {
        // 首页单独一步，超时放宽到 20 秒（仍受 25 秒截止）
        part = '首页';
        http = mkHttp(SHILLER_HOME_TIMEOUT_MS);
        homeReq = true;
        const home = await http.text(SHILLER_HOME, { headers: HTML_HEADERS }, 'Shiller 首页');
        homeReq = false;
        const url = shillerXlsUrl(home.text);
        if (!url) throw new FetchFail('Shiller 首页上没找到 ie_data.xls 的下载链接（或链接不在 shillerdata.com / wsimg.com 上）');
        const old = w.recheck ? await storedOf(env, 'SPX') : null;
        if (w.recheck && url === w.recheck && old) {
          // 首页上还是存的那个链接：Shiller 本月还没更新，保留旧数据，记一笔（页面注明），这个月这一轮算完
          part = '首页（没有新链接，Shiller 本月还没更新）';
          await env.DB.batch([saveVal(env, { ...old, stale_month: day8(now).slice(0, 7), stale_why: undefined }, now), markOk(env, key, now), delWork(env, key), delBlobs(env)]);
          work.delete(key);
          status = 'ok';
        } else {
          w = { day: day8(now), stage: 'dl', url, cached: false, n: 0, len: 0 };
          work.set(key, w);
          await putWork(env, key, w, now).run();
        }
      } else if (w.stage === 'dl') {
        // 下载：只把工作簿流拆块存起来，不解析
        part = w.known ? '下载（已知链接）' : '下载';
        let wb: Uint8Array | null = null, dlWhy = '';
        try {
          wb = cfbStream(await http.bin(w.url!, { headers: { 'user-agent': BROWSER_UA, referer: SHILLER_HOME } }, 'Shiller 数据'), 'Workbook');
          if (!wb) throw new FetchFail('Shiller 的 ie_data.xls 认不出来（不是 xls）');
        } catch (e) {
          if (!w.cached || blockedBy(e)) throw e;
          // 存的 / 已知链接不能用了（不是被拦）：这一轮回退首页找新链接（下一步）
          const which = w.known ? '已知链接' : '存的链接';
          part = `下载（${which}没取到：${why(e)}；改去首页找）`;
          dlWhy = `${which}没取到：${why(e)}`;
          wb = null;
        }
        if (!wb) {
          w = { day: day8(now), stage: 'home', n: 0, len: 0, ...(dlWhy ? { dlWhy } : {}) };
          work.set(key, w);
          await putWork(env, key, w, now).run();
        } else {
          const n = Math.ceil(wb.length / VAL_BLOB);
          w = { day: day8(now), stage: 'globals', url: w.url, cached: w.cached, n, len: wb.length };
          await env.DB.batch([delBlobs(env), ...Array.from({ length: n }, (_, i) => env.DB.prepare("INSERT INTO fund_val_blob (src, idx, data) VALUES ('shiller', ?1, ?2)").bind(i, wb!.slice(i * VAL_BLOB, (i + 1) * VAL_BLOB))), putWork(env, key, w, now)]);
          work.set(key, w);
        }
      } else if (w.stage === 'globals') {
        // 第一块里的目录（各表起点）和共享字符串表
        part = '目录';
        const loc = shillerLocate(await readBlob(env, 0));
        if (!loc) throw new FetchFail('Shiller 的 ie_data.xls 里没找到 Data 表');
        w = { ...w, stage: 'rows', pos: loc.pos, sst: loc.sst.map((s) => s.slice(0, 40)), st: shillerInit(), pend: null };
        work.set(key, w);
        await putWork(env, key, w, now).run();
      } else {
        // 之后每次只解析一块里的记录
        const i = Math.floor(w.pos! / VAL_BLOB);
        part = `解析第 ${i + 1} / ${w.n} 块`;
        if (i >= w.n) throw new FetchFail('Shiller 的 Data 表没读到表尾');
        const pend = { cell: w.pend ?? null };
        const r = xlsWalk(await readBlob(env, i), i * VAL_BLOB, w.pos!, (i + 1) * VAL_BLOB, w.sst!, (rr, c, v) => shillerCell(w!.st!, rr, c, v), pend);
        if (!r.eof && r.pos <= w.pos!) throw new FetchFail('Shiller 的表解析不往前走了');
        if (!r.eof) { w = { ...w, pos: r.pos, pend: pend.cell }; work.set(key, w); await putWork(env, key, w, now).run(); }
        else {
          const p = shillerDone(w.st!);
          if (!p) throw new FetchFail('Shiller 的 Data 表认不出来（没有表头或 CAPE）');
          const last = p.series[p.series.length - 1];
          const old = await storedOf(env, 'SPX');
          const advanced = !old?.pe_now_date || last[0] > old.pe_now_date;
          if (!advanced && w.cached && w.url) {
            // 用存的链接取到的最新月份没比库里前进：同一轮里再看一次首页有没有新链接（下一步，仍是每次调用 ≤ 1 个请求、同源隔 ≥ 5 秒）
            w = { day: day8(now), stage: 'home', recheck: w.url, n: 0, len: 0 };
            work.set(key, w);
            await env.DB.batch([delBlobs(env), putWork(env, key, w, now)]);
          } else {
            // 第五版：成功下载并解析过的链接存下来，下次直接请求它；最新月份没前进的记 stale_month（页面注明"Shiller 本月还没更新"）
            await env.DB.batch([saveVal(env, { code: 'SPX', series: p.series, pe_now: last[1], pe_now_date: last[0], dy_now: p.dy, dy_date: p.dyDate, ...(w.url ? { xls_url: w.url } : {}), ...(advanced ? {} : { stale_month: day8(now).slice(0, 7) }) }, now), markOk(env, key, now), delWork(env, key), delBlobs(env)]);
            work.delete(key);
            status = 'ok';
          }
        }
      }
    }
  } catch (e) {
    // 这一轮没成功：这次刷新里不再碰它；保留上次的值，只记原因。
    // 第五版：中证 perf 的进度留着（open = false），下一轮从断点接着取；Shiller 的进行中状态和块照旧丢掉（失败都在解析或下载，下一轮重下）
    status = 'failed';
    const stop = blockedBy(e) && !blocked.includes(fam);
    const w = work.get(key);
    // 第六版：回退首页之前存的 / 已知链接也没取到 → 两个原因一起写
    const pre = key === 'shiller' && (w as ShWork | undefined)?.dlWhy ? `${(w as ShWork).dlWhy}；` : '';
    reason = `${pre}${part ? part + '：' : ''}${why(e)}${stop ? `，这一轮不再请求${FAMILY_NAME[fam]}` : ''}`;
    run.failed.push(key);
    // 第六版：存的链接数据没前进、再看首页时首页连不上 → 保留旧数据，页面注明"Shiller 本月还没更新（首页连不上）"，不记错误。
    // 不记 ok_day：下次点「刷新数据」（每天最多 2 轮）只再请求首页（不重下存的链接），首页恢复了就能找到新链接
    const staleOld = key === 'shiller' && homeReq && (w as ShWork | undefined)?.recheck ? await storedOf(env, 'SPX') : null;
    if (staleOld) reason += '；保留现有数据（Shiller 本月还没更新，首页连不上）';
    const keep = key.startsWith('cs-perf:') && w && Array.isArray(w.segs);
    if (keep) work.set(key, { ...w, open: false });
    else work.delete(key);
    const stmts = [keep ? putWork(env, key, { ...w, open: false }, now) : delWork(env, key), ...(key === 'shiller' ? [delBlobs(env)] : []),
      staleOld ? saveVal(env, { ...staleOld, stale_month: day8(now).slice(0, 7), stale_why: '首页连不上' }, now) : saveErr(env, def.code, reason, now)];
    if (stop) {
      // 回 403 / 429：这次刷新里同一来源剩下的都不再请求；列出来（各自记一条原因，卡片上看得到）。
      // 没开始的也算用掉今天的一轮（宁可少取不多取：被拦了两轮，当天就不再碰这个来源）
      const st = (e as FetchFail).status;
      const rest = todo().filter((k) => k !== key && family(k) === fam);
      for (const k of rest) if (!active(k, work, now)) stmts.push(tryStmt(env, k, now));
      const others = [...new Set(rest.map((k) => keyDef(k)).filter((d) => d.code !== def.code))];
      blocked.push(fam);
      const msg = `没再请求（${FAMILY_NAME[fam]}回 ${st}，这一轮停止请求${FAMILY_NAME[fam]}，下次点「刷新数据」从断点接着取）`;
      skipped = others.map((d) => ({ code: d.code, name: d.name, reason: msg }));
      for (const d of others) stmts.push(saveErr(env, d.code, msg, now));
    }
    await env.DB.batch(stmts).catch(() => {});
  }
  if (http.used) run.last[fam] = http.lastEnd;
  await putWork(env, 'run', run, now).run();
  log = await readLog(env); // 这一步可能刚记了"今天取成功了"或"又开了一轮"
  const rest = left();
  return { next: rest > 0 && cursor + 1 < VAL_MAX_STEPS ? cursor + 1 : null, done: cursor + 1, total: cursor + 1 + rest, code: def.code, name: def.name, part, status, ...(reason ? { reason } : {}), ...(skipped?.length ? { skipped } : {}), requests: http.used };
}

export interface ValuationList {
  items: (ValCard & { ok_at: string | null; error?: string; error_at?: string; note?: string })[];
  /** 还没有数据的指数（从没取到过） */
  missing: { code: string; name: string; market: string; error?: string }[];
  /** 还有来源今天（Shiller 这个月）没取过：页面刷新完 45 只后才去调 POST /api/funds/valuation/refresh；false 就不调 */
  due: boolean;
}

/** GET /api/funds 里的 valuation（表还没建等读不到时回 null，不影响 45 只） */
export async function valuationList(env: Env, now: number): Promise<ValuationList | null> {
  try {
    const rows = (await env.DB.prepare('SELECT code, data, ok_at, err, err_at FROM fund_valuation').all<Row>()).results ?? [];
    const [log, work] = await Promise.all([readLog(env), readWork(env)]);
    const by = new Map(rows.map((r) => [r.code, r]));
    const items: ValuationList['items'] = [];
    const missing: ValuationList['missing'] = [];
    for (const def of VAL_INDEXES) {
      const r = by.get(def.code);
      const st = readStored(r?.data);
      const card = st ? valCard(def, st) : null;
      if (!card) { missing.push({ code: def.code, name: def.name, market: def.market, ...(r?.err ? { error: r.err } : {}) }); continue; }
      // 第五版：Shiller 这个月重新看过、还没更新 → 注明
      // 第六版：再看首页时首页连不上（stale_why）→ "Shiller 本月还没更新（首页连不上），最新是 … 的数据"
      const note = st!.stale_month && st!.stale_month === day8(now).slice(0, 7)
        ? (st!.stale_why ? `Shiller 本月还没更新（${st!.stale_why}），最新是 ${st!.pe_now_date} 的数据` : `Shiller 本月还没更新（最新是 ${st!.pe_now_date} 的数据）`) : '';
      items.push({ ...card, ok_at: r?.ok_at ? new Date(r.ok_at).toISOString() : null, ...(note ? { note } : {}), ...(r?.err ? { error: r.err, ...(r.err_at ? { error_at: new Date(r.err_at).toISOString() } : {}) } : {}) });
    }
    // 股息率要等有了市盈率序列才取（keyReady）：没有市盈率的指数不因为股息率一直显示"要取"
    const hasPe = new Map(rows.map((r) => [r.code, !!readStored(r.data)?.series.length]));
    const due = ALL_KEYS.some((k) => keyReady(k, hasPe) && keyDue(k, log, work, now));
    return { items, missing, due };
  } catch {
    return null;
  }
}

/** /api/funds 和 /api/funds/refresh（第二版：最后一批顺带取债券收益率）；别的地址回 null（由 adminApi 回 404） */
export async function fundsApi(env: Env, req: Request, now: number, sub: string, f?: FetchLike): Promise<Response | null> {
  // 第四版：GET 多一个 valuation（估值卡片 + due）；表还没建时是 null
  if (sub === '' && req.method === 'GET') return json({ ...(await fundsList(env)), valuation: await valuationList(env, now) });
  if (sub === 'valuation/refresh' && req.method === 'POST') {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const st = body?.cursor ?? 0;
    if (typeof st !== 'number' || !Number.isInteger(st) || st < 0 || st >= VAL_MAX_STEPS) return json({ error: '估值的进度不对，请重新点一次「刷新数据」' }, 400);
    return json(await refreshValuation(env, st, now, f));
  }
  if (sub === 'refresh' && req.method === 'POST') {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const c = body?.cursor ?? 0;
    if (typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c >= FUNDS.length) return json({ error: '刷新进度不对，请重新点一次「刷新数据」' }, 400);
    return json(await refreshBatch(env, c, now, f));
  }
  return null;
}
