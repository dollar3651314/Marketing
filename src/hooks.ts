/**
 * 公司平台批 3 · PR 4：GitHub Webhook 实时进度（agents 公司平台/技术方案-公司平台-Webhook.md 第二～四节；Amos 已定 P-2～P-5、P-7、T-4；C147）。
 * - POST /hooks/github  GitHub 发来的事件。只依赖 COMPANY_INGEST_TOKEN（同一个值当 HMAC 密钥，去首尾空格；没填或不到 32 个字符 404），
 *   所以和推送接口一样在后台（密码）判断之前处理；不放在 /api/ 下（/api/* 要会话和本站来源，GitHub 过不去）。
 *   顺序：① 请求体 > 512 KB → 413 ② 先验签（X-Hub-Signature-256，crypto.subtle.verify 常数时间）再解析：不对 → 401，
 *   settings 的 hook:bad_sig_at 每分钟最多写一次（一条带条件的语句；签名不对的请求不读开关、不碰别的表）
 *   ③ 开关 settings 的 hook:github（默认开）：关着回 200、不写库 ④ 不是 JSON → 400 ⑤ 只处理 ping、push、pull_request、workflow_run（只认 completed）、delete，
 *   别的 204 ⑥ 仓库白名单（dollar3651314 的 agents、new-forecast、Marketing，不分大小写）不在 → 202 ⑦ 每个仓库每分钟 120 次（company_rate 的 gh:<仓库>，
 *   推送接口的每分钟 6 次另算）→ 429 ⑧ X-GitHub-Delivery 见过的直接 200 ⑨ 写 active_item（事件时间不早于库里的才覆盖）、追加 active_log，顺手删 30 天前的。
 * - GET  /api/active    （会话）{ on, lastAt, badSigAt, limitedAt, items, ended }：变灰（2 小时）、最近结束（24 小时）在读的时候算，不加定时任务。
 * - POST /api/hook {on}  （会话 + 本站来源）切开关。
 * C147：代码仓库（new-forecast、marketing）只给分支名、PR 标题、CI；提交说明和 PR 正文不显示也不存。agents 只存自己人提交说明的第一行。
 *   外部人：PR 的 author_association 不是 OWNER / MEMBER / COLLABORATOR 或 head.repo.fork；推送的 sender 不是仓库主人。外部的不显示提交说明、不进"需要我的事"。
 * 接口约定和测试在 test/platform-batch3.test.ts 文件头；页面在 src/admin-page.ts 第三段脚本（团队在做什么、#ci-alert、#hook-toggle）。
 */
import type { Env } from './env';
import { companyEnabled } from './company';

export const HOOK_MAX_BYTES = 512 * 1024;
export const HOOK_PER_MINUTE = 120;
const KEEP_MS = 30 * 24 * 3600_000;
const IDLE_MS = 2 * 3600_000;
const END_MS = 24 * 3600_000;
const BAD_SIG_EVERY_MS = 60_000;
/** "有延迟"：最近 10 分钟里有过限流（company_rate 只留最近 10 分钟） */
const LIMITED_WINDOW_MIN = 10;
const OWNER = 'dollar3651314';
const REPOS = ['agents', 'new-forecast', 'marketing'] as const;
type Repo = (typeof REPOS)[number];
export const ROLE_CODES = ['main', 'pm', 'mkt', 'dev', 'qa', 'ops', 'review'] as const;
export const PROJECT_CODES = ['forecast', 'platform', 'company'] as const;
/** PR 标题里的岗位写中文（也认短码） */
const ROLE_NAMES: Record<string, string> = { 主会话: 'main', 产品: 'pm', 市场: 'mkt', 研发: 'dev', 测试: 'qa', 运维安全: 'ops', 审查: 'review', 审查会话: 'review' };
const BRANCH_RE = new RegExp(`^claude/(${ROLE_CODES.join('|')})-(${PROJECT_CODES.join('|')})-(.+)$`);
const TITLE_RE = /【([^】·・]{1,8})[·・]([a-z]{1,16})】/g;
const INSIDERS = ['OWNER', 'MEMBER', 'COLLABORATOR'];
const EVENTS = ['ping', 'push', 'pull_request', 'workflow_run', 'delete'];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
const notFound = () => new Response('Not found', { status: 404 });
const enc = new TextEncoder();

