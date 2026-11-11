/**
 * 公共工具「基金观察」的纯计算部分（**不碰网络、不碰数据库**；取数在 src/funds-api.ts，页面在 src/funds-page.ts）。
 *
 * 口径照 agents 研发 2026-11-10 实际跑通的参考脚本 fetch2.py（45 只的清单、名称、标签和顺序照它的 L）：
 *   - 收益、回撤一律用**含分红的复权价**（Yahoo adjclose；东方财富用累计净值 LJJZ）；
 *   - 某段时间的"基准" = 日期 ≤（最后一天 − 7 / 30 / 365 天）的最后一个点；今年以来的基准 = ≤ 上年 12/31 的最后一个点；**没有基准返回 null**（上市不满这段时间）；
 *   - 最大回撤 = 从基准那一点起，按时间往后"从当时最高点跌到之后最低点"的最大跌幅（百分数，≤ 0）；'all' = 手上这段（最多一年）全部点；
 *   - 清洗：① 上市首日报价异常（前两点复权价差 >20%，XUS、XWR 首日差 30%）去掉第一点、循环；
 *          ② 单日坏报价（和前后两点都差 >8% 且同侧，BYJ 2026-07-15 跌 10% 次日涨 11.6%）去掉这一点；
 *          ③ 只留最后一点往前 375 天内。
 */

export type Market = '新加坡' | '美国' | '中国';
export type Category = '宽基' | '债券' | '红利';
export type Source = 'yahoo' | 'eastmoney';

export interface FundDef {
  market: Market;
  category: Category;
  /** 页面上显示的名字 */
  name: string;
  /** 页面上显示的代码（Yahoo 的 .SI / .SS 后缀去掉） */
  code: string;
  /** 去取数用的代码：Yahoo 代码（带后缀）或东方财富基金代码 */
  symbol: string;
  source: Source;
  /** 小标签（"10 月新上市""货币"……），没有是 '' */
  tag: string;
}

/** [日期 YYYY-MM-DD, 收盘价 / 单位净值, 复权价 / 累计净值]，按日期升序 */
export type Point = [date: string, close: number, adj: number];

export type ReturnPeriod = 'd1' | 'w1' | 'm1' | 'ytd' | 'y1';
export type DrawdownPeriod = 'w1' | 'm1' | 'ytd' | 'y1' | 'all';

export interface FundSnapshot {
  market: Market;
  category: Category;
  name: string;
  code: string;
  symbol: string;
  /** 这次实际用的来源（.SS 回退到东方财富时是 'eastmoney'） */
  source: Source;
  tag: string;
  currency: string | null;
  /** 最新收盘价 / 单位净值（不复权） */
  last: number;
  /** 最新一个点的日期 */
  date: string;
  /** 一共几个点 */
  points: number;
  d1: number | null;
  w1: number | null;
  m1: number | null;
  ytd: number | null;
  y1: number | null;
  dd_w1: number | null;
  dd_m1: number | null;
  dd_ytd: number | null;
  dd_y1: number | null;
  /** 手上这段（最多一年）第一个点到最后一个点的收益 */
  ret_all: number | null;
  /** 手上这段的最大回撤 */
  dd_all: number | null;
  /** 手上这段第一个点的日期 */
  first: string;
  /** [日期, 复权价]，给页面画走势和水下曲线 */
  series: [string, number][];
}

type Row = [Market, Category, string, string, 'y' | 'em', string];

