/**
 * 「基金观察」估值板块的"参考：导入的历史"（Amos 2026-11-12：D1～D4、I1、I3 都按建议）——纯计算（**不碰网络、不碰数据库**；存取在 src/funds-api.ts，页面在 src/funds-page.ts）。
 *
 * 导入文件（Claude 整理后发给 Amos，由他在页面上点「导入估值历史」上传；**数据不进仓库**——仓库公开，第三方数据不能转载）：
 *   { asOf: 'YYYY-MM-DD', indexes: [{ code, name, funds: string[], source, basis, series: { pe?: [['YYYY-MM', 值]…], pb?: […], dy?: […] },
 *                                     seriesMeta?: { pe?: { source, basis }, … }, alternates?: […] }] }
 *   校验（parseImport）：整个文件 ≤ 2MB（接口里量）；code 必须是基金观察 45 只之一（FUNDS 的 code）；日期 YYYY-MM；数值有限正数；每个序列 ≤ 600 点、月份不重复。
 *   有一项不对就整只跳过（skipped 里写原因），别的照样导入。alternates（对照用的别的口径）不存、不显示。
 *
 * 显示（impCard，GET /api/funds 的 val_import 每只一项）：
 *   选指标：市盈率 ≥ 36 个点、且最后一点离导入文件的 asOf 不超过 12 个月 → pe；否则股息率 ≥ 24 个点 → dy；都不够 → metric = null，只显示当前值（不比贵贱）。
 *   百分位 = 最近 120 点里**低于**现在的点所占的百分比（四舍五入到整数，和 Amos 审过的原型 v4 一致）；
 *   "贵的程度" expensive：pe = 百分位；dy = 100 − 百分位（股息率越低越贵）。不足 120 点时 short = true（页面写"上市以来"）。
 *   proxy：选用指标的口径写着"代理"或"自算"。source_tag：选用指标的来源是蛋卷 →"来源：蛋卷，口径未公开"；
 *     来源按 seriesMeta[指标].source 判断；没有 seriesMeta 时看 basis 里"指标=…"那一段有没有写蛋卷，source 只有一个来源时直接看它；判断不了就不加标签。
 */
import { FUNDS, type Market } from './funds';

/** 导入文件最多多大（字节） */
export const IMP_MAX_BYTES = 2 * 1024 * 1024;
/** 每个序列最多几个点 */
export const IMP_MAX_POINTS = 600;
/** 百分位用最近几个点 */
export const IMP_WIN = 120;
/** 市盈率至少几个点才比贵贱 */
export const IMP_PE_MIN = 36;
/** 股息率至少几个点才比贵贱 */
export const IMP_DY_MIN = 24;
/** 市盈率最后一点离 asOf 最多几个月 */
export const IMP_PE_RECENT = 12;
/** 来源是蛋卷时的标签 */
export const DJ_TAG = '来源：蛋卷，口径未公开';

export type ImpMetric = 'pe' | 'pb' | 'dy';
const METRICS: ImpMetric[] = ['pe', 'pb', 'dy'];
const TEXT_MAX = 2000;

/** 存进 fund_val_import.data 的一只 */
export interface ImpStored {
  name: string;
  funds: string[];
  source: string;
  basis: string;
  /** 导入文件的 asOf（YYYY-MM-DD） */
  as_of: string;
  series: Partial<Record<ImpMetric, [string, number][]>>;
  meta?: Partial<Record<ImpMetric, { source?: string; basis?: string }>>;
}

export interface ImpParsed {
  ok: { code: string; stored: ImpStored }[];
  skipped: { code: string; reason: string }[];
}

const isMonth = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const str = (v: unknown, max = TEXT_MAX) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const CODES = new Set(FUNDS.map((f) => f.code));

