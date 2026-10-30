#!/usr/bin/env node
/**
 * 把 extension/ 打成 zip，写进 src/generated/extension.ts（base64），网页后台"插件下载"用（Amos 2026-10-30："咱们做的插件，让我可以在marketing后台下载"）。
 * 生成的文件不进仓库（.gitignore），测试、类型检查、部署前自动生成（package.json 的 pre 脚本、scripts/deploy.sh）。
 * zip 里是一个 marketing-copilot/ 文件夹，解压后直接在 chrome://extensions "加载已解压的扩展程序"选它。
 * 文件按名字排序、时间固定，同样的代码每次生成同样的 zip。
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { crc32, deflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'extension');
const FOLDER = 'marketing-copilot/';
// 固定的修改时间 2026-01-01 00:00（DOS 格式），保证同样的代码生成同样的 zip
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

/** 生成 zip（每个文件 deflate 压缩，带 CRC32） */
export function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of files) {
    const fname = Buffer.from(name, 'utf8');
    const body = deflateRawSync(data, { level: 9 });
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(fname.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12); central.writeUInt16LE(DOS_DATE, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(fname.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, fname, body);
    centrals.push(central, fname);
    offset += local.length + fname.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

function main() {
  const names = readdirSync(src).filter((n) => !n.startsWith('.')).sort();
  const files = names.map((n) => ({ name: FOLDER + n, data: readFileSync(path.join(src, n)) }));
  const version = JSON.parse(readFileSync(path.join(src, 'manifest.json'), 'utf8')).version;
  const zip = buildZip(files);
  mkdirSync(path.join(root, 'src/generated'), { recursive: true });
  writeFileSync(path.join(root, 'src/generated/extension.ts'),
    `// 由 scripts/build-ext-zip.mjs 生成，不要手改，不进仓库\nexport const EXTENSION_VERSION = ${JSON.stringify(version)};\nexport const EXTENSION_FILES = ${files.length};\nexport const EXTENSION_ZIP_B64 = ${JSON.stringify(zip.toString('base64'))};\n`);
  console.log(`✓ 插件 ${version} 打包：${files.length} 个文件，zip ${(zip.length / 1024).toFixed(1)} KB → src/generated/extension.ts`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