/** 读请求体，超过 max 个字节就停（返回 null），不把超大的请求整个读进内存 */
async function readCapped(req: Request, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (Number(req.headers.get('content-length') ?? 0) > max) return null;
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { await reader.cancel().catch(() => {}); return null; }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.byteLength; }
  return out;
}

/** X-Hub-Signature-256 = sha256=<十六进制 HMAC-SHA256(原始请求体)>；密钥 = 去掉首尾空格的 COMPANY_INGEST_TOKEN */
async function signatureOk(env: Env, header: string | null, body: Uint8Array<ArrayBuffer>): Promise<boolean> {
  const m = /^sha256=([0-9a-fA-F]{64})$/.exec((header ?? '').trim());
  if (!m) return false;
  const sig = new Uint8Array(32);
  for (let i = 0; i < 32; i++) sig[i] = parseInt(m[1].slice(i * 2, i * 2 + 2), 16);
  const key = await crypto.subtle.importKey('raw', enc.encode((env.COMPANY_INGEST_TOKEN ?? '').trim()), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, sig, body);
}

/** 签名不对：记下时间，和库里的差不到 60 秒就不写（一条带条件的语句，只碰 settings） */
async function noteBadSig(env: Env, now: number): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES ('hook:bad_sig_at', ?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at WHERE CAST(settings.value AS INTEGER) <= ?3",
  ).bind(String(now), now, now - BAD_SIG_EVERY_MS).run();
}

/** Webhook 开关（settings 的 hook:github；默认开，'0' = 关） */
export async function hookOn(env: Env): Promise<boolean> {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key = 'hook:github'").first<{ value: string }>();
  return r?.value !== '0';
}

async function underLimit(env: Env, repo: string, now: number): Promise<boolean> {
  const minute = Math.floor(now / 60_000);
  const r = await env.DB.prepare('INSERT INTO company_rate (source, minute, n) VALUES (?1, ?2, 1) ON CONFLICT (source, minute) DO UPDATE SET n = n + 1 RETURNING n').bind('gh:' + repo, minute).first<{ n: number }>();
  if (minute % 10 === 0) await env.DB.prepare('DELETE FROM company_rate WHERE minute < ?1').bind(minute - 10).run();
  return (r?.n ?? 0) <= HOOK_PER_MINUTE;
}