/** 校验导入文件。整个文件不对（不是对象、没有 indexes）回 { error }；单只不对进 skipped */
export function parseImport(body: unknown, today: string): ImpParsed | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: '文件格式不对：要是 {asOf, indexes:[…]} 这样的 JSON' };
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.indexes)) return { error: '文件格式不对：没有 indexes 列表' };
  if (b.indexes.length > 200) return { error: `文件里的指数太多（${b.indexes.length} 个），一次最多 200 个` };
  const asOf = typeof b.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.asOf) ? b.asOf : today;
  const out: ImpParsed = { ok: [], skipped: [] };
  const seen = new Set<string>();
  b.indexes.forEach((raw, i) => {
    const x = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
    const code = typeof x.code === 'string' ? x.code.trim().slice(0, 20) : '';
    const skip = (reason: string) => out.skipped.push({ code: code || `第 ${i + 1} 项`, reason });
    if (!code) return skip('没有 code');
    if (!CODES.has(code)) return skip('不在基金观察 45 只里');
    if (seen.has(code)) return skip('文件里重复出现，只导入第一次的');
    seen.add(code);
    const name = str(x.name, 80);
    if (!name) return skip('没有名字');
    const funds = Array.isArray(x.funds) ? x.funds.filter((f): f is string => typeof f === 'string' && !!f.trim()).map((f) => f.trim().slice(0, 20)).slice(0, 10) : [];
    const s = x.series;
    if (!s || typeof s !== 'object' || Array.isArray(s)) return skip('没有 series');
    const series: ImpStored['series'] = {};
    for (const m of METRICS) {
      const arr = (s as Record<string, unknown>)[m];
      if (arr == null) continue;
      if (!Array.isArray(arr)) return skip(`${m} 不是列表`);
      if (arr.length > IMP_MAX_POINTS) return skip(`${m} 有 ${arr.length} 个点，最多 ${IMP_MAX_POINTS}`);
      const pts: [string, number][] = [];
      const months = new Set<string>();
      for (let k = 0; k < arr.length; k++) {
        const p = arr[k];
        if (!Array.isArray(p) || p.length < 2) return skip(`${m} 第 ${k + 1} 个点格式不对（要 [YYYY-MM, 数值]）`);
        if (!isMonth(p[0])) return skip(`${m} 第 ${k + 1} 个点日期不是 YYYY-MM`);
        if (typeof p[1] !== 'number' || !Number.isFinite(p[1]) || p[1] <= 0) return skip(`${m} 第 ${k + 1} 个点的值不是正数`);
        if (months.has(p[0])) return skip(`${m} 的 ${p[0]} 出现了两次`);
        months.add(p[0]);
        pts.push([p[0], p[1]]);
      }
      if (pts.length) series[m] = pts.sort((a, c) => (a[0] < c[0] ? -1 : 1));
    }
    if (!Object.keys(series).length) return skip('没有数据点');
    const meta: NonNullable<ImpStored['meta']> = {};
    const sm = x.seriesMeta;
    if (sm && typeof sm === 'object' && !Array.isArray(sm)) {
      for (const m of METRICS) {
        const v = (sm as Record<string, unknown>)[m];
        if (!v || typeof v !== 'object') continue;
        const o = v as Record<string, unknown>;
        const e = { ...(str(o.source) ? { source: str(o.source) } : {}), ...(str(o.basis) ? { basis: str(o.basis) } : {}) };
        if (Object.keys(e).length) meta[m] = e;
      }
    }
    out.ok.push({ code, stored: { name, funds: funds.length ? funds : [code], source: str(x.source), basis: str(x.basis), as_of: asOf, series, ...(Object.keys(meta).length ? { meta } : {}) } });
  });
  return out;
}

/** "a=…；b=…" 里 m= 那一段（口径文字里自己也可能有"；"，所以只在"；pe=""；pb=""；dy="前面切） */
export function basisOf(basis: string, m: ImpMetric): string {
  const parts = basis.split(/[；;]\s*(?=(?:pe|pb|dy)\s*=)/);
  const hit = parts.find((p) => new RegExp(`^\\s*${m}\\s*=`).test(p));
  if (hit) return hit.replace(/^\s*\w+\s*=\s*/, '');
  // 只有一段、没写"指标="：就是它
  return parts.length === 1 && !/^\s*(?:pe|pb|dy)\s*=/.test(parts[0]) ? parts[0] : '';
}

