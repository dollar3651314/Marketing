/**
 * 公司平台批 3（PR 4 Webhook 实时进度）的验收测试（接口层；agents 公司平台/技术方案-公司平台-Webhook.md 第二～四节，
 * 测试与风险页第二节 PR 4 一行，范围与上线页第二节 T-4；Amos 已定 P-2、P-3、P-4、P-5、P-7、T-4；C147 代码仓库只给标题和 CI、外部人标"外部"）。
 * 测试会话先写（agents C145 第 3 条）：写的时候功能还没做，所以"新功能"几组现在是红的；研发写代码到全绿，不改这里的断言（底线 6）。
 * "不能变"的一组（/v1/*、推送接口每分钟 6 次、0001～0007 的表）在改动前的代码上就是绿的，之后必须一直绿。
 *
 * 只在本地跑：直接调 handle()，D1 是 Miniflare 的本地 SQLite；签名用下面这个只给测试用的假 secret 在本地算（不是线上的值，
 * 也不发到 GitHub 或 Cloudflare）。样例事件照 GitHub 文档的结构（webhook-events-and-payloads），只留本方案会读的字段。
 *
 * 覆盖：
 *   验签：签名对才收；不对 / 没有 401；hook:bad_sig_at 每分钟最多写一次（固定时钟连发 100 个错签名），签名不对的请求只碰 settings；
 *         COMPANY_INGEST_TOKEN 前后带空格时按去掉空格的值验；没填令牌 404；后台密码没填照样收；先验签再解析 JSON。
 *   事件：ping、push（开工 / 上一步 / 【交付】）、pull_request（开、改标题、合并、没合并就关、【要你决定】）、workflow_run（只认 completed，红 / 绿）、
 *         delete（没开 PR 的分支 → 最近结束"分支已删"）、别的事件 204；同一投递编号只写一次；仓库白名单 202。
 *   识别：分支名 claude/<岗位>-<项目>-<主题>；PR 标题【岗位·项目】；不合约定 → 未标 + 按仓库猜项目；agents 按改动的文件夹猜；
 *         不是 claude/ 开头 → Amos；C147：代码仓库不显示提交说明和 PR 正文；外部人的推送 / PR 标"外部"、不进"需要我的事"。
 *   时间：2 小时没动静变灰（idle）、24 小时进"最近结束"（end = timeout）、active_log 30 天前的写入时删。
 *   防护：> 512 KB 回 413（正好 512 KB 收）；每个仓库每分钟 120 次（第 121 次 429），别的仓库、下一分钟不受影响；
 *         20 个并发计数准确、125 个并发正好 120 个通过；乱序到达不倒退；合并时约 10 个事件几乎同时到（C139）都写对。
 *   开关：hook:github 关着时验签通过回 200、一条都不写；签名不对照样 401。
 *   迁移 0008：只建新表（active_item、active_log、gh_delivery）；在已有 0001～0007 数据的库上跑，旧表结构和数据一行不变。
 *   不影响别的：/v1/* 不经过这里；推送接口每分钟 6 次照旧、和 Webhook 分开算。
 *
 * 接口约定（技术方案没写死的由测试先提；研发要改名就同一个 PR 改这里并在 PR 描述写明）：
 *   POST /hooks/github   GitHub 发来的事件。404 = 没填令牌或不是 POST；413 = 请求体 > 512 KB；401 = 签名不对；
 *                        200 = 收下（含 ping、开关关着、重复的投递编号）；202 = 仓库不在白名单；204 = 不处理的事件；429 = 限流；400 = 签名对但不是 JSON。
 *   GET  /api/active     （登录后）{ on, lastAt, badSigAt, limitedAt, items: Item[], ended: Item[] }
 *       on        Webhook 开关（settings 的 hook:github，默认开）
 *       lastAt    最近一次收到验签通过的事件的时间（毫秒），从没收到过是 null → 页面"还没接上"
 *       badSigAt  settings 的 hook:bad_sig_at，没有是 null → 页面"签名不对"
 *       limitedAt 最近一次因限流回 429 的时间（分钟精度即可，可从 company_rate 的 gh:* 行算，不要求另写库），没有是 null → 页面"有延迟"
 *       items     正在进行（含变灰的），ended 最近结束；同一个 仓库 + 分支 只有一条
 *   Item = { repo: 'agents'|'new-forecast'|'marketing', branch, role, project, labeled, step, at, pr, title, url, ci, decide, delivered, external, idle, end }
 *       role      岗位短码 main / pm / mkt / dev / qa / ops / review；认不出 'none'（页面"未标"）；不是 claude/ 开头 'amos'
 *       project   'forecast' | 'platform' | 'company'
 *       labeled   分支名合不合 claude/<岗位短码>-<项目短码>-<主题>（不合的页面写"分支名没按约定"）
 *       step      "上一步"：最后一次推送的提交说明第一行；代码仓库（new-forecast、marketing）和外部人的一律 ''（C147 只给分支名、PR 标题、CI）
 *       at        最后一次事件的时间：事件里带时间的用事件里的（push 用 head_commit.timestamp，PR 用 pull_request.updated_at，
 *                 workflow_run 用 workflow_run.updated_at），delete 没带时间用收到的时间；变灰、24 小时都按它算
 *       pr        PR 号或 null；title PR 标题或 ''；url PR 或分支的 https 链接
 *       ci        'success' | 'failure' | null（只认 workflow_run completed）
 *       decide    PR 标题含【要你决定】且不是外部的
 *       delivered 最后一次提交说明以"【交付】"开头（"交了，等主会话"）
 *       external  外部（C147 第 3 条）：PR 的 author_association 不是 OWNER / MEMBER / COLLABORATOR，或 head.repo.fork 为真；
 *                 推送的 sender.login 不是 repository.owner.login（现在没有协作者；加了协作者再改口径时同改这里）
 *       idle      now - at ≥ 2 小时（P-5）
 *       end       null（进行中）| 'merged' | 'closed'（没合并就关了）| 'deleted'（分支删了、没开 PR）| 'timeout'（now - at ≥ 24 小时）
 *   POST /api/hook {on: boolean}   （登录 + 本站来源）切开关，成功 {ok: true, on}；没登录 401、跨站 403、请求不对 400
 *   岗位短码以外，PR 标题里的岗位写中文：主会话 / 产品 / 市场 / 研发 / 测试 / 运维安全 / 审查；项目写 forecast / platform / company
 */
