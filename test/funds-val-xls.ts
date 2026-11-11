/**
 * 测试用：拼一个最小的 BIFF8 .xls（OLE2 复合文档），给 src/funds-val.ts 的 xls 解析用（不把中证 / Shiller 的真文件放进仓库：只本人看、不转载）。
 * 支持：共享字符串表（可以在某个字符串中间切到 CONTINUE 记录）、LABELSST、NUMBER、RK、MULRK、FORMULA（数字结果 / 字符串结果 + STRING）。
 * small = true 时流放进 mini stream（< 4096 字节，中证 indicator.xls 就是这样），否则放普通扇区。
 */
export type TCell = string | number | { rk: number } | { f: number } | { fs: string };
export interface TSheet { name: string; rows: [number, TCell[]][] }

const rec = (t: number, data: number[]) => [t & 255, t >> 8, data.length & 255, data.length >> 8, ...data];
const u16 = (v: number) => [v & 255, (v >> 8) & 255];
const u32 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
const f64 = (v: number) => { const b = new DataView(new ArrayBuffer(8)); b.setFloat64(0, v, true); return [...new Uint8Array(b.buffer)]; };
const wide = (s: string) => [...s].some((c) => c.charCodeAt(0) > 255);
const chars = (s: string, w: boolean) => (w ? [...s].flatMap((c) => u16(c.charCodeAt(0))) : [...s].map((c) => c.charCodeAt(0)));

/** RK：整数（×4 + 2）或 ×100 的整数（+3） */
function rkOf(v: number): number {
  if (Number.isInteger(v)) return ((v << 2) | 2) >>> 0;
  const h = Math.round(v * 100);
  return ((h << 2) | 3) >>> 0;
}

export function buildXls(sheets: TSheet[], opts: { small?: boolean; splitSstAt?: number } = {}): Uint8Array {
  // 共享字符串表
  const strs: string[] = [];
  const idx = (s: string) => { let i = strs.indexOf(s); if (i < 0) { strs.push(s); i = strs.length - 1; } return i; };
  for (const sh of sheets) for (const [, cells] of sh.rows) for (const c of cells) if (typeof c === 'string') idx(c);
  // SST 正文：每个字符串 cch + flags + chars；splitSstAt = 在第几个字节切（会落在某个字符串的字符中间时，CONTINUE 开头补一个标志字节）
  const parts: { head: number[]; body: number[]; w: boolean }[] = strs.map((s) => ({ head: [...u16(s.length), wide(s) ? 1 : 0], body: chars(s, wide(s)), w: wide(s) }));
  let sst = [...u32(strs.length), ...u32(strs.length)];
  const recs: number[][] = [];
  if (opts.splitSstAt === undefined) {
    for (const p of parts) sst.push(...p.head, ...p.body);
    recs.push(rec(0x00fc, sst));
  } else {
    let cur = sst, cut = false;
    for (const p of parts) {
      cur.push(...p.head);
      if (!cut && cur.length + p.body.length > opts.splitSstAt) {
        // 在字符中间切（宽字符按 2 字节对齐）
        let k = Math.max(0, opts.splitSstAt - cur.length);
        if (p.w && k % 2) k--;
        cur.push(...p.body.slice(0, k));
        recs.push(rec(0x00fc, cur));
        cur = [p.w ? 1 : 0, ...p.body.slice(k)];
        cut = true;
      } else cur.push(...p.body);
    }
    recs.push(rec(cut ? 0x003c : 0x00fc, cur));
  }
  const bof = (dt: number) => rec(0x0809, [...u16(0x0600), ...u16(dt), ...new Array(12).fill(0)]);
  const eof = rec(0x000a, []);
  // 先算全局部分长度（BOUNDSHEET 里要写表的偏移）
  const bsLen = (n: string) => 4 + 6 + 2 + n.length * (wide(n) ? 2 : 1);
  const globalsLen = bof(5).length + sheets.reduce((a, s) => a + bsLen(s.name), 0) + recs.reduce((a, r) => a + r.length, 0) + eof.length;
  const sheetBytes: number[][] = sheets.map((sh) => {
    const out: number[] = [...bof(0x10)];
    for (const [r, cells] of sh.rows) {
      cells.forEach((c, col) => {
        if (c === undefined || c === null) return;
        if (typeof c === 'string') out.push(...rec(0x00fd, [...u16(r), ...u16(col), 0, 0, ...u32(idx(c))]));
        else if (typeof c === 'number') out.push(...rec(0x0203, [...u16(r), ...u16(col), 0, 0, ...f64(c)]));
        else if ('rk' in c) out.push(...rec(0x027e, [...u16(r), ...u16(col), 0, 0, ...u32(rkOf(c.rk))]));
        else if ('f' in c) out.push(...rec(0x0006, [...u16(r), ...u16(col), 0, 0, ...f64(c.f), 0, 0, 0, 0, 0, 0]));
        else { out.push(...rec(0x0006, [...u16(r), ...u16(col), 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 0, 0, 0, 0, 0, 0])); out.push(...rec(0x0207, [...u16(c.fs.length), wide(c.fs) ? 1 : 0, ...chars(c.fs, wide(c.fs))])); }
      });
    }
    out.push(...eof);
    return out;
  });
  let pos = globalsLen;
  const bs: number[] = [];
  sheets.forEach((sh, i) => { bs.push(...rec(0x0085, [...u32(pos), 0, 0, sh.name.length, wide(sh.name) ? 1 : 0, ...chars(sh.name, wide(sh.name))])); pos += sheetBytes[i].length; });
  const wb = [...bof(5), ...bs, ...recs.flat(), ...eof, ...sheetBytes.flat()];
  return cfb(new Uint8Array(wb), !!opts.small);
}

