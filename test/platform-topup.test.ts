/**
 * 工作台认出新项目 TopUP 的验收测试（Amos 2026-11-13："工作台为新项目开辟 TopUP菜单显示进度和问题"；agents main 04a0314 已立项）。
 * 测试会话先写（agents C154）：写的时候实现还没改，"要改的"几组现在是红的；研发改 src 到全绿，不改这里的断言（底线 6）。
 * "不能变"的断言（new-forecast → forecast、fork / 外部人规则、白名单外 202）在改动前就是绿的，之后必须一直绿。
 *
 * 覆盖：
 *   ① src/projects.ts REPO_PROJECT：TopUP 代码仓库（GitHub dollar3651314/TopUP）推来的 PR / CI 归到项目 TopUP；
 *      键按 GitHub 返回的仓库名 TopUP，也认小写 topup（上报脚本的来源名按惯例是小写，同 marketing）；值和 agents 项目版图里的项目名一样写 TopUP。
 *   ② 推送接口（/api/company/ingest）认来源 topup：和 new-forecast、marketing 一样只能报 prs / ci（扩展项，见下面说明）。
 *   ③ src/hooks.ts Webhook 仓库白名单：收 dollar3651314/TopUP（不分大小写）；push / pull_request / workflow_run 都归到项目 TopUP
 *      （项目页"团队在做什么"按 x.project === 当前项目名 过滤，所以要和项目名一字不差）；C147 代码仓库不存提交说明；
 *      fork 来的、外部人的照旧标外部；别人名下的 TopUP 仓库照旧 202。
 *   ④ agents 不合约定的分支改了 项目/TopUP/ 下的文件 → 项目 TopUP（同 项目/forecast/ → forecast；扩展项）。
 *   ⑤ 工作台项目页：projects 块里有 TopUP 时项目名单原样带 TopUP（大小写不变），上限、填数字都认它。
 *
 * 超出任务字面的两项（单独标出，C7）：② ingest 来源白名单、④ agents 文件夹猜项目。不加的话 ① 的 REPO_PROJECT 永远用不上
 * （TopUP 仓库推不进 prs / ci 块），agents 里 TopUP 的改动也只会落到"公司"。研发 / 主会话不同意可以在 PR 里说，测试再改。
 */
import { createHmac, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import { PROJECT_PAGES_FALLBACK, REPO_PROJECT, projectPagesFrom } from '../src/projects';
import { ROOT, T0 } from './helpers';

const SECRET = 'ci_only_webhook_secret_0123456789abcdef';
const PASS = 'ci_only_copilot_password_01';
const HOST = 'https://copilot.example.test';
const OWNER = 'dollar3651314';
const M = 60_000;
const MIG = path.join(ROOT, 'migrations');
const TABLES = ['company_snapshot', 'company_done', 'company_rate', 'company_report', 'auth_fail', 'auth_lock', 'settings', 'active_item', 'active_log', 'gh_delivery'];

const stmtsOf = (files: string[]) => files.map((f) => readFileSync(path.join(MIG, f), 'utf8').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n'))
  .join(';\n').split(';').map((s) => s.trim()).filter(Boolean);

let db: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  const p = await getPlatformProxy<{ DB: D1Database }>({ configPath: path.join(ROOT, 'test/wrangler.test.toml'), persist: false, remoteBindings: false, envFiles: [] });
  db = p.env.DB;
  dispose = p.dispose;
  await db.batch(stmtsOf(readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort()).map((s) => db.prepare(s)));
});
afterAll(async () => dispose());
beforeEach(async () => { await db.batch(TABLES.map((t) => db.prepare(`DELETE FROM ${t}`))); });

const env = (): Env => ({ DB: db, ENVIRONMENT: 'test', COPILOT_PASSWORD: PASS, COMPANY_INGEST_TOKEN: SECRET });
const page = (p: string, init: RequestInit & { cookie?: string } = {}) =>
  new Request(`${HOST}${p}`, { ...init, headers: { 'content-type': 'application/json', origin: HOST, 'cf-connecting-ip': '203.0.113.9', ...(init.cookie ? { cookie: init.cookie } : {}) } });
