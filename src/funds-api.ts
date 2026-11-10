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
import { cleanPoints, eastmoneyPageOldest, FUNDS, MIN_POINTS, parseEastmoney, parseYahoo, summarize, type FundDef, type FundSnapshot, type Point } from './funds';

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
        const r = await this.f(url, { headers, signal: ac.signal });
        if (r.ok) {
          const text = await r.text();
          let body: unknown;
          try { body = JSON.parse(text); } catch { throw new FetchFail(`${what}回的不是数据（可能被拦了）`); }
          return body;
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

async function fromEastmoney(http: Http, code: string, now: number): Promise<Point[]> {
  const cut = new Date(now - 400 * 86_400_000).toISOString().slice(0, 10);
  const pages: unknown[] = [];
  for (let n = 1; n <= EM_MAX_PAGES; n++) {
    const pg = await http.get(emUrl(code, n), { 'user-agent': UA, referer: EM_REFERER }, '东方财富');
    const oldest = eastmoneyPageOldest(pg);
    if (oldest === null) break;
    pages.push(pg);
    if (oldest < cut) break;
  }
  return parseEastmoney(pages).filter((p) => p[0] >= cut);
}

/** 估一只最多要几个请求（不够就留到下一批，免得取到一半额度用完白取） */
export function estimateRequests(def: FundDef): number {
  if (def.source === 'eastmoney') return 16;
  return def.symbol.endsWith('.SS') ? 3 : 2;
}

/** 取一只：Yahoo（2y → 1y）；.SS 清洗后不到 30 点或 Yahoo 取不到 → 改用东方财富（去掉 .SS）。返回快照；取不到抛 FetchFail，额度用完抛 BudgetOut */
export async function fetchFund(def: FundDef, http: Http, now: number): Promise<FundSnapshot> {
  if (def.source === 'eastmoney') {
    const pts = cleanPoints(await fromEastmoney(http, def.symbol, now));
    if (!pts.length) throw new FetchFail('东方财富没有这只的净值');
    return summarize(def, 'CNY', pts);
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
    if (em.length) return summarize({ ...def, source: 'eastmoney' }, 'CNY', em);
  }
  if (!pts.length) throw yErr instanceof Error ? new FetchFail(yErr.message) : new FetchFail(why ? `Yahoo 没有这只的数据：${why}` : 'Yahoo 没有这只的数据');
  return summarize(def, cur, pts);
}

export interface RefreshResult {
  next: number | null;
  done: number;
  total: number;
  /** 这一批更新了的 code */
  updated: string[];
  failed: { code: string; reason: string }[];
  /** 这一次实际发了几个对外请求 */
  requests: number;
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
  let i = cursor, n = 0;
  while (i < total && n < MAX_FUNDS_PER_CALL) {
    const def = FUNDS[i];
    if (n > 0 && (http.left < estimateRequests(def) || Date.now() - t0 > START_CUTOFF_MS)) break;
    try {
      ok.push(await fetchFund(def, http, now));
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
  // 先取完再写库（不在事务里调外部接口）
  const stmts = [
    ...ok.map((s) => env.DB.prepare('INSERT INTO fund_snapshot (code, data, ok_at, err, err_at) VALUES (?1, ?2, ?3, NULL, NULL) ON CONFLICT (code) DO UPDATE SET data = ?2, ok_at = ?3, err = NULL, err_at = NULL').bind(s.code, JSON.stringify(s), now)),
    ...failed.map((x) => env.DB.prepare('INSERT INTO fund_snapshot (code, data, ok_at, err, err_at) VALUES (?1, NULL, NULL, ?2, ?3) ON CONFLICT (code) DO UPDATE SET err = ?2, err_at = ?3').bind(x.code, x.reason.slice(0, 200), now)),
  ];
  if (stmts.length) await env.DB.batch(stmts);
  return { next: i < total ? i : null, done: i, total, updated: ok.map((x) => x.code), failed, requests: http.used };
}

interface Row { code: string; data: string | null; ok_at: number | null; err: string | null; err_at: number | null }

/** GET /api/funds 的内容 */
export async function fundsList(env: Env): Promise<{ fetched_at: string | null; items: Record<string, unknown>[] }> {
  const rows = (await env.DB.prepare('SELECT code, data, ok_at, err, err_at FROM fund_snapshot').all<Row>()).results ?? [];
  const by = new Map(rows.map((r) => [r.code, r]));
  let latest = 0;
  const items = FUNDS.map((def) => {
    const r = by.get(def.code);
    let snap: Record<string, unknown> | null = null;
    if (r?.data) { try { snap = JSON.parse(r.data); } catch { snap = null; } }
    if (r?.ok_at && r.ok_at > latest) latest = r.ok_at;
    // 名字、标签、市场、类别以代码里的清单为准（改名后旧快照也跟着变）；source 用快照里实际用的
    const item: Record<string, unknown> = { ...(snap ?? {}), market: def.market, category: def.category, name: def.name, code: def.code, symbol: def.symbol, tag: def.tag, source: (snap?.source as string) ?? def.source };
    // 这一只上次取到的时间（页面用来标出"上次数据"：分批刷新中途断了，没轮到的几只比标题的数据时间旧）
    if (snap && r?.ok_at) item.ok_at = new Date(r.ok_at).toISOString();
    if (!snap) item.error = r?.err ?? '还没取过';
    // 取到时会把 err 清空，所以 err 还在 = 最近一次没取到（不比时间：同一毫秒先成功后失败也算失败，C106）
    else if (r?.err) { item.error = r.err; if (r.err_at) item.error_at = new Date(r.err_at).toISOString(); }
    return item;
  });
  return { fetched_at: latest ? new Date(latest).toISOString() : null, items };
}

/** /api/funds 和 /api/funds/refresh；别的地址回 null（由 adminApi 回 404） */
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