// ---------------- 认岗位、认项目 ----------------
type O = Record<string, unknown>;
const obj = (v: unknown): O => (v && typeof v === 'object' && !Array.isArray(v) ? (v as O) : {});
const s = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const lower = (v: unknown) => s(v, 300).toLowerCase();
const httpsUrl = (v: unknown) => (typeof v === 'string' && /^https:\/\/github\.com\/[^\s"'<>]{1,400}$/.test(v) ? v : '');
/** 事件里带的时间；没有或解析不了用收到的时间；晚于收到的时间也按收到的时间（防止时钟不准把后面的事件都挡住） */
const timeOf = (v: unknown, now: number) => { const t = typeof v === 'string' ? Date.parse(v) : NaN; return Number.isFinite(t) ? Math.min(t, now) : now; };

interface Ident { role: string; project: string; labeled: boolean }
/** 分支名 claude/<岗位>-<项目>-<主题>；认不出：claude/ 开头 none，否则 amos；项目按仓库猜（agents 看第一个提交改的文件） */
export function identify(repo: Repo, branch: string, files: string[] = []): Ident {
  const m = BRANCH_RE.exec(branch);
  if (m) return { role: m[1], project: m[2], labeled: true };
  return { role: branch.startsWith('claude/') ? 'none' : 'amos', project: guessProject(repo, files), labeled: false };
}
function guessProject(repo: Repo, files: string[]): string {
  if (repo === 'new-forecast') return 'forecast';
  if (repo === 'marketing') return 'platform';
  const f = files[0] ?? '';
  if (f.startsWith('项目/forecast/')) return 'forecast';
  if (f.startsWith('公司平台/')) return 'platform';
  return 'company';
}
/** PR 标题里的【岗位·项目】（【要你决定】【只看】不算） */
export function fromTitle(title: string): { role: string; project: string } | null {
  for (const m of title.matchAll(TITLE_RE)) {
    const role = ROLE_NAMES[m[1]] ?? ((ROLE_CODES as readonly string[]).includes(m[1]) ? m[1] : '');
    if (role && (PROJECT_CODES as readonly string[]).includes(m[2])) return { role, project: m[2] };
  }
  return null;
}
const firstLine = (msg: unknown) => s(msg, 4000).split('\n')[0].trim().slice(0, 200);

// ---------------- 写库 ----------------
function logStmts(env: Env, repo: string, branch: string, kind: string, now: number): D1PreparedStatement[] {
  return [
    env.DB.prepare('INSERT INTO active_log (repo, branch, kind, at) VALUES (?1, ?2, ?3, ?4)').bind(repo, branch, kind, now),
    env.DB.prepare('DELETE FROM active_log WHERE at < ?1').bind(now - KEEP_MS),
    env.DB.prepare('DELETE FROM active_item WHERE at < ?1').bind(now - KEEP_MS),
    env.DB.prepare('DELETE FROM gh_delivery WHERE at < ?1').bind(now - KEEP_MS),
  ];
}
const treeUrl = (fullName: string, branch: string) => `https://github.com/${fullName}/tree/${branch.split('/').map(encodeURIComponent).join('/')}`;

async function onPush(env: Env, repo: Repo, b: O, now: number): Promise<void> {
  const ref = s(b.ref, 300);
  if (!ref.startsWith('refs/heads/') || b.deleted === true) return; // 删分支由 delete 事件处理
  const branch = ref.slice('refs/heads/'.length);
  const repository = obj(b.repository);
  const head = obj(b.head_commit);
  const commits = Array.isArray(b.commits) ? b.commits.map(obj) : [];
  const c0 = commits[0] ?? {};
  const files = ['added', 'modified', 'removed'].flatMap((k) => (Array.isArray(c0[k]) ? (c0[k] as unknown[]).filter((x): x is string => typeof x === 'string') : []));
  const id = identify(repo, branch, files);
  const external = lower(obj(b.sender).login) !== lower(obj(repository.owner).login) || !lower(obj(b.sender).login);
  const msg = typeof head.message === 'string' ? head.message : null;
  // C147：代码仓库、外部人的提交说明一个字都不存；【交付】只存是 / 否
  const step = msg === null ? null : repo === 'agents' && !external ? firstLine(msg) : '';
  const delivered = msg !== null && !external && msg.trimStart().startsWith('【交付】') ? 1 : 0;
  const at = timeOf(head.timestamp, now);
  const url = treeUrl(s(repository.full_name, 300) || `${OWNER}/${repo}`, branch);
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO active_item (repo, branch, role, project, labeled, step, delivered, at, url, external) VALUES (?1, ?2, ?3, ?4, ?5, COALESCE(?6, \'\'), ?7, ?8, ?9, ?10) ' +
        'ON CONFLICT (repo, branch) DO UPDATE SET step = COALESCE(?6, active_item.step), delivered = ?7, at = ?8, external = ?10, end_kind = NULL, ' +
        'url = CASE WHEN active_item.pr IS NULL THEN ?9 ELSE active_item.url END WHERE active_item.at <= ?8',
    ).bind(repo, branch, id.role, id.project, id.labeled ? 1 : 0, step, delivered, at, url, external ? 1 : 0),
    ...logStmts(env, repo, branch, 'push', now),
  ]);
}

async function onPullRequest(env: Env, repo: Repo, b: O, now: number): Promise<void> {
  const p = obj(b.pull_request);
  const head = obj(p.head);
  const branch = s(head.ref, 300);
  const number = typeof p.number === 'number' && Number.isInteger(p.number) ? p.number : null;
  if (!branch || number === null) return;
  const action = s(b.action, 40);
  const title = s(p.title, 200); // C147：只要标题；正文 body 不读、不存
  const external = !INSIDERS.includes(s(p.author_association, 40)) || obj(head.repo).fork === true;
  const decide = !external && title.includes('【要你决定】') ? 1 : 0;
  const end = action === 'closed' ? (p.merged === true ? 'merged' : 'closed') : null;
  const at = timeOf(p.updated_at, now);
  const url = httpsUrl(p.html_url) || `https://github.com/${s(obj(b.repository).full_name, 300) || `${OWNER}/${repo}`}/pull/${number}`;
  const id = identify(repo, branch);
  const t = !id.labeled && id.role !== 'amos' ? fromTitle(title) : null;
  const role = t?.role ?? id.role;
  const project = t?.project ?? id.project;
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO active_item (repo, branch, role, project, labeled, at, pr, title, url, decide, external, end_kind) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12) ' +
        'ON CONFLICT (repo, branch) DO UPDATE SET at = ?6, pr = ?7, title = ?8, url = ?9, decide = ?10, external = ?11, end_kind = ?12, ' +
        'role = CASE WHEN ?13 THEN ?3 ELSE active_item.role END, project = CASE WHEN ?13 THEN ?4 ELSE active_item.project END WHERE active_item.at <= ?6',
    ).bind(repo, branch, role, project, id.labeled ? 1 : 0, at, number, title, url, decide, external ? 1 : 0, end, t ? 1 : 0),
    ...logStmts(env, repo, branch, 'pr:' + action, now),
  ]);
}

