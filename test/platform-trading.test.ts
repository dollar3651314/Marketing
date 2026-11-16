/**
 * 工作台认出新项目 Trading 的验收测试（Amos 2026-11-16 启动 Trading，要求"工作台加 Trading 菜单"、"项目菜单 Practical 排第一个"；agents main 5096602 已立项，#200）。
 * 照 test/platform-topup.test.ts（2026-11-13 TopUP 那一套）逐条改成 Trading：项目名 Trading、短码 / 上报来源名 trading、GitHub 仓库 dollar3651314/Trading。
 *
 * 覆盖：
 *   ① src/projects.ts REPO_PROJECT：Trading / trading → 项目 Trading；TopUP、new-forecast 的照旧。
 *   ② 推送接口（/api/company/ingest）认来源 trading，只能报 prs / ci。
 *   ③ src/hooks.ts Webhook 仓库白名单收 dollar3651314/Trading（不分大小写），push / pull_request / workflow_run 归到项目 Trading；
 *      C147 代码仓库不存提交说明；fork、外部人、别人名下的仓库规则照旧。
 *   ④ agents 不合约定的分支改了 项目/Trading/ 下的文件 → 项目 Trading。
 *   ⑤ 工作台项目页：projects 块里有 Trading 时上限、填数字都认它。
 *   ⑥ 项目菜单、项目概况的顺序**跟 projects 块的行序走**（agents 项目版图"产品"表：Practical、forecast、TopUP、Trading），
 *      服务端 projectPagesFrom、/api/reply-cap 和页面里的 pagesFrom() 都不重新排序；页面里不许出现对项目名单的写死排序。
 */
