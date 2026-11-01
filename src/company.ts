/**
 * 公司运营仪表盘（后台第四页"公司"；agents 公司平台/技术方案-运营仪表盘.md，Amos 2026-11-01 确认 B-3' B-5 B-7，B-6 不要定时兜底）。
 * 推送模型：agents、new-forecast、Marketing 各自的自动检查在合并到 main、开 / 关 PR 时把解析好的块推进来；这里不读 GitHub、没有定时任务。
 * - POST /api/company/ingest  Bearer <COMPANY_INGEST_TOKEN>（≥ 32 个字符，常数时间比较；没填时 404，C103）。不要会话、只依赖这个令牌，
 *   所以在 adminApi() 的 adminEnabled 判断之前处理。{source, blocks:[{kind, key, payload, status, error, source_at}]}；
 *   整体 ≤ 256 KB（413）；source、kind 白名单（400）；每个 source 每分钟 ≤ 6 次（429）；payload 只留白名单字段、按上限截断；
 *   status = error 的块只更新 error，保留上次成功的 payload；所有块一个 DB.batch 写入。
 * - GET  /api/company[?week=YYYY-MM-DD]  会话：所有块（更新时间、是否超过 7 天）、周报（默认最新一期）、"我做了"列表。
 * - POST /api/company/done  {key, done}  会话 + 本站来源（adminApi 已校验）：写 / 取消"我做了"；顺手删 90 天前的。
 */
import type { Env } from './env';

export const STALE_MS = 7 * 24 * 3600_000;
const DONE_KEEP_MS = 90 * 24 * 3600_000;
const MAX_BYTES = 256 * 1024;
const PER_MINUTE = 6;
const MAX_BLOCKS = 100;
const SOURCES = ['agents', 'new-forecast', 'marketing'] as const;
const KINDS = ['projects', 'status', 'handoff', 'todo', 'weekly', 'learning', 'prs', 'ci'] as const;
/** new-forecast、Marketing 只报自己仓库的 PR 和 CI（技术方案第二节） */
const KINDS_OF: Record<string, readonly string[]> = { agents: KINDS, 'new-forecast': ['prs', 'ci'], marketing: ['prs', 'ci'] };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
const notFound = () => new Response('Not found', { status: 404 });

export function companyEnabled(env: Env): boolean {
  return (env.COMPANY_INGEST_TOKEN ?? '').trim().length >= 32;
}

const enc = new TextEncoder();
async function ingestTokenOk(env: Env, req: Request): Promise<boolean> {
  const got = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(got)), crypto.subtle.digest('SHA-256', enc.encode((env.COMPANY_INGEST_TOKEN ?? '').trim()))]);
  const u = new Uint8Array(a), v = new Uint8Array(b);
  let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}

// ---- payload 字段白名单（技术方案第四节；字符串 ≤ 2,000、数组 ≤ 100；不认识的字段丢掉） ----
type Spec = { t: 's'; max?: number } | { t: 'n' } | { t: 'b' } | { t: 'u' } | { t: 'e'; of: readonly string[] } | { t: 'o'; f: Record<string, Spec> } | { t: 'a'; of: Spec };
const S = (max = 2000): Spec => ({ t: 's', max });
const N: Spec = { t: 'n' };
const B: Spec = { t: 'b' };
const U: Spec = { t: 'u' };
const E = (...of: string[]): Spec => ({ t: 'e', of });
const O = (f: Record<string, Spec>): Spec => ({ t: 'o', f });
const A = (of: Spec): Spec => ({ t: 'a', of });

export const SCHEMA: Record<(typeof KINDS)[number], Spec> = {
  // 项目版图：产品、当前阶段
  projects: O({ version: S(32), rules: S(64), items: A(O({ name: S(64), sub: S(200), stage: S(200), note: S(200), link: U })) }),
  // 状态卡（key = 产品）：数字 vs 目标、本周、没做完的事（stuck = 14 天没变）、在等 Amos 的事
  status: O({
    product: S(64), state: S(32), level: E('ok', 'warn', 'err', 'mute'), week: S(), link: U,
    metrics: A(O({ name: S(64), now: S(64), target: S(64), pct: N })),
    open: A(O({ what: S(), who: S(64), status: S(64), since: S(32), stuck: B })),
    waiting: A(O({ id: S(32), text: S(), hint: S(200), link: U })),
  }),
  // 交接记录（key = 岗位）
  handoff: O({ role: S(32), date: S(32), done: S(), next: S(), mistakes: N, link: U, sections: A(O({ title: S(64), text: S() })) }),
  // Amos 待办（key = 产品）：等你确认 / 等你操作 / 回报
  todo: O({ product: S(64), link: U, items: A(O({ id: S(32), type: E('confirm', 'action', 'report'), level: S(16), text: S(), hint: S(200), link: U, link_text: S(32) })) }),
  // 周报（key = 日期）
  weekly: O({
    title: S(64), range: S(64), rules: S(64), cost: S(), mistakes: N, link: U,
    numbers: A(O({ name: S(64), value: S(64), note: S(200) })),
    highlights: A(O({ value: S(32), label: S(64), until: S(10) })),
    next: A(O({ what: S(), who: S(64), when: S(64), status: S(32) })),
  }),
  // 岗位学习（key = 岗位）：最近 7 天新增
  learning: O({ role: S(32), note: S(200), items: A(O({ title: S(200), link: U })) }),
  // 含【要你决定】的 open PR
  prs: O({ items: A(O({ number: N, title: S(200), url: U, days: N })) }),
  // main 最近一次 CI（key 为空 = 仓库本身；其他 key 例如"定时任务"）
  ci: O({ name: S(64), conclusion: E('success', 'failure', 'cancelled', 'running', 'none', 'off'), url: U, sha: S(40), at: N, note: S(200) }),
};