/** 复合文档：small → mini stream；否则普通扇区（不够 4096 补 0 到 4096） */
function cfb(stream: Uint8Array, small: boolean): Uint8Array {
  const SS = 512, END = 0xfffffffe, FREE = 0xffffffff, FATS = 0xfffffffd;
  let data = stream;
  if (!small && data.length < 4096) { const d = new Uint8Array(4096); d.set(data); data = d; }
  if (small && data.length >= 4096) throw new Error('small 只能放 < 4096 字节');
  const head = new Uint8Array(SS);
  const hv = new DataView(head.buffer);
  [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].forEach((b, i) => (head[i] = b));
  hv.setUint16(0x18, 0x3e, true); hv.setUint16(0x1a, 3, true); hv.setUint16(0x1c, 0xfffe, true);
  hv.setUint16(0x1e, 9, true); hv.setUint16(0x20, 6, true);
  hv.setUint32(0x2c, 1, true); hv.setUint32(0x30, 1, true); hv.setUint32(0x38, 4096, true);
  hv.setUint32(0x44, END, true); hv.setUint32(0x48, 0, true);
  for (let i = 0; i < 109; i++) hv.setUint32(0x4c + 4 * i, i === 0 ? 0 : FREE, true);
  const fat = new Uint32Array(128).fill(FREE);
  fat[0] = FATS; fat[1] = END;
  const sectors: Uint8Array[] = [];
  const dir = new Uint8Array(SS);
  const dv = new DataView(dir.buffer);
  const entry = (i: number, name: string, type: number, start: number, size: number) => {
    const o = i * 128;
    [...name].forEach((c, k) => dv.setUint16(o + 2 * k, c.charCodeAt(0), true));
    dv.setUint16(o + 0x40, (name.length + 1) * 2, true);
    dir[o + 0x42] = type; dir[o + 0x43] = 1;
    dv.setUint32(o + 0x44, FREE, true); dv.setUint32(o + 0x48, FREE, true); dv.setUint32(o + 0x4c, i === 0 ? 1 : FREE, true);
    dv.setUint32(o + 0x74, start, true); dv.setUint32(o + 0x78, size, true);
  };
  const chainSectors = (bytes: Uint8Array, first: number) => {
    const n = Math.ceil(bytes.length / SS);
    for (let k = 0; k < n; k++) { const s = new Uint8Array(SS); s.set(bytes.subarray(k * SS, (k + 1) * SS)); sectors.push(s); fat[first + k] = k === n - 1 ? END : first + k + 1; }
    return n;
  };
  if (small) {
    // 扇区：0 FAT、1 目录、2 MiniFAT、3.. mini stream 容器
    const nMini = Math.ceil(data.length / 64);
    const container = new Uint8Array(nMini * 64); container.set(data);
    const mfat = new Uint8Array(SS); const mv = new DataView(mfat.buffer);
    for (let i = 0; i < 128; i++) mv.setUint32(4 * i, i < nMini ? (i === nMini - 1 ? END : i + 1) : FREE, true);
    fat[2] = END;
    hv.setUint32(0x3c, 2, true); hv.setUint32(0x40, 1, true);
    entry(0, 'Root Entry', 5, 3, container.length);
    entry(1, 'Workbook', 2, 0, data.length);
    sectors.push(dir, mfat);
    chainSectors(container, 3);
  } else {
    hv.setUint32(0x3c, END, true); hv.setUint32(0x40, 0, true);
    entry(0, 'Root Entry', 5, END, 0);
    entry(1, 'Workbook', 2, 2, data.length);
    sectors.push(dir);
    chainSectors(data, 2);
  }
  const fatSec = new Uint8Array(SS); const fv = new DataView(fatSec.buffer);
  fat.forEach((v, i) => fv.setUint32(4 * i, v, true));
  const all = [head, fatSec, ...sectors];
  const out = new Uint8Array(all.length * SS);
  all.forEach((s, i) => out.set(s, i * SS));
  return out;
}
