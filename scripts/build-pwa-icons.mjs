#!/usr/bin/env node
/**
 * 工作台 PWA 图标（2026-11-12，Amos"都按建议"选候选 A）：深蓝 #0F1B33 底、青 #2DD4BF 高竖条 + 黄 #FBBF24 矮竖条，和顶栏 .logo 一样。
 * 不依赖任何库、不开浏览器：按 96×96 的设计稿（原型里的 SVG）逐像素画（每像素 4×4 抽样抗锯齿），自己编 PNG，结果写进 src/pwa-icons.ts（base64，提交进仓库）。
 * 同样的输入每次产出同样的字节；改了图形才需要重跑：node scripts/build-pwa-icons.mjs
 * 产出：192 / 512（圆角、四角透明，purpose any）、maskable 512（整块深蓝铺满、竖条缩到安全区 80% 圆内）、apple-touch-icon 180（不透明方底，iOS 自己切圆角）、favicon 32 + SVG。
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAVY = [0x0f, 0x1b, 0x33], TEAL = [0x2d, 0xd4, 0xbf], AMBER = [0xfb, 0xbf, 0x24];
// 96×96 设计稿（和原型 工作台图标原型.html 候选 A 的 SVG 同一组数）
const BARS = [{ x: 31, y: 24, w: 14, h: 48, r: 4, c: TEAL }, { x: 51, y: 44, w: 14, h: 28, r: 4, c: AMBER }];

function inRound(px, py, { x, y, w, h, r }) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r), cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

/** bgRadius：底的圆角（96 单位；0 = 直角铺满）；scale：竖条以中心缩放（maskable 用） */
function render(size, { bgRadius, scale = 1 }) {
  const bars = BARS.map((b) => ({ x: 48 + (b.x - 48) * scale, y: 48 + (b.y - 48) * scale, w: b.w * scale, h: b.h * scale, r: b.r * scale, c: b.c }));
  const bg = { x: 0, y: 0, w: 96, h: 96, r: bgRadius };
  const N = 4, px = Buffer.alloc(size * size * 4);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sj = 0; sj < N; sj++) for (let si = 0; si < N; si++) {
      const u = ((i + (si + 0.5) / N) / size) * 96, v = ((j + (sj + 0.5) / N) / size) * 96;
      if (!inRound(u, v, bg)) continue;
      const bar = bars.find((q) => inRound(u, v, q));
      const c = bar ? bar.c : NAVY;
      r += c[0]; g += c[1]; b += c[2]; a++;
    }
    const o = (j * size + i) * 4;
    if (a) { px[o] = Math.round(r / a); px[o + 1] = Math.round(g / a); px[o + 2] = Math.round(b / a); px[o + 3] = Math.round((a / (N * N)) * 255); }
  }
  return png(size, px, bgRadius === 0);
}

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (const x of buf) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** opaque：整张不透明时存成 RGB（apple-touch-icon 要不透明底，文件也更小） */
function png(size, rgba, opaque) {
  const ch = opaque ? 3 : 4, raw = Buffer.alloc((size * ch + 1) * size);
  for (let j = 0; j < size; j++) {
    raw[j * (size * ch + 1)] = 0;
    for (let i = 0; i < size; i++) for (let k = 0; k < ch; k++) raw[j * (size * ch + 1) + 1 + i * ch + k] = rgba[(j * size + i) * 4 + k];
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = opaque ? 2 : 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="22" fill="#0F1B33"/>'
  + '<rect x="31" y="24" width="14" height="48" rx="4" fill="#2DD4BF"/><rect x="51" y="44" width="14" height="28" rx="4" fill="#FBBF24"/></svg>';
const out = {
  'icon-192.png': render(192, { bgRadius: 22 }),
  'icon-512.png': render(512, { bgRadius: 22 }),
  'icon-maskable-512.png': render(512, { bgRadius: 0, scale: 0.8 }),
  'apple-touch-icon.png': render(180, { bgRadius: 0 }),
  'favicon-32.png': render(32, { bgRadius: 22 }),
};
const lines = Object.entries(out).map(([k, v]) => `  '/${k}': '${v.toString('base64')}',`);
writeFileSync(path.join(ROOT, 'src/pwa-icons.ts'), [
  '// 由 scripts/build-pwa-icons.mjs 生成，不要手改（改图形就改脚本再重跑）。工作台 PWA 图标，候选 A（2026-11-12 Amos"都按建议"）。',
  '/** 路径 → PNG 的 base64 */',
  'export const PWA_PNG: Record<string, string> = {',
  ...lines,
  '};',
  `export const FAVICON_SVG = '${SVG}';`,
  '',
].join('\n'));
for (const [k, v] of Object.entries(out)) console.log(k, v.length, 'bytes');