/** 按白名单清洗：不认识的字段丢掉，字符串、数组按上限截断；类型不对的字段当作没有 */
export function clean(spec: Spec, v: unknown): unknown {
  switch (spec.t) {
    case 's': return typeof v === 'string' ? v.slice(0, spec.max ?? 2000) : undefined;
    case 'n': return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
    case 'b': return typeof v === 'boolean' ? v : undefined;
    case 'u': return typeof v === 'string' && /^https:\/\/[^\s"'<>]{1,500}$/.test(v) ? v : undefined;
    case 'e': return typeof v === 'string' && spec.of.includes(v) ? v : undefined;
    case 'a': return Array.isArray(v) ? v.slice(0, 100).map((x) => clean(spec.of, x)).filter((x) => x !== undefined) : undefined;
    case 'o': {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
      const out: Record<string, unknown> = {};
      for (const [k, s] of Object.entries(spec.f)) {
        const c = clean(s, (v as Record<string, unknown>)[k]);
        if (c !== undefined) out[k] = c;
      }
      return out;
    }
  }
}

async function underLimit(env: Env, source: string, now: number): Promise<boolean> {
  const minute = Math.floor(now / 60_000);
  const r = await env.DB.prepare('INSERT INTO company_rate (source, minute, n) VALUES (?1, ?2, 1) ON CONFLICT (source, minute) DO UPDATE SET n = n + 1 RETURNING n').bind(source, minute).first<{ n: number }>();
  if (minute % 10 === 0) await env.DB.prepare('DELETE FROM company_rate WHERE minute < ?1').bind(minute - 10).run();
  return (r?.n ?? 0) <= PER_MINUTE;
}

const KEY = /^[^\u0000-\u001f\u007f]{0,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** POST /api/company/ingest；不是这个地址返回 null */
export async function companyIngest(env: Env, req: Request, now: number): Promise<Response | null> {
  if (new URL(req.url).pathname !== '/api/company/ingest') return null;
  if (!companyEnabled(env) || req.method !== 'POST') return notFound();
  if (!(await ingestTokenOk(env, req))) return json({ error: 'unauthorized' }, 401);
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BYTES) return json({ error: 'too large' }, 413);
  const buf = await req.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return json({ error: 'too large' }, 413);
  let body: { source?: unknown; blocks?: unknown };
  try {
    body = JSON.parse(new TextDecoder().decode(buf));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
  } catch {
    return json({ error: '请求不对：要一个 JSON 对象' }, 400);
  }
  const source = typeof body.source === 'string' ? body.source : '';
  if (!(SOURCES as readonly string[]).includes(source)) return json({ error: `source 不对：只能是 ${SOURCES.join(' / ')}` }, 400);
  if (!Array.isArray(body.blocks) || body.blocks.length === 0 || body.blocks.length > MAX_BLOCKS) return json({ error: `blocks 不对：要 1～${MAX_BLOCKS} 块` }, 400);
  if (!(await underLimit(env, source, now))) return json({ error: 'too many requests', retryAfter: 60 }, 429);
  // 先把每一块都检查完，一次报全部问题（C56），有一块不对整次不写
  const bad: string[] = [];
  const stmts: D1PreparedStatement[] = [];
  body.blocks.forEach((raw: unknown, i: number) => {
    const b = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
    const kind = typeof b.kind === 'string' ? b.kind : '';
    const key = typeof b.key === 'string' ? b.key.trim() : b.key === undefined ? '' : null;
    const status = b.status === undefined ? 'ok' : b.status;
    const at = b.source_at === undefined ? now : b.source_at;
    const why: string[] = [];
    if (!KINDS_OF[source].includes(kind)) why.push(`kind 只能是 ${KINDS_OF[source].join(' / ')}`);
    if (key === null || !KEY.test(key)) why.push('key 要是不超过 64 个字的字符串');
    else if (kind === 'weekly' && !DAY.test(key)) why.push('周报的 key 要写成 YYYY-MM-DD');
    if (status !== 'ok' && status !== 'error') why.push('status 只能是 ok 或 error');
    if (typeof at !== 'number' || !Number.isInteger(at) || at <= 0 || at > now + 24 * 3600_000) why.push('source_at 要是毫秒时间戳，不能晚于现在');
    const payload = status === 'ok' && KINDS_OF[source].includes(kind) ? clean(SCHEMA[kind as keyof typeof SCHEMA], b.payload) : undefined;
    if (status === 'ok' && payload === undefined) why.push('payload 要是对象');
    if (why.length) { bad.push(`blocks[${i}]: ${why.join('; ')}`); return; }
    if (status === 'ok') {
      stmts.push(env.DB.prepare(
        "INSERT INTO company_snapshot (source, kind, key, payload, status, error, source_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'ok', '', ?5, ?6) " +
          "ON CONFLICT (source, kind, key) DO UPDATE SET payload = excluded.payload, status = 'ok', error = '', source_at = excluded.source_at, updated_at = excluded.updated_at",
      ).bind(source, kind, key, JSON.stringify(payload), at, now));
    } else {
      // 解析失败：只记原因，保留上次成功的 payload 和它的更新时间（页面照旧显示旧内容 + "解析失败：原因"）
      const error = (typeof b.error === 'string' && b.error.trim() ? b.error.trim() : '原因没写').slice(0, 300);
      stmts.push(env.DB.prepare(
        "INSERT INTO company_snapshot (source, kind, key, payload, status, error, source_at, updated_at) VALUES (?1, ?2, ?3, 'null', 'error', ?4, ?5, ?6) " +
          "ON CONFLICT (source, kind, key) DO UPDATE SET status = 'error', error = excluded.error, updated_at = excluded.updated_at",
      ).bind(source, kind, key, error, at, now));
    }
  });
  if (bad.length) return json({ error: '有块不对，这次一块都没写', detail: bad.slice(0, 20) }, 400);
  await env.DB.batch(stmts);
  console.log(JSON.stringify({ event: 'company.ingest', source, n: stmts.length }));
  return json({ ok: true, written: stmts.length });
}

interface Row { source: string; kind: string; key: string; payload: string; status: string; error: string; source_at: number; updated_at: number }
function out(r: Row, now: number) {
  let payload: unknown = null;
  try { payload = JSON.parse(r.payload); } catch { /* 当作没有 */ }
  return { source: r.source, kind: r.kind, key: r.key, payload, status: r.status, error: r.error, source_at: r.source_at, updated_at: r.updated_at, stale: r.source_at < now - STALE_MS };
}

/** 后台的 /api/company、/api/company/done（调用方已核对会话和来源）；不是这两个地址返回 null */
export async function companyApi(env: Env, req: Request, now: number): Promise<Response | null> {
  const url = new URL(req.url);
  const p = url.pathname;
  if (p === '/api/company' && req.method === 'GET') {
    const w = url.searchParams.get('week');
    const week = w && DAY.test(w) ? w : null;
    const COLS = 'source, kind, key, payload, status, error, source_at, updated_at';
    const [rows, weeks, done] = await Promise.all([
      env.DB.prepare(`SELECT ${COLS} FROM company_snapshot WHERE kind != 'weekly' ORDER BY source, kind, key`).all<Row>(),
      env.DB.prepare("SELECT key FROM company_snapshot WHERE kind = 'weekly' ORDER BY key DESC LIMIT 52").all<{ key: string }>(),
      env.DB.prepare('SELECT item_key, done_at FROM company_done WHERE done_at >= ?1 ORDER BY done_at DESC').bind(now - DONE_KEEP_MS).all<{ item_key: string; done_at: number }>(),
    ]);
    const list = (weeks.results ?? []).map((x) => x.key);
    const pick = week ?? list[0] ?? null;
    const wk = pick ? await env.DB.prepare(`SELECT ${COLS} FROM company_snapshot WHERE kind = 'weekly' AND key = ?1 ORDER BY source LIMIT 1`).bind(pick).first<Row>() : null;
    return json({
      configured: companyEnabled(env), now, staleAfter: STALE_MS,
      blocks: (rows.results ?? []).map((r) => out(r, now)),
      weeks: list, weekly: wk ? out(wk, now) : null,
      done: (done.results ?? []).map((x) => ({ key: x.item_key, at: x.done_at })),
    });
  }
  if (p === '/api/company/done' && req.method === 'POST') {
    let b: { key?: unknown; done?: unknown } = {};
    try { b = (await req.json()) as typeof b; } catch { /* 下面判 400 */ }
    const key = typeof b.key === 'string' ? b.key.trim() : '';
    if (!key || key.length > 200 || /[\u0000-\u001f\u007f]/.test(key) || typeof b.done !== 'boolean') return json({ error: '请求不对' }, 400);
    const prune = env.DB.prepare('DELETE FROM company_done WHERE done_at < ?1').bind(now - DONE_KEEP_MS);
    if (b.done) {
      await env.DB.batch([env.DB.prepare('INSERT INTO company_done (item_key, done_at) VALUES (?1, ?2) ON CONFLICT (item_key) DO UPDATE SET done_at = excluded.done_at').bind(key, now), prune]);
      return json({ ok: true, key, at: now });
    }
    await env.DB.batch([env.DB.prepare('DELETE FROM company_done WHERE item_key = ?1').bind(key), prune]);
    return json({ ok: true, key, at: null });
  }
  return null;
}
