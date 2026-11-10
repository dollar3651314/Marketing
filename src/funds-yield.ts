/**
 * 「基金观察」第二版：债券类 16 只的"未来 1～3 年预期年化"——配置 + 解析（**纯函数，不碰网络、不碰数据库**；取数在 src/funds-api.ts `refreshYields()`，
 * 存表 `fund_yield`（迁移 0018），页面在 src/funds-page.ts「债券类：未来 1～3 年预期年化」）。Amos 2026-11-10「都按建议」。
 *
 * 口径：
 *   - **每天自动 8 只**（任务原文写 9 只、近似 7 只，但逐只列出的是 8 + 8，按逐只列的做）：AGG、TLT、LQD（iShares 产品页 HTML 里的 JSON：反转义后取 label = "Average Yield to Maturity" / "Effective Duration" 那一项的 formattedValue）；
 *     BND、BSV（Vanguard 产品页 HTML 里的 JSON 字段 yieldToMaturity、yieldToMaturityDate、averageDuration）；
 *     O9P（BlackRock 新加坡产品页，去标签后匹配 "Weighted Avg YTM as of …" 和 "Effective Duration as of …"）；
 *     511990（东方财富 lsjz 的 LJJZ 就是 7 日年化）；511880（用单位净值 DWJZ 自算 (P_t / P_{t-7 天} − 1) × 365 / 7）。
 *   - **近似 8 只** = 同期限国债（每天自动取）+ 固定利差（下面的常量，写明来源和日期；**每季度人工校准一次**）：
 *     A35、MBH、0P00006FY6、SBO 用新加坡国债（MAS）；511010、511360、000171、217003 用中债国债收益率曲线。
 *   - **兜底**：iShares / Vanguard / BlackRock 页面取不到或解析失败（页面大，免费版每次请求 CPU 10ms 可能不够——未验证点，见《项目地图》），
 *     就退回"美国同期限国债 + 利差"近似并标"近似"；国债也没取到就保留上次的值并标"过期"，不显示 0。
 *   - 到期收益率是"现在买入、持有到期、不违约"的年化，扣费前；不是投资建议。
 */

export type YieldKind = 'auto' | 'approx';
export type YieldSource = 'ishares' | 'vanguard' | 'blackrock-sg' | 'em-7d' | 'em-nav' | 'sgs' | 'cgb';
export type Curve = 'ust' | 'sgs' | 'cgb';

export interface BondYieldDef {
  /** 页面上的代码（和 src/funds.ts FUNDS 的 code 一致） */
  code: string;
  kind: YieldKind;
  source: YieldSource;
  /** 自动取的那一页 / 接口（近似的没有） */
  url?: string;
  /** 页面上写的口径 */
  label: string;
  /** 近似（或兜底）用哪条国债曲线、取几年期（按久期，线性插值）、加多少利差（百分点） */
  curve?: Curve;
  tenor?: number;
  spread?: number;
  /** 利差从哪来、哪天算的 */
  spreadNote?: string;
  /** 久期（年）：自动的以页面为准，这里是近似 / 兜底时用的值；不知道写 null */
  duration: number | null;
}

/** 近似 / 兜底时页面写的曲线名 */
export const CURVE_NAME: Record<Curve, string> = { ust: '美国', sgs: '新加坡', cgb: '中债' };

/**
 * 16 只的配置（顺序 = src/funds.ts FUNDS 里债券类的顺序）。
 * 利差来源（2026-11-10 研发核算；**季度人工校准**，下次 2027-02）：
 *   - 美国兜底利差 = 页面 YTM − 美国财政部同一天、按久期插值的国债收益率（AGG 11/09 5.20 − 4.70；BND 11/06 5.2 − 4.68；TLT 11/06 5.32 − 5.07；
 *     LQD 11/06 5.91 − 4.77；BSV 11/06 4.8 − 4.56；O9P 11/09 8.30 − 4.54），四舍五入到 0.01。
 *   - A35 / MBH / 0P00006FY6：2026-09-30 月报加权 YTM 2.54 / 3.17 / 5.80 − 9/30 MAS 新加坡国债按久期插值（1/2/5/10 年 1.73/1.99/2.24/2.47）。
 *   - SBO：2 年新加坡国债 + 利差，以 2026-05-31 母基金 YTM 3.01 校准（5/29 是 5 月最后一个交易日，2 年 SGS 1.57）。
 *   - 中国 4 只：**利差是推断值，未用中债曲线核对**（本会话取中债接口时连接被重置）；第一次真刷新后对照基金季报人工校准。
 */
