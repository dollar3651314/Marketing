/**
 * 「基金观察」第四版 ② 估值：纯计算 + 解析（**不碰网络、不碰数据库**；取数在 src/funds-api.ts refreshValuation()，页面在 src/funds-page.ts）。
 *
 * 口径照 Amos 11/11 审过的原型（基金观察原型-v3.html）和参考脚本 valuation2/scripts/calc.py：
 *   - 6 个指数、11 只基金：沪深300（510300、510310）、上证50（510050）、中证500（510500）、上证红利（510880）、中证红利（515080、515180）、
 *     标普500（VOO、IVV、SPY、XUS，用 Shiller CAPE）。
 *   - A 股市盈率 = 中证 index-perf 的字段 peg（**口径官方没有写明**，页面注明）；股息率 = 中证 <代码>indicator.xls 的「股息率1（总股本）D/P1」那一列最新一天。
 *   - 标普500 = Shiller ie_data.xls「Data」表的 CAPE（P/E10，实际值）；股息率 = 最近有 D 的那个月 D / P。
 *   - 月末取样：每月最后一个有值的交易日（当月取到最新一天）；窗口 = 最近 120 个月；分位 = 窗口里 ≤ 当前值的月份占比；中位数、最低、最高。
 *   - 两种长期（10 年）预期年化（**推断、不是预测、不是投资建议、两种口径不能直接比较**）：
 *       盈利收益率法 a = 1 / 市盈率（标普用 1 / CAPE，是扣通胀的实际值）；
 *       分红 + 增长法 b = 股息率 + 盈利增长假设（A 股 5%、美国 4%）+ ((中位数 / 当前)^(1/10) − 1)（名义值）。
 *   改口径先过 Amos。
 *
 * xls 解析：中证 indicator.xls（约 8KB）和 Shiller ie_data.xls（约 1.6MB）都是老的 BIFF8（OLE2 复合文档）。Worker 里没有现成库，
 * 这里自己读：复合文档只找 Workbook 这一个流；BIFF 只认取值要用的几种记录（共享字符串表、数字、RK、MULRK、字符串、公式的缓存结果），
 * 只读要的那一张表、只留前 maxCol 列。不支持 BIFF5 / xlsx（认不出就报"认不出"，不猜）。
 */

export type ValMarket = '中国' | '美国';
export interface ValIndexDef {
  /** 指数代码（中证）；标普500 用 'SPX' */
  code: string;
  name: string;
  /** 对应的基金代码（页面上的代码） */
  funds: string[];
  market: ValMarket;
  src: 'csindex' | 'shiller';
}

export const VAL_INDEXES: ValIndexDef[] = [
  { code: '000300', name: '沪深300', funds: ['510300', '510310'], market: '中国', src: 'csindex' },
  { code: '000016', name: '上证50', funds: ['510050'], market: '中国', src: 'csindex' },
  { code: '000905', name: '中证500', funds: ['510500'], market: '中国', src: 'csindex' },
  { code: '000015', name: '上证红利', funds: ['510880'], market: '中国', src: 'csindex' },
  { code: '000922', name: '中证红利', funds: ['515080', '515180'], market: '中国', src: 'csindex' },
  { code: 'SPX', name: '标普500', funds: ['VOO', 'IVV', 'SPY', 'XUS'], market: '美国', src: 'shiller' },
];

/** 分位、中位数用的窗口（月） */
export const VAL_WINDOW = 120;
/** 存多少个月（比窗口多留一点） */
export const VAL_KEEP = 130;
/** 少于这么多个月不算分位（页面写"历史不够"） */
export const VAL_MIN_MONTHS = 24;
/** 盈利增长假设（名义） */
export const GROWTH: Record<ValMarket, number> = { 中国: 0.05, 美国: 0.04 };

