/**
 * 跟帖评论清单（原"待回复清单"，agents C136；0.3 改名）：插件存进来，Amos 在网页后台点"一键回复"→ 官方回复窗口 → 本人按发送 → 回来点"我回了"。
 * - 插件用（令牌）：POST /v1/queue {product, platform, post:{id, author, text, ageMinutes}, score, reasons, draft, source}；同一条帖子只存一次。
 * - 后台用（密码登录后的会话 Cookie）：
 *   GET /api/queue?status=pending|done|skip&product=（已知项目名原样匹配，不认识的 400）&platform=&from=YYYY-MM-DD&to=YYYY-MM-DD（按存进来的台湾日期）&sort=time|score、POST /api/queue/<id> {status}、
 *   GET /api/company、POST /api/company/done（公司运营仪表盘，company.ts）、GET /api/active、POST /api/hook {on}（团队在做什么、Webhook 开关，hooks.ts）、
 *   GET /api/reply-cap、POST /api/reply-cap {caps:{项目: 1～50}}（每天回帖上限按项目，D-2，公司平台批 2）、
 *   POST /api/queue/delete {ids}（Amos 自己删；记录不自动删，D-4 选 B）、GET /api/usage、POST /api/usage {caps}（用量和限额 ＋ 用量监控：还剩多少 left、分别用到了哪里 byPurpose，usage.ts）、POST /api/login、POST /api/logout、
 *   /api/assets/*（素材生成器，assets.ts）、/api/tts/*（语音生成，tts.ts）、/api/voice/*（语音对话实测，voice.ts）、
 *   /api/english/*（英语练习的跨轮记忆，english-memory.ts：词汇线、生成这一轮的提示词、把 #LOG 贴回来入库；不调任何 AI，不花钱）、
 *   /api/drill/*（工作台「带练」，drill.ts：场景 0 前三段的进度、「会了 / 不会」；内容写死在代码里，同样不调任何 AI、不花钱）、
 *   GET /api/funds、POST /api/funds/refresh {cursor?}（基金观察，funds-api.ts：45 只基金的快照、分批去 Yahoo / 东方财富取数）。
 * 登录：密钥 COPILOT_PASSWORD（≥ 16 个字符，没填时后台 404）；同一 IP 15 分钟错 5 次锁 15 分钟，全站 1 小时错 20 次锁 1 小时；
 * 失败一律回答同一句（不透露锁定规则，C128）；会话 12 小时，签名密钥由密码派生，改密码旧会话全部失效。
 */
import type { Env } from './env';
import { modelList } from './gemini';
import { accountLimit, envName, saveCaps, unlabeledUsage, usageByProject, usageByPurpose, usageLeft, usageReport, WAI_KEY } from './usage';
import { usedToday } from './workers-ai';
import { extensionZip } from './extension-download';
import { companyApi, projectPages } from './company';
import { activeApi } from './hooks';
import { assetsApi } from './assets';
import { ttsApi } from './tts';
import { voiceApi } from './voice';
import { englishApi } from './english-memory';
import { drillApi } from './drill';
import { fundsApi } from './funds-api';

export const SESSION_MS = 12 * 3600_000;
const LOCK = { ipWindow: 15 * 60_000, ipMax: 5, ipLock: 15 * 60_000, allWindow: 3600_000, allMax: 20, allLock: 3600_000 };
const TW_MS = 8 * 3600_000;
const twDay = (now: number) => new Date(now + TW_MS).toISOString().slice(0, 10);
const COOKIE = 'qc_cp';

export function adminEnabled(env: Env): boolean {
  return (env.COPILOT_PASSWORD ?? '').length >= 16;
}

