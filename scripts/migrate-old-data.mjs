#!/usr/bin/env node
/**
 * 一次性搬数据（Amos 2026-10-30："原来的测试环境，直接给我改造成marketing项目的生成环境吧"）：
 * 把旧测试版数据库 quickcome-copilot-staging 的业务数据导入正式版数据库 marketing。
 * - 只搬 queue（跟帖评论清单）、events（记录）、ai_usage、model_usage（用量）、settings（后台设的上限）；
 *   登录失败、锁定、每分钟计数这类临时数据不搬。
 * - 正式版的表结构由部署时的迁移建好；这里只导出数据（--no-schema），不碰 d1_migrations。
 * - 安全：正式版这几张表里任何一张已经有数据就停下，不重复导入；搬完逐表核对两边条数。旧数据库不删、不改（只读导出）。
 * 由 GitHub Actions 手动运行（.github/workflows/migrate-once.yml），需要 CLOUDFLARE_API_TOKEN、CLOUDFLARE_ACCOUNT_ID。输出里没有密钥。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseList } from './ensure-d1.mjs';

const OLD = 'quickcome-copilot-staging';
const NEW = 'marketing';
const TABLES = ['queue', 'events', 'ai_usage', 'model_usage', 'settings'];

const dir = mkdtempSync(path.join(tmpdir(), 'mk-migrate-'));
const run = (args) => execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'inherit'] });

const dbs = parseList(run(['d1', 'list', '--json']));
const old = dbs.find((d) => d.name === OLD);
const neu = dbs.find((d) => d.name === NEW);
if (!old) throw new Error(`找不到旧数据库 ${OLD}`);
if (!neu) throw new Error(`找不到正式版数据库 ${NEW}（先部署正式版）`);
const cfg = path.join(dir, 'wrangler.migrate.toml');
writeFileSync(cfg, `name = "marketing-migrate"\ncompatibility_date = "2026-10-01"\n\n[[d1_databases]]\nbinding = "OLD"\ndatabase_name = "${OLD}"\ndatabase_id = "${old.uuid}"\n\n[[d1_databases]]\nbinding = "NEW"\ndatabase_name = "${NEW}"\ndatabase_id = "${neu.uuid}"\n`);

function count(db, table) {
  const out = run(['d1', 'execute', db, '--remote', '-c', cfg, '--json', '--command', `SELECT COUNT(*) AS n FROM ${table}`]);
  return JSON.parse(out.slice(out.indexOf('[')))[0].results[0].n;
}

const busy = TABLES.filter((t) => count(NEW, t) > 0);
if (busy.length) {
  console.error(`✗ 正式版 ${NEW} 的 ${busy.join('、')} 已经有数据，不重复导入（要重来先清空正式版的这些表）`);
  process.exit(1);
}
const before = Object.fromEntries(TABLES.map((t) => [t, count(OLD, t)]));
console.log('旧数据库条数：', JSON.stringify(before));
for (const t of TABLES) {
  if (!before[t]) { console.log(`· ${t}：没有数据，跳过`); continue; }
  const file = path.join(dir, `${t}.sql`);
  run(['d1', 'export', OLD, '--remote', '-c', cfg, '--no-schema', '--table', t, '--output', file]);
  const sql = readFileSync(file, 'utf8');
  console.log(`· ${t}：导出 ${sql.split('\n').filter((l) => l.startsWith('INSERT')).length} 行`);
  run(['d1', 'execute', NEW, '--remote', '-c', cfg, '--yes', '--file', file]);
}
let ok = true;
for (const t of TABLES) {
  const n = count(NEW, t);
  const same = n === before[t];
  if (!same) ok = false;
  console.log(`${same ? '✓' : '✗'} ${t}：旧 ${before[t]} 条，正式版 ${n} 条`);
}
if (!ok) { console.error('✗ 有表的条数对不上'); process.exit(1); }
console.log('✓ 搬完了，条数一致；旧数据库没动，确认后由 Amos 删除');