/** 存进 fund_valuation.data 的内容 */
export interface ValStored {
  code: string;
  /** [YYYY-MM, 市盈率]，月末取样，升序，最多 VAL_KEEP 个月 */
  series: [string, number][];
  /** 当前市盈率（A 股：最新一个交易日的 peg；标普：最新一个月的 CAPE） */
  pe_now: number;
  /** 当前值的日期（A 股 YYYY-MM-DD；标普 YYYY-MM） */
  pe_now_date: string;
  /** 股息率（百分数，3.03 = 3.03%）；没取到过是 null */
  dy_now: number | null;
  dy_date: string | null;
  /** 只有标普500：上次成功下载并解析过的 ie_data.xls 链接（第五版：下次直接请求它，失败再回退首页找） */
  xls_url?: string;
  /** 只有标普500：哪个月（UTC+8 的 YYYY-MM）重新看过、Shiller 还没更新（页面那个月注明"Shiller 本月还没更新"） */
  stale_month?: string;
}

/** GET /api/funds 里 valuation.items 的一张卡（字段名照调研的 val.json，测试会话 test/funds-v4-valuation.test.ts 按这些名字比） */
export interface ValCard {
  code: string;
  name: string;
  funds: string[];
  market: ValMarket;
  /** 'PE'（中证 peg）或 'CAPE' */
  metric: 'PE' | 'CAPE';
  /** 来源（页面上写的） */
  source: string;
  pe_now: number;
  pe_now_date: string;
  /** 窗口里 ≤ 当前值的月份占比（0～100，1 位小数）；历史不够是 null */
  pe_pct10y: number | null;
  pe_median10y: number;
  pe_min10y: number;
  pe_max10y: number;
  /** 窗口里实际有几个月 */
  n_months: number;
  dy_now: number | null;
  dy_date: string | null;
  /** 盈利收益率法（百分数，2 位小数） */
  exp_a: number;
  /** 分红 + 增长法（百分数，2 位小数）；没有股息率是 null */
  exp_b: number | null;
  /** 窗口里的序列 [YYYY-MM, 值]（画 10 年走势） */
  pe_series: [string, number][];
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** 中位数（偶数个取中间两个的平均，和 Python statistics.median 一样） */
export function median(a: number[]): number {
  const s = a.slice().sort((x, y) => x - y);
  const n = s.length;
  if (!n) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** 日序列 [YYYY-MM-DD, 值]（任意顺序）→ 月末取样 [YYYY-MM, 值]（每月最后一个有值的日子），升序 */
export function monthEnds(daily: [string, number][]): [string, number][] {
  const by = new Map<string, [string, number]>();
  for (const [d, v] of daily) {
    const ym = d.slice(0, 7);
    const cur = by.get(ym);
    if (!cur || d > cur[0]) by.set(ym, [d, v]);
  }
  return [...by.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([ym, [, v]]) => [ym, r2(v)] as [string, number]);
}

/** 旧的月序列 + 新的月序列：同一个月以新的为准；升序；只留最后 keep 个月 */
export function mergeMonths(old: [string, number][], fresh: [string, number][], keep = VAL_KEEP): [string, number][] {
  const by = new Map<string, number>();
  for (const [m, v] of old) by.set(m, v);
  for (const [m, v] of fresh) by.set(m, v);
  return [...by.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-keep) as [string, number][];
}

/** 存的值 → 一张卡（分位、中位数、预期年化现算） */
export function valCard(def: ValIndexDef, st: ValStored): ValCard | null {
  const win = (st.series ?? []).filter((x) => Array.isArray(x) && typeof x[1] === 'number' && isFinite(x[1]) && x[1] > 0).slice(-VAL_WINDOW);
  if (!win.length || !(st.pe_now > 0)) return null;
  const vals = win.map((x) => x[1]);
  const now = st.pe_now;
  const med = r2(median(vals));
  const pct = win.length >= VAL_MIN_MONTHS ? Math.round((vals.filter((v) => v <= now).length / vals.length) * 1000) / 10 : null;
  const dy = typeof st.dy_now === 'number' && isFinite(st.dy_now) ? st.dy_now : null;
  const ea = 100 / now;
  const eb = dy === null ? null : (dy / 100 + GROWTH[def.market] + (Math.pow(med / now, 0.1) - 1)) * 100;
  return {
    code: def.code, name: def.name, funds: def.funds, market: def.market,
    metric: def.src === 'shiller' ? 'CAPE' : 'PE',
    source: def.src === 'shiller' ? 'Robert Shiller（shillerdata.com）' : '中证指数有限公司（官网）',
    pe_now: r2(now), pe_now_date: st.pe_now_date, pe_pct10y: pct, pe_median10y: med, pe_min10y: r2(Math.min(...vals)), pe_max10y: r2(Math.max(...vals)), n_months: win.length,
    dy_now: dy, dy_date: st.dy_date, exp_a: r2(ea), exp_b: eb === null ? null : r2(eb), pe_series: win,
  };
}

// ---------------------------------------------------------------- 中证 index-perf（JSON）
/** 中证 index-perf 回包 → 日序列 [YYYY-MM-DD, peg]（peg 为空的跳过）；认不出回 null */
export function parseCsPerf(body: unknown): [string, number][] | null {
  const b = body as { code?: unknown; data?: unknown } | null;
  if (!b || !Array.isArray(b.data)) return null;
  const out: [string, number][] = [];
  for (const r of b.data as Record<string, unknown>[]) {
    const d = typeof r?.tradeDate === 'string' ? r.tradeDate : '';
    const v = typeof r?.peg === 'number' ? r.peg : typeof r?.peg === 'string' ? Number(r.peg) : NaN;
    if (!/^\d{8}$/.test(d) || !isFinite(v) || v <= 0) continue;
    out.push([`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, v]);
  }
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

// ---------------------------------------------------------------- xls（OLE2 复合文档 + BIFF8）
export type XlsCell = string | number;
export interface XlsSheet { name: string; rows: Map<number, XlsCell[]> }

const ENDS = 0xfffffffa; // ≥ 这个的都是特殊扇区号（结束、空闲、FAT、DIFAT）

/** 复合文档里取一个流（按名字，不分大小写）；认不出回 null */
export function cfbStream(buf: Uint8Array, name: string): Uint8Array | null {
  if (buf.length < 1024) return null;
  const SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (SIG.some((b, i) => buf[i] !== b)) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const ss = 1 << dv.getUint16(0x1e, true);
  if (ss !== 512 && ss !== 4096) return null;
  const mss = 1 << dv.getUint16(0x20, true);
  const nFat = dv.getUint32(0x2c, true), dir0 = dv.getUint32(0x30, true), cutoff = dv.getUint32(0x38, true);
  const mfat0 = dv.getUint32(0x3c, true), difat0 = dv.getUint32(0x44, true), nDifat = dv.getUint32(0x48, true);
  const maxSect = Math.floor(buf.length / ss); // 扇区号上限（循环硬上限用）
  const off = (s: number) => (s + 1) * ss;
  const fatSects: number[] = [];
  for (let i = 0; i < 109 && fatSects.length < nFat; i++) { const v = dv.getUint32(0x4c + 4 * i, true); if (v >= ENDS) break; fatSects.push(v); }
  for (let d = difat0, k = 0; fatSects.length < nFat && d < ENDS && k <= nDifat; k++) {
    const o = off(d);
    if (o + ss > buf.length) return null;
    for (let i = 0; i < ss / 4 - 1 && fatSects.length < nFat; i++) { const v = dv.getUint32(o + 4 * i, true); if (v < ENDS) fatSects.push(v); }
    d = dv.getUint32(o + ss - 4, true);
  }
  const per = ss / 4;
  const fat = new Uint32Array(fatSects.length * per);
  for (let k = 0; k < fatSects.length; k++) {
    const o = off(fatSects[k]);
    if (o + ss > buf.length) return null;
    for (let i = 0; i < per; i++) fat[k * per + i] = dv.getUint32(o + 4 * i, true);
  }
  const chain = (start: number, table: Uint32Array, limit: number): number[] | null => {
    const out: number[] = [];
    for (let s = start; s < ENDS; s = table[s]) { if (s >= table.length || out.length > limit) return null; out.push(s); }
    return out;
  };
  const readChain = (start: number, size: number): Uint8Array | null => {
    const c = chain(start, fat, maxSect);
    if (!c) return null;
    const out = new Uint8Array(Math.min(size, c.length * ss));
    let p = 0;
    for (const s of c) {
      if (p >= out.length) break;
      const o = off(s), take = Math.min(ss, out.length - p);
      if (o + take > buf.length) return null;
      out.set(buf.subarray(o, o + take), p);
      p += take;
    }
    return out;
  };
  const dirChain = chain(dir0, fat, maxSect);
  if (!dirChain) return null;
  const dir = readChain(dir0, dirChain.length * ss);
  if (!dir) return null;
  const ddv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  let root: { start: number; size: number } | null = null, hit: { start: number; size: number } | null = null;
  for (let e = 0; e + 128 <= dir.length; e += 128) {
    const type = dir[e + 0x42];
    if (type !== 2 && type !== 5) continue;
    const nl = Math.min(64, ddv.getUint16(e + 0x40, true));
    let nm = '';
    for (let i = 0; i + 2 < nl; i += 2) nm += String.fromCharCode(ddv.getUint16(e + i, true));
    const ent = { start: ddv.getUint32(e + 0x74, true), size: ddv.getUint32(e + 0x78, true) };
    if (type === 5) root = ent;
    else if (nm.toLowerCase() === name.toLowerCase()) hit = ent;
  }
  if (!hit) return null;
  if (hit.size >= cutoff) return readChain(hit.start, hit.size);
  // 小流：在根目录的 mini stream 里，按 MiniFAT 走
  if (!root) return null;
  const ministream = readChain(root.start, root.size);
  const mfc = chain(mfat0, fat, maxSect);
  if (!ministream || !mfc) return null;
  const mfat = new Uint32Array(mfc.length * per);
  for (let k = 0; k < mfc.length; k++) { const o = off(mfc[k]); if (o + ss > buf.length) return null; for (let i = 0; i < per; i++) mfat[k * per + i] = dv.getUint32(o + 4 * i, true); }
  const mc = chain(hit.start, mfat, Math.ceil(ministream.length / mss));
  if (!mc) return null;
  const out = new Uint8Array(hit.size);
  let p = 0;
  for (const s of mc) {
    if (p >= out.length) break;
    const o = s * mss, take = Math.min(mss, out.length - p);
    if (o + take > ministream.length) return null;
    out.set(ministream.subarray(o, o + take), p);
    p += take;
  }
  return out;
}

/** 跨 CONTINUE 记录读共享字符串表 */
class Segs {
  si = 0;
  pos = 0;
  private segs: Uint8Array[];
  constructor(segs: Uint8Array[]) { this.segs = segs; }
  private ensure(): boolean { while (this.si < this.segs.length && this.pos >= this.segs[this.si].length) { this.si++; this.pos = 0; } return this.si < this.segs.length; }
  u8(): number { if (!this.ensure()) throw new Error('eof'); return this.segs[this.si][this.pos++]; }
  u16(): number { return this.u8() | (this.u8() << 8); }
  u32(): number { return (this.u16() | (this.u16() << 16)) >>> 0; }
  skip(n: number) { for (let i = 0; i < n; i++) this.u8(); }
  /** n 个字符；跨到下一段时那一段开头有一个新的标志字节（只决定后面是单字节还是双字节） */
  chars(n: number, high: boolean): string {
    let s = '';
    while (n > 0) {
      if (this.pos >= this.segs[this.si]?.length) {
        this.si++; this.pos = 0;
        if (this.si >= this.segs.length) throw new Error('eof');
        high = (this.segs[this.si][this.pos++] & 1) === 1;
      }
      const seg = this.segs[this.si];
      while (n > 0 && this.pos < seg.length) {
        if (high) { if (this.pos + 1 >= seg.length) { this.pos = seg.length; break; } s += String.fromCharCode(seg[this.pos] | (seg[this.pos + 1] << 8)); this.pos += 2; } else { s += String.fromCharCode(seg[this.pos]); this.pos += 1; }
        n--;
      }
    }
    return s;
  }
}

function parseSst(segs: Uint8Array[]): string[] {
  const r = new Segs(segs);
  const out: string[] = [];
  try {
    r.u32();
    const n = r.u32();
    for (let i = 0; i < n; i++) {
      const cch = r.u16(), fl = r.u8();
      const runs = fl & 0x08 ? r.u16() : 0;
      const ext = fl & 0x04 ? r.u32() : 0;
      out.push(r.chars(cch, (fl & 1) === 1));
      r.skip(runs * 4 + ext);
    }
  } catch { /* 表尾坏了：已经读出来的照用 */ }
  return out;
}

function rk(dv: DataView, o: number): number {
  const v = dv.getInt32(o, true);
  let x: number;
  if (v & 2) x = v >> 2;
  else { const t = new DataView(new ArrayBuffer(8)); t.setUint32(4, (v & 0xfffffffc) >>> 0, true); x = t.getFloat64(0, true); }
  return v & 1 ? x / 100 : x;
}

/** 短字符串（BOUNDSHEET 里的表名）：cch u8 + 标志 + 字符 */
function shortStr(b: Uint8Array, o: number): string {
  const n = b[o], high = (b[o + 1] & 1) === 1;
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(high ? b[o + 2 + 2 * i] | (b[o + 3 + 2 * i] << 8) : b[o + 2 + i]);
  return s;
}
/** XLUnicodeString（LABEL、STRING 记录）：cch u16 + 标志 + 字符 */
function longStr(b: Uint8Array, o: number): string {
  const n = b[o] | (b[o + 1] << 8), high = (b[o + 2] & 1) === 1;
  let s = '';
  for (let i = 0; i < n && o + 3 + i < b.length; i++) s += String.fromCharCode(high ? b[o + 3 + 2 * i] | (b[o + 4 + 2 * i] << 8) : b[o + 3 + i]);
  return s;
}

/** 工作簿全局部分：每张表的名字和在流里的起点、共享字符串表；不是 BIFF8 回 null */
export function xlsGlobals(wb: Uint8Array): { sheets: { name: string; pos: number }[]; sst: string[] } | null {
  if (wb.length < 8) return null;
  const dv = new DataView(wb.buffer, wb.byteOffset, wb.byteLength);
  if (dv.getUint16(0, true) !== 0x0809 || dv.getUint16(4, true) !== 0x0600) return null; // 只认 BIFF8
  const sheets: { name: string; pos: number }[] = [];
  const sstSegs: Uint8Array[] = [];
  let p = 0, inSst = false, guard = 0;
  while (p + 4 <= wb.length && guard++ < wb.length / 4 + 10) {
    const t = dv.getUint16(p, true), len = dv.getUint16(p + 2, true), d = p + 4;
    if (d + len > wb.length) break;
    if (t === 0x0085) { sheets.push({ pos: dv.getUint32(d, true), name: shortStr(wb, d + 6) }); inSst = false; }
    else if (t === 0x00fc) { sstSegs.push(wb.subarray(d, d + len)); inSst = true; }
    else if (t === 0x003c && inSst) sstSegs.push(wb.subarray(d, d + len));
    else inSst = false;
    p = d + len;
    if (t === 0x000a) break; // 全局部分结束
  }
  return { sheets, sst: sstSegs.length ? parseSst(sstSegs) : [] };
}

/**
 * 从流里的 pos 往后逐条读一张表的单元格（buf 是从流的第 base 字节开始的一段，可以只是一部分）。
 * 读到表尾（EOF）、或下一条记录的起点到了 stopAt、或这段字节里放不下下一条完整记录就停。返回停下的位置（流里的绝对位置）和是不是到了表尾。
 * pending：公式的字符串结果在下一条 STRING 记录里（跨段时由调用方带着）。
 */
export function xlsWalk(buf: Uint8Array, base: number, pos: number, stopAt: number, sst: string[], onCell: (r: number, c: number, v: XlsCell) => void, pending: { cell: [number, number] | null } = { cell: null }): { pos: number; eof: boolean } {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let q = pos - base, g = 0;
  while (q + 4 <= buf.length && base + q < stopAt && g++ < buf.length / 4 + 10) {
    const t = dv.getUint16(q, true), len = dv.getUint16(q + 2, true), d = q + 4;
    if (d + len > buf.length) break; // 这条记录跨出了这段：留给下一步
    if (t === 0x0203 && len >= 14) onCell(dv.getUint16(d, true), dv.getUint16(d + 2, true), dv.getFloat64(d + 6, true));
    else if (t === 0x027e && len >= 10) onCell(dv.getUint16(d, true), dv.getUint16(d + 2, true), rk(dv, d + 6));
    else if (t === 0x00bd && len >= 6) {
      const r = dv.getUint16(d, true), c0 = dv.getUint16(d + 2, true), n = (len - 6) / 6;
      for (let k = 0; k < n; k++) onCell(r, c0 + k, rk(dv, d + 4 + 6 * k + 2));
    } else if (t === 0x00fd && len >= 10) { const s = sst[dv.getUint32(d + 6, true)]; if (s !== undefined) onCell(dv.getUint16(d, true), dv.getUint16(d + 2, true), s); }
    else if (t === 0x0204 && len >= 9) onCell(dv.getUint16(d, true), dv.getUint16(d + 2, true), longStr(buf, d + 6));
    else if (t === 0x0006 && len >= 20) {
      const r = dv.getUint16(d, true), c = dv.getUint16(d + 2, true);
      if (dv.getUint16(d + 12, true) === 0xffff) { if (buf[d + 6] === 0) pending.cell = [r, c]; } // 0 = 字符串结果，在下一条 STRING 记录里；布尔 / 错误 / 空不要
      else onCell(r, c, dv.getFloat64(d + 6, true));
    } else if (t === 0x0207 && pending.cell) { onCell(pending.cell[0], pending.cell[1], longStr(buf, d)); pending.cell = null; }
    q = d + len;
    if (t === 0x000a) return { pos: base + q, eof: true };
  }
  return { pos: base + q, eof: false };
}

/**
 * 读 BIFF8 工作簿里的表（一次读完；中证 indicator.xls 这种小文件用）。pick(表名, 序号) 为 true 的才读；每张表只留前 maxCol 列。认不出回 null。
 */
export function readXls(file: Uint8Array, pick: (name: string, i: number) => boolean = () => true, maxCol = 32): XlsSheet[] | null {
  const wb = cfbStream(file, 'Workbook');
  const g = wb ? xlsGlobals(wb) : null;
  if (!wb || !g) return null;
  const out: XlsSheet[] = [];
  g.sheets.forEach((sh, si) => {
    if (!pick(sh.name, si)) return;
    const rows = new Map<number, XlsCell[]>();
    xlsWalk(wb, 0, sh.pos, wb.length, g.sst, (r, c, v) => { if (c >= maxCol) return; let a = rows.get(r); if (!a) rows.set(r, (a = [])); a[c] = v; });
    out.push({ name: sh.name, rows });
  });
  return out;
}

// ---------------------------------------------------------------- 中证 indicator.xls
/** 中证 <代码>indicator.xls → 最新一天的「股息率1（总股本）D/P1」；认不出回 null */
export function parseCsIndicator(file: Uint8Array): { dy: number; date: string } | null {
  const sh = readXls(file, (_n, i) => i === 0, 16)?.[0];
  if (!sh) return null;
  let col = -1, dcol = 0, head = -1;
  for (const [r, cells] of sh.rows) {
    const i = cells.findIndex((c) => typeof c === 'string' && /D\/P1|股息率1/.test(c));
    if (i >= 0) { col = i; head = r; const j = cells.findIndex((c) => typeof c === 'string' && /日期|Date/.test(c)); if (j >= 0) dcol = j; break; }
  }
  if (col < 0) return null;
  let best: { dy: number; date: string } | null = null;
  for (const [r, cells] of sh.rows) {
    if (r <= head) continue;
    const raw = cells[dcol], v = cells[col];
    const ds = typeof raw === 'number' ? String(Math.round(raw)) : String(raw ?? '').trim();
    const num = typeof v === 'number' ? v : Number(v);
    if (!/^\d{8}$/.test(ds) || !isFinite(num) || num <= 0) continue;
    const date = `${ds.slice(0, 4)}-${ds.slice(4, 6)}-${ds.slice(6, 8)}`;
    if (!best || date > best.date) best = { dy: num, date };
  }
  return best;
}

// ---------------------------------------------------------------- Shiller
/** shillerdata.com 首页 → 当前 ie_data.xls 的下载地址（只认 https，主机只认 shillerdata.com 和它的文件托管 wsimg.com）；找不到回 null */
export function shillerXlsUrl(html: string): string | null {
  const m = /href\s*=\s*["']([^"']*ie_data\.xls[^"']*)["']/i.exec(html);
  if (!m) return null;
  let u = m[1].replace(/&amp;/g, '&').trim();
  if (u.startsWith('//')) u = 'https:' + u;
  else if (u.startsWith('/')) u = 'https://shillerdata.com' + u;
  let url: URL;
  try { url = new URL(u); } catch { return null; }
  const h = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || !(h === 'shillerdata.com' || h.endsWith('.shillerdata.com') || h.endsWith('.wsimg.com'))) return null;
  return url.toString();
}

/**
 * Shiller「Data」表**分步解析**（Amos 11/11：「表格太大无法单次解析完成，可以分开成多个小文档，多次解析」）：
 * 状态可以 JSON 存进 D1，每一步只读一段字节（xlsWalk），按行累积；只留最近 keep 个月的 CAPE 和最近一个有 D 的月份。
 */
export interface ShillerState {
  /** 表头所在行和 P / D / CAPE 在第几列；还没读到表头是 null */
  head: { row: number; cP: number; cD: number; cCape: number } | null;
  /** 正在读的那一行（一行的单元格可能跨两步） */
  row: number;
  cells: Record<number, XlsCell>;
  cape: [string, number][];
  dy: number | null;
  dyDate: string | null;
  keep: number;
}
export const shillerInit = (keep = VAL_KEEP): ShillerState => ({ head: null, row: -1, cells: {}, cape: [], dy: null, dyDate: null, keep });
/** 一行读完：表头行定列；数据行（第一列是 1871.01 这种年月）记 CAPE、D / P */
function shillerRow(st: ShillerState) {
  const cells = st.cells;
  st.cells = {};
  if (st.row < 0) return;
  if (!st.head) {
    const t = (c: number) => (typeof cells[c] === 'string' ? (cells[c] as string).trim() : '');
    const cols = Object.keys(cells).map(Number);
    const find = (name: string) => cols.find((c) => t(c) === name) ?? -1;
    if (t(0) === 'Date' && find('CAPE') >= 0 && find('P') >= 0) st.head = { row: st.row, cP: find('P'), cD: find('D'), cCape: find('CAPE') };
    return;
  }
  const x = cells[0];
  if (typeof x !== 'number' || x < 1800 || x > 3000) return;
  const y = Math.floor(x), mo = Math.round((x - y) * 100);
  if (mo < 1 || mo > 12) return;
  const ym = `${y}-${String(mo).padStart(2, '0')}`;
  const c = cells[st.head.cCape], P = cells[st.head.cP], D = st.head.cD >= 0 ? cells[st.head.cD] : undefined;
  if (typeof c === 'number' && isFinite(c) && c > 0) { st.cape.push([ym, r2(c)]); if (st.cape.length > st.keep) st.cape.splice(0, st.cape.length - st.keep); }
  if (typeof D === 'number' && typeof P === 'number' && D > 0 && P > 0) { st.dy = r2((D / P) * 100); st.dyDate = ym; }
}
/** 往状态里喂一个单元格（只留前 16 列） */
export function shillerCell(st: ShillerState, r: number, c: number, v: XlsCell) {
  if (c >= 16) return;
  if (r !== st.row) { shillerRow(st); st.row = r; }
  st.cells[c] = v;
}
/** 表读完：收最后一行，出结果；认不出回 null */
export function shillerDone(st: ShillerState): { series: [string, number][]; dy: number | null; dyDate: string | null } | null {
  shillerRow(st);
  st.row = -1;
  if (!st.head || !st.cape.length) return null;
  return { series: st.cape.slice(-st.keep), dy: st.dy, dyDate: st.dyDate };
}
/** 工作簿流 → Data 表的起点和共享字符串表（分步解析的第一步） */
export function shillerLocate(wb: Uint8Array): { pos: number; sst: string[] } | null {
  const g = xlsGlobals(wb);
  const sh = g?.sheets.find((x) => x.name.trim().toLowerCase() === 'data');
  return g && sh ? { pos: sh.pos, sst: g.sst } : null;
}

/** 一次解析完（测试和本地核对用；线上是 refreshValuation 分步调上面那几个） */
export function parseShiller(file: Uint8Array, keep = VAL_KEEP): { series: [string, number][]; dy: number | null; dyDate: string | null } | null {
  const wb = cfbStream(file, 'Workbook');
  const loc = wb ? shillerLocate(wb) : null;
  if (!wb || !loc) return null;
  const st = shillerInit(keep);
  const w = xlsWalk(wb, 0, loc.pos, wb.length, loc.sst, (r, c, v) => shillerCell(st, r, c, v));
  return w.eof ? shillerDone(st) : null;
}