export function replyUrl(platform: 'x' | 'threads', id: string, text: string): string {
  const t = encodeURIComponent(text);
  return platform === 'x'
    ? `https://x.com/intent/tweet?in_reply_to=${encodeURIComponent(id)}&text=${t}`
    : `https://www.threads.com/intent/post?reply_post_shortcode=${encodeURIComponent(id)}&text=${t}`;
}
export function postUrl(platform: 'x' | 'threads', id: string, author: string): string {
  const a = author.replace(/^@/, '');
  return platform === 'x' ? `https://x.com/${encodeURIComponent(a || 'i')}/status/${encodeURIComponent(id)}` : `https://www.threads.com/@${encodeURIComponent(a)}/post/${encodeURIComponent(id)}`;
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}
const enc = new TextEncoder();
async function hmac(env: Env, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', enc.encode('copilot-session:' + (env.COPILOT_PASSWORD ?? ''))), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function same(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}
async function ipHash(req: Request): Promise<string> {
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode('copilot-ip:' + ip)))].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sessionOk(env: Env, req: Request, now: number): Promise<boolean> {
  const m = (req.headers.get('cookie') ?? '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d+)\\.([0-9a-f]{64})`));
  if (!m || Number(m[1]) <= now) return false;
  return same(m[2], await hmac(env, m[1]));
}

async function login(env: Env, req: Request, now: number): Promise<Response> {
  const fail = () => json({ error: '登录失败，请稍后再试' }, 401);
  const ip = await ipHash(req);
  const locked = await env.DB.prepare('SELECT MAX(until) AS u FROM auth_lock WHERE scope IN (?1, ?2) AND until > ?3').bind('ip:' + ip, 'all', now).first<{ u: number | null }>();
  let body: { password?: unknown } = {};
  try { body = (await req.json()) as { password?: unknown }; } catch { /* 当成密码错 */ }
  if (locked?.u) return fail();
  if (typeof body.password === 'string' && (await same(body.password, env.COPILOT_PASSWORD ?? ''))) {
    const exp = String(now + SESSION_MS);
    const cookie = `${COOKIE}=${exp}.${await hmac(env, exp)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_MS / 1000}`;
    return json({ ok: true }, 200, { 'set-cookie': cookie });
  }
  await env.DB.batch([env.DB.prepare('INSERT INTO auth_fail (ip, at) VALUES (?1, ?2)').bind(ip, now), env.DB.prepare('DELETE FROM auth_fail WHERE at < ?1').bind(now - LOCK.allWindow)]);
  const c = await env.DB.prepare('SELECT SUM(CASE WHEN ip = ?1 AND at > ?2 THEN 1 ELSE 0 END) AS mine, COUNT(*) AS everyone FROM auth_fail WHERE at > ?3').bind(ip, now - LOCK.ipWindow, now - LOCK.allWindow).first<{ mine: number; everyone: number }>();
  const up = 'INSERT INTO auth_lock (scope, until) VALUES (?1, ?2) ON CONFLICT (scope) DO UPDATE SET until = MAX(until, excluded.until)';
  if ((c?.mine ?? 0) >= LOCK.ipMax) await env.DB.prepare(up).bind('ip:' + ip, now + LOCK.ipLock).run();
  if ((c?.everyone ?? 0) >= LOCK.allMax) await env.DB.prepare(up).bind('all', now + LOCK.allLock).run();
  console.log(JSON.stringify({ event: 'copilot.login_failed', ip }));
  return fail();
}

/** 全站默认的每天回帖上限（wrangler.toml DAILY_REPLY_CAP，没填 10）：项目没单独设上限时用它 */
const defaultCap = (env: Env) => Math.max(1, Math.min(50, Number(env.DAILY_REPLY_CAP) || 10));
/** 不带项目时按 forecast 算（老插件 0.3.5 的 /v1/today 不带 product，技术方案 PR 与数据页第三节） */
export const DEFAULT_PROJECT = 'forecast';
export const REPLY_CAP_MAX = 50;
const capKey = (product: string) => 'reply_cap:' + product;

/** 每天回帖上限按项目（D-2，公司平台批 2）：settings 的 reply_cap:<项目>，没设时退回 DAILY_REPLY_CAP */
export async function replyCap(env: Env, product: string = DEFAULT_PROJECT): Promise<number> {
  const r = await env.DB.prepare('SELECT value FROM settings WHERE key = ?1').bind(capKey(product)).first<{ value: string }>();
  const v = Number(r?.value);
  return Number.isInteger(v) && v >= 1 ? Math.min(REPLY_CAP_MAX, v) : defaultCap(env);
}

/** 今天这个项目回了几条：插件"同意"（events.approve）+ 后台"我回了"（queue.done），两边合起来算每天上限（2026-10-30）；D-2 起按项目分开算 */
export async function doneToday(env: Env, now: number, product: string = DEFAULT_PROJECT): Promise<number> {
  const day = twDay(now);
  const [a, b] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM queue WHERE status = 'done' AND done_day = ?1 AND product = ?2").bind(day, product).first<{ n: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE day = ?1 AND action = 'approve' AND product = ?2").bind(day, product).first<{ n: number }>(),
  ]);
  return (a?.n ?? 0) + (b?.n ?? 0);
}