export const BOND_YIELDS: BondYieldDef[] = [
  { code: 'A35', kind: 'approx', source: 'sgs', label: '近似：新加坡 8 年国债 + 利差', curve: 'sgs', tenor: 8.2, spread: 0.15, spreadNote: '2026-09-30 月报加权 YTM 2.54 − 同日 8.2 年 SGS 2.39', duration: 8.18 },
  { code: 'MBH', kind: 'approx', source: 'sgs', label: '近似：新加坡 6 年国债 + 利差', curve: 'sgs', tenor: 5.8, spread: 0.89, spreadNote: '2026-09-30 月报加权 YTM 3.17 − 同日 5.8 年 SGS 2.28', duration: 5.76 },
  { code: 'SBO', kind: 'approx', source: 'sgs', label: '近似：新加坡 2 年国债 + 利差', curve: 'sgs', tenor: 2, spread: 1.44, spreadNote: '2026-05-31 母基金 YTM 3.01 − 5/29 2 年 SGS 1.57', duration: 2.5 },
  { code: 'O9P', kind: 'auto', source: 'blackrock-sg', url: 'https://www.blackrock.com/sg/en/products/251722/ishares-barclays-usd-asia-high-yield-bond-index-etf', label: '加权 YTM（美元）', curve: 'ust', tenor: 2.98, spread: 3.76, spreadNote: '2026-11-09 加权 YTM 8.30 − 同日 3 年美债 4.54', duration: 2.98 },
  { code: '0P00006FY6', kind: 'approx', source: 'sgs', label: '近似：新加坡 7 年国债 + 利差', curve: 'sgs', tenor: 6.8, spread: 3.48, spreadNote: '2026-09-30 月报加权 YTM 5.80 − 同日 6.8 年 SGS 2.32', duration: 6.75 },
  { code: 'AGG', kind: 'auto', source: 'ishares', url: 'https://www.ishares.com/us/products/239458/ishares-core-total-us-bond-market-etf', label: 'YTM', curve: 'ust', tenor: 5.73, spread: 0.5, spreadNote: '2026-11-09 YTM 5.20 − 同日 5.7 年美债 4.70', duration: 5.73 },
  { code: 'BND', kind: 'auto', source: 'vanguard', url: 'https://investor.vanguard.com/investment-products/etfs/profile/bnd', label: 'YTM', curve: 'ust', tenor: 5.7, spread: 0.53, spreadNote: '2026-11-06 YTM 5.2 − 同日 5.7 年美债 4.68', duration: 5.7 },
  { code: 'TLT', kind: 'auto', source: 'ishares', url: 'https://www.ishares.com/us/products/239454/ishares-20-year-treasury-bond-etf', label: 'YTM', curve: 'ust', tenor: 14.9, spread: 0.25, spreadNote: '2026-11-06 YTM 5.32 − 同日 14.9 年美债 5.07', duration: 14.9 },
  { code: 'BSV', kind: 'auto', source: 'vanguard', url: 'https://investor.vanguard.com/investment-products/etfs/profile/bsv', label: 'YTM', curve: 'ust', tenor: 2.6, spread: 0.24, spreadNote: '2026-11-06 YTM 4.8 − 同日 2.6 年美债 4.56', duration: 2.6 },
  { code: 'LQD', kind: 'auto', source: 'ishares', url: 'https://www.ishares.com/us/products/239566/ishares-iboxx-investment-grade-corporate-bond-etf', label: 'YTM', curve: 'ust', tenor: 7.67, spread: 1.14, spreadNote: '2026-11-06 YTM 5.91 − 同日 7.7 年美债 4.77', duration: 7.67 },
  { code: '511990', kind: 'auto', source: 'em-7d', url: 'https://api.fund.eastmoney.com/f10/lsjz?fundCode=511990&pageIndex=1&pageSize=20', label: '7 日年化', duration: 0.1 },
  { code: '511880', kind: 'auto', source: 'em-nav', url: 'https://api.fund.eastmoney.com/f10/lsjz?fundCode=511880&pageIndex=1&pageSize=20', label: '7 日年化（按净值算）', duration: 0.1 },
  { code: '511010', kind: 'approx', source: 'cgb', label: '近似：中债 5 年国债', curve: 'cgb', tenor: 5, spread: 0, spreadNote: '跟踪上证 5 年期国债指数，不加利差', duration: 4.3 },
  { code: '511360', kind: 'approx', source: 'cgb', label: '近似：中债 1 年 + 短融利差', curve: 'cgb', tenor: 1, spread: 0.3, spreadNote: '推断：AAA 短融相对 1 年国债约 0.3 个百分点（2026-11-10，未核对，季度校准）', duration: 0.8 },
  { code: '000171', kind: 'approx', source: 'cgb', label: '近似：中债 3 年 + 信用利差（另有约 14% 股票）', curve: 'cgb', tenor: 3, spread: 0.6, spreadNote: '推断：中高等级信用债相对 3 年国债约 0.6 个百分点（2026-11-10，未核对，季度校准）；约 14% 股票不在这个数里', duration: null },
  { code: '217003', kind: 'approx', source: 'cgb', label: '近似：中债 3 年 + 信用利差', curve: 'cgb', tenor: 3, spread: 0.6, spreadNote: '推断：同 000171（2026-11-10，未核对，季度校准）', duration: null },
];

