/**
 * 浏览器级测试共用的本地服务（照 scripts/e2e-admin.mjs 的写法，agents C141）：wrangler dev + 本地 D1，每次从空库开始、跑全部迁移。
 * 给 scripts/e2e-queue.mjs、scripts/e2e-platform.mjs、scripts/e2e-live.mjs、scripts/e2e-tools.mjs 用；
 * e2e-admin.mjs 自己起服务，但共用下面的 waitForServer（2026-11-03 起，同一个端口竞争的毛病它也有）。
 *   const srv = await startServer({ name: 'e2e-queue', vars: { DAILY_REPLY_CAP: '3' }, seedSql: 'INSERT …' });
 *   srv.BASE  // http://127.0.0.1:<端口>（端口由 workerd 自己挑，起来之后才知道）
 *   srv.stop()
 * seedSql：迁移跑完、服务启动前直接写进本地库的样例数据（不经过插件接口，所以不需要插件令牌，也不用伪造来源）。
 * 密码和令牌是只给测试用的假值，不是线上的。
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
  const allVars = { COPILOT_PASSWORD: PASS, COMPANY_INGEST_TOKEN: TOKEN, ...vars };
  const varArgs = Object.entries(allVars).flatMap(([k, v]) => ['--var', `${k}:${v}`]);
  // --port 0：端口由 workerd 自己 bind 时向内核要，没有"先占座再交给别人"的空窗（详见 waitForServer 的注释）
  const dev = spawn(process.execPath, [WRANGLER, 'dev', ...cfg, '--port', '0', '--ip', '127.0.0.1', ...varArgs], { cwd: ROOT, env: wenv, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const stop = () => { try { process.kill(-dev.pid, 'SIGTERM'); } catch { /* 已经停了 */ } };
  process.on('exit', stop);
  const BASE = await waitForServer(dev, { name, stop });
  /** 用测试令牌推公司块（和 agents 自动检查走同一个接口）；返回状态码和内容，不抛错，让调用方自己判断 */
  const ingest = async (source, blocks) => {
    const r = await fetch(BASE + '/api/company/ingest', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ source, blocks }) });
    return { status: r.status, body: await r.text() };
  };
  return { BASE, stop, ingest, log: () => dev.e2eLog };
}

/**
 * 等本地服务真的就绪（按条件等，不是按钟）。给 startServer 和 scripts/e2e-admin.mjs 共用。
 *
 * 为什么不再自己挑端口（2026-11-03 测试会话查 CI 飘的测试）：
 *   原来先用 net.createServer().listen(0) 向内核要一个空端口、close() 掉，再把这个号码交给 wrangler。
 *   从 close() 到 workerd 真正 bind() 中间有一秒多的空窗，这段时间里机器上任何一个要临时端口的
 *   socket（浏览器连接、wrangler 自己的内部服务、前一个 e2e 脚本残留的进程……）都可能正好拿到它，
 *   workerd 再 bind 就是 Address already in use（CI 实例：运行 41568484428 第 1 次、 41565243841 第 1 次）。
 *   改成 --port 0：端口是 workerd 自己 bind 的那一刻向内核要的，要到和占住是同一个动作，空窗没了。
 *
 * 为什么不是死等 60 秒：
 *   原来的循环不看 wrangler 进程是死是活，它启动失败立刻退出也要等满 60 秒，
 *   再报一句不对的"本地服务 60 秒没起来"（CI 上 workerd 其实 5 秒就死了，60 秒全是白等）。
 *   现在：进程一退出就马上红，并把退出码和 wrangler 自己的报错原文报出来。
 *   60 秒这个数没改（正常 1～2 秒就就绪），只当"真的卡住了"的兜底，并且报出实际等了多久。
 */
export const READY_MS = 60_000;
export async function waitForServer(dev, { name = 'e2e', stop = () => {} } = {}) {
  let log = '';
  dev.e2eLog = '';
  const add = (d) => { log += d; dev.e2eLog = log; };
  dev.stdout.on('data', add);
  dev.stderr.on('data', add);
  let dead = null;
  dev.on('exit', (code, signal) => { dead = { code, signal }; });
  const t0 = Date.now();
  const die = (why) => { console.error(log.slice(-3000)); stop(); return new Error(`本地服务没起来（${name}，等了 ${Date.now() - t0} 毫秒）：${why}`); };
  // 第一步：等 wrangler 报出它真正 bind 到的端口（它 bind 成功了才会打这一行）
  let BASE = '';
  for (;;) {
    const m = /Ready on (http:\/\/127\.0\.0\.1:\d+)/.exec(log);
    if (m) { BASE = m[1]; break; }
    if (dead) throw die(`wrangler 退出了（退出码 ${dead.code}、信号 ${dead.signal}），上面是它自己的输出`);
    if (Date.now() - t0 > READY_MS) throw die('wrangler 还活着，但一直没报出端口');
    await new Promise((r) => setTimeout(r, 100));
  }
  // 第二步：探到 /health 真的能应答才算就绪
  for (;;) {
    try { if ((await fetch(BASE + '/health')).ok) return BASE; } catch { /* 还没接上 */ }
    if (dead) throw die(`报出了端口，但 wrangler 随后退出了（退出码 ${dead.code}、信号 ${dead.signal}）`);
    if (Date.now() - t0 > READY_MS) throw die(`端口 ${BASE} 开了，但 /health 一直没应答`);
    await new Promise((r) => setTimeout(r, 100));
  }
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