import { createHmac, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import { ADMIN_PAGE } from '../src/admin-page';
import { MAX_PROJECT_PAGES, NOT_PROJECTS, PROJECT_PAGES_FALLBACK, REPO_PROJECT, projectPagesFrom } from '../src/projects';
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
const TRADING = `${OWNER}/Trading`;
const isTrading = (x: Item) => x.repo.toLowerCase() === 'trading';

// ======================================================================
describe('① REPO_PROJECT：Trading 仓库推来的 PR / CI 归到项目 Trading', () => {
  it('按 GitHub 返回的仓库名 Trading 查：项目 Trading（和项目版图里的项目名一字不差）', () => {
    expect(REPO_PROJECT['Trading']).toBe('Trading');
  });

  it('小写 trading 也认（上报来源名、Webhook 的仓库名都可能是小写）：项目 Trading', () => {
    expect(REPO_PROJECT['trading']).toBe('Trading');
  });

  it('不能变：TopUP 照旧归 TopUP', () => {
    expect(REPO_PROJECT['TopUP']).toBe('TopUP');
    expect(REPO_PROJECT['topup']).toBe('TopUP');
  });

  it('不能变：new-forecast 照旧归 forecast；agents、marketing 照旧不在表里（算"公司"）', () => {
    expect(REPO_PROJECT['new-forecast']).toBe('forecast');
    expect(REPO_PROJECT['agents']).toBeUndefined();
    expect(REPO_PROJECT['marketing']).toBeUndefined();
  });
});

describe('② 推送接口认来源 trading（扩展项：不认的话 REPO_PROJECT 用不上）', () => {
  it('trading 能报 prs、ci（200），读回来来源是 trading', async () => {
    const r = await ingest({ source: 'trading', blocks: [{ kind: 'ci', payload: { conclusion: 'failure', sha: 'a'.repeat(40) } }, { kind: 'prs', payload: { items: [] } }] });
    expect(r.status, JSON.stringify(await r.clone().json())).toBe(200);
    const rows = await db.prepare("SELECT kind FROM company_snapshot WHERE source = 'trading' ORDER BY kind").all<{ kind: string }>();
    expect(rows.results.map((x) => x.kind)).toEqual(['ci', 'prs']);
  });

  it('和别的代码仓库一样只能报 prs / ci：报 status、todo 400，一块都不写', async () => {
    for (const kind of ['status', 'todo', 'projects']) expect((await ingest({ source: 'trading', blocks: [{ kind, key: 'Trading', payload: {} }] })).status, kind).toBe(400);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM company_snapshot').first<{ n: number }>())!.n).toBe(0);
  });

  it('不能变：不认识的来源照旧 400', async () => {
    expect((await ingest({ source: 'trading2', blocks: [{ kind: 'ci', payload: {} }] })).status).toBe(400);
  });
});

// ======================================================================
describe('③ Webhook：收 dollar3651314/Trading，进度归到项目 Trading', () => {
  it('push：200，项目 Trading；仓库名大小写不同（dollar3651314/trading）也收', async () => {
    expect((await hook('push', push({ repo: TRADING, branch: 'claude/fix-login' }))).status).toBe(200);
    expect((await hook('push', push({ repo: `${OWNER}/trading`, branch: 'claude/fix-signup' }))).status).toBe(200);
    const a = (await active()).filter(isTrading);
    expect(a.map((x) => x.branch).sort()).toEqual(['claude/fix-login', 'claude/fix-signup']);
    for (const x of a) expect(x.project, x.branch).toBe('Trading');
  });

  it('pull_request：200，项目 Trading，PR 号和标题照常；C147 代码仓库：提交说明、PR 正文不存', async () => {
    const MARK = 'ZZTrading正文ZZ';
    expect((await hook('push', push({ repo: TRADING, branch: 'claude/feature-a', msg: `提交说明 ${MARK}` }))).status).toBe(200);
    expect((await hook('pull_request', pr({ repo: TRADING, branch: 'claude/feature-a', number: 3, title: '下单页', body: MARK }), T0 + 1)).status).toBe(200);
    const a = await active();
    const x = a.find((i) => isTrading(i) && i.branch === 'claude/feature-a');
    expect(x).toMatchObject({ project: 'Trading', pr: 3, title: '下单页', step: '', external: false });
    expect(JSON.stringify(a)).not.toContain(MARK);
  });

  it('workflow_run：红的 CI 落到项目 Trading（项目页"问题"能看到）', async () => {
    expect((await hook('workflow_run', run({ repo: TRADING, branch: 'claude/feature-b', conclusion: 'failure' }))).status).toBe(200);
    const x = (await active()).find((i) => isTrading(i) && i.branch === 'claude/feature-b');
    expect(x).toMatchObject({ project: 'Trading', ci: 'failure', external: false });
  });

  it('合约定的分支名用 trading 短码也落到项目 Trading（不会因为短码大小写和项目名不同就丢到别的项目）', async () => {
    expect((await hook('push', push({ repo: TRADING, branch: 'claude/dev-trading-order' }))).status).toBe(200);
    expect((await active()).find((i) => isTrading(i) && i.branch === 'claude/dev-trading-order')?.project).toBe('Trading');
  });

  it('不能变：fork 来的 PR、外部人的 PR、外部人的推送照旧标外部；【要你决定】不进"需要我的事"', async () => {
    expect((await hook('pull_request', pr({ repo: TRADING, branch: 'claude/x', number: 7, title: '【要你决定】合并', forkOwner: 'someone-fork' }))).status).toBe(200);
    expect((await hook('pull_request', pr({ repo: TRADING, branch: 'feature-y', number: 8, title: '【要你决定】docs', assoc: 'CONTRIBUTOR', user: 'stranger' }))).status).toBe(200);
    expect((await hook('push', push({ repo: TRADING, branch: 'feature-z', msg: '外部提交', sender: 'stranger2' }))).status).toBe(200);
    const a = (await active()).filter(isTrading);
    expect(a.filter((i) => i.pr === 7)).toHaveLength(1);
    expect(a.find((i) => i.pr === 7)).toMatchObject({ external: true, decide: false });
    expect(a.find((i) => i.pr === 8)).toMatchObject({ external: true, decide: false });
    expect(a.find((i) => i.branch === 'feature-z')).toMatchObject({ external: true, step: '' });
  });

  it('不能变：别人名下的 Trading 仓库、名字只差一点的仓库照旧 202、不写', async () => {
    expect((await hook('push', push({ repo: 'someone-else/Trading', branch: 'claude/a' }))).status).toBe(202);
    expect((await hook('push', push({ repo: `${OWNER}/Trading2`, branch: 'claude/b' }))).status).toBe(202);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM active_item').first<{ n: number }>())!.n).toBe(0);
  });
});

describe('④ agents 里改 项目/Trading/ 的不合约定分支 → 项目 Trading（扩展项）', () => {
  it('同 项目/forecast/ → forecast 的猜法', async () => {
    expect((await hook('push', push({ repo: `${OWNER}/agents`, branch: 'claude/trading-kickoff', files: ['项目/Trading/状态卡.md'] }))).status).toBe(200);
    expect((await active()).find((i) => i.branch === 'claude/trading-kickoff')).toMatchObject({ role: 'none', project: 'Trading' });
  });
});

// ======================================================================
describe('⑤ 工作台项目页：projects 块里有 Trading 就出 Trading', () => {
  it('projectPagesFrom 原样保留 Trading（大小写不变，不被当成工具层）', () => {
    expect(projectPagesFrom({ items: [{ name: 'forecast' }, { name: 'Trading' }] })).toEqual(['forecast', 'Trading']);
    expect(PROJECT_PAGES_FALLBACK).toContain('forecast');
  });

  it('推了 forecast + Trading：上限两行、Trading 能填数字', async () => {
    expect((await ingest({ source: 'agents', blocks: [{ kind: 'projects', key: '', payload: { items: [{ name: 'forecast', stage: '试水' }, { name: 'Trading', stage: '立项' }] } }] })).status).toBe(200);
    const ck = await cookie();
    const rows = (await (await handle(page('/api/reply-cap', { cookie: ck }), env(), T0)).json() as { rows: { project: string }[] }).rows.map((x) => x.project);
    expect(rows).toEqual(['forecast', 'Trading']);
    const rep = await handle(page('/api/company/report', { method: 'POST', cookie: ck, body: JSON.stringify({ key: 'todo:Trading:R1', project: 'Trading', values: { 'X 关注': '1' } }) }), env(), T0);
    expect(rep.status).toBe(200);
  });
});

// ======================================================================
describe('⑥ 项目菜单、项目概况按 projects 块的行序（Practical 排第一），没有写死的排序', () => {
  const ROWS = [{ name: 'Practical', stage: '开局沟通' }, { name: 'forecast', stage: '试水' }, { name: 'TopUP', stage: 'D 技术方案' }, { name: 'Trading', stage: 'D 产品 1.0' }];
  const ORDER = ['Practical', 'forecast', 'TopUP', 'Trading'];

  it('projectPagesFrom 原样保留行序（不按字母、不把 forecast 提前）', () => {
    expect(projectPagesFrom({ items: ROWS })).toEqual(ORDER);
    // 反过来推，结果也反过来：说明是跟着行序走，不是碰巧排出来的
    expect(projectPagesFrom({ items: ROWS.slice().reverse() })).toEqual(ORDER.slice().reverse());
  });

  it('服务端（/api/reply-cap 每个项目一行）按同一顺序，Practical 第一', async () => {
    expect((await ingest({ source: 'agents', blocks: [{ kind: 'projects', key: '', payload: { items: ROWS } }] })).status).toBe(200);
    const rows = (await (await handle(page('/api/reply-cap', { cookie: await cookie() }), env(), T0)).json() as { rows: { project: string }[] }).rows.map((x) => x.project);
    expect(rows).toEqual(ORDER);
  });

  it('页面里的 pagesFrom()（一级菜单的名单）跑出来也是行序', () => {
    const m = /function pagesFrom\(data\)\{[\s\S]*?PCFG\.PROJECT_PAGES_FALLBACK\.slice\(\);\}/.exec(ADMIN_PAGE);
    expect(m, '页面里找不到 pagesFrom()').not.toBeNull();
    const fn = new Function('CFG', 'PCFG', `${m![0]}; return pagesFrom;`)({ NOT_PROJECTS }, { PROJECT_PAGES_FALLBACK, MAX_PROJECT_PAGES }) as (d: unknown) => string[];
    expect(fn({ blocks: [{ kind: 'projects', payload: { items: [...ROWS, { name: '工作平台' }] } }] })).toEqual(ORDER);
  });

  it('一级菜单按名单顺序画、项目概况按名单下标排；页面里不对项目名单（PROJS）排序', () => {
    expect(ADMIN_PAGE).toMatch(/function renderNav1\(\)\{[^]*?PROJS\.forEach\(/);
    expect(ADMIN_PAGE).toMatch(/function renderProj\(now\)\{const pi=\(k\)=>\{const i=PROJS\.indexOf\(k\);/);
    expect(ADMIN_PAGE).not.toMatch(/PROJS[\w.()]*\.sort\(/);
    // 名单从 projects 块到一级菜单经过的三个函数，函数体里都没有 sort
    for (const name of ['pagesFrom', 'setProjects', 'renderNav1']) {
      const m = new RegExp(`function ${name}\\([^)]*\\)\\{[\\s\\S]*?\\n(?=function |const |let |/[*/]|renderNav1\\(\\);)`).exec(ADMIN_PAGE);
      expect(m, name).not.toBeNull();
      expect(m![0], name).not.toMatch(/\.sort\(/);
    }
  });
});