// 顺序、名称、标签逐字照 fetch2.py 的 L（市场 → 类别）
// 第三版（Amos 2026-11-11「都按建议」，安全经理核对 Yahoo 条款）：中国 14 只场内 ETF 改走东方财富净值（'em'，不带 .SS），不再请求 Yahoo；
// 美国 15 只、新加坡 14 只仍走 Yahoo（Amos 知情保留，另有调研在找替代）
const L: Row[] = [
  ['新加坡', '宽基', 'SPDR 海峡时报指数 ETF', 'ES3.SI', 'y', ''],
  ['新加坡', '宽基', 'Amova-StraitsTrading 亚洲除日本 REIT ETF', 'CFA.SI', 'y', ''],
  ['新加坡', '宽基', 'Lion-OCBC 恒生科技 ETF', 'HST.SI', 'y', ''],
  ['新加坡', '宽基', 'Xtrackers 标普500 UCITS ETF', 'XUS.SI', 'y', '10 月新上市'],
  ['新加坡', '宽基', 'Xtrackers MSCI World UCITS ETF', 'XWR.SI', 'y', '10 月新上市'],
  ['新加坡', '债券', 'ABF 新加坡债券指数基金', 'A35.SI', 'y', ''],
  ['新加坡', '债券', 'Amova 新元投资级公司债 ETF', 'MBH.SI', 'y', ''],
  ['新加坡', '债券', 'Lion 短久期债券主动 ETF', 'SBO.SI', 'y', ''],
  ['新加坡', '债券', 'iShares 亚洲美元高收益债 ETF', 'O9P.SI', 'y', '美元'],
  ['新加坡', '债券', 'Amova 亚洲收益债券基金（原 Shenton Income）', '0P00006FY6.SI', 'y', '场外 · 推断对应'],
  ['新加坡', '红利', 'Lion-Phillip S-REIT ETF', 'CLR.SI', 'y', ''],
  ['新加坡', '红利', 'CSOP iEdge S-REIT 领袖 ETF', 'SRT.SI', 'y', ''],
  ['新加坡', '红利', 'Phillip SGX 亚太红利 REIT ETF', 'BYJ.SI', 'y', '替代 #13'],
  ['新加坡', '红利', 'UOBAM 平安富时东盟红利 ETF', 'UPD.SI', 'y', '1 月新上市'],
  ['美国', '宽基', 'Vanguard 标普500', 'VOO', 'y', ''],
  ['美国', '宽基', 'iShares 核心标普500', 'IVV', 'y', ''],
  ['美国', '宽基', 'SPDR 标普500', 'SPY', 'y', ''],
  ['美国', '宽基', 'Vanguard Morningstar 美国全市场', 'VTI', 'y', '7/29 改名'],
  ['美国', '宽基', 'Invesco 纳斯达克100', 'QQQ', 'y', ''],
  ['美国', '债券', 'iShares 美国综合债', 'AGG', 'y', ''],
  ['美国', '债券', 'Vanguard 全市场债', 'BND', 'y', ''],
  ['美国', '债券', 'iShares 20 年以上美债', 'TLT', 'y', ''],
  ['美国', '债券', 'Vanguard 短期债', 'BSV', 'y', ''],
  ['美国', '债券', 'iShares 投资级公司债', 'LQD', 'y', ''],
  ['美国', '红利', 'Vanguard 股息增值', 'VIG', 'y', ''],
  ['美国', '红利', 'Schwab 美国股息', 'SCHD', 'y', ''],
  ['美国', '红利', 'Vanguard 高股息', 'VYM', 'y', ''],
  ['美国', '红利', 'iShares 核心股息增长', 'DGRO', 'y', ''],
  ['美国', '红利', 'SPDR 标普股息', 'SDY', 'y', ''],
  ['中国', '宽基', '华泰柏瑞沪深300ETF', '510300', 'em', ''],
  ['中国', '宽基', '易方达沪深300ETF', '510310', 'em', ''],
  ['中国', '宽基', '华夏上证50ETF', '510050', 'em', ''],
  ['中国', '宽基', '南方中证500ETF', '510500', 'em', ''],
  ['中国', '宽基', '华夏科创50ETF', '588000', 'em', ''],
  ['中国', '债券', '华宝添益ETF', '511990', 'em', '货币'],
  ['中国', '债券', '银华日利ETF', '511880', 'em', '货币'],
  ['中国', '债券', '国泰上证5年期国债ETF', '511010', 'em', '原写的 511010'],
  ['中国', '债券', '海富通短融ETF', '511360', 'em', ''],
  ['中国', '债券', '易方达裕丰回报债券A', '000171', 'em', '场外 · 含少量股票'],
  ['中国', '债券', '招商安泰债券A', '217003', 'em', '场外'],
  ['中国', '红利', '华泰柏瑞红利ETF', '510880', 'em', ''],
  ['中国', '红利', '景顺长城红利低波100ETF', '515100', 'em', ''],
  ['中国', '红利', '招商中证红利ETF', '515080', 'em', ''],
  ['中国', '红利', '易方达中证红利ETF', '515180', 'em', ''],
  ['中国', '红利', '华宝标普A股红利ETF', '562060', 'em', ''],
];

export const FUNDS: FundDef[] = L.map(([market, category, name, sym, src, tag]) => ({
  market,
  category,
  name,
  code: sym.replace(/\.(SI|SS)$/, ''),
  symbol: sym,
  source: src === 'y' ? 'yahoo' : 'eastmoney',
  tag,
}));