async function onWorkflowRun(env: Env, repo: Repo, b: O, now: number): Promise<void> {
  if (s(b.action, 40) !== 'completed') return; // requested、in_progress 不改 CI
  const r = obj(b.workflow_run);
  const branch = s(r.head_branch, 300);
  const c = s(r.conclusion, 40);
  const ci = c === 'success' ? 'success' : ['failure', 'timed_out', 'startup_failure'].includes(c) ? 'failure' : null;
  if (!branch || !ci) return; // cancelled、skipped 等不改
  const at = timeOf(r.updated_at, now);
  const id = identify(repo, branch);
  const external = obj(r.head_repository).fork === true ? 1 : 0;
  const url = treeUrl(s(obj(b.repository).full_name, 300) || `${OWNER}/${repo}`, branch);
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO active_item (repo, branch, role, project, labeled, at, url, ci, ci_at, external) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?6, ?9) ' +
        'ON CONFLICT (repo, branch) DO UPDATE SET ci = CASE WHEN active_item.ci_at IS NULL OR active_item.ci_at <= ?6 THEN ?8 ELSE active_item.ci END, ' +
        'ci_at = MAX(COALESCE(active_item.ci_at, 0), ?6), at = MAX(active_item.at, ?6)',
    ).bind(repo, branch, id.role, id.project, id.labeled ? 1 : 0, at, url, ci, external),
    ...logStmts(env, repo, branch, 'ci:' + ci, now),
  ]);
}

async function onDelete(env: Env, repo: Repo, b: O, now: number): Promise<number> {
  if (s(b.ref_type, 20) !== 'branch') return 204; // 删 tag 不管
  const branch = s(b.ref, 300);
  // 没开 PR 的分支删了 → 最近结束"分支已删"；开了 PR 的由 PR 关闭事件处理。delete 不带时间，用收到的时间
  await env.DB.batch([
    env.DB.prepare("UPDATE active_item SET end_kind = 'deleted', at = ?3 WHERE repo = ?1 AND branch = ?2 AND pr IS NULL AND at <= ?3").bind(repo, branch, now),
    ...logStmts(env, repo, branch, 'delete', now),
  ]);
  return 200;
}