async function cookie(): Promise<string> {
  const r = await handle(page('/api/login', { method: 'POST', body: JSON.stringify({ password: PASS }) }), env(), T0);
  return r.headers.get('set-cookie')!.split(';')[0];
}
const ingest = (body: unknown, now = T0) =>
  handle(new Request(`${HOST}/api/company/ingest`, { method: 'POST', headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }), env(), now);

// ---------------- GitHub 样例事件（同 test/platform-batch3.test.ts 的结构，只留会读的字段） ----------------
const iso = (ms: number) => new Date(ms).toISOString();
const repoObj = (full: string) => ({ id: 1, name: full.split('/')[1], full_name: full, private: true, owner: { login: full.split('/')[0], type: 'User' }, html_url: `https://github.com/${full}` });
function push(o: { repo: string; branch: string; msg?: string; files?: string[]; sender?: string }) {
  const c = { id: 'c'.repeat(40), message: o.msg ?? '开工', timestamp: iso(T0), url: `https://github.com/${o.repo}/commit/c`, author: { name: 'Claude', username: o.sender ?? OWNER }, added: o.files ?? [], removed: [], modified: [] };
  return { ref: `refs/heads/${o.branch}`, before: 'a'.repeat(40), after: 'b'.repeat(40), created: false, deleted: false, forced: false, repository: repoObj(o.repo), pusher: { name: o.sender ?? OWNER }, sender: { login: o.sender ?? OWNER, type: 'User' }, commits: [c], head_commit: c };
}
function pr(o: { repo: string; branch: string; number: number; title: string; body?: string; assoc?: string; user?: string; forkOwner?: string }) {
  const headOwner = o.forkOwner ?? o.repo.split('/')[0];
  const name = o.repo.split('/')[1];
  return {
    action: 'opened', number: o.number,
    pull_request: {
      number: o.number, title: o.title, body: o.body ?? 'PR 正文', state: 'open', draft: false, merged: false, html_url: `https://github.com/${o.repo}/pull/${o.number}`,
      created_at: iso(T0), updated_at: iso(T0), closed_at: null, merged_at: null, author_association: o.assoc ?? 'OWNER', user: { login: o.user ?? OWNER, type: 'User' },
      head: { ref: o.branch, label: `${headOwner}:${o.branch}`, sha: 'b'.repeat(40), user: { login: headOwner }, repo: { full_name: `${headOwner}/${name}`, name, fork: !!o.forkOwner, owner: { login: headOwner } } },
      base: { ref: 'main', repo: { full_name: o.repo, fork: false } },
    },
    repository: repoObj(o.repo), sender: { login: o.user ?? OWNER, type: 'User' },
  };
}
function run(o: { repo: string; branch: string; conclusion: string }) {
  const name = o.repo.split('/')[1];
  return {
    action: 'completed',
    workflow_run: {
      id: 1, name: 'ci', head_branch: o.branch, head_sha: 'b'.repeat(40), event: 'pull_request', status: 'completed', conclusion: o.conclusion, html_url: `https://github.com/${o.repo}/actions/runs/1`,
      created_at: iso(T0), updated_at: iso(T0), pull_requests: [], head_repository: { full_name: o.repo, name, fork: false, owner: { login: OWNER } },
    },
    repository: repoObj(o.repo), sender: { login: OWNER, type: 'User' },
  };
}
const sign = (raw: string) => 'sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex');
function hook(event: string, body: unknown, now = T0) {
  const raw = JSON.stringify(body);
  return handle(new Request(`${HOST}/hooks/github`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-github-event': event, 'x-github-delivery': randomUUID(), 'x-hub-signature-256': sign(raw) }, body: raw }), env(), now);
}
interface Item { repo: string; branch: string; role: string; project: string; step: string; pr: number | null; title: string; ci: string | null; decide: boolean; external: boolean }
async function active(): Promise<Item[]> {
  const r = await handle(page('/api/active', { cookie: await cookie() }), env(), T0 + M);
  expect(r.status, 'GET /api/active').toBe(200);
  const j = (await r.json()) as { items: Item[]; ended: Item[] };
  return [...j.items, ...j.ended];
}
const TOPUP = `${OWNER}/TopUP`;
const isTopup = (x: Item) => x.repo.toLowerCase() === 'topup';

// ======================================================================
describe('① REPO_PROJECT：TopUP 仓库推来的 PR / CI 归到项目 TopUP', () => {
  it('按 GitHub 返回的仓库名 TopUP 查：项目 TopUP（和项目版图里的项目名一字不差）', () => {
    expect(REPO_PROJECT['TopUP']).toBe('TopUP');
  });

  it('小写 topup 也认（上报来源名、Webhook 的仓库名都可能是小写）：项目 TopUP', () => {
    expect(REPO_PROJECT['topup']).toBe('TopUP');
  });

  it('不能变：new-forecast 照旧归 forecast；agents、marketing 照旧不在表里（算"公司"）', () => {
    expect(REPO_PROJECT['new-forecast']).toBe('forecast');
    expect(REPO_PROJECT['agents']).toBeUndefined();
    expect(REPO_PROJECT['marketing']).toBeUndefined();
  });
});

describe('② 推送接口认来源 topup（扩展项：不认的话 REPO_PROJECT 用不上）', () => {
  it('topup 能报 prs、ci（200），读回来来源是 topup', async () => {
    const r = await ingest({ source: 'topup', blocks: [{ kind: 'ci', payload: { conclusion: 'failure', sha: 'a'.repeat(40) } }, { kind: 'prs', payload: { items: [] } }] });
    expect(r.status, JSON.stringify(await r.clone().json())).toBe(200);
    const rows = await db.prepare("SELECT kind FROM company_snapshot WHERE source = 'topup' ORDER BY kind").all<{ kind: string }>();
    expect(rows.results.map((x) => x.kind)).toEqual(['ci', 'prs']);
  });

  it('和别的代码仓库一样只能报 prs / ci：报 status、todo 400，一块都不写', async () => {
    for (const kind of ['status', 'todo', 'projects']) expect((await ingest({ source: 'topup', blocks: [{ kind, key: 'TopUP', payload: {} }] })).status, kind).toBe(400);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM company_snapshot').first<{ n: number }>())!.n).toBe(0);
  });

  it('不能变：不认识的来源照旧 400', async () => {
    expect((await ingest({ source: 'topup2', blocks: [{ kind: 'ci', payload: {} }] })).status).toBe(400);
  });
});

// ======================================================================
describe('③ Webhook：收 dollar3651314/TopUP，进度归到项目 TopUP', () => {
  it('push：200，项目 TopUP；仓库名大小写不同（dollar3651314/topup）也收', async () => {
    expect((await hook('push', push({ repo: TOPUP, branch: 'claude/fix-login' }))).status).toBe(200);
    expect((await hook('push', push({ repo: `${OWNER}/topup`, branch: 'claude/fix-signup' }))).status).toBe(200);
    const a = (await active()).filter(isTopup);
    expect(a.map((x) => x.branch).sort()).toEqual(['claude/fix-login', 'claude/fix-signup']);
    for (const x of a) expect(x.project, x.branch).toBe('TopUP');
  });

  it('pull_request：200，项目 TopUP，PR 号和标题照常；C147 代码仓库：提交说明、PR 正文不存', async () => {
    const MARK = 'ZZTopUP正文ZZ';
    expect((await hook('push', push({ repo: TOPUP, branch: 'claude/feature-a', msg: `提交说明 ${MARK}` }))).status).toBe(200);
    expect((await hook('pull_request', pr({ repo: TOPUP, branch: 'claude/feature-a', number: 3, title: '充值页', body: MARK }), T0 + 1)).status).toBe(200);
    const a = await active();
    const x = a.find((i) => isTopup(i) && i.branch === 'claude/feature-a');
    expect(x).toMatchObject({ project: 'TopUP', pr: 3, title: '充值页', step: '', external: false });
    expect(JSON.stringify(a)).not.toContain(MARK);
  });

  it('workflow_run：红的 CI 落到项目 TopUP（项目页"问题"能看到）', async () => {
    expect((await hook('workflow_run', run({ repo: TOPUP, branch: 'claude/feature-b', conclusion: 'failure' }))).status).toBe(200);
    const x = (await active()).find((i) => isTopup(i) && i.branch === 'claude/feature-b');
    expect(x).toMatchObject({ project: 'TopUP', ci: 'failure', external: false });
  });

  it('合约定的分支名用 topup 短码也落到项目 TopUP（不会因为短码大小写和项目名不同就丢到别的项目）', async () => {
    expect((await hook('push', push({ repo: TOPUP, branch: 'claude/dev-topup-pay' }))).status).toBe(200);
    expect((await active()).find((i) => isTopup(i) && i.branch === 'claude/dev-topup-pay')?.project).toBe('TopUP');
  });

  it('不能变：fork 来的 PR、外部人的 PR、外部人的推送照旧标外部；【要你决定】不进"需要我的事"', async () => {
    expect((await hook('pull_request', pr({ repo: TOPUP, branch: 'claude/x', number: 7, title: '【要你决定】合并', forkOwner: 'someone-fork' }))).status).toBe(200);
    expect((await hook('pull_request', pr({ repo: TOPUP, branch: 'feature-y', number: 8, title: '【要你决定】docs', assoc: 'CONTRIBUTOR', user: 'stranger' }))).status).toBe(200);
    expect((await hook('push', push({ repo: TOPUP, branch: 'feature-z', msg: '外部提交', sender: 'stranger2' }))).status).toBe(200);
    const a = (await active()).filter(isTopup);
    expect(a.filter((i) => i.pr === 7)).toHaveLength(1);
    expect(a.find((i) => i.pr === 7)).toMatchObject({ external: true, decide: false });
    expect(a.find((i) => i.pr === 8)).toMatchObject({ external: true, decide: false });
    expect(a.find((i) => i.branch === 'feature-z')).toMatchObject({ external: true, step: '' });
  });

  it('不能变：别人名下的 TopUP 仓库、名字只差一点的仓库照旧 202、不写', async () => {
    expect((await hook('push', push({ repo: 'someone-else/TopUP', branch: 'claude/a' }))).status).toBe(202);
    expect((await hook('push', push({ repo: `${OWNER}/TopUP2`, branch: 'claude/b' }))).status).toBe(202);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM active_item').first<{ n: number }>())!.n).toBe(0);
  });
});

describe('④ agents 里改 项目/TopUP/ 的不合约定分支 → 项目 TopUP（扩展项）', () => {
  it('同 项目/forecast/ → forecast 的猜法', async () => {
    expect((await hook('push', push({ repo: `${OWNER}/agents`, branch: 'claude/topup-kickoff', files: ['项目/TopUP/状态卡.md'] }))).status).toBe(200);
    expect((await active()).find((i) => i.branch === 'claude/topup-kickoff')).toMatchObject({ role: 'none', project: 'TopUP' });
  });
});

// ======================================================================
describe('⑤ 工作台项目页：projects 块里有 TopUP 就出 TopUP', () => {
  it('projectPagesFrom 原样保留 TopUP（大小写不变，不被当成工具层）', () => {
    expect(projectPagesFrom({ items: [{ name: 'forecast' }, { name: 'TopUP' }] })).toEqual(['forecast', 'TopUP']);
    expect(PROJECT_PAGES_FALLBACK).toContain('forecast');
  });

  it('推了 forecast + TopUP：上限两行、TopUP 能填数字', async () => {
    expect((await ingest({ source: 'agents', blocks: [{ kind: 'projects', key: '', payload: { items: [{ name: 'forecast', stage: '试水' }, { name: 'TopUP', stage: '立项' }] } }] })).status).toBe(200);
    const ck = await cookie();
    const rows = (await (await handle(page('/api/reply-cap', { cookie: ck }), env(), T0)).json() as { rows: { project: string }[] }).rows.map((x) => x.project);
    expect(rows).toEqual(['forecast', 'TopUP']);
    const rep = await handle(page('/api/company/report', { method: 'POST', cookie: ck, body: JSON.stringify({ key: 'todo:TopUP:R1', project: 'TopUP', values: { 'X 关注': '1' } }) }), env(), T0);
    expect(rep.status).toBe(200);
  });
});