/** 清洗后少于这么多点就算"Yahoo 丢了历史"（.SS 回退东方财富、2y 退 1y 都用这个数） */
export const MIN_POINTS = 30;

const DAY = 86_400_000;
const ms = (iso: string) => Date.parse(iso + 'T00:00:00Z');
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const asJson = (x: unknown): any => (typeof x === 'string' ? JSON.parse(x) : x);

/** Yahoo chart 接口（range=2y&interval=1d&events=div）的回包 → 币种 + 点（用 adjclose；日期 = timestamp + meta.gmtoffset 的那一天）。没有数据时 points 为空 */
export function parseYahoo(json: unknown): { currency: string | null; points: Point[] } {
  const j = asJson(json);
  const r = j?.chart?.result?.[0];
  if (!r) return { currency: null, points: [] };
  const m = r.meta ?? {};
  const off = Number(m.gmtoffset) || 0;
  const ts: unknown[] = Array.isArray(r.timestamp) ? r.timestamp : [];
  const close: unknown[] = r.indicators?.quote?.[0]?.close ?? [];
  const adjRaw: unknown[] | undefined = r.indicators?.adjclose?.[0]?.adjclose;
  const adj = Array.isArray(adjRaw) ? adjRaw : close;
  const byDate = new Map<string, Point>();
  ts.forEach((t, i) => {
    const c = close[i], a = adj[i];
    if (typeof t !== 'number' || typeof c !== 'number' || typeof a !== 'number' || !isFinite(c) || !isFinite(a) || a <= 0) return;
    const d = iso((t + off) * 1000);
    byDate.set(d, [d, c, a]); // 同一天出现两次（盘中那一条）留后一条
  });
  const points = [...byDate.values()].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  return { currency: typeof m.currency === 'string' ? m.currency : null, points };
}

/** 东方财富历史净值接口（f10/lsjz，每页 20 条）的若干页回包 → 点（close = 单位净值 DWJZ，adj = 累计净值 LJJZ），按日期升序、同一天只留一条 */
export function parseEastmoney(pages: unknown[]): Point[] {
  const byDate = new Map<string, Point>();
  for (const pg of pages ?? []) {
    const list = asJson(pg)?.Data?.LSJZList;
    if (!Array.isArray(list)) continue;
    for (const x of list) {
      const d = typeof x?.FSRQ === 'string' ? x.FSRQ : '';
      const c = parseFloat(x?.DWJZ), a = parseFloat(x?.LJJZ);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !isFinite(c) || !isFinite(a) || a <= 0) continue;
      byDate.set(d, [d, c, a]);
    }
  }
  return [...byDate.values()].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
}

/**
 * 第三版：东方财富 lsjz 的货币基金页（Data.SYType 是"每百份收益"/"每万份收益"，例如 511990 华宝添益）DWJZ 是当天收益、LJJZ 是 7 日年化，
 * **不是净值**，不能直接当 close / adj。这时按每天的收益连乘出一条"含收益的指数"：第一天 = 100，之后 × (1 + DWJZ / 10000)
 * （每百份收益 × 面值 100 元 = 每万元收益；每万份收益 × 面值 1 元 = 每万元收益，两种都是"每 1 万元当天赚多少"）。
 * 周末、节假日的收益会记在节后那一行（或单独几行），连乘不丢。不是货币基金页回 null。
 */
export function eastmoneyMoneyIndex(pages: unknown[]): Point[] | null {
  const rows = new Map<string, number>();
  let money = false;
  for (const pg of pages ?? []) {
    const d = asJson(pg)?.Data;
    if (typeof d?.SYType === 'string' && /每(百|万)份收益/.test(d.SYType)) money = true;
    for (const x of Array.isArray(d?.LSJZList) ? d.LSJZList : []) {
      const day = typeof x?.FSRQ === 'string' ? x.FSRQ : '';
      const inc = parseFloat(x?.DWJZ);
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && isFinite(inc) && inc >= 0 && inc < 100) rows.set(day, inc);
    }
  }
  if (!money) return null;
  const days = [...rows.keys()].sort();
  let v = 100;
  return days.map((day, i) => { if (i > 0) v *= 1 + rows.get(day)! / 10000; const r = Math.round(v * 1e6) / 1e6; return [day, r, r] as Point; });
}