const DJ = /蛋卷|danjuan/i;
/** 选用指标的来源是不是蛋卷：true / false；判断不了是 null */
export function isDanjuan(st: ImpStored, m: ImpMetric): boolean | null {
  const ms = st.meta?.[m]?.source;
  if (ms) return DJ.test(ms);
  const b = st.meta?.[m]?.basis || basisOf(st.basis, m);
  if (b && DJ.test(b)) return true;
  const srcs = st.source.split(/[；;]/).map((s) => s.trim()).filter(Boolean);
  if (srcs.length <= 1) return DJ.test(st.source);
  if (!srcs.some((s) => DJ.test(s))) return false;
  return null;
}

const monthIdx = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

export interface ImpCard {
  code: string;
  name: string;
  funds: string[];
  market: Market | null;
  /** 选用的指标；null = 历史不够，只显示当前值 */
  metric: 'pe' | 'dy' | null;
  /** metric 为 null 时显示的那个指标（有点的里面最新的） */
  shown: ImpMetric;
  now: number;
  date: string;
  /** 这个指标一共几个点 */
  points: number;
  /** 百分位（最近 120 点里低于现在的占比，整数）；metric 为 null 时没有 */
  pct?: number;
  /** 贵的程度（0～100）：pe = pct，dy = 100 − pct */
  expensive?: number;
  median?: number;
  /** 窗口里几个点、起止月份 */
  n?: number;
  start?: string;
  end?: string;
  /** 不足 120 点（"上市以来"） */
  short?: boolean;
  proxy: boolean;
  source_tag: string | null;
  /** 选用指标的来源 / 口径原文（页面放在 title 里） */
  source: string;
  basis: string;
  /** 最近 120 点 */
  series: [string, number][];
  as_of: string;
  imported_at: string | null;
}

/** 一只导入的历史 → 页面小卡 */
export function impCard(code: string, st: ImpStored, importedAt: number | null): ImpCard {
  const S = st.series;
  const pe = S.pe ?? [], dy = S.dy ?? [];
  const asM = monthIdx(st.as_of.slice(0, 7));
  let metric: ImpCard['metric'] = null;
  if (pe.length >= IMP_PE_MIN && asM - monthIdx(pe[pe.length - 1][0]) <= IMP_PE_RECENT) metric = 'pe';
  else if (dy.length >= IMP_DY_MIN) metric = 'dy';
  // 不够比的：显示有点的指标里最后日期最新的那个（同一天先 dy 后 pe 再 pb）
  const lastOf = (m: ImpMetric) => { const a = S[m] ?? []; return a.length ? a[a.length - 1][0] : ''; };
  let shown: ImpMetric = metric ?? 'dy';
  if (!metric) for (const m of ['dy', 'pe', 'pb'] as ImpMetric[]) if (lastOf(m) > lastOf(shown)) shown = m;
  const all = S[shown] ?? [];
  const last = all[all.length - 1];
  const basis = st.meta?.[shown]?.basis || basisOf(st.basis, shown);
  const source = st.meta?.[shown]?.source || (st.source.split(/[；;]/).length <= 1 ? st.source : '');
  const card: ImpCard = {
    code, name: st.name, funds: st.funds, market: FUNDS.find((f) => f.code === code)?.market ?? null,
    metric, shown, now: last[1], date: last[0], points: all.length,
    proxy: /代理|自算/.test(basis), source_tag: isDanjuan(st, shown) ? DJ_TAG : null, source, basis,
    series: [], as_of: st.as_of, imported_at: importedAt ? new Date(importedAt).toISOString() : null,
  };
  if (!metric) return card;
  const win = all.slice(-IMP_WIN);
  const vals = win.map((p) => p[1]);
  const pct = Math.round((vals.filter((v) => v < last[1]).length / vals.length) * 100);
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { ...card, pct, expensive: metric === 'dy' ? 100 - pct : pct, median: r4(median), n: win.length, start: win[0][0], end: last[0], short: win.length < IMP_WIN, series: win };
}