/** 一只解析出来的到期收益率（百分数）、久期（年，没有 null）、数据日期 YYYY-MM-DD */
export interface ParsedYield { ytm: number; duration: number | null; asOf: string }
/** 一条国债曲线：{期限（年）: 收益率（百分数）, asOf} */
export type CurvePoints = { asOf: string; [tenorYears: number]: number };

const MON: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
const isoOk = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z')) ? s : '');
/** 各种日期写法 → YYYY-MM-DD：20261109、11/09/2026、Nov 09, 2026、09-Nov-2026、2026-11-09；认不出回 '' */
export function toIso(raw: unknown): string {
  const s = String(raw ?? '').trim();
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) return isoOk(`${m[1]}-${m[2]}-${m[3]}`);
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return isoOk(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) return isoOk(`${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`);
  if ((m = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})$/.exec(s)) && MON[m[1].toLowerCase()]) return isoOk(`${m[3]}-${MON[m[1].toLowerCase()]}-${m[2].padStart(2, '0')}`);
  if ((m = /^(\d{1,2})[- ]([A-Za-z]{3})[a-z]*[- ](\d{4})$/.exec(s)) && MON[m[2].toLowerCase()]) return isoOk(`${m[3]}-${MON[m[2].toLowerCase()]}-${m[1].padStart(2, '0')}`);
  return '';
}

/** HTML 实体反转义（只处理页面 JSON 里会出现的几种：&quot; &#34; &#39; &amp; &lt; &gt; &#xNN; &#NN;） */
export function unescapeHtml(s: string): string {
  return s.replace(/&(quot|amp|lt|gt|apos|nbsp|#\d+|#x[0-9a-f]+);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k === 'quot') return '"';
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'apos') return "'";
    if (k === 'nbsp') return ' ';
    const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
  });
}

const num = (s: unknown): number | null => {
  const v = parseFloat(String(s ?? '').replace(/[,%\s]/g, ''));
  return isFinite(v) ? v : null;
};
const sane = (ytm: number | null) => ytm !== null && ytm > -5 && ytm < 50;

/**
 * 在一大段 HTML 里找某个 label（页面 JSON 是转义过的：&quot;label&quot;:&quot;…&quot;），只把它前面那一小段反转义后读 formattedValue / asOfDate。
 * 为了省 CPU（iShares 的页面约 2MB），不把整页反转义。
 */
function isharesItem(html: string, label: string): { value: number | null; asOf: string } | null {
  const pats = [`"label":"${label}"`, `&quot;label&quot;:&quot;${label}&quot;`, `&#34;label&#34;:&#34;${label}&#34;`];
  for (const p of pats) {
    let from = 0;
    for (let k = 0; k < 20; k++) {
      const i = html.indexOf(p, from);
      if (i < 0) break;
      from = i + p.length;
      const seg = unescapeHtml(html.slice(Math.max(0, i - 1500), i + p.length));
      // 同一个对象里 label 前面依次是 asOfDate、formattedAsOfDate、formattedValue；取离 label 最近的那一个
      const fv = [...seg.matchAll(/"formattedValue":"([^"]*)"/g)].pop();
      if (!fv) continue;
      const v = num(fv[1]);
      if (v === null) continue;
      const ad = [...seg.matchAll(/"asOfDate":"?(\d{8})"?/g)].pop();
      const fad = [...seg.matchAll(/"formattedAsOfDate":"([^"]*)"/g)].pop();
      return { value: v, asOf: toIso(ad?.[1]) || toIso(fad?.[1]) };
    }
  }
  return null;
}

