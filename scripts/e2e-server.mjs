/**
 * 浏览器级测试共用的本地服务（照 scripts/e2e-admin.mjs 的写法，agents C141）：wrangler dev + 本地 D1，每次从空库开始、跑全部迁移。
 * 给 scripts/e2e-queue.mjs、scripts/e2e-platform.mjs 用；e2e-admin.mjs 不改。
 *   const srv = await startServer({ name: 'e2e-queue', vars: { DAILY_REPLY_CAP: '3' }, seedSql: 'INSERT …' });
 *   srv.BASE  // http://127.0.0.1:<端口>
 *   srv.stop()
 * seedSql：迁移跑完、服务启动前直接写进本地库的样例数据（不经过插件接口，所以不需要插件令牌，也不用伪造来源）。
 * 密码和令牌是只给测试用的假值，不是线上的。
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PASS = 'e2e_only_password_0123';
export const TOKEN = 'e2e_only_company_token_0123456789abcdef';
const WRANGLER = path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js');

export async function startServer({ name, vars = {}, seedSql = '' }) {
  const WORK = path.join(ROOT, '.wrangler', name);
  if (!existsSync(path.join(ROOT, 'src/generated/extension.ts'))) execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-ext-zip.mjs')], { cwd: ROOT, stdio: 'inherit' });
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  writeFileSync(path.join(WORK, 'wrangler.toml'), [
    `name = "marketing-${name}"`, 'main = "../../src/index.ts"', 'compatibility_date = "2026-10-01"',
    '[[d1_databases]]', 'binding = "DB"', `database_name = "marketing-${name}"`, 'database_id = "local-only"', 'migrations_dir = "../../migrations"', '',
  ].join('\n'));
  const wenv = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' };
  const cfg = ['--config', path.join(WORK, 'wrangler.toml'), '--persist-to', path.join(WORK, 'state')];
  execFileSync(process.execPath, [WRANGLER, 'd1', 'migrations', 'apply', 'DB', '--local', ...cfg], { cwd: ROOT, env: wenv, stdio: 'pipe' });
  if (seedSql) {
    const f = path.join(WORK, 'seed.sql');
    writeFileSync(f, seedSql);
    execFileSync(process.execPath, [WRANGLER, 'd1', 'execute', 'DB', '--local', '--file', f, ...cfg], { cwd: ROOT, env: wenv, stdio: 'pipe' });
  }
  const port = await new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
  const BASE = `http://127.0.0.1:${port}`;
  const allVars = { COPILOT_PASSWORD: PASS, COMPANY_INGEST_TOKEN: TOKEN, ...vars };
  const varArgs = Object.entries(allVars).flatMap(([k, v]) => ['--var', `${k}:${v}`]);
  const dev = spawn(process.execPath, [WRANGLER, 'dev', ...cfg, '--port', String(port), '--ip', '127.0.0.1', ...varArgs], { cwd: ROOT, env: wenv, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = '';
  dev.stdout.on('data', (d) => { log += d; });
  dev.stderr.on('data', (d) => { log += d; });
  const stop = () => { try { process.kill(-dev.pid, 'SIGTERM'); } catch { /* 已经停了 */ } };
  process.on('exit', stop);
  for (let i = 0; ; i++) {
    try { if ((await fetch(BASE + '/health')).ok) break; } catch { /* 还没起来 */ }
    if (i > 120) { console.error(log.slice(-3000)); stop(); throw new Error('本地服务 60 秒没起来'); }
    await new Promise((r) => setTimeout(r, 500));
  }
  /** 用测试令牌推公司块（和 agents 自动检查走同一个接口）；返回状态码和内容，不抛错，让调用方自己判断 */
  const ingest = async (source, blocks) => {
    const r = await fetch(BASE + '/api/company/ingest', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ source, blocks }) });
    return { status: r.status, body: await r.text() };
  };
  return { BASE, stop, ingest, log: () => log };
}

/** 台湾日期 YYYY-MM-DD */
export const twDay = (ms) => new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);
/** 台湾某天 00:00 的毫秒 */
export const twStart = (day) => Date.parse(`${day}T00:00:00+08:00`);
/** SQL 字符串字面量 */
export const q = (s) => (s == null ? 'NULL' : typeof s === 'number' ? String(s) : `'${String(s).replace(/'/g, "''")}'`);

/** check(名字, 是否通过, 实际值)：照 e2e-admin.mjs；最后看 fails */
export function checker() {
  const fails = [];
  const check = (name, ok, got) => { console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : '：实际 ' + JSON.stringify(got)}`); if (!ok) fails.push(name); return ok; };
  return { fails, check };
}