/** POST /hooks/github；不是这个地址返回 null */
export async function githubHook(env: Env, req: Request, now: number): Promise<Response | null> {
  if (new URL(req.url).pathname !== '/hooks/github') return null;
  if (!companyEnabled(env) || req.method !== 'POST') return notFound();
  const body = await readCapped(req, HOOK_MAX_BYTES);
  if (!body) return json({ error: 'too large' }, 413);
  if (!(await signatureOk(env, req.headers.get('x-hub-signature-256'), body))) {
    await noteBadSig(env, now);
    console.log(JSON.stringify({ event: 'hook.bad_signature' }));
    return json({ error: 'bad signature' }, 401);
  }
  if (!(await hookOn(env))) return json({ ok: true, off: true });
  let b: O;
  try {
    const v = JSON.parse(new TextDecoder().decode(body));
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    b = v as O;
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  const event = (req.headers.get('x-github-event') ?? '').trim();
  if (!EVENTS.includes(event)) return new Response(null, { status: 204 });
  if (event === 'push' && !s(b.ref, 300).startsWith('refs/heads/')) return new Response(null, { status: 204 }); // 推 tag 不管
  const full = lower(obj(b.repository).full_name);
  const repo = REPOS.find((r) => full === `${OWNER}/${r}`);
  if (!repo) return json({ ignored: 'repository' }, 202);
  if (!(await underLimit(env, repo, now))) return json({ error: 'too many requests' }, 429);
  const delivery = (req.headers.get('x-github-delivery') ?? '').trim().slice(0, 100) || crypto.randomUUID();
  const fresh = await env.DB.prepare('INSERT INTO gh_delivery (id, repo, event, at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (id) DO NOTHING').bind(delivery, repo, event, now).run();
  if (!fresh.meta.changes) return json({ ok: true, duplicate: true });
  let status = 200;
  if (event === 'push') await onPush(env, repo, b, now);
  else if (event === 'pull_request') await onPullRequest(env, repo, b, now);
  else if (event === 'workflow_run') await onWorkflowRun(env, repo, b, now);
  else if (event === 'delete') status = await onDelete(env, repo, b, now);
  return status === 204 ? new Response(null, { status }) : json({ ok: true });
}

// ---------------- 后台读写 ----------------
interface Row { repo: string; branch: string; role: string; project: string; labeled: number; step: string; delivered: number; at: number; pr: number | null; title: string; url: string; ci: string | null; decide: number; external: number; end_kind: string | null }
function item(r: Row, now: number) {
  const end = r.end_kind ?? (now - r.at >= END_MS ? 'timeout' : null);
  return {
    repo: r.repo, branch: r.branch, role: r.role, project: r.project, labeled: !!r.labeled, step: r.step, at: r.at, pr: r.pr, title: r.title, url: r.url,
    ci: r.ci, decide: !!r.decide, delivered: !!r.delivered, external: !!r.external, idle: now - r.at >= IDLE_MS, end,
  };
}

/** GET /api/active、POST /api/hook（调用方已核对会话和来源）；不是这两个地址返回 null */
export async function activeApi(env: Env, req: Request, now: number): Promise<Response | null> {
  const p = new URL(req.url).pathname;
  if (p === '/api/active' && req.method === 'GET') {
    const minute = Math.floor(now / 60_000);
    const [on, rows, last, bad, lim] = await Promise.all([
      hookOn(env),
      env.DB.prepare('SELECT repo, branch, role, project, labeled, step, delivered, at, pr, title, url, ci, decide, external, end_kind FROM active_item WHERE at >= ?1 ORDER BY at DESC LIMIT 300').bind(now - KEEP_MS).all<Row>(),
      env.DB.prepare('SELECT MAX(at) AS at FROM gh_delivery').first<{ at: number | null }>(),
      env.DB.prepare("SELECT value FROM settings WHERE key = 'hook:bad_sig_at'").first<{ value: string }>(),
      env.DB.prepare("SELECT MAX(minute) AS m FROM company_rate WHERE source LIKE 'gh:%' AND n > ?1 AND minute >= ?2").bind(HOOK_PER_MINUTE, minute - LIMITED_WINDOW_MIN).first<{ m: number | null }>(),
    ]);
    const all = (rows.results ?? []).map((r) => item(r, now));
    const badSigAt = Number(bad?.value);
    return json({
      on, lastAt: last?.at ?? null, badSigAt: Number.isFinite(badSigAt) && bad ? badSigAt : null, limitedAt: lim?.m != null ? lim.m * 60_000 : null,
      items: all.filter((x) => x.end === null), ended: all.filter((x) => x.end !== null),
    });
  }
  if (p === '/api/hook' && req.method === 'POST') {
    let b: { on?: unknown } = {};
    try { b = (await req.json()) as typeof b; } catch { /* 下面判 400 */ }
    if (typeof b?.on !== 'boolean') return json({ error: '请求不对：要 {on: true 或 false}' }, 400);
    await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('hook:github', ?1, ?2) ON CONFLICT (key) DO UPDATE SET value = ?1, updated_at = ?2").bind(b.on ? '1' : '0', now).run();
    console.log(JSON.stringify({ event: 'hook.toggle', on: b.on }));
    return json({ ok: true, on: b.on });
  }
  return null;
}