/** iShares 美国产品页（AGG / TLT / LQD）→ 到期收益率、有效久期、数据日期；认不出回 null */
export function parseIshares(html: string): ParsedYield | null {
  if (typeof html !== 'string' || !html) return null;
  const y = isharesItem(html, 'Average Yield to Maturity') ?? isharesItem(html, 'Yield to Maturity') ?? isharesItem(html, 'Weighted Avg YTM');
  if (!y || !sane(y.value) || !y.asOf) return null;
  const d = isharesItem(html, 'Effective Duration');
  return { ytm: y.value!, duration: d && d.value !== null && d.value > 0 ? d.value : null, asOf: y.asOf };
}

/** 在转义过 / 没转义的 JSON 文本里找第一个 "key":"value"（Vanguard 页面用 &#34;） */
function jsonField(html: string, key: string): string | null {
  for (const q of ['"', '&#34;', '&quot;']) {
    const p = `${q}${key}${q}:${q}`;
    const i = html.indexOf(p);
    if (i < 0) continue;
    const s = i + p.length;
    const e = html.indexOf(q, s);
    if (e < 0 || e - s > 80) continue;
    return unescapeHtml(html.slice(s, e));
  }
  return null;
}

/** Vanguard 产品页（BND / BSV）→ yieldToMaturity、yieldToMaturityDate、averageDuration（第一处是基金本身，后面的是基准指数）；认不出回 null */
export function parseVanguard(html: string): ParsedYield | null {
  if (typeof html !== 'string' || !html) return null;
  const ytm = num(jsonField(html, 'yieldToMaturity'));
  const asOf = toIso(jsonField(html, 'yieldToMaturityDate'));
  if (!sane(ytm) || !asOf) return null;
  const dur = num(jsonField(html, 'averageDuration'));
  return { ytm: ytm!, duration: dur !== null && dur > 0 ? dur : null, asOf };
}

