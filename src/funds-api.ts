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
 * 不花钱（底线 8）：两个来源都是公开免费接口，不用密钥。
 */
import type { Env } from './env';
import { bandCoverage, bondCenter, cleanPoints, eastmoneyMoneyIndex, eastmoneyPageOldest, FUNDS, MIN_POINTS, parseEastmoney, parseYahoo, rangeBand, summarize, type FundDef, type FundSnapshot, type Point } from './funds';
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

/** 取数失败的中文原因（页面直接显示） */
export class FetchFail extends Error {}

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
  constructor(
    private f: FetchLike,
    public max = MAX_REQUESTS,
    private sleep: (ms: number) => Promise<unknown> = (ms) => new Promise((r) => setTimeout(r, ms)),
    public deadline = Infinity,
  ) {}
  get left() { return this.max - this.used; }
  async get(url: string, headers: Record<string, string>, what: string): Promise<unknown> {
    return (await this.send(url, { headers }, what, 'json')).body;
  }
  /** 取网页 / CSV 原文（第二版债券收益率用）；cookie = 回包里 set-cookie 的 name=value 拼好的（MAS 的表单要带回去） */
  async text(url: string, init: { method?: string; headers: Record<string, string>; body?: string }, what: string): Promise<{ text: string; cookie: string }> {
    const r = await this.send(url, init, what, 'text');
    return { text: r.body as string, cookie: r.cookie };
  }
  private async send(url: string, init: { method?: string; headers: Record<string, string>; body?: string }, what: string, as: 'json' | 'text'): Promise<{ body: unknown; cookie: string }> {
    let last = '', tries = 0;
    const cut = () => new TimeUp(last ? `${last}（试了 ${tries} 次）` : '');
    for (let i = 0; i < TRIES; i++) {
      if (this.used >= this.max) throw new BudgetOut();
      const rest = this.deadline - Date.now();
      if (rest <= 0) throw cut();
      const limit = Math.min(TIMEOUT_MS, rest);
      this.used++;
      tries++;
      const t0 = Date.now();
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), limit);
      try {
        const r = await this.f(url, { ...init, signal: ac.signal });
        if (r.ok) {
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
        if (r.status !== 429 && r.status < 500) throw new FetchFail(last);
      } catch (e) {
        if (e instanceof FetchFail || e instanceof BudgetOut || e instanceof TimeUp) throw e;
        if (ac.signal.aborted && limit < TIMEOUT_MS) throw cut(); // 是 25 秒截止把它打断的，不是数据源慢
        last = ac.signal.aborted ? `${what} ${Math.max(1, Math.round((Date.now() - t0) / 1000))} 秒没回应` : `连不上${what}`;
      } finally {
        clearTimeout(timer);
      }
      if (i < TRIES - 1) {
        if (this.deadline - Date.now() <= 1000) throw cut(); // 来不及再试一次：留给下一批
        await this.sleep(1000);
      }
    }
    throw new FetchFail(`${last}（试了 ${tries} 次）`);
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

/** 估一只最多要几个请求（不够就留到下一批，免得取到一半额度用完白取） */
export function estimateRequests(def: FundDef, incremental = false): number {
  if (def.source === 'eastmoney') return incremental ? 2 : 16;
  return def.symbol.endsWith('.SS') ? 3 : 2;
}

/** 取一只：Yahoo（2y → 1y）；.SS 清洗后不到 30 点或 Yahoo 取不到 → 改用东方财富（去掉 .SS）。返回快照；取不到抛 FetchFail，额度用完抛 BudgetOut */
export async function fetchFund(def: FundDef, http: Http, now: number, prev?: Record<string, unknown> | null): Promise<FundSnapshot> {
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
  if (!pts.length) throw yErr instanceof Error ? new FetchFail(yErr.message) : new FetchFail(why ? `Yahoo 没有这只的数据：${why}` : 'Yahoo 没有这只的数据');
  return { ...summarize(def, cur, pts), price_kind: 'price' };
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
  let i = cursor, n = 0;
  while (i < total && n < MAX_FUNDS_PER_CALL) {
    const def = FUNDS[i];
    if (n > 0 && (http.left < estimateRequests(def, inc(def)) || Date.now() - t0 > START_CUTOFF_MS)) break;
    // 第二版 ③：最后一只之后要在同一次调用里取债券收益率——额度或时间不够留给它，就把最后一只留给下一批（下一批 = 最后一只 + 收益率）
    if (n > 0 && i === total - 1 && (http.left - estimateRequests(def, inc(def)) < YIELD_RESERVE || Date.now() - t0 > YIELD_START_MS)) break;
    try {
      ok.push(await fetchFund(def, http, now, prev.get(def.code)));
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

/** /api/funds 和 /api/funds/refresh（第二版：最后一批顺带取债券收益率）；别的地址回 null（由 adminApi 回 404） */
export async function fundsApi(env: Env, req: Request, now: number, sub: string, f?: FetchLike): Promise<Response | null> {
  if (sub === '' && req.method === 'GET') return json(await fundsList(env));
  if (sub === 'refresh' && req.method === 'POST') {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const c = body?.cursor ?? 0;
    if (typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c >= FUNDS.length) return json({ error: '刷新进度不对，请重新点一次「刷新数据」' }, 400);
    return json(await refreshBatch(env, c, now, f));
  }
  return null;
}