/** 东方财富一页里最早的日期（判断翻到 400 天前没有）；这一页没数据回 null */
export function eastmoneyPageOldest(page: unknown): string | null {
  const list = asJson(page)?.Data?.LSJZList;
  if (!Array.isArray(list) || !list.length) return null;
  let min: string | null = null;
  for (const x of list) if (typeof x?.FSRQ === 'string' && (min === null || x.FSRQ < min)) min = x.FSRQ;
  return min;
}

/** 清洗：① 上市首日异常 ② 单日坏报价 ③ 只留最后一点往前 375 天内（见文件头） */
export function cleanPoints(points: Point[]): Point[] {
  let p = points.slice();
  while (p.length > 2 && Math.abs(p[1][2] / p[0][2] - 1) > 0.2) p = p.slice(1);
  p = p.filter((x, i) => {
    if (i === 0 || i === p.length - 1) return true;
    const a = p[i - 1][2], b = p[i + 1][2], v = x[2];
    const bad = Math.abs(v / a - 1) > 0.08 && Math.abs(v / b - 1) > 0.08 && (v - a) * (v - b) > 0;
    return !bad;
  });
  if (!p.length) return p;
  const cut = iso(ms(p[p.length - 1][0]) - 375 * DAY);
  return p.filter((x) => x[0] >= cut);
}

/** 某段时间的起点日期：w1 / m1 / y1 = 最后一天往前 7 / 30 / 365 天；ytd = 上年 12/31 */
function startOf(lastDate: string, period: Exclude<ReturnPeriod, 'd1'>): string {
  if (period === 'ytd') return `${Number(lastDate.slice(0, 4)) - 1}-12-31`;
  const days = { w1: 7, m1: 30, y1: 365 }[period];
  return iso(ms(lastDate) - days * DAY);
}

/** 基准点下标：日期 ≤ 起点的最后一个点；没有回 -1 */
function baseIndex(points: Point[], start: string): number {
  let b = -1;
  for (let i = 0; i < points.length; i++) if (points[i][0] <= start) b = i;
  return b;
}

const fix0 = (v: number) => (v === 0 ? 0 : v); // 不返回 -0

/** 各期收益（百分数）。d1 = 最后两点；其余按基准点算；历史不够长返回 null */
export function periodReturn(points: Point[], period: ReturnPeriod): number | null {
  if (!points || points.length < 2) return null;
  const last = points[points.length - 1];
  if (period === 'd1') return fix0((last[2] / points[points.length - 2][2] - 1) * 100);
  const b = baseIndex(points, startOf(last[0], period));
  if (b < 0) return null;
  return fix0((last[2] / points[b][2] - 1) * 100);
}

function ddOf(points: Point[]): number {
  let peak = points[0][2], worst = 0;
  for (const p of points) {
    if (p[2] > peak) peak = p[2];
    const r = p[2] / peak - 1;
    if (r < worst) worst = r;
  }
  return fix0(worst * 100);
}