/** 去掉标签、反转义、合并空白 */
function textOf(htmlPart: string): string {
  return unescapeHtml(htmlPart.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
}

/** BlackRock 新加坡产品页（O9P）→ "Weighted Avg YTM as of 09-Nov-2026 8.30%"、"Effective Duration as of … 2.98"；认不出回 null */
export function parseBlackrockSg(html: string): ParsedYield | null {
  if (typeof html !== 'string' || !html) return null;
  // 只处理关键词附近一段（页面约 1MB，整页去标签太费 CPU）
  const i = html.indexOf('Weighted Avg YTM');
  if (i < 0) return null;
  const t = textOf(html.slice(i, i + 6000));
  const y = /Weighted Avg YTM as of (\d{1,2}[- ][A-Za-z]{3}[- ]\d{4}) (-?[\d.]+)\s*%/.exec(t);
  if (!y) return null;
  const ytm = num(y[2]), asOf = toIso(y[1]);
  if (!sane(ytm) || !asOf) return null;
  const d = /Effective Duration as of \d{1,2}[- ][A-Za-z]{3}[- ]\d{4} (-?[\d.]+)/.exec(t);
  const dur = d ? num(d[1]) : null;
  return { ytm: ytm!, duration: dur !== null && dur > 0 ? dur : null, asOf };
}

/** 期限文字 → 年：「1 Mo」「1.5 Month」「6 Mo」「2 Yr」「10-Year」「3-Month」；认不出回 null */
function tenorOf(label: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*-?\s*(mo|month|yr|year)/i.exec(label);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return /^mo/i.test(m[2]) ? Math.round((v / 12) * 10000) / 10000 : v;
}

/** 美国财政部日收益率曲线 CSV（Date,"1 Mo",…,"30 Yr"，最新一天在最上面）→ 最新一天的曲线；认不出回 null */
export function parseTreasuryCsv(csv: string): CurvePoints | null {
  if (typeof csv !== 'string' || !csv.trim()) return null;
  const lines = csv.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (lines.length < 2) return null;
  const head = lines[0].split(',').map((x) => x.replace(/"/g, '').trim());
  if (!/date/i.test(head[0])) return null;
  const tenors = head.map((h, i) => (i ? tenorOf(h) : null));
  let best: CurvePoints | null = null;
  for (const l of lines.slice(1)) {
    const c = l.split(',').map((x) => x.replace(/"/g, '').trim());
    const asOf = toIso(c[0]);
    if (!asOf || (best && asOf <= best.asOf)) continue;
    const curve: CurvePoints = { asOf };
    let n = 0;
    tenors.forEach((t, i) => { const v = num(c[i]); if (t !== null && v !== null && c[i] !== '') { curve[t] = v; n++; } });
    if (n >= 2) best = curve;
  }
  return best;
}

/** MAS「Benchmark Prices and Yields」日频结果表（年、月只写在每段第一行）→ 最后一个有数的那天的曲线；认不出回 null */
export function parseMasHtml(html: string): CurvePoints | null {
  if (typeof html !== 'string' || !html) return null;
  const ti = html.indexOf('results-table');
  const tab = ti >= 0 ? html.slice(ti, html.indexOf('</table>', ti) + 8) : (/<table[\s\S]*?<\/table>/i.exec(html)?.[0] ?? '');
  if (!tab) return null;
  const rows = [...tab.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((m) => m[0]);
  if (!rows.length) return null;
  const ths = [...rows[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => textOf(m[1]));
  if (!ths.length) return null;
  // 第一格"End of Period"占 3 列（年、月、日），后面每格是一个期限
  const tenors: (number | null)[] = [null, null, null, ...ths.slice(1).map((h) => (/yield/i.test(h) ? tenorOf(h) : null))];
  let year = '', mon = '', best: CurvePoints | null = null;
  for (const r of rows.slice(1)) {
    const tds = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => textOf(m[1]).trim());
    if (tds.length < 4) continue;
    if (tds[0]) year = tds[0];
    if (tds[1]) mon = tds[1];
    const asOf = toIso(`${tds[2]}-${mon}-${year}`);
    if (!asOf) continue;
    const curve: CurvePoints = { asOf };
    let n = 0;
    tenors.forEach((t, i) => { const v = num(tds[i]); if (t !== null && v !== null) { curve[t] = v; n++; } });
    if (n && (!best || asOf >= best.asOf)) best = curve;
  }
  return best;
}

/**
 * 中债收益率曲线接口（cbweb-mn/yc/searchYc）的回包 → 曲线。回包形状（未在本会话实测，见《项目地图》未验证点）：
 * 数组（或带数组的对象），每项有 seriesData: [[期限, 收益率], …] 和日期（worktime / workTime 之类）。没日期时用 fallbackDate。认不出回 null。
 */
export function parseChinabond(json: unknown, fallbackDate = ''): CurvePoints | null {
  let j: unknown = json;
  if (typeof j === 'string') { try { j = JSON.parse(j); } catch { return null; } }
  const items: unknown[] = Array.isArray(j) ? j : j && typeof j === 'object' ? Object.values(j as Record<string, unknown>).flatMap((v) => (Array.isArray(v) ? v : [v])) : [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    const sd = o.seriesData;
    if (!Array.isArray(sd) || !sd.length) continue;
    let asOf = '';
    for (const k of ['worktime', 'workTime', 'workTimes', 'date', 'ycDate']) if (!asOf && typeof o[k] === 'string') asOf = toIso(String(o[k]).slice(0, 10));
    asOf = asOf || toIso(fallbackDate);
    if (!asOf) continue;
    const curve: CurvePoints = { asOf };
    let n = 0;
    for (const p of sd) {
      if (!Array.isArray(p) || p.length < 2) continue;
      const t = num(p[0]), v = num(p[1]);
      if (t === null || v === null || t < 0 || t > 50) continue;
      curve[Math.round(t * 100) / 100] = v;
      n++;
    }
    if (n >= 2) return curve;
  }
  return null;
}

/** 曲线上某个期限的收益率：两头之间线性插值，超出两头取最近那头；曲线是空的回 null */
export function curveAt(curve: CurvePoints | null | undefined, tenor: number): number | null {
  if (!curve) return null;
  const pts = Object.keys(curve).filter((k) => k !== 'asOf').map(Number).filter((t) => isFinite(t) && isFinite(curve[t])).sort((a, b) => a - b);
  if (!pts.length) return null;
  if (tenor <= pts[0]) return curve[pts[0]];
  if (tenor >= pts[pts.length - 1]) return curve[pts[pts.length - 1]];
  for (let i = 1; i < pts.length; i++) {
    if (tenor <= pts[i]) {
      const a = pts[i - 1], b = pts[i];
      return curve[a] + ((tenor - a) / (b - a)) * (curve[b] - curve[a]);
    }
  }
  return null;
}

/** 东方财富 lsjz 回包里的行（按日期降序） */
function emRows(json: unknown): { d: string; dw: number | null; lj: number | null }[] {
  let j: unknown = json;
  if (typeof j === 'string') { try { j = JSON.parse(j); } catch { return []; } }
  const list = (j as { Data?: { LSJZList?: unknown } } | null)?.Data?.LSJZList;
  if (!Array.isArray(list)) return [];
  return list
    .map((x: Record<string, unknown>) => ({ d: toIso(x?.FSRQ), dw: num(x?.DWJZ), lj: num(x?.LJJZ) }))
    .filter((x) => x.d)
    .sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
}

/** 511990：东方财富 lsjz 最新一行的 LJJZ 就是 7 日年化（%）；认不出回 null */
export function parseEm7d(json: unknown): ParsedYield | null {
  const r = emRows(json).find((x) => x.lj !== null);
  if (!r || !sane(r.lj)) return null;
  return { ytm: r.lj!, duration: null, asOf: r.d };
}

/** 511880：用单位净值自算 7 日年化 = (P_t / P_{t−7 天} − 1) × 365 / 7（P_{t−7 天} = 日期 ≤ 最新日期 − 7 天的最近一行）；认不出回 null */
export function parseEmNav(json: unknown): ParsedYield | null {
  const rows = emRows(json).filter((x) => x.dw !== null && x.dw > 0);
  if (rows.length < 2) return null;
  const last = rows[0];
  const cut = new Date(Date.parse(last.d + 'T00:00:00Z') - 7 * 86_400_000).toISOString().slice(0, 10);
  const base = rows.find((x) => x.d <= cut);
  if (!base) return null;
  const v = (last.dw! / base.dw! - 1) * (365 / 7) * 100;
  if (!sane(v)) return null;
  return { ytm: Math.round(v * 10000) / 10000, duration: null, asOf: last.d };
}

/** 存进 fund_yield、GET /api/funds 里每只债券带的 yield（stale 在读的时候算） */
export interface BondYield {
  /** 预期年化（百分数） */
  value: number;
  kind: YieldKind;
  /** 口径（YTM / 加权 YTM / 7 日年化 / 近似说明） */
  label: string;
  duration: number | null;
  asOf: string;
  /** 来源名（iShares、Vanguard、BlackRock、东方财富、MAS、美国财政部、中债） */
  source: string;
}

const SRC_NAME: Record<YieldSource, string> = { ishares: 'iShares', vanguard: 'Vanguard', 'blackrock-sg': 'BlackRock', 'em-7d': '东方财富', 'em-nav': '东方财富', sgs: 'MAS', cgb: '中债' };
const CURVE_SRC: Record<Curve, string> = { ust: '美国财政部', sgs: 'MAS', cgb: '中债' };
const r2 = (v: number) => Math.round(v * 100) / 100;

/** 按曲线 + 利差算近似值；fallback = 自动的那几只页面没取到、退回美国国债近似时写明原因 */
export function approxYield(def: BondYieldDef, curves: Partial<Record<Curve, CurvePoints | null>>, fallback = false): BondYield | null {
  if (!def.curve || def.tenor === undefined || def.spread === undefined) return null;
  const c = curves[def.curve];
  const base = curveAt(c, def.tenor);
  if (base === null || !c) return null;
  const yrs = def.tenor >= 1 ? `${Math.round(def.tenor)} 年` : `${Math.round(def.tenor * 12)} 个月`;
  const label = fallback || def.kind === 'auto'
    ? `近似：${CURVE_NAME[def.curve]} ${yrs}国债 ${r2(base).toFixed(2)}% + 利差（${SRC_NAME[def.source]}页面这次没取到）`
    : def.label.includes(' + ') ? def.label.replace(' + ', ` ${r2(base).toFixed(2)}% + `) : `${def.label} ${r2(base).toFixed(2)}%`;
  return { value: r2(base + def.spread), kind: 'approx', label, duration: def.duration, asOf: c.asOf, source: CURVE_SRC[def.curve] };
}

/** 自动取到的值 → BondYield */
export function autoYield(def: BondYieldDef, p: ParsedYield): BondYield {
  return { value: r2(p.ytm), kind: 'auto', label: def.label, duration: p.duration ?? def.duration, asOf: p.asOf, source: SRC_NAME[def.source] };
}