import { createHmac, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import { ROOT, T0 } from './helpers';

/** 只给测试用的假 secret（≥ 32 个字符）；线上的值只有 Amos 知道，测试不碰 */
const SECRET = 'ci_only_webhook_secret_0123456789abcdef';
const PASS = 'ci_only_copilot_password_01';
const TOKEN = 'ci_only_copilot_token_0123456789';
const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const HOST = 'https://copilot.example.test';
const OWNER = 'dollar3651314';
const MIG = path.join(ROOT, 'migrations');
const M0008 = '0008_active.sql';
const NEW_TABLES = ['active_item', 'active_log', 'gh_delivery'];
const OLD_TABLES = ['events', 'rate', 'queue', 'auth_fail', 'auth_lock', 'ai_usage', 'model_usage', 'settings', 'company_snapshot', 'company_done', 'company_rate', 'company_report', 'usage_by_project'];
const M = 60_000, H = 3600_000, D = 24 * H;
const KB512 = 512 * 1024;

const stmtsOf = (files: string[]) => files.map((f) => readFileSync(path.join(MIG, f), 'utf8').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n'))
  .join(';\n').split(';').map((s) => s.trim()).filter(Boolean);
const migs = () => readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
const newProxy = () => getPlatformProxy<{ DB: D1Database }>({ configPath: path.join(ROOT, 'test/wrangler.test.toml'), persist: false, remoteBindings: false, envFiles: [] });
const hasTable = async (d: D1Database, t: string) => !!(await d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1").bind(t).first());
const count = async (t: string, d: D1Database = db) => ((await hasTable(d, t)) ? (await d.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())!.n : 0);

let db: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  const p = await newProxy();
  db = p.env.DB;
  dispose = p.dispose;
  await db.batch(stmtsOf(migs()).map((s) => db.prepare(s)));
});
afterAll(async () => dispose());
beforeEach(async () => {
  const ts: string[] = [];
  for (const t of [...OLD_TABLES, ...NEW_TABLES]) if (await hasTable(db, t)) ts.push(t);
  await db.batch(ts.map((t) => db.prepare(`DELETE FROM ${t}`)));
});

const env = (over: Partial<Env> = {}, d: D1Database = db): Env => ({ DB: d, ENVIRONMENT: 'test', COPILOT_PASSWORD: PASS, COPILOT_TOKEN: TOKEN, GEMINI_API_KEY: 'ci_only_gemini_key', COMPANY_INGEST_TOKEN: SECRET, ...over });

// ---------------- GitHub 样例事件（照文档结构，只留会读的字段） ----------------
type Repo = 'agents' | 'new-forecast' | 'marketing';
const repoObj = (r: string, owner = OWNER) => ({ id: 1, name: r.split('/').pop(), full_name: r.includes('/') ? r : `${owner}/${r}`, private: r === 'agents', owner: { login: r.includes('/') ? r.split('/')[0] : owner, type: 'User' }, html_url: `https://github.com/${r.includes('/') ? r : `${owner}/${r}`}` });
const iso = (ms: number) => new Date(ms).toISOString();
interface PushOpt { repo?: string; branch: string; msg?: string; at?: number; files?: string[]; created?: boolean; sender?: string; commits?: { msg: string; files: string[] }[] }
function push(o: PushOpt) {
  const at = o.at ?? T0;
  const commits = (o.commits ?? [{ msg: o.msg ?? '开工', files: o.files ?? [] }]).map((c, i) => ({ id: `c${i}${'0'.repeat(38)}`, message: c.msg, timestamp: iso(at), url: `https://github.com/${OWNER}/x/commit/c${i}`, author: { name: 'Claude', username: o.sender ?? OWNER }, added: c.files, removed: [], modified: [] }));
  return {
    ref: `refs/heads/${o.branch}`, before: o.created ? '0'.repeat(40) : 'a'.repeat(40), after: 'b'.repeat(40), created: !!o.created, deleted: false, forced: false,
    repository: repoObj(o.repo ?? 'agents'), pusher: { name: o.sender ?? OWNER }, sender: { login: o.sender ?? OWNER, type: 'User' },
    commits, head_commit: commits[commits.length - 1],
  };
}
interface PrOpt { repo?: string; branch: string; number: number; title: string; action?: string; at?: number; merged?: boolean; body?: string; assoc?: string; fork?: boolean; user?: string; userType?: string; forkOwner?: string }
function pr(o: PrOpt) {
  const repo = o.repo ?? 'agents';
  const closed = o.action === 'closed';
  return {
    action: o.action ?? 'opened', number: o.number,
    pull_request: {
      number: o.number, title: o.title, body: o.body ?? 'PR 说明正文', state: closed ? 'closed' : 'open', draft: false, merged: !!o.merged,
      html_url: `https://github.com/${OWNER}/${repo}/pull/${o.number}`, created_at: iso(o.at ?? T0), updated_at: iso(o.at ?? T0), closed_at: closed ? iso(o.at ?? T0) : null, merged_at: o.merged ? iso(o.at ?? T0) : null,
      author_association: o.assoc ?? 'OWNER', user: { login: o.user ?? OWNER, type: o.userType ?? 'User' },
      head: (() => {
        const owner = o.fork ? (o.forkOwner ?? o.user ?? 'stranger') : OWNER;
        return { ref: o.branch, label: `${owner}:${o.branch}`, sha: 'b'.repeat(40), user: { login: owner }, repo: { full_name: `${owner}/${repo}`, name: repo, fork: !!o.fork, owner: { login: owner } } };
      })(),
      base: { ref: repo === 'agents' ? 'main' : 'staging', repo: { full_name: `${OWNER}/${repo}`, fork: false } },
    },
    repository: repoObj(repo), sender: { login: o.user ?? OWNER, type: 'User' },
  };
}
function run(o: { repo?: string; branch: string; action?: string; conclusion?: string | null; at?: number; name?: string; prs?: number[]; forkOwner?: string }) {
  const action = o.action ?? 'completed';
  return {
    action,
    workflow_run: {
      id: 1, name: o.name ?? 'ci', head_branch: o.branch, head_sha: 'b'.repeat(40), event: 'pull_request', status: action === 'completed' ? 'completed' : action === 'requested' ? 'queued' : 'in_progress',
      conclusion: action === 'completed' ? (o.conclusion ?? 'success') : null, html_url: `https://github.com/${OWNER}/${o.repo ?? 'agents'}/actions/runs/1`,
      created_at: iso(o.at ?? T0), updated_at: iso(o.at ?? T0), pull_requests: (o.prs ?? []).map((n) => ({ number: n })),
      head_repository: { full_name: `${o.forkOwner ?? OWNER}/${o.repo ?? 'agents'}`, name: o.repo ?? 'agents', fork: !!o.forkOwner, owner: { login: o.forkOwner ?? OWNER } },
    },
    repository: repoObj(o.repo ?? 'agents'), sender: { login: OWNER, type: 'User' },
  };
}
const del = (o: { repo?: string; branch: string; refType?: string }) => ({ ref: o.branch, ref_type: o.refType ?? 'branch', pusher_type: 'user', repository: repoObj(o.repo ?? 'agents'), sender: { login: OWNER, type: 'User' } });
const ping = (repo = 'agents') => ({ zen: 'Keep it logically awesome.', hook_id: 1, hook: { type: 'Repository', events: ['push', 'pull_request', 'workflow_run', 'delete'], active: true }, repository: repoObj(repo), sender: { login: OWNER, type: 'User' } });

// ---------------- 发事件（本地签名；只调 handle()，不发到任何真实服务） ----------------
const sign = (body: string | Uint8Array, secret = SECRET) => 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
interface HookOpt { event: string; body: unknown; now?: number; sig?: string | null; secret?: string; delivery?: string; e?: Env; raw?: string | Uint8Array }
function hookReq(o: HookOpt): Request {
  const raw = o.raw ?? JSON.stringify(o.body);
  const headers: Record<string, string> = { 'content-type': 'application/json', 'user-agent': 'GitHub-Hookshot/test', 'x-github-event': o.event, 'x-github-delivery': o.delivery ?? randomUUID(), 'x-github-hook-id': '1' };
  const sig = o.sig === undefined ? sign(raw, o.secret ?? SECRET) : o.sig;
  if (sig !== null) headers['x-hub-signature-256'] = sig;
  return new Request(`${HOST}/hooks/github`, { method: 'POST', headers, body: raw as BodyInit });
}
const hook = (o: HookOpt) => handle(hookReq(o), o.e ?? env(), o.now ?? T0);

// ---------------- 后台读写 ----------------
const page = (p: string, init: RequestInit & { cookie?: string; origin?: string } = {}) =>
  new Request(`${HOST}${p}`, { ...init, headers: { 'content-type': 'application/json', origin: init.origin ?? HOST, 'cf-connecting-ip': '203.0.113.9', ...(init.cookie ? { cookie: init.cookie } : {}) } });
let ck = '';
async function cookie(now = T0): Promise<string> {
  const r = await handle(page('/api/login', { method: 'POST', body: JSON.stringify({ password: PASS }) }), env(), now);
  return r.headers.get('set-cookie')!.split(';')[0];
}
interface Item { repo: string; branch: string; role: string; project: string; labeled: boolean; step: string; at: number; pr: number | null; title: string; url: string; ci: string | null; decide: boolean; delivered: boolean; external: boolean; idle: boolean; end: string | null }
interface Active { on: boolean; lastAt: number | null; badSigAt: number | null; limitedAt: number | null; items: Item[]; ended: Item[] }
async function active(now = T0): Promise<Active> {
  // 会话有有效期：每次在读的那个时间点登录（时间相关的用例会把时钟拨到几天以后）
  const c = now === T0 ? (ck ||= await cookie()) : await cookie(now);
  const r = await handle(page('/api/active', { cookie: c }), env(), now);
  expect(r.status, 'GET /api/active').toBe(200);
  return (await r.json()) as Active;
}
const find = (a: Active, branch: string, repo: Repo = 'agents') => {
  const all = [...a.items.map((x) => ({ ...x, _in: 'items' })), ...a.ended.map((x) => ({ ...x, _in: 'ended' }))].filter((x) => x.branch === branch && x.repo.toLowerCase() === repo);
  expect(all.length, `${repo} ${branch} 只有一条`).toBeLessThanOrEqual(1);
  return all[0] as (Item & { _in: string }) | undefined;
};
const setHook = (on: unknown, now = T0, origin?: string) => handle(page('/api/hook', { method: 'POST', body: JSON.stringify({ on }), cookie: ck, origin }), env(), now);

/** 只记下这次请求用到的 SQL（看签名不对的请求碰了哪些表）；语句本身照常执行 */
function spyDb(d: D1Database): { db: D1Database; sql: string[] } {
  const sql: string[] = [];
  const wrapped = new Proxy(d, {
    get(t, k) {
      if (k === 'prepare') return (q: string) => { sql.push(q); return t.prepare(q); };
      if (k === 'exec') return (q: string) => { sql.push(q); return t.exec(q); };
      const v = Reflect.get(t, k);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  return { db: wrapped, sql };
}
const isWrite = (q: string) => /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(q) || /\bON\s+CONFLICT\b/i.test(q);
const ghRate = async (minute: number) => (await db.prepare("SELECT COALESCE(SUM(n), 0) AS n FROM company_rate WHERE source LIKE 'gh:%' AND minute = ?1").bind(minute).first<{ n: number }>())!.n;

// ======================================================================
describe('迁移 0008：只建新表（active_item、active_log、gh_delivery），旧表不动', () => {
  it('有 0008_active.sql，里面只有 CREATE TABLE / CREATE INDEX，索引只建在新表上（没有 ALTER、DROP、DELETE、UPDATE、INSERT）', () => {
    expect(existsSync(path.join(MIG, M0008)), `migrations/${M0008}`).toBe(true);
    const st = stmtsOf([M0008]);
    expect(st.length).toBeGreaterThanOrEqual(3);
    for (const s of st) {
      expect(s, s).toMatch(/^CREATE\s+(TABLE|(UNIQUE\s+)?INDEX)\s/i);
      const idx = /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?\S+\s+ON\s+(\w+)/i.exec(s);
      if (idx) expect(NEW_TABLES, s).toContain(idx[1]);
      const tbl = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i.exec(s);
      if (tbl) expect(NEW_TABLES, s).toContain(tbl[1]);
    }
    expect(st.join('\n')).not.toMatch(/\b(ALTER|DROP|DELETE|UPDATE|INSERT|REPLACE)\b/i);
  });

  it('跑完全部迁移：三张新表都在', async () => {
    for (const t of NEW_TABLES) expect(await hasTable(db, t), t).toBe(true);
  });

  it('在"已有 0001～0007 数据"的库上跑 0008：13 张旧表的结构和数据一行不变（含 settings 里已有的 hook:github）', async () => {
    const p = await newProxy();
    try {
      const d = p.env.DB;
      const before = migs().filter((f) => f < '0008');
      expect(before).toEqual(['0001_init.sql', '0002_queue.sql', '0003_workers_ai.sql', '0004_v03.sql', '0005_company.sql', '0006_platform_reports.sql', '0007_usage_by_project.sql']);
      await d.batch(stmtsOf(before).map((s) => d.prepare(s)));
      await d.batch([
        d.prepare("INSERT INTO events (at, day, product, platform, post_id, author, snippet, score, action, draft) VALUES (1, '2026-11-01', 'forecast', 'x', '1', '@a', '摘要', 80, 'approve', '回覆')"),
        d.prepare('INSERT INTO rate (minute, n) VALUES (29000000, 7)'),
        d.prepare("INSERT INTO queue (at, updated_at, product, platform, post_id, author, draft, status, done_day, engine, reasons) VALUES (1, 2, 'forecast', 'x', '1', '@a', '草稿', 'done', '2026-11-01', 'workers-ai', '[\"理由\"]')"),
        d.prepare("INSERT INTO auth_fail (ip, at) VALUES ('abc', 5)"),
        d.prepare("INSERT INTO auth_lock (scope, until) VALUES ('all', 9)"),
        d.prepare("INSERT INTO ai_usage (day, neurons) VALUES ('2026-11-01', 123.456)"),
        d.prepare("INSERT INTO model_usage (day, model, req, tok_in, tok_out, last_status, last_at) VALUES ('2026-11-01', 'gemini-3.6-flash', 41, 5000, 900, 200, 7)"),
        d.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('cap:gemini-3.6-flash', '150', 1)"),
        d.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('reply_cap:forecast', '3', 1)"),
        d.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('hook:github', '1', 1)"),
        d.prepare("INSERT INTO company_snapshot (source, kind, key, payload, status, source_at, updated_at) VALUES ('agents', 'todo', 'forecast', '{}', 'ok', 1, 1)"),
        d.prepare("INSERT INTO company_done (item_key, done_at) VALUES ('todo:forecast:T3', 5)"),
        d.prepare("INSERT INTO company_rate (source, minute, n) VALUES ('agents', 29000000, 2)"),
        d.prepare("INSERT INTO company_report (item_key, project, name, value, at) VALUES ('todo:forecast:R1', 'forecast', 'X 关注', '12', 6)"),
        d.prepare("INSERT INTO usage_by_project (day, project, model, req, tok_in, tok_out, neurons) VALUES ('2026-11-01', 'forecast', 'gemini-3.6-flash', 4, 400, 90, 0)"),
      ]);
      const schema = async () => (await d.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND tbl_name NOT IN ('active_item', 'active_log', 'gh_delivery') ORDER BY name").all()).results;
      const dump = async () => Promise.all(OLD_TABLES.map(async (t) => [t, (await d.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()).results]));
      const [s0, d0] = [await schema(), await dump()];
      expect(s0.length).toBeGreaterThan(13);
      expect(existsSync(path.join(MIG, M0008)), `migrations/${M0008}`).toBe(true);
      await d.batch(stmtsOf([M0008]).map((s) => d.prepare(s)));
      expect(await schema()).toEqual(s0);
      expect(await dump()).toEqual(d0);
      for (const t of NEW_TABLES) {
        expect(await hasTable(d, t), t).toBe(true);
        expect(await count(t, d), t).toBe(0);
      }
    } finally { await p.dispose(); }
  });
});

// ======================================================================
describe('验签（P-2：签名密钥就是 COMPANY_INGEST_TOKEN 的值）', () => {
  it('签名对：ping 回 200，记下 lastAt；签名不对、没有签名、sha1 格式：401', async () => {
    expect((await hook({ event: 'ping', body: ping() })).status).toBe(200);
    expect((await active(T0 + 1000)).lastAt).toBe(T0);
    expect((await hook({ event: 'ping', body: ping(), sig: sign('别的内容') })).status).toBe(401);
    expect((await hook({ event: 'ping', body: ping(), secret: 'some_other_secret_0123456789abcdefgh' })).status).toBe(401);
    expect((await hook({ event: 'ping', body: ping(), sig: null })).status).toBe(401);
    expect((await hook({ event: 'ping', body: ping(), sig: sign(JSON.stringify(ping())).replace('sha256=', 'sha1=') })).status).toBe(401);
    expect((await hook({ event: 'ping', body: ping(), sig: 'sha256=' })).status).toBe(401);
  });

  it('签名不对：一条进度都不写；hook:bad_sig_at 记下时间，页面能读到 badSigAt', async () => {
    const r = await hook({ event: 'push', body: push({ branch: 'claude/pm-forecast-weekly' }), sig: sign('x') });
    expect(r.status).toBe(401);
    for (const t of NEW_TABLES) expect(await count(t), t).toBe(0);
    const s = await db.prepare("SELECT value FROM settings WHERE key = 'hook:bad_sig_at'").first<{ value: string }>();
    expect(Number(s?.value)).toBe(T0);
    const a = await active(T0 + 1000);
    expect(a.badSigAt).toBe(T0);
    expect(a.items).toEqual([]);
  });

  it('签名不对每分钟最多写一次：固定时钟 59 秒内连发 100 个，hook:bad_sig_at 一直是第一次的时间；满 60 秒才更新', async () => {
    for (let i = 0; i < 100; i++) {
      const r = await hook({ event: 'push', body: push({ branch: 'claude/pm-forecast-weekly' }), sig: sign('x' + i), now: T0 + Math.floor((i * 59_000) / 99) });
      expect(r.status, `第 ${i + 1} 个`).toBe(401);
    }
    const v = async () => Number((await db.prepare("SELECT value FROM settings WHERE key = 'hook:bad_sig_at'").first<{ value: string }>())?.value);
    expect(await v()).toBe(T0);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key = 'hook:bad_sig_at'").first<{ n: number }>())!.n).toBe(1);
    expect((await hook({ event: 'ping', body: ping(), sig: sign('y'), now: T0 + 60_000 })).status).toBe(401);
    expect(await v()).toBe(T0 + 60_000);
  });

  it('签名不对的请求只碰 settings 的 hook:bad_sig_at：不读开关、不碰进度表、不算限流；同一分钟里第二次不写', async () => {
    const s1 = spyDb(db);
    expect((await hook({ event: 'push', body: push({ branch: 'claude/pm-forecast-weekly' }), sig: sign('x'), e: env({}, s1.db) })).status).toBe(401);
    expect(s1.sql.length).toBeGreaterThan(0);
    for (const q of s1.sql) {
      expect(q, q).toMatch(/\bsettings\b/i);
      expect(q, q).not.toMatch(/active_item|active_log|gh_delivery|company_rate/i);
      expect(q, q).not.toMatch(/hook:github/);
    }
    const s2 = spyDb(db);
    expect((await hook({ event: 'push', body: push({ branch: 'claude/pm-forecast-weekly' }), sig: sign('x'), now: T0 + 30_000, e: env({}, s2.db) })).status).toBe(401);
    for (const q of s2.sql) expect(q, q).toMatch(/\bsettings\b/i);
    expect(await ghRate(Math.floor(T0 / M))).toBe(0);
  });

  it('COMPANY_INGEST_TOKEN 前后带空格：按去掉首尾空格的值验（Amos 在 GitHub 填不带空格的值就对）；用带空格的原值签反而 401', async () => {
    const e = env({ COMPANY_INGEST_TOKEN: `  ${SECRET}\n ` });
    expect((await hook({ event: 'ping', body: ping(), e })).status).toBe(200);
    expect((await hook({ event: 'ping', body: ping(), e, secret: `  ${SECRET}\n ` })).status).toBe(401);
    // 反过来：Worker 里没空格，GitHub 那边多填了空格 → 签名永远对不上（页面"签名不对"提示，R-8）
    expect((await hook({ event: 'ping', body: ping(), secret: ` ${SECRET} ` })).status).toBe(401);
  });

  it('没填令牌（或不到 32 个字符）：/hooks/github 404，一条都不写；不是 POST 也 404', async () => {
    expect((await hook({ event: 'ping', body: ping(), e: env({ COMPANY_INGEST_TOKEN: undefined }) })).status).toBe(404);
    expect((await hook({ event: 'ping', body: ping(), e: env({ COMPANY_INGEST_TOKEN: 'short_token' }), secret: 'short_token' })).status).toBe(404);
    expect((await handle(new Request(`${HOST}/hooks/github`), env(), T0)).status).toBe(404);
    expect(await count('settings')).toBe(0);
  });

  it('只依赖这个令牌：后台密码没填（后台 404）时照样收', async () => {
    const e = env({ COPILOT_PASSWORD: undefined });
    expect((await handle(page('/'), e, T0)).status).toBe(404);
    expect((await hook({ event: 'push', body: push({ branch: 'claude/pm-forecast-weekly', created: true }), e })).status).toBe(200);
    expect(await count('active_item')).toBe(1);
  });

  it('先验签再解析：签名不对的乱码 401（不是 400）；签名对但不是 JSON 400', async () => {
    expect((await hook({ event: 'push', body: null, raw: '{不是 JSON', sig: sign('别的') })).status).toBe(401);
    expect((await hook({ event: 'push', body: null, raw: '{不是 JSON' })).status).toBe(400);
  });
});

// ======================================================================
describe('请求体上限 512 KB', () => {
  const padTo = (obj: unknown, n: number) => { const s = JSON.stringify(obj); return s + ' '.repeat(n - Buffer.byteLength(s)); };
  it('正好 512 KB：收下；多 1 个字节：413（签名对也一样），一条都不写', async () => {
    const ok = padTo(push({ branch: 'claude/dev-platform-big', created: true }), KB512);
    expect(Buffer.byteLength(ok)).toBe(KB512);
    expect((await hook({ event: 'push', body: null, raw: ok })).status).toBe(200);
    expect(await count('active_item')).toBe(1);
    const big = padTo(push({ branch: 'claude/dev-platform-big2', created: true }), KB512 + 1);
    expect((await hook({ event: 'push', body: null, raw: big })).status).toBe(413);
    expect((await hook({ event: 'push', body: null, raw: big, sig: sign('x') })).status).toBe(413);
    expect(await count('active_item')).toBe(1);
  });
});

// ======================================================================
describe('事件：在"团队在做什么"里怎么显示', () => {
  it('push 新分支 = 开工：一条进行中的，岗位、项目、上一步、时间；再推一次只更新上一步和时间（提交说明第一行）', async () => {
    expect((await hook({ event: 'push', body: push({ branch: 'claude/pm-forecast-weekly-pack', msg: '开工', created: true, at: T0 }), now: T0 })).status).toBe(200);
    let a = await active(T0 + M);
    let x = find(a, 'claude/pm-forecast-weekly-pack');
    expect(x).toMatchObject({ _in: 'items', repo: 'agents', role: 'pm', project: 'forecast', labeled: true, step: '开工', at: T0, pr: null, ci: null, decide: false, delivered: false, external: false, idle: false, end: null });
    expect(x!.url).toMatch(/^https:\/\/github\.com\/dollar3651314\/agents\//);
    expect(a.lastAt).toBe(T0);
    await hook({ event: 'push', body: push({ branch: 'claude/pm-forecast-weekly-pack', msg: '周包：写完 6 条帖子\n\n详细说明第二段', at: T0 + 10 * M }), now: T0 + 10 * M });
    a = await active(T0 + 11 * M);
    x = find(a, 'claude/pm-forecast-weekly-pack');
    expect(x).toMatchObject({ step: '周包：写完 6 条帖子', at: T0 + 10 * M, end: null });
    expect(a.items.length).toBe(1);
    expect(await count('active_log')).toBe(2);
  });

  it('一次推多个提交：上一步取最后一个（head_commit）的第一行', async () => {
    await hook({ event: 'push', body: push({ branch: 'claude/dev-platform-hooks', commits: [{ msg: '第一步', files: [] }, { msg: '第二步\n说明', files: [] }] }) });
    expect(find(await active(), 'claude/dev-platform-hooks')).toMatchObject({ step: '第二步' });
  });

  it('多个岗位同时干活：每个分支一条，互不覆盖', async () => {
    await hook({ event: 'push', body: push({ branch: 'claude/pm-forecast-a', msg: 'A' }) });
    await hook({ event: 'push', body: push({ branch: 'claude/mkt-forecast-b', msg: 'B' }) });
    await hook({ event: 'push', body: push({ repo: 'marketing', branch: 'claude/dev-platform-c', msg: 'C' }) });
    const a = await active(T0 + M);
    expect(a.items.length).toBe(3);
    expect(find(a, 'claude/pm-forecast-a')).toMatchObject({ role: 'pm', step: 'A' });
    expect(find(a, 'claude/mkt-forecast-b')).toMatchObject({ role: 'mkt', step: 'B' });
    expect(find(a, 'claude/dev-platform-c', 'marketing')).toMatchObject({ role: 'dev', project: 'platform' });
  });

  it('【交付】开头的提交说明 = "交了，等主会话"（delivered），还在进行中', async () => {
    await hook({ event: 'push', body: push({ branch: 'claude/qa-platform-batch3', msg: '开工', created: true }) });
    expect(find(await active(), 'claude/qa-platform-batch3')).toMatchObject({ delivered: false });
    await hook({ event: 'push', body: push({ branch: 'claude/qa-platform-batch3', msg: '【交付】批 3 验收测试', at: T0 + M }), now: T0 + M });
    expect(find(await active(T0 + 2 * M), 'claude/qa-platform-batch3')).toMatchObject({ delivered: true, end: null, _in: 'items' });
    // 后面又推了普通提交：不再是"交了"
    await hook({ event: 'push', body: push({ branch: 'claude/qa-platform-batch3', msg: '按审查改', at: T0 + 2 * M }), now: T0 + 2 * M });
    expect(find(await active(T0 + 3 * M), 'claude/qa-platform-batch3')).toMatchObject({ delivered: false });
  });

  it('pull_request 开 / 改标题：补上 PR 号、标题、链接；标题含【要你决定】→ decide（进"需要我的事"）；改掉以后不再是', async () => {
    const br = 'claude/pm-forecast-weekly';
    await hook({ event: 'push', body: push({ branch: br, created: true }) });
    expect((await hook({ event: 'pull_request', body: pr({ branch: br, number: 101, title: '【只看】【产品·forecast】周包 11/2', at: T0 + M }), now: T0 + M })).status).toBe(200);
    let x = find(await active(T0 + 2 * M), br);
    expect(x).toMatchObject({ pr: 101, title: '【只看】【产品·forecast】周包 11/2', decide: false, end: null, at: T0 + M });
    expect(x!.url).toBe('https://github.com/dollar3651314/agents/pull/101');
    await hook({ event: 'pull_request', body: pr({ branch: br, number: 101, action: 'edited', title: '【要你决定】【产品·forecast】周包 11/2', at: T0 + 2 * M }), now: T0 + 2 * M });
    expect(find(await active(T0 + 3 * M), br)).toMatchObject({ decide: true, title: '【要你决定】【产品·forecast】周包 11/2' });
    await hook({ event: 'pull_request', body: pr({ branch: br, number: 101, action: 'edited', title: '【只看】【产品·forecast】周包 11/2（改）', at: T0 + 3 * M }), now: T0 + 3 * M });
    expect(find(await active(T0 + 4 * M), br)).toMatchObject({ decide: false });
  });

  it('只开了 PR、之前没收到推送：也有一条（PR 号、标题）', async () => {
    await hook({ event: 'pull_request', body: pr({ branch: 'claude/ops-company-dict', number: 7, title: '【运维安全·company】字典检查' }) });
    expect(find(await active(), 'claude/ops-company-dict')).toMatchObject({ pr: 7, role: 'ops', project: 'company', _in: 'items' });
  });

  it('workflow_run 只认 completed：requested、in_progress 不改 CI；completed 红 → failure，再跑一次绿 → success', async () => {
    const br = 'claude/dev-platform-hooks';
    await hook({ event: 'push', body: push({ branch: br, created: true }) });
    expect((await hook({ event: 'workflow_run', body: run({ branch: br, action: 'requested' }) })).status).toBeLessThan(300);
    expect((await hook({ event: 'workflow_run', body: run({ branch: br, action: 'in_progress' }) })).status).toBeLessThan(300);
    expect(find(await active(), br)).toMatchObject({ ci: null });
    await hook({ event: 'workflow_run', body: run({ branch: br, conclusion: 'failure', at: T0 + M }), now: T0 + M });
    expect(find(await active(T0 + 2 * M), br)).toMatchObject({ ci: 'failure', end: null });
    await hook({ event: 'workflow_run', body: run({ branch: br, conclusion: 'success', at: T0 + 5 * M }), now: T0 + 5 * M });
    expect(find(await active(T0 + 6 * M), br)).toMatchObject({ ci: 'success' });
  });

  it('PR 合并 → 最近结束"已合并"；PR 关了没合并 → 最近结束"没合并就关了"', async () => {
    await hook({ event: 'pull_request', body: pr({ branch: 'claude/pm-forecast-a', number: 11, title: '【产品·forecast】A' }) });
    await hook({ event: 'pull_request', body: pr({ branch: 'claude/pm-forecast-b', number: 12, title: '【产品·forecast】B' }) });
    await hook({ event: 'pull_request', body: pr({ branch: 'claude/pm-forecast-a', number: 11, title: '【产品·forecast】A', action: 'closed', merged: true, at: T0 + M }), now: T0 + M });
    await hook({ event: 'pull_request', body: pr({ branch: 'claude/pm-forecast-b', number: 12, title: '【产品·forecast】B', action: 'closed', merged: false, at: T0 + M }), now: T0 + M });
    const a = await active(T0 + 2 * M);
    expect(a.items).toEqual([]);
    expect(find(a, 'claude/pm-forecast-a')).toMatchObject({ _in: 'ended', end: 'merged', pr: 11 });
    expect(find(a, 'claude/pm-forecast-b')).toMatchObject({ _in: 'ended', end: 'closed', pr: 12 });
  });

  it('PR 关了又重开：回到进行中', async () => {
    const br = 'claude/pm-forecast-a';
    await hook({ event: 'pull_request', body: pr({ branch: br, number: 11, title: 'A', action: 'closed', at: T0 }) });
    await hook({ event: 'pull_request', body: pr({ branch: br, number: 11, title: 'A', action: 'reopened', at: T0 + M }), now: T0 + M });
    expect(find(await active(T0 + 2 * M), br)).toMatchObject({ _in: 'items', end: null });
  });

  it('delete：没开 PR 的分支删掉 → 最近结束"分支已删"；删 tag 不管；删掉的时间用收到的时间', async () => {
    await hook({ event: 'push', body: push({ branch: 'claude/mkt-forecast-draft', created: true, at: T0 }) });
    expect((await hook({ event: 'delete', body: del({ branch: 'v1.0', refType: 'tag' }), now: T0 + M })).status).toBeLessThan(300);
    expect((await hook({ event: 'delete', body: del({ branch: 'claude/mkt-forecast-draft' }), now: T0 + 3 * M })).status).toBe(200);
    const a = await active(T0 + 4 * M);
    expect(find(a, 'claude/mkt-forecast-draft')).toMatchObject({ _in: 'ended', end: 'deleted', at: T0 + 3 * M });
    expect(find(a, 'v1.0')).toBeUndefined();
  });

  it('ping 回 200、不出条目；别的事件（issues、star、push 到 tag）回 204、一条都不写', async () => {
    expect((await hook({ event: 'ping', body: ping() })).status).toBe(200);
    expect((await hook({ event: 'issues', body: { action: 'opened', issue: { number: 1, title: 't' }, repository: repoObj('agents'), sender: { login: OWNER } } })).status).toBe(204);
    expect((await hook({ event: 'star', body: { action: 'created', repository: repoObj('agents'), sender: { login: OWNER } } })).status).toBe(204);
    expect((await active()).items).toEqual([]);
    expect(await count('active_item')).toBe(0);
    expect(await count('active_log')).toBe(0);
  });

  it('同一个投递编号（GitHub 手动 Redeliver）只写一次，第二次也回 200', async () => {
    const id = randomUUID();
    const body = push({ branch: 'claude/pm-forecast-weekly', msg: '开工', created: true });
    expect((await hook({ event: 'push', body, delivery: id })).status).toBe(200);
    expect((await hook({ event: 'push', body, delivery: id, now: T0 + M })).status).toBe(200);
    expect(await count('active_log')).toBe(1);
    expect(await count('gh_delivery')).toBe(1);
  });

  it('仓库白名单：只认 agents、new-forecast、marketing（full_name，不分大小写）；别的仓库 202、不写', async () => {
    expect((await hook({ event: 'push', body: push({ repo: 'Dollar3651314/Marketing', branch: 'claude/dev-platform-a' }) })).status).toBe(200);
    expect((await hook({ event: 'push', body: push({ repo: `${OWNER}/new-forecast`, branch: 'claude/dev-forecast-b' }) })).status).toBe(200);
    expect((await hook({ event: 'push', body: push({ repo: `${OWNER}/other-repo`, branch: 'claude/dev-platform-c' }) })).status).toBe(202);
    expect((await hook({ event: 'push', body: push({ repo: 'someone-else/marketing', branch: 'claude/dev-platform-d' }) })).status).toBe(202);
    const a = await active(T0 + M);
    expect(a.items.map((x) => x.branch).sort()).toEqual(['claude/dev-forecast-b', 'claude/dev-platform-a']);
    expect(find(a, 'claude/dev-platform-a', 'marketing')).toBeDefined();
    expect(find(a, 'claude/dev-forecast-b', 'new-forecast')).toBeDefined();
  });

  it('GET /api/active：没登录 401；后台没开 404；从没收到事件时 lastAt、badSigAt、limitedAt 都是 null、开关默认开', async () => {
    expect((await handle(page('/api/active'), env(), T0)).status).toBe(401);
    expect((await handle(page('/api/active'), env({ COPILOT_PASSWORD: undefined }), T0)).status).toBe(404);
    expect(await active()).toEqual({ on: true, lastAt: null, badSigAt: null, limitedAt: null, items: [], ended: [] });
  });
});

// ======================================================================
describe('识别：岗位、项目（P-3）', () => {
  const ROLES: [string, string][] = [['main', 'main'], ['pm', 'pm'], ['mkt', 'mkt'], ['dev', 'dev'], ['qa', 'qa'], ['ops', 'ops'], ['review', 'review']];
  it('分支名 claude/<岗位>-<项目>-<主题>：七个岗位短码 × 三个项目短码都认得，主题里可以再有横线', async () => {
    let i = 0;
    for (const [code] of ROLES) for (const project of ['forecast', 'platform', 'company']) {
      const br = `claude/${code}-${project}-some-topic-${i++}`;
      expect((await hook({ event: 'push', body: push({ branch: br }) })).status, br).toBe(200);
    }
    const a = await active(T0 + M);
    i = 0;
    for (const [code, role] of ROLES) for (const project of ['forecast', 'platform', 'company']) {
      const br = `claude/${code}-${project}-some-topic-${i++}`;
      expect(find(a, br), br).toMatchObject({ role, project, labeled: true });
    }
  });

  it('不合约定的分支：岗位"未标"（none）、labeled = false，项目按仓库猜：new-forecast → forecast，marketing → platform', async () => {
    await hook({ event: 'push', body: push({ repo: 'new-forecast', branch: 'claude/weekly-pack-1102' }) });
    await hook({ event: 'push', body: push({ repo: 'marketing', branch: 'claude/fix-something' }) });
    await hook({ event: 'push', body: push({ repo: 'marketing', branch: 'claude/boss-platform-x' }) });
    const a = await active(T0 + M);
    expect(find(a, 'claude/weekly-pack-1102', 'new-forecast')).toMatchObject({ role: 'none', project: 'forecast', labeled: false });
    expect(find(a, 'claude/fix-something', 'marketing')).toMatchObject({ role: 'none', project: 'platform', labeled: false });
    expect(find(a, 'claude/boss-platform-x', 'marketing')).toMatchObject({ role: 'none', labeled: false });
  });

  it('agents 不合约定的分支：按改动的文件夹猜（项目/forecast/ → forecast，工作平台/ → platform，其他 → company；没改文件 → company）', async () => {
    await hook({ event: 'push', body: push({ branch: 'claude/v0.36-a', files: ['项目/forecast/状态卡.md'] }) });
    await hook({ event: 'push', body: push({ branch: 'claude/v0.36-b', files: ['工作平台/技术方案-工作平台.md', '工作平台/状态卡.md'] }) });
    await hook({ event: 'push', body: push({ branch: 'claude/v0.36-c', files: ['流程/底线细则.md'] }) });
    await hook({ event: 'push', body: push({ branch: 'claude/v0.36-d', files: [] }) });
    const a = await active(T0 + M);
    expect(find(a, 'claude/v0.36-a')).toMatchObject({ role: 'none', project: 'forecast', labeled: false });
    expect(find(a, 'claude/v0.36-b')).toMatchObject({ role: 'none', project: 'platform', labeled: false });
    expect(find(a, 'claude/v0.36-c')).toMatchObject({ role: 'none', project: 'company', labeled: false });
    expect(find(a, 'claude/v0.36-d')).toMatchObject({ role: 'none', project: 'company', labeled: false });
  });

  it('分支名合约定时，项目以分支名为准，不按文件夹猜', async () => {
    await hook({ event: 'push', body: push({ branch: 'claude/pm-platform-scenes', files: ['项目/forecast/状态卡.md'] }) });
    expect(find(await active(T0 + M), 'claude/pm-platform-scenes')).toMatchObject({ role: 'pm', project: 'platform', labeled: true });
  });

  it('分支名不合约定、PR 标题带【岗位·项目】：按标题认出岗位和项目（labeled 仍是 false，页面照样提示分支名没按约定）', async () => {
    await hook({ event: 'pull_request', body: pr({ branch: 'claude/weekly-pack-1109', number: 21, title: '【只看】【市场·forecast】周包 11/9' }) });
    await hook({ event: 'pull_request', body: pr({ branch: 'claude/fix-ci', number: 22, title: '【要你决定】【测试·platform】批 3 验收测试' }) });
    await hook({ event: 'pull_request', body: pr({ branch: 'claude/v0.36', number: 23, title: '【审查·company】v0.36 审查' }) });
    const a = await active(T0 + M);
    expect(find(a, 'claude/weekly-pack-1109')).toMatchObject({ role: 'mkt', project: 'forecast', labeled: false });
    expect(find(a, 'claude/fix-ci')).toMatchObject({ role: 'qa', project: 'platform', labeled: false, decide: true });
    expect(find(a, 'claude/v0.36')).toMatchObject({ role: 'review', project: 'company', labeled: false });
  });

  it('PR 标题七个岗位中文名都认得：主会话、产品、市场、研发、测试、运维安全、审查', async () => {
    const names: [string, string][] = [['主会话', 'main'], ['产品', 'pm'], ['市场', 'mkt'], ['研发', 'dev'], ['测试', 'qa'], ['运维安全', 'ops'], ['审查', 'review']];
    for (const [i, [n]] of names.entries()) await hook({ event: 'pull_request', body: pr({ branch: `claude/x-${i}`, number: 30 + i, title: `【${n}·company】样例` }) });
    const a = await active(T0 + M);
    for (const [i, [n, role]] of names.entries()) expect(find(a, `claude/x-${i}`), n).toMatchObject({ role, project: 'company' });
  });

  it('分支名和 PR 标题都认不出：未标；标题里只有【要你决定】【只看】不算岗位', async () => {
    await hook({ event: 'pull_request', body: pr({ branch: 'claude/v0.33-review-levels', number: 86, title: '【要你决定】第 0.33 版修改建议' }) });
    expect(find(await active(T0 + M), 'claude/v0.33-review-levels')).toMatchObject({ role: 'none', project: 'company', labeled: false, decide: true });
  });

  it('不是 claude/ 开头的分支（Amos 自己在网页上改的）：岗位 amos', async () => {
    await hook({ event: 'push', body: push({ branch: 'patch-1', files: ['README.md'] }) });
    await hook({ event: 'push', body: push({ repo: 'marketing', branch: 'amos-fix' }) });
    const a = await active(T0 + M);
    expect(find(a, 'patch-1')).toMatchObject({ role: 'amos', project: 'company' });
    expect(find(a, 'amos-fix', 'marketing')).toMatchObject({ role: 'amos', project: 'platform' });
  });

  it('workflow_run 按 head_branch 归到那一条（岗位、项目不变）', async () => {
    await hook({ event: 'workflow_run', body: run({ repo: 'new-forecast', branch: 'claude/dev-forecast-signup', conclusion: 'failure' }) });
    expect(find(await active(T0 + M), 'claude/dev-forecast-signup', 'new-forecast')).toMatchObject({ role: 'dev', project: 'forecast', ci: 'failure' });
  });
});

// ======================================================================
describe('C147：代码仓库只给分支名、PR 标题、CI；外部人的标"外部"', () => {
  const MARK = 'ZZ正文标记ZZ';
  const dumpAll = async () => JSON.stringify(await Promise.all(NEW_TABLES.map(async (t) => (await hasTable(db, t) ? (await db.prepare(`SELECT * FROM ${t}`).all()).results : []))));

  it('marketing、new-forecast：提交说明、PR 正文一个字都不显示、不存；PR 标题、CI 照常', async () => {
    for (const repo of ['marketing', 'new-forecast'] as const) {
      const br = `claude/dev-${repo === 'marketing' ? 'platform' : 'forecast'}-c147`;
      await hook({ event: 'push', body: push({ repo, branch: br, msg: `提交说明 ${MARK}`, created: true }) });
      await hook({ event: 'pull_request', body: pr({ repo, branch: br, number: 40, title: '【研发·platform】批 3', body: `PR 正文 ${MARK}`, at: T0 + M }), now: T0 + M });
      await hook({ event: 'workflow_run', body: run({ repo, branch: br, conclusion: 'success', at: T0 + 2 * M }), now: T0 + 2 * M });
    }
    const a = await active(T0 + 3 * M);
    expect(JSON.stringify(a)).not.toContain(MARK);
    expect(await dumpAll()).not.toContain(MARK);
    expect(find(a, 'claude/dev-platform-c147', 'marketing')).toMatchObject({ step: '', title: '【研发·platform】批 3', pr: 40, ci: 'success' });
    expect(find(a, 'claude/dev-forecast-c147', 'new-forecast')).toMatchObject({ step: '', pr: 40, ci: 'success' });
  });

  it('agents：提交说明照常显示（上一步）；PR 正文不存', async () => {
    await hook({ event: 'push', body: push({ branch: 'claude/pm-forecast-x', msg: '状态卡：更新数字' }) });
    await hook({ event: 'pull_request', body: pr({ branch: 'claude/pm-forecast-x', number: 50, title: '【产品·forecast】x', body: `PR 正文 ${MARK}` }) });
    const a = await active(T0 + M);
    expect(find(a, 'claude/pm-forecast-x')).toMatchObject({ step: '状态卡：更新数字', pr: 50 });
    expect(await dumpAll()).not.toContain(MARK);
  });

  it('外部人的 PR（author_association 不是 OWNER / MEMBER / COLLABORATOR）：external，标题含【要你决定】也不进"需要我的事"', async () => {
    await hook({ event: 'pull_request', body: pr({ repo: 'marketing', branch: 'feature-x', number: 60, title: '【要你决定】请合并我的改动', assoc: 'CONTRIBUTOR', user: 'stranger', body: MARK }) });
    await hook({ event: 'pull_request', body: pr({ repo: 'marketing', branch: 'feature-y', number: 61, title: 'docs', assoc: 'NONE', user: 'stranger2' }) });
    await hook({ event: 'pull_request', body: pr({ repo: 'marketing', branch: 'feature-z', number: 62, title: 'ok', assoc: 'COLLABORATOR', user: 'helper' }) });
    const a = await active(T0 + M);
    expect(find(a, 'feature-x', 'marketing')).toMatchObject({ external: true, decide: false, pr: 60, title: '【要你决定】请合并我的改动' });
    expect(find(a, 'feature-y', 'marketing')).toMatchObject({ external: true });
    expect(find(a, 'feature-z', 'marketing')).toMatchObject({ external: false });
    expect(JSON.stringify(a)).not.toContain(MARK);
  });

  it('fork 来的 PR 一律外部，不论作者是谁（含 agents）', async () => {
    await hook({ event: 'pull_request', body: pr({ branch: 'claude/pm-forecast-fork', number: 70, title: '【产品·forecast】x', assoc: 'OWNER', fork: true, user: OWNER, forkOwner: 'someone-fork' }) });
    // 测试用例修正（批 3 审查 R1）：fork 来的单独成行，分支那一格可能带 fork 所有者前缀，按 PR 号找
    const a = await active(T0 + M);
    const x = [...a.items, ...a.ended].filter((i) => i.pr === 70);
    expect(x.length).toBe(1);
    expect(x[0]).toMatchObject({ external: true, decide: false });
  });

  it('外部人的推送（sender 不是仓库主人）：external，提交说明不显示（agents 也一样）', async () => {
    await hook({ event: 'push', body: push({ branch: 'claude/pm-forecast-ext', msg: `外部的提交 ${MARK}`, sender: 'stranger' }) });
    await hook({ event: 'push', body: push({ branch: 'claude/pm-forecast-own', msg: '自己的提交' }) });
    const a = await active(T0 + M);
    expect(find(a, 'claude/pm-forecast-ext')).toMatchObject({ external: true, step: '' });
    expect(find(a, 'claude/pm-forecast-own')).toMatchObject({ external: false, step: '自己的提交' });
    expect(JSON.stringify(a)).not.toContain(MARK);
  });
});

// ======================================================================
describe('时间：2 小时变灰、24 小时进"最近结束"（P-5）、30 天删（P-7）', () => {
  it('2 小时差 1 毫秒不灰，正好 2 小时变灰（idle），还在进行中', async () => {
    await hook({ event: 'push', body: push({ branch: 'claude/pm-forecast-w', at: T0 }), now: T0 });
    expect(find(await active(T0 + 2 * H - 1), 'claude/pm-forecast-w')).toMatchObject({ idle: false, _in: 'items', end: null });
    expect(find(await active(T0 + 2 * H), 'claude/pm-forecast-w')).toMatchObject({ idle: true, _in: 'items', end: null });
  });

  it('24 小时差 1 毫秒还在进行中；正好 24 小时移进最近结束（end = timeout）', async () => {
    await hook({ event: 'push', body: push({ branch: 'claude/pm-forecast-w', at: T0 }), now: T0 });
    expect(find(await active(T0 + D - 1), 'claude/pm-forecast-w')).toMatchObject({ _in: 'items', idle: true });
    expect(find(await active(T0 + D), 'claude/pm-forecast-w')).toMatchObject({ _in: 'ended', end: 'timeout' });
  });

  it('变灰以后又有新事件：马上不灰；进了最近结束以后又推：回到进行中', async () => {
    await hook({ event: 'push', body: push({ branch: 'claude/pm-forecast-w', at: T0 }), now: T0 });
    await hook({ event: 'push', body: push({ branch: 'claude/pm-forecast-w', msg: '又动了', at: T0 + 3 * H }), now: T0 + 3 * H });
    expect(find(await active(T0 + 3 * H + M), 'claude/pm-forecast-w')).toMatchObject({ idle: false, step: '又动了' });
    await hook({ event: 'push', body: push({ branch: 'claude/pm-forecast-w', msg: '隔天再动', at: T0 + 2 * D }), now: T0 + 2 * D });
    expect(find(await active(T0 + 2 * D + M), 'claude/pm-forecast-w')).toMatchObject({ _in: 'items', end: null, idle: false, step: '隔天再动' });
  });

  it('时间按事件里的时间算：事件晚到（收到时已经是 3 小时前的推送）直接是灰的', async () => {
    await hook({ event: 'push', body: push({ branch: 'claude/pm-forecast-late', at: T0 - 3 * H }), now: T0 });
    expect(find(await active(T0), 'claude/pm-forecast-late')).toMatchObject({ idle: true, at: T0 - 3 * H });
  });

  it('active_log 写入时顺手删 30 天前的：29 天前的留着，31 天前的删掉', async () => {
    await hook({ event: 'push', body: push({ branch: 'claude/pm-forecast-log', msg: '第一条', at: T0 }), now: T0 });
    await hook({ event: 'push', body: push({ branch: 'claude/pm-forecast-log', msg: '第二条', at: T0 + 29 * D }), now: T0 + 29 * D });
    expect(await count('active_log')).toBe(2);
    await hook({ event: 'push', body: push({ branch: 'claude/pm-forecast-log', msg: '第三条', at: T0 + 31 * D }), now: T0 + 31 * D });
    expect(await count('active_log')).toBe(2);
  });

  it('lastAt：最近一次收到验签通过的事件；签名不对的不算', async () => {
    await hook({ event: 'ping', body: ping(), now: T0 });
    await hook({ event: 'ping', body: ping(), now: T0 + H, sig: sign('x') });
    const a = await active(T0 + 3 * H);
    expect(a.lastAt).toBe(T0);
    expect(a.badSigAt).toBe(T0 + H);
  });
});

// ======================================================================
describe('防护：限流、并发、乱序、合并时一串事件（C139）', () => {
  const minute = Math.floor(T0 / M);
  const base = minute * M;

  it('每个仓库每分钟 120 次：第 120 个不 429，第 121 个 429；limitedAt 记下；别的仓库、下一分钟不受影响', async () => {
    for (let i = 1; i <= 120; i++) {
      const r = await hook({ event: 'push', body: push({ repo: 'marketing', branch: `claude/dev-platform-r${i % 5}` }), now: base + i * 100 });
      expect(r.status, `第 ${i} 个`).not.toBe(429);
    }
    expect((await active(base + 12_500)).limitedAt).toBeNull();
    const r121 = await hook({ event: 'push', body: push({ repo: 'marketing', branch: 'claude/dev-platform-r0' }), now: base + 12_100 });
    expect(r121.status).toBe(429);
    expect((await active(base + 13_000)).limitedAt).not.toBeNull();
    expect((await hook({ event: 'push', body: push({ repo: 'agents', branch: 'claude/pm-forecast-q' }), now: base + 12_200 })).status).toBe(200);
    expect((await hook({ event: 'push', body: push({ repo: 'marketing', branch: 'claude/dev-platform-r0' }), now: base + M + 1 })).status).toBe(200);
  });

  it('20 个请求并发：都收下，计数正好 20（company_rate 的 gh:* 行）', async () => {
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => hook({ event: 'push', body: push({ branch: `claude/dev-platform-p${i}` }), now: base + 1000 })));
    expect(rs.map((r) => r.status)).toEqual(Array(20).fill(200));
    expect(await ghRate(minute)).toBe(20);
    expect((await active(base + 2000)).items.length).toBe(20);
  });

  it('125 个请求并发打进同一个仓库：正好 120 个收下、5 个 429', async () => {
    const rs = await Promise.all(Array.from({ length: 125 }, (_, i) => hook({ event: 'push', body: push({ branch: `claude/dev-platform-c${i}` }), now: base + 1000 })));
    const st = rs.map((r) => r.status);
    expect(st.filter((s) => s === 429).length).toBe(5);
    expect(st.filter((s) => s === 200).length).toBe(120);
  });

  it('同一分支两次推送乱序到达：先到的是新的，后到的旧事件不让"上一步"和时间倒退', async () => {
    const br = 'claude/pm-forecast-order';
    await hook({ event: 'push', body: push({ branch: br, msg: '第二步', at: T0 + 2 * M }), now: T0 + 3 * M });
    await hook({ event: 'push', body: push({ branch: br, msg: '第一步', at: T0 + M }), now: T0 + 3 * M + 1000 });
    expect(find(await active(T0 + 4 * M), br)).toMatchObject({ step: '第二步', at: T0 + 2 * M });
  });

  it('同一时间戳的两个事件：后到的覆盖（"不早于"就覆盖）', async () => {
    const br = 'claude/pm-forecast-same';
    await hook({ event: 'push', body: push({ branch: br, msg: '甲', at: T0 }), now: T0 });
    await hook({ event: 'push', body: push({ branch: br, msg: '乙', at: T0 }), now: T0 + 1 });
    expect(find(await active(T0 + M), br)).toMatchObject({ step: '乙' });
  });

  it('PR 合并后才到的旧推送：还在"最近结束"、不回到进行中', async () => {
    const br = 'claude/pm-forecast-late2';
    await hook({ event: 'pull_request', body: pr({ branch: br, number: 80, title: 'x', action: 'closed', merged: true, at: T0 + 5 * M }), now: T0 + 5 * M });
    await hook({ event: 'push', body: push({ branch: br, msg: '旧推送', at: T0 + 4 * M }), now: T0 + 5 * M + 1000 });
    expect(find(await active(T0 + 6 * M), br)).toMatchObject({ _in: 'ended', end: 'merged' });
  });

  it('合并一个 PR 时的一串事件（push main、pull_request closed、delete、两个 workflow 各 3 次 workflow_run，共 10 个）几乎同时乱序到达：都 2xx、写对', async () => {
    const br = 'claude/dev-platform-merge';
    const t = base + 2000;
    await hook({ event: 'push', body: push({ repo: 'marketing', branch: br, msg: '开工', created: true, at: t - 30 * M }), now: t - 30 * M });
    await hook({ event: 'pull_request', body: pr({ repo: 'marketing', branch: br, number: 90, title: '【研发·platform】批 3', at: t - 20 * M }), now: t - 20 * M });
    const burst: HookOpt[] = [
      { event: 'push', body: push({ repo: 'marketing', branch: 'staging', msg: 'Merge pull request #90', at: t }) },
      { event: 'pull_request', body: pr({ repo: 'marketing', branch: br, number: 90, title: '【研发·platform】批 3', action: 'closed', merged: true, at: t }) },
      { event: 'delete', body: del({ repo: 'marketing', branch: br }) },
      ...['ci', 'company'].flatMap((name) => ['requested', 'in_progress', 'completed'].map((action) => ({ event: 'workflow_run', body: run({ repo: 'marketing', branch: 'staging', name, action, conclusion: 'success', at: t + 1000 }) }))),
      { event: 'workflow_run', body: run({ repo: 'marketing', branch: br, name: 'ci', conclusion: 'success', at: t - 1000 }) },
    ];
    expect(burst.length).toBe(10);
    const order = [7, 2, 9, 0, 5, 1, 8, 3, 6, 4];
    const rs = await Promise.all(order.map((k, i) => hook({ ...burst[k], now: t + i * 300 })));
    for (const [i, r] of rs.entries()) expect(r.status, `${burst[order[i]].event} #${order[i]}`).toBeGreaterThanOrEqual(200);
    for (const [i, r] of rs.entries()) expect(r.status, `${burst[order[i]].event} #${order[i]}`).toBeLessThan(300);
    const a = await active(t + 5000);
    expect(find(a, br, 'marketing')).toMatchObject({ _in: 'ended', end: 'merged', pr: 90, ci: 'success', role: 'dev', project: 'platform' });
    expect(await count('gh_delivery')).toBe(12);
  });
});

// ======================================================================
describe('开关（settings 的 hook:github，默认开）', () => {
  it('后台切开关：没登录 401、跨站 403、请求不对 400；切了以后 GET /api/active 的 on 跟着变', async () => {
    ck = ck || (await cookie());
    expect((await handle(page('/api/hook', { method: 'POST', body: JSON.stringify({ on: false }) }), env(), T0)).status).toBe(401);
    expect((await setHook(false, T0, 'https://evil.example')).status).toBe(403);
    expect((await setHook('否')).status).toBe(400);
    expect((await active()).on).toBe(true);
    const r = await setHook(false);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, on: false });
    expect((await active()).on).toBe(false);
    expect(await getJsonOk(setHook(true))).toEqual({ ok: true, on: true });
    expect((await active()).on).toBe(true);
  });

  it('关着：验签通过的事件一律回 200、不写库（进度表、投递编号、限流计数都不动，只读开关）；签名不对照样 401', async () => {
    ck = ck || (await cookie());
    await hook({ event: 'push', body: push({ branch: 'claude/pm-forecast-before', created: true }) });
    expect((await setHook(false)).status).toBe(200);
    const before = await Promise.all([...NEW_TABLES, 'company_rate'].map((t) => count(t)));
    const rateBefore = await ghRate(Math.floor(T0 / M));
    for (const [event, body] of [
      ['push', push({ branch: 'claude/pm-forecast-off', created: true })],
      ['pull_request', pr({ branch: 'claude/pm-forecast-off', number: 5, title: 'x' })],
      ['workflow_run', run({ branch: 'claude/pm-forecast-off', conclusion: 'failure' })],
      ['delete', del({ branch: 'claude/pm-forecast-before' })],
      ['ping', ping()],
    ] as [string, unknown][]) {
      const s = spyDb(db);
      const r = await hook({ event, body, now: T0 + 1000, e: env({}, s.db) });
      expect(r.status, event).toBe(200);
      expect(s.sql.filter(isWrite), event).toEqual([]);
    }
    expect(await Promise.all([...NEW_TABLES, 'company_rate'].map((t) => count(t)))).toEqual(before);
    expect(await ghRate(Math.floor(T0 / M))).toBe(rateBefore);
    expect((await hook({ event: 'push', body: push({ branch: 'claude/pm-forecast-off' }), sig: sign('x'), now: T0 + 2000 })).status).toBe(401);
    const a = await active(T0 + 3000);
    expect(a.on).toBe(false);
    expect(find(a, 'claude/pm-forecast-off')).toBeUndefined();
    expect(find(a, 'claude/pm-forecast-before')).toMatchObject({ _in: 'items' });
    // 再打开：下一次事件照常写
    expect((await setHook(true)).status).toBe(200);
    expect((await hook({ event: 'push', body: push({ branch: 'claude/pm-forecast-off' }), now: T0 + 4000 })).status).toBe(200);
    expect(find(await active(T0 + 5000), 'claude/pm-forecast-off')).toMatchObject({ _in: 'items' });
  });
});
const getJsonOk = async (r: Promise<Response>) => { const x = await r; expect(x.status).toBe(200); return x.json(); };

// ======================================================================
describe('不影响别的功能（这组在改动前就是绿的，之后必须一直绿）', () => {
  it('推送接口每分钟 6 次照旧，和 Webhook 分开算：同一分钟 Webhook 来了很多次，推送接口第 1～6 次照样 200、第 7 次 429', async () => {
    for (let i = 0; i < 10; i++) await hook({ event: 'push', body: push({ branch: `claude/pm-forecast-n${i}` }), now: T0 + i });
    const ingest = (now: number) => handle(new Request(`${HOST}/api/company/ingest`, { method: 'POST', headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' }, body: JSON.stringify({ source: 'agents', blocks: [{ kind: 'ci', key: '', payload: { name: 'ci', conclusion: 'success' } }] }) }), env(), now);
    for (let i = 0; i < 6; i++) expect((await ingest(T0 + 100 + i)).status, `第 ${i + 1} 次`).toBe(200);
    expect((await ingest(T0 + 200)).status).toBe(429);
  });

  it('/v1/* 不受影响：插件请求照旧；/v1/ 下没有 hooks，/api/hooks/github 也不是入口', async () => {
    const v1 = (p: string) => new Request(`${HOST}${p}`, { headers: { origin: ORIGIN, authorization: `Bearer ${TOKEN}` } });
    const t = await handle(v1('/v1/today'), env(), T0);
    expect(t.status).toBe(200);
    expect(Object.keys((await t.json()) as object).sort()).toEqual(['approved', 'cap', 'day', 'items', 'saved', 'skipped']);
    const body = JSON.stringify(ping());
    const h = { 'content-type': 'application/json', 'x-github-event': 'ping', 'x-github-delivery': randomUUID(), 'x-hub-signature-256': sign(body) };
    expect((await handle(new Request(`${HOST}/v1/hooks/github`, { method: 'POST', headers: { ...h, origin: ORIGIN, authorization: `Bearer ${TOKEN}` }, body }), env(), T0)).status).toBe(404);
    expect((await handle(new Request(`${HOST}/api/hooks/github`, { method: 'POST', headers: h, body }), env(), T0)).status).not.toBe(200);
  });

  it('签名密钥只用 COMPANY_INGEST_TOKEN（不新增变量名）：src/env.ts 没有 GITHUB_WEBHOOK_SECRET', () => {
    expect(readFileSync(path.join(ROOT, 'src/env.ts'), 'utf8')).not.toMatch(/GITHUB_WEBHOOK_SECRET/);
  });
});

// ======================================================================
// 批 3 审查"改完再审"（🔴 R1、🟡 R2 R4 R5 R6；R3、R8 在 scripts/e2e-live.mjs）：测试先写，研发再改
describe('审查 R1：外部 fork 用同名分支开 PR、跑 CI、关 PR，不能改内部同名分支那一行', () => {
  const BR = 'claude/dev-platform-same';
  const all = (a: Active) => [...a.items.map((x) => ({ ...x, _in: 'items' })), ...a.ended.map((x) => ({ ...x, _in: 'ended' }))];
  const inner = (a: Active) => { const x = all(a).filter((i) => i.repo === 'marketing' && i.branch === BR && !i.external); expect(x.length, '内部那一行正好一条').toBe(1); return x[0]; };
  const outer = (a: Active) => all(a).filter((i) => i.repo === 'marketing' && i.external && i.pr === 41);
  async function seedInner() {
    await hook({ event: 'push', body: push({ repo: 'marketing', branch: BR, msg: '开工', created: true, at: T0 }), now: T0 });
    await hook({ event: 'pull_request', body: pr({ repo: 'marketing', branch: BR, number: 40, title: '【要你决定】【研发·platform】内部的', at: T0 + M }), now: T0 + M });
    await hook({ event: 'workflow_run', body: run({ repo: 'marketing', branch: BR, conclusion: 'success', at: T0 + 2 * M }), now: T0 + 2 * M });
    const x = inner(await active(T0 + 3 * M));
    expect(x).toMatchObject({ pr: 40, title: '【要你决定】【研发·platform】内部的', decide: true, ci: 'success', end: null, _in: 'items' });
    return x;
  }
  const keep = (x: Item & { _in: string }) => ({ pr: x.pr, title: x.title, decide: x.decide, ci: x.ci, end: x.end, url: x.url, external: x.external, _in: x._in });
  const ext = (o: Partial<PrOpt> = {}) => pr({ repo: 'marketing', branch: BR, number: 41, title: '外部人同名分支的 PR', assoc: 'CONTRIBUTOR', fork: true, user: 'stranger', forkOwner: 'stranger', ...o });

  it('fork 开 PR：内部那一行 pr、title、decide、ci、end 都不变；外部的单独一行（external、pr 41）', async () => {
    const before = keep(await seedInner());
    await hook({ event: 'pull_request', body: ext({ at: T0 + 4 * M }), now: T0 + 4 * M });
    const a = await active(T0 + 5 * M);
    expect(keep(inner(a))).toEqual(before);
    const o = outer(a);
    expect(o.length, '外部的单独成行').toBe(1);
    expect(o[0]).toMatchObject({ external: true, pr: 41, decide: false, end: null });
  });

  it('fork 的 CI 红了：内部那一行 ci 还是 success；红的记在外部那一行', async () => {
    const before = keep(await seedInner());
    await hook({ event: 'pull_request', body: ext({ at: T0 + 4 * M }), now: T0 + 4 * M });
    await hook({ event: 'workflow_run', body: run({ repo: 'marketing', branch: BR, conclusion: 'failure', forkOwner: 'stranger', at: T0 + 5 * M }), now: T0 + 5 * M });
    const a = await active(T0 + 6 * M);
    expect(keep(inner(a))).toEqual(before);
    const o = outer(a);
    expect(o.length).toBe(1);
    expect(o[0]).toMatchObject({ ci: 'failure', external: true });
  });

  it('fork 的 CI 先到（之前没开 PR）：也不改内部那一行', async () => {
    const before = keep(await seedInner());
    await hook({ event: 'workflow_run', body: run({ repo: 'marketing', branch: BR, conclusion: 'failure', forkOwner: 'stranger', at: T0 + 5 * M }), now: T0 + 5 * M });
    expect(keep(inner(await active(T0 + 6 * M)))).toEqual(before);
  });

  it('fork 关 PR（没合并）：内部那一行还在进行中、end 不变；外部那一行进最近结束"没合并就关了"', async () => {
    const before = keep(await seedInner());
    await hook({ event: 'pull_request', body: ext({ at: T0 + 4 * M }), now: T0 + 4 * M });
    await hook({ event: 'pull_request', body: ext({ action: 'closed', at: T0 + 6 * M }), now: T0 + 6 * M });
    const a = await active(T0 + 7 * M);
    expect(keep(inner(a))).toEqual(before);
    const o = outer(a);
    expect(o.length).toBe(1);
    expect(o[0]).toMatchObject({ end: 'closed', _in: 'ended' });
  });

  it('两个不同的 fork 用同一个分支名：各自一行，互不覆盖', async () => {
    await seedInner();
    await hook({ event: 'pull_request', body: ext({ at: T0 + 4 * M }), now: T0 + 4 * M });
    await hook({ event: 'pull_request', body: ext({ number: 42, user: 'other', forkOwner: 'other', title: '另一个外部人', at: T0 + 5 * M }), now: T0 + 5 * M });
    const a = await active(T0 + 6 * M);
    const ex = all(a).filter((i) => i.repo === 'marketing' && i.external).map((i) => i.pr).sort();
    expect(ex).toEqual([41, 42]);
  });
});

describe('审查 R2：第一次处理时 D1 batch 抛错，GitHub 用同一个投递编号重送要正常处理', () => {
  /** batch 第一次调用抛错（模拟 D1 临时出错），其余照常 */
  function failingBatchDb(d: D1Database): D1Database {
    let failed = false;
    return new Proxy(d, {
      get(t, k) {
        if (k === 'batch') return async (st: D1PreparedStatement[]) => { if (!failed) { failed = true; throw new Error('模拟 D1 batch 出错'); } return t.batch(st); };
        const v = Reflect.get(t, k);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
  }
  it('第一次 batch 抛错（回 5xx 或抛出）；同一投递编号重送：200、不是 duplicate、库里有这一条', async () => {
    const id = randomUUID();
    const body = push({ branch: 'claude/pm-forecast-retry', msg: '开工', created: true });
    const first = await hook({ event: 'push', body, delivery: id, e: env({}, failingBatchDb(db)) }).catch((e: unknown) => e);
    if (first instanceof Response) expect(first.status, '第一次没写成不能回 2xx（GitHub 才会知道要重送）').toBeGreaterThanOrEqual(500);
    expect(await count('active_item'), '第一次没写成').toBe(0);
    const r = await hook({ event: 'push', body, delivery: id, now: T0 + M });
    expect(r.status).toBe(200);
    const j = (await r.json()) as Record<string, unknown>;
    expect(j.duplicate, '重送不能当成重复').toBeFalsy();
    expect(find(await active(T0 + 2 * M), 'claude/pm-forecast-retry')).toMatchObject({ step: '开工', _in: 'items' });
    expect(await count('active_log')).toBe(1);
    // 再送第三次才是真的重复
    const r3 = await hook({ event: 'push', body, delivery: id, now: T0 + 3 * M });
    expect(r3.status).toBe(200);
    expect(await count('active_log')).toBe(1);
  });
});

describe('审查 R4：PR 的 user.type === "Bot" 一律外部', () => {
  it('机器人的 PR（author_association 是 OWNER / MEMBER / COLLABORATOR 也一样）：external、标题有【要你决定】也不进"需要我的事"', async () => {
    for (const [i, assoc] of ['OWNER', 'MEMBER', 'COLLABORATOR', 'NONE'].entries()) {
      await hook({ event: 'pull_request', body: pr({ repo: 'marketing', branch: `dependabot/npm/x-${i}`, number: 100 + i, title: '【要你决定】Bump x', assoc, user: 'dependabot[bot]', userType: 'Bot' }) });
    }
    const a = await active(T0 + M);
    for (let i = 0; i < 4; i++) expect(find(a, `dependabot/npm/x-${i}`, 'marketing'), `第 ${i} 个`).toMatchObject({ external: true, decide: false });
  });
});

describe('审查 R5：缺 X-Hub-Signature-256 或 X-GitHub-Event 头：直接 401，不读请求体、不写 hook:bad_sig_at、不碰 D1', () => {
  function bare(drop: string): Request {
    const raw = JSON.stringify(push({ branch: 'claude/pm-forecast-nohdr' }));
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-github-event': 'push', 'x-github-delivery': randomUUID(), 'x-hub-signature-256': sign(raw) };
    delete headers[drop];
    return new Request(`${HOST}/hooks/github`, { method: 'POST', headers, body: raw });
  }
  for (const drop of ['x-hub-signature-256', 'x-github-event']) {
    it(`缺 ${drop}：401；请求体没读（bodyUsed = false）；D1 一条语句都没执行`, async () => {
      const s = spyDb(db);
      const req = bare(drop);
      const r = await handle(req, env({}, s.db), T0);
      expect(r.status).toBe(401);
      expect(req.bodyUsed, '请求体没读').toBe(false);
      expect(s.sql, '不碰 D1').toEqual([]);
      expect(await db.prepare("SELECT value FROM settings WHERE key = 'hook:bad_sig_at'").first()).toBeNull();
      for (const t of NEW_TABLES) expect(await count(t), t).toBe(0);
    });
  }
});

describe('审查 R6："最近结束"只显示 7 天内的（原型 v2 第 274 行）；记录照样留 30 天', () => {
  it('显示窗口：合并了的，7 天差 1 毫秒还在 ended；正好 7 天不在了', async () => {
    await hook({ event: 'pull_request', body: pr({ branch: 'claude/pm-forecast-done', number: 9, title: 'x', action: 'closed', merged: true, at: T0 }), now: T0 });
    expect(find(await active(T0 + 7 * D - 1), 'claude/pm-forecast-done')).toMatchObject({ _in: 'ended', end: 'merged' });
    expect(find(await active(T0 + 7 * D), 'claude/pm-forecast-done')).toBeUndefined();
  });

  it('显示窗口：一天没动静收起来的（timeout），从最后一次事件算 7 天后也不显示了', async () => {
    await hook({ event: 'push', body: push({ branch: 'claude/pm-forecast-quiet', at: T0 }), now: T0 });
    expect(find(await active(T0 + 7 * D - 1), 'claude/pm-forecast-quiet')).toMatchObject({ _in: 'ended', end: 'timeout' });
    expect(find(await active(T0 + 7 * D), 'claude/pm-forecast-quiet')).toBeUndefined();
  });

  it('保留期限（和显示分开断言，只看库）：过了 7 天显示窗口，库里 active_item、active_log 照样还在；第 8 天、第 29 天都在（现在就绿，守住 30 天不被显示窗口带着删）', async () => {
    await hook({ event: 'pull_request', body: pr({ branch: 'claude/pm-forecast-done', number: 9, title: 'x', action: 'closed', merged: true, at: T0 }), now: T0 });
    // 别的分支在第 8 天、第 29 天各来一次事件（会触发"顺手删 30 天前的"），这一条不能被删
    await hook({ event: 'push', body: push({ branch: 'claude/pm-forecast-other', at: T0 + 8 * D }), now: T0 + 8 * D });
    await active(T0 + 8 * D); // 读一次（显示窗口在读的时候算，不能顺手把库里的删了）
    const rows = async () => (await db.prepare("SELECT COUNT(*) AS n FROM active_item WHERE branch = 'claude/pm-forecast-done'").first<{ n: number }>())!.n;
    const logs = async () => (await db.prepare("SELECT COUNT(*) AS n FROM active_log WHERE branch = 'claude/pm-forecast-done'").first<{ n: number }>())!.n;
    expect(await rows()).toBe(1);
    expect(await logs()).toBe(1);
    await hook({ event: 'push', body: push({ branch: 'claude/pm-forecast-other', at: T0 + 29 * D }), now: T0 + 29 * D });
    expect(await rows()).toBe(1);
    expect(await logs()).toBe(1);
  });
});

// ======================================================================
// 批 3 复审（🔴 R1b、🟡 R2 的 catch 抓得太宽）：测试先写，研发再改
describe('复审 R1b：外部人开着 PR 时删了 fork（head.repo = null），之后的 closed / synchronize 不能改内部同名分支那一行', () => {
  const BR = 'claude/dev-platform-gone';
  const all = (a: Active) => [...a.items.map((x) => ({ ...x, _in: 'items' })), ...a.ended.map((x) => ({ ...x, _in: 'ended' }))];
  const inner = (a: Active) => { const x = all(a).filter((i) => i.repo === 'marketing' && i.branch === BR && !i.external); expect(x.length, '内部那一行正好一条').toBe(1); return x[0]; };
  const keep = (x: Item & { _in: string }) => ({ pr: x.pr, title: x.title, decide: x.decide, ci: x.ci, end: x.end, external: x.external, _in: x._in });
  async function seedInner() {
    await hook({ event: 'push', body: push({ repo: 'marketing', branch: BR, msg: '开工', created: true, at: T0 }), now: T0 });
    await hook({ event: 'pull_request', body: pr({ repo: 'marketing', branch: BR, number: 5, title: '【要你决定】【研发·platform】内部的', at: T0 + M }), now: T0 + M });
    await hook({ event: 'workflow_run', body: run({ repo: 'marketing', branch: BR, conclusion: 'success', at: T0 + 2 * M }), now: T0 + 2 * M });
    const x = inner(await active(T0 + 3 * M));
    expect(x).toMatchObject({ pr: 5, decide: true, ci: 'success', end: null, _in: 'items' });
    return keep(x);
  }
  /** fork 删掉以后 GitHub 发的 PR 事件：head.repo 是 null，head.label / head.user 还在 */
  const gone = (action: string, at: number) => {
    const ev = pr({ repo: 'marketing', branch: BR, number: 99, title: '外部人的 PR', action, assoc: 'NONE', fork: true, user: 'evil', forkOwner: 'evil', at }) as { pull_request: { head: Record<string, unknown> } };
    ev.pull_request.head.repo = null;
    return ev;
  };

  it('fork 还在时开了 PR，删 fork 后 closed：内部那一行 pr、title、decide、ci、end 都不变', async () => {
    const before = await seedInner();
    await hook({ event: 'pull_request', body: pr({ repo: 'marketing', branch: BR, number: 99, title: '外部人的 PR', assoc: 'NONE', fork: true, user: 'evil', forkOwner: 'evil', at: T0 + 4 * M }), now: T0 + 4 * M });
    await hook({ event: 'pull_request', body: gone('closed', T0 + 6 * M), now: T0 + 6 * M });
    expect(keep(inner(await active(T0 + 7 * M)))).toEqual(before);
  });

  it('删 fork 后 synchronize：内部那一行不变', async () => {
    const before = await seedInner();
    await hook({ event: 'pull_request', body: gone('synchronize', T0 + 5 * M), now: T0 + 5 * M });
    expect(keep(inner(await active(T0 + 6 * M)))).toEqual(before);
  });

  it('只收到删 fork 后的事件（synchronize 再 closed，之前没见过这个 PR）：内部那一行不变；外部那一条（pr 99）标 external、不进"需要我的事"', async () => {
    const before = await seedInner();
    await hook({ event: 'pull_request', body: gone('synchronize', T0 + 5 * M), now: T0 + 5 * M });
    await hook({ event: 'pull_request', body: gone('closed', T0 + 6 * M), now: T0 + 6 * M });
    const a = await active(T0 + 7 * M);
    expect(keep(inner(a))).toEqual(before);
    for (const x of all(a).filter((i) => i.pr === 99)) expect(x).toMatchObject({ external: true, decide: false });
  });
});

describe('复审 R2：处理时出别的约束错误（例如 NOT NULL constraint failed），要回 503、不能当重复回 200；重送同一编号能写进去', () => {
  /** batch 第一次调用抛 D1 的 NOT NULL 约束错误，其余照常 */
  function notNullOnce(d: D1Database): D1Database {
    let failed = false;
    return new Proxy(d, {
      get(t, k) {
        if (k === 'batch') return async (st: D1PreparedStatement[]) => {
          if (!failed) { failed = true; throw new Error('D1_ERROR: NOT NULL constraint failed: active_item.role: SQLITE_CONSTRAINT'); }
          return t.batch(st);
        };
        const v = Reflect.get(t, k);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
  }
  it('NOT NULL 约束错误：503（不是 200 duplicate）；同一投递编号重送 200、不是 duplicate、库里有这一条', async () => {
    const id = randomUUID();
    const body = push({ repo: 'marketing', branch: 'claude/dev-platform-nn', msg: '开工', created: true });
    const r1 = await hook({ event: 'push', body, delivery: id, e: env({}, notNullOnce(db)) });
    const j1 = (await r1.json().catch(() => ({}))) as Record<string, unknown>;
    expect({ status: r1.status, duplicate: j1.duplicate ?? null }).toEqual({ status: 503, duplicate: null });
    expect(await count('active_item')).toBe(0);
    const r2 = await hook({ event: 'push', body, delivery: id, now: T0 + M });
    expect(r2.status).toBe(200);
    expect(((await r2.json()) as Record<string, unknown>).duplicate, '重送不能当成重复').toBeFalsy();
    expect(find(await active(T0 + 2 * M), 'claude/dev-platform-nn', 'marketing')).toMatchObject({ _in: 'items' });
  });
});