/** 各期最大回撤（百分数，≤ 0）。'all' = 全部点；其余从基准点起算；历史不够长返回 null */
export function maxDrawdown(points: Point[], period: DrawdownPeriod): number | null {
  if (!points || !points.length) return null;
  if (period === 'all') return ddOf(points);
  const b = baseIndex(points, startOf(points[points.length - 1][0], period));
  if (b < 0) return null;
  return ddOf(points.slice(b));
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** 一只的快照（存进 D1、给页面用）。points 应该已经 cleanPoints 过；一个点都没有时抛错 */
export function summarize(def: FundDef, currency: string | null, points: Point[]): FundSnapshot {
  if (!points || !points.length) throw new Error('没有数据');
  const last = points[points.length - 1];
  return {
    market: def.market,
    category: def.category,
    name: def.name,
    code: def.code,
    symbol: def.symbol,
    source: def.source,
    tag: def.tag,
    currency,
    last: last[1],
    date: last[0],
    points: points.length,
    d1: periodReturn(points, 'd1'),
    w1: periodReturn(points, 'w1'),
    m1: periodReturn(points, 'm1'),
    ytd: periodReturn(points, 'ytd'),
    y1: periodReturn(points, 'y1'),
    dd_w1: maxDrawdown(points, 'w1'),
    dd_m1: maxDrawdown(points, 'm1'),
    dd_ytd: maxDrawdown(points, 'ytd'),
    dd_y1: maxDrawdown(points, 'y1'),
    ret_all: points.length >= 2 ? fix0((last[2] / points[0][2] - 1) * 100) : null,
    dd_all: maxDrawdown(points, 'all'),
    first: points[0][0],
    series: points.map((p) => [p[0], r6(p[2])] as [string, number]),
  };
}

// ---------------------------------------------------------------- 第二版：未来 1 个月的可能区间（Amos 2026-11-10「都按建议」）
/**
 * 口径：
 *   - 取最后一点往前 365 天内的点（价格用每个点的**最后一个数**：Point 是复权价 adj，快照里的 series 是 [日期, 复权价]，两种都能直接传）；
 *   - 每日对数收益 r_i = ln(P_i / P_{i-1})，日波动 σ = 样本标准差（除以 n−1）；**少于 40 个日收益不算**（返回 null，页面写"上市不满两个月，算不出"）；
 *   - h = σ·√21（21 个交易日约 1 个月）；区间（百分数）= exp(c ± h) − 1（约 2/3）、exp(c ± 1.96h) − 1（约 95%）；
 *   - c（center，对数、整段 21 天的中心）：股票类（宽基、红利）= 0；债券类 = ln(1 + 预期年化) / 12（预期年化见 src/funds-yield.ts）。
 * 只说明波动有多大，不是预测涨跌，不是投资建议。改口径先过 Amos。
 */
export const BAND_DAYS = 21;
/** 少于这么多个日收益不算区间 */
export const BAND_MIN_RETURNS = 40;

type PriceRow = readonly [string, ...number[]];
const priceOf = (p: PriceRow) => p[p.length - 1] as number;

/** 最后一点往前 365 天内的价格（升序） */
function yearPrices(points: readonly PriceRow[]): number[] {
  if (!points || !points.length) return [];
  const cut = iso(ms(points[points.length - 1][0]) - 365 * DAY);
  return points.filter((p) => p[0] >= cut).map(priceOf).filter((v) => typeof v === 'number' && isFinite(v) && v > 0);
}

/** 过去一年的日对数收益和 h = σ·√21；日收益不够 40 个回 null */
function bandBase(points: readonly PriceRow[]): { prices: number[]; h: number } | null {
  const prices = yearPrices(points);
  const n = prices.length - 1;
  if (n < BAND_MIN_RETURNS) return null;
  const rets: number[] = [];
  for (let i = 1; i < prices.length; i++) rets.push(Math.log(prices[i] / prices[i - 1]));
  const mean = rets.reduce((a, b) => a + b, 0) / n;
  const varc = rets.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1);
  return { prices, h: Math.sqrt(varc) * Math.sqrt(BAND_DAYS) };
}

/**
 * 未来 1 个月（21 个交易日）的可能区间，百分数：[约 95% 下沿, 约 2/3 下沿, 中心, 约 2/3 上沿, 约 95% 上沿]。
 * center 是对数中心 c（股票类 0；债券类 ln(1+预期年化)/12）。过去一年日收益少于 40 个返回 null。
 */
export function rangeBand(points: readonly PriceRow[], center = 0): [number, number, number, number, number] | null {
  const b = bandBase(points);
  if (!b) return null;
  const c = isFinite(center) ? center : 0;
  const at = (z: number) => fix0((Math.exp(c + z * b.h) - 1) * 100);
  return [at(-1.96), at(-1), at(0), at(1), at(1.96)];
}

/**
 * 回测：过去一年里每一段 21 个交易日（每天起一段，段与段重叠）的真实对数收益，落在 ±h（约 2/3 那段，中心按 0）里的比例，0～1。
 * σ 用同一年的数据（样本内）。日收益少于 40 个、或者一段都凑不出来返回 null。页面把各只的比例取平均写进说明。
 */
export function bandCoverage(points: readonly PriceRow[]): number | null {
  const b = bandBase(points);
  if (!b) return null;
  const p = b.prices;
  let inside = 0, total = 0;
  for (let i = 0; i + BAND_DAYS < p.length; i++) {
    const r = Math.log(p[i + BAND_DAYS] / p[i]);
    total++;
    if (Math.abs(r) <= b.h) inside++;
  }
  return total ? inside / total : null;
}

/** 债券类区间的对数中心：预期年化（百分数，例如 5.2）→ ln(1 + 5.2%) / 12；没有预期年化或不是有限数回 0 */
export function bondCenter(annualPct: number | null | undefined): number {
  if (typeof annualPct !== 'number' || !isFinite(annualPct) || annualPct <= -100) return 0;
  return Math.log(1 + annualPct / 100) / 12;
}