/** 后台"每天回帖上限"一行：每个有项目页的项目（src/company.ts projectPages()，按 agents 推来的 projects 块动态算） */
async function replyCapRows(env: Env, now: number): Promise<{ project: string; cap: number; doneToday: number }[]> {
  return Promise.all((await projectPages(env)).map(async (project) => {
    const [cap, done] = await Promise.all([replyCap(env, project), doneToday(env, now, project)]);
    return { project, cap, doneToday: done };
  }));
}

/** POST /api/reply-cap {caps:{项目: n}}：n 是 1～50 的整数、项目要有项目页；有一个不对就一个都不存 */
async function saveReplyCaps(env: Env, now: number, caps: unknown): Promise<string[]> {
  if (!caps || typeof caps !== 'object' || Array.isArray(caps) || !Object.keys(caps).length) return ['请求不对：要 {caps:{项目: 数字}}'];
  const bad: string[] = [];
  const ok: [string, number][] = [];
  // 名单动态（projects 块），但**仍然是白名单**：不在名单里的项目名照旧拒收
  const pages = await projectPages(env);
  for (const [project, v] of Object.entries(caps as Record<string, unknown>)) {
    if (!pages.includes(project)) { bad.push(`不认识的项目：${project.slice(0, 40)}`); continue; }
    if (typeof v !== 'number' && typeof v !== 'string') { bad.push(`${project} 要在 1～${REPLY_CAP_MAX} 之间`); continue; }
    const n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v);
    if (!Number.isInteger(n) || n < 1 || n > REPLY_CAP_MAX) bad.push(`${project} 要在 1～${REPLY_CAP_MAX} 之间（整数）`);
    else ok.push([project, n]);
  }
  if (bad.length) return bad;
  await env.DB.batch(ok.map(([p, n]) => env.DB.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT (key) DO UPDATE SET value = ?2, updated_at = ?3').bind(capKey(p), String(n), now)));
  return [];
}

/** 后台的接口（/api/*）；不是后台的地址返回 null */
export async function adminApi(env: Env, req: Request, now: number): Promise<Response | null> {
  const url = new URL(req.url);
  const p = url.pathname;
  if (!p.startsWith('/api/')) return null;
  if (!adminEnabled(env)) return new Response('Not found', { status: 404 });
  if (req.method === 'POST') {
    // 只接受本站页面发来的写请求（防跨站提交）
    const origin = req.headers.get('origin');
    if (origin && origin !== url.origin) return json({ error: 'forbidden' }, 403);
  }
  if (p === '/api/login' && req.method === 'POST') return login(env, req, now);
  if (p === '/api/logout' && req.method === 'POST') return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
  if (!(await sessionOk(env, req, now))) return json({ error: '请重新登录' }, 401);
  if (p === '/api/extension.zip' && req.method === 'GET') return extensionZip();
  // 素材生成器（公共工具 → 素材生成器，assets.ts）：只看 Amos 自己在"用量和限额"里设的那个上限，不另外加额度
  if (p.startsWith('/api/assets/')) return (await assetsApi(env, req, now, p.slice('/api/assets/'.length))) ?? new Response('Not found', { status: 404 });
  // 语音生成（公共工具 → 语音生成，tts.ts）：跨项目可复用的单句配音，同样只看"用量和限额"里那个上限
  if (p.startsWith('/api/tts/')) return (await ttsApi(env, req, now, p.slice('/api/tts/'.length))) ?? new Response('Not found', { status: 404 });
  if (p.startsWith('/api/voice/')) return (await voiceApi(env, req, now, p.slice('/api/voice/'.length))) ?? new Response('Not found', { status: 404 });
  // 英语练习的跨轮记忆（工作台 → 英语练习，english-memory.ts）：只做记忆 + 出题，**不调任何 AI、不花一分钱**（底线 8 / C117）
  if (p.startsWith('/api/english/')) return (await englishApi(env, req, now, p.slice('/api/english/'.length))) ?? new Response('Not found', { status: 404 });
  // 带练（工作台 → 带练，drill.ts）：内容写死在代码里，只存他练到哪儿了；**一个 AI 都不调、不花一分钱**（底线 8 / C117）
  if (p.startsWith('/api/drill/')) return (await drillApi(env, req, now, p.slice('/api/drill/'.length))) ?? new Response('Not found', { status: 404 });
  // 基金观察（一级菜单「基金观察」#/funds，funds-api.ts）：GET 读快照、POST refresh 分批去 Yahoo / 东方财富取（每次 ≤45 个对外请求）；公开免费接口，不花钱
  if (p === '/api/funds' || p.startsWith('/api/funds/')) return (await fundsApi(env, req, now, p === '/api/funds' ? '' : p.slice('/api/funds/'.length))) ?? new Response('Not found', { status: 404 });
  const company = await companyApi(env, req, now);
  if (company) return company;
  const live = await activeApi(env, req, now);
  if (live) return live;
  if (p === '/api/queue' && req.method === 'GET') {
    const q = url.searchParams;
    const status = ['pending', 'done', 'skip'].includes(q.get('status') ?? '') ? q.get('status')! : 'pending';
    const where = ['status = ?1'];
    const args: (string | number)[] = [status];
    const add = (sql: string, v: string | number) => { args.push(v); where.push(sql.replace('?', '?' + args.length)); };
    // 按项目筛（批 B 走查 🔴，2026-11-04）：以前只认 /^[a-z0-9-]{1,32}$/，大写的"Practical"被悄悄丢掉、当成"全部"返回，项目页写了假数。
    // 现在按名字原样匹配已知项目（有项目页的项目 projectPages() ∪ 清单里出现过的 product ∪ 默认项目）；没带或空串 = 全部；**不认识的一律 400，不当成全部**
    const rawProd = (q.get('product') ?? '').trim();
    const [products, pages] = await Promise.all([
      env.DB.prepare('SELECT DISTINCT product FROM queue ORDER BY product').all<{ product: string }>(),
      rawProd ? projectPages(env) : Promise.resolve([] as string[]),
    ]);
    const prodList = (products.results ?? []).map((x) => x.product);
    if (rawProd && !new Set([...pages, ...prodList, DEFAULT_PROJECT]).has(rawProd)) return json({ error: `不认识的项目：${rawProd.slice(0, 40)}` }, 400);
    const prod = rawProd;
    if (prod) add('product = ?', prod);
    if (q.get('platform') === 'x' || q.get('platform') === 'threads') add('platform = ?', q.get('platform')!);
    const day = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(`${v}T00:00:00+08:00`) : NaN);
    if (Number.isFinite(day(q.get('from')))) add('at >= ?', day(q.get('from')));
    if (Number.isFinite(day(q.get('to')))) add('at < ?', day(q.get('to')) + 24 * 3600_000);
    const cond = where.join(' AND ');
    // 排序：默认按时间（待回按存进来、其他按处理时间，新的在前）；sort=score 按评分从高到低，同分新的在前（2026-10-30 Amos：帖子多时先处理评分高的）
    const byTime = status === 'pending' ? 'at DESC' : 'updated_at DESC';
    const order = q.get('sort') === 'score' ? `score IS NULL, score DESC, ${byTime}` : byTime;
    const [r, total] = await Promise.all([
      env.DB.prepare(`SELECT id, at, updated_at, product, platform, post_id, author, snippet, post_at, score, reasons, draft, source, engine, status FROM queue WHERE ${cond} ORDER BY ${order} LIMIT ${LIST_MAX}`).bind(...args)
        .all<{ id: number; at: number; updated_at: number; product: string; platform: 'x' | 'threads'; post_id: string; author: string; snippet: string; post_at: number | null; score: number | null; reasons: string; draft: string; source: string; engine: string; status: string }>(),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM queue WHERE ${cond}`).bind(...args).first<{ n: number }>(),
    ]);
    const items = (r.results ?? []).map((x) => ({
      id: x.id, product: x.product, platform: x.platform, author: x.author, snippet: x.snippet, score: x.score, reasons: readReasons(x.reasons),
      draft: x.draft, source: x.source, engine: x.engine, status: x.status,
      savedAt: x.at, postAt: x.post_at, handledAt: x.status === 'pending' ? null : x.updated_at,
      stale: (x.post_at ?? x.at) < now - 24 * 3600_000,
      replyUrl: replyUrl(x.platform, x.post_id, x.draft), postUrl: postUrl(x.platform, x.post_id, x.author),
    }));
    // 每天回帖上限按项目（D-2）：doneToday、cap 是筛的那个项目的（没筛按 forecast，和 /v1/today 一样）；caps 是清单里每个项目各自的，页面按条目所在项目判断"到上限"
    const caps: Record<string, { doneToday: number; cap: number }> = {};
    await Promise.all([...new Set([...prodList, prod || DEFAULT_PROJECT])].map(async (pj) => {
      const [doneN, capN] = await Promise.all([doneToday(env, now, pj), replyCap(env, pj)]);
      caps[pj] = { doneToday: doneN, cap: capN };
    }));
    const cur = caps[prod || DEFAULT_PROJECT];
    return json({ items, total: total?.n ?? 0, max: LIST_MAX, products: prodList, doneToday: cur.doneToday, cap: cur.cap, caps });
  }
  if (p === '/api/queue/delete' && req.method === 'POST') {
    // Amos 自己删（D-4：记录一直保留，条数太多时自己删）；一次最多 LIST_MAX 条，删了不能恢复（页面上先确认）
    let ids: number[] = [];
    try { ids = ((await req.json()) as { ids?: unknown }).ids as number[]; } catch { /* 下面判 400 */ }
    if (!Array.isArray(ids) || !ids.length || ids.length > LIST_MAX || !ids.every((n) => Number.isInteger(n) && n > 0)) return json({ error: '请求不对' }, 400);
    // D1 每条语句最多 100 个参数：每 100 个一批，一起提交
    const chunks: number[][] = [];
    for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
    const rs = await env.DB.batch(chunks.map((c) => env.DB.prepare(`DELETE FROM queue WHERE id IN (${c.map((_, i) => '?' + (i + 1)).join(',')})`).bind(...c)));
    const deleted = rs.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
    console.log(JSON.stringify({ event: 'copilot.queue_deleted', n: deleted }));
    return json({ ok: true, deleted });
  }
  if (p === '/api/usage' && req.method === 'GET') {
    // byProject：今天每个项目的 Gemini 次数、Workers AI neurons（D-3，只记、不当限额；11/2 以前的没分项目）
    // left / byPurpose：用量监控（Amos 2026-11-03"可以看到剩余和分别用到了哪里"）——还剩多少、分别用到了哪里。
    // 两本账分开（Workers AI 按 neurons、Gemini 按次数），**不加在一起**；没按用途记下来的单独一行，不摊进任何一项（底线 3）。
    // accountLimit：Cloudflare 自己说"账号额度用完了"那一条（表 account_limit，迁移 0011）。
    // left 里的数只是**本环境**记下的下限（两个环境两个 D1，Cloudflare 按整个账号算），所以每一行都带着说明；
    // 真实剩余查不到，不编（底线 3）。
    const rows = await usageReport(env, now, modelList(env), await usedToday(env, now), !!env.AI);
    const left = usageLeft(rows, envName(env));
    const byPurpose = await usageByPurpose(env, now);
    const rest = unlabeledUsage(byPurpose, left);
    return json({ rows, byProject: await usageByProject(env, now), left, byPurpose: rest ? [...byPurpose, rest] : byPurpose, accountLimit: await accountLimit(env, now) });
  }
  if (p === '/api/reply-cap' && req.method === 'GET') return json({ rows: await replyCapRows(env, now) });
  if (p === '/api/reply-cap' && req.method === 'POST') {
    let caps: unknown = null;
    try { caps = ((await req.json()) as { caps?: unknown }).caps; } catch { /* 下面判 400 */ }
    const bad = await saveReplyCaps(env, now, caps);
    if (bad.length) return json({ error: '没保存：' + bad.join('；') }, 400);
    console.log(JSON.stringify({ event: 'copilot.reply_cap_saved' }));
    return json({ ok: true, rows: await replyCapRows(env, now) });
  }
  if (p === '/api/usage' && req.method === 'POST') {
    let caps: Record<string, unknown> = {};
    try { caps = ((await req.json()) as { caps?: Record<string, unknown> }).caps ?? {}; } catch { /* 下面判 400 */ }
    if (!caps || typeof caps !== 'object' || Array.isArray(caps)) return json({ error: '请求不对' }, 400);
    const bad = await saveCaps(env, now, caps, [...modelList(env), WAI_KEY]);
    if (bad.length) return json({ error: '没保存：' + bad.join('；') }, 400);
    // 改完上限，"还剩多少"那一块要跟着一起回新的（不然页面上还显示旧的上限）
    const saved = await usageReport(env, now, modelList(env), await usedToday(env, now), !!env.AI);
    return json({ ok: true, rows: saved, left: usageLeft(saved, envName(env)), accountLimit: await accountLimit(env, now) });
  }
  const m = p.match(/^\/api\/queue\/(\d{1,10})$/);
  if (m && req.method === 'POST') {
    let status = '';
    try { status = String(((await req.json()) as { status?: unknown }).status ?? ''); } catch { /* 下面判 400 */ }
    if (!['pending', 'done', 'skip'].includes(status)) return json({ error: '请求不对' }, 400);
    const row = await env.DB.prepare('SELECT product FROM queue WHERE id = ?1').bind(Number(m[1])).first<{ product: string }>();
    if (!row) return json({ error: '这条已经不在了，请刷新' }, 404);
    // 每天上限按这一条所在的项目算（D-2）：forecast 到上限不挡别的项目
    if (status === 'done') { const c = await replyCap(env, row.product); if ((await doneToday(env, now, row.product)) >= c) return json({ error: `今天已经回了 ${c} 条，到上限了` }, 429); }
    const r = await env.DB.prepare('UPDATE queue SET status = ?1, updated_at = ?2, done_day = CASE WHEN ?1 = \'done\' THEN ?3 ELSE NULL END WHERE id = ?4').bind(status, now, twDay(now), Number(m[1])).run();
    if (!r.meta.changes) return json({ error: '这条已经不在了，请刷新' }, 404);
    return json({ ok: true, doneToday: await doneToday(env, now, row.product) });
  }
  return new Response('Not found', { status: 404 });
}

const LIST_MAX = 500;
function readReasons(s: string): string[] {
  try {
    const a = JSON.parse(s);
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string').slice(0, 3) : [];
  } catch {
    return [];
  }
}

/** 插件存一条进清单（调用方已经核对过令牌和来源）；同一条帖子只存一次；记录一直保留（D-4 选 B，Amos 在后台自己删） */
export async function saveToQueue(env: Env, now: number, q: { product: string; platform: 'x' | 'threads'; postId: string; author: string; text: string; ageMinutes: number | null; score: number | null; reasons?: string[]; draft: string; source: string; engine?: string }): Promise<{ saved: boolean }> {
  const reasons = JSON.stringify((q.reasons ?? []).slice(0, 3).map((r) => r.slice(0, 60)));
  const r = await env.DB.prepare(
    'INSERT INTO queue (at, updated_at, product, platform, post_id, author, snippet, post_at, score, reasons, draft, source, engine) VALUES (?1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12) ON CONFLICT (platform, post_id) DO NOTHING',
  )
    .bind(now, q.product, q.platform, q.postId, q.author, q.text.slice(0, 280), q.ageMinutes == null ? null : now - q.ageMinutes * 60_000, q.score, reasons, q.draft.slice(0, 600), q.source.slice(0, 120), q.engine === 'workers-ai' ? 'workers-ai' : 'gemini')
    .run();
  return { saved: r.meta.changes === 1 };
}
