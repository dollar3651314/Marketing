/**
 * 公司平台批 2（PR 3 公共工具）的验收测试（接口层；agents 公司平台/技术方案-公司平台-测试与风险.md 第二节 PR 3 一行，
 * PR与数据页第三、五节，范围与上线页第二节 T-4）。
 * 测试会话先写（agents C145 第 3 条）：写的时候功能还没做，所以"新功能"几组现在是红的；研发写代码到全绿，不改这里的断言（底线 6）。
 * "不能变"的几组（/v1/* 请求和返回格式、插件文件、model_usage / ai_usage 的值）在改动前的代码上就是绿的，之后必须一直绿。
 *
 * 覆盖：
 *   迁移 0007 只建 usage_by_project（不给 events 加索引，T-4）；在已有 0001～0006 数据的库上跑，旧表结构和数据一行不变；
 *   每天回帖上限按项目（D-2）：settings 的 reply_cap:<项目>，没设退回 DAILY_REPLY_CAP（默认 10）；forecast 到上限别的项目不受影响；
 *     /v1/today 不带项目 = forecast，和清单接口的"今天已回 / 上限"一致；后台保存上限（成功 / 不合法 / 要登录和本站来源）；
 *   用量按项目（D-3 不回填）：打分、写稿记到请求里的项目，"测试 AI"记 _platform；按项目加起来 = model_usage / ai_usage 的总量；
 *     同一组请求下 model_usage、ai_usage 的值和改之前一模一样；usage_by_project 只记、不当限额；按项目记失败时打分照常返回；
 *   插件不用重装：extension/ 一个字节不变、版本还是 0.3.5（T-4：0.3.6 不做）；/v1/* 的请求和返回字段不变。
 *
 * 接口约定（技术方案没写死的由测试先提；研发要改名就同一个 PR 改这里并在 PR 描述写明）：
 *   GET  /api/reply-cap                 {rows:[{project, cap, doneToday}]}   每个有项目页的项目（src/projects.ts PROJECT_PAGES）一行
 *   POST /api/reply-cap {caps:{项目: n}}  n 是 1～50 的整数；成功 {ok:true, rows}；有一个不对就 400 {error}，一个都不存
 *   GET  /api/queue?product=<项目>       doneToday、cap 按这个项目算；没带 product 时按 forecast 算（和 /v1/today 一样）
 *   GET  /api/usage                     多一项 byProject:[{project, gemini, workersAi}]：今天每个项目的 Gemini 次数（几个模型加起来）和 Workers AI neurons；
 *                                       "今天"和 rows 一样按各家的重置时间算（usage_by_project.day 同 model_usage.day，src/usage.ts dayFor）
 *   usage_by_project.model 和 model_usage.model 用同一套名字（Gemini 模型名、workers-ai）
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/env';
import { handle, twDay } from '../src/index';
import { ROOT, T0 } from './helpers';

const TOKEN = 'ci_only_copilot_token_0123456789';
const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const PASS = 'ci_only_copilot_password_01';
const HOST = 'https://copilot.example.test';
const MIG = path.join(ROOT, 'migrations');
const M0007 = '0007_usage_by_project.sql';
const OLD_TABLES = ['events', 'rate', 'queue', 'auth_fail', 'auth_lock', 'ai_usage', 'model_usage', 'settings', 'company_snapshot', 'company_done', 'company_rate', 'company_report'];

const stmtsOf = (files: string[]) => files.map((f) => readFileSync(path.join(MIG, f), 'utf8').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n'))
  .join(';\n').split(';').map((s) => s.trim()).filter(Boolean);
const migs = () => readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
const newProxy = () => getPlatformProxy<{ DB: D1Database }>({ configPath: path.join(ROOT, 'test/wrangler.test.toml'), persist: false, remoteBindings: false, envFiles: [] });
const hasTable = async (d: D1Database, t: string) => !!(await d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1").bind(t).first());

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
  const ts = [...OLD_TABLES];
  if (await hasTable(db, 'usage_by_project')) ts.push('usage_by_project');
  await db.batch(ts.map((t) => db.prepare(`DELETE FROM ${t}`)));
});

const env = (over: Partial<Env> = {}, d: D1Database = db): Env => ({ DB: d, ENVIRONMENT: 'test', COPILOT_TOKEN: TOKEN, GEMINI_API_KEY: 'ci_only_gemini_key', COPILOT_PASSWORD: PASS, DAILY_REPLY_CAP: '10', ...over });
/** 插件发的请求（本地单元测试里直接调 handle()，和 test/relay.test.ts 同一写法；不发到任何真实服务） */
const v1 = (method: string, p: string, body?: unknown) =>
  new Request(`${HOST}${p}`, { method, headers: { origin: ORIGIN, authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
/** 后台页面发的请求 */
const page = (p: string, init: RequestInit & { cookie?: string; origin?: string } = {}) =>
  new Request(`${HOST}${p}`, { ...init, headers: { 'content-type': 'application/json', origin: init.origin ?? HOST, 'cf-connecting-ip': '203.0.113.9', ...(init.cookie ? { cookie: init.cookie } : {}) } });
async function cookie(e: Env = env()): Promise<string> {
  const r = await handle(page('/api/login', { method: 'POST', body: JSON.stringify({ password: PASS }) }), e, T0);
  return r.headers.get('set-cookie')!.split(';')[0];
}
const getJson = async <T>(r: Response | Promise<Response>) => (await (await r).json()) as T;

const POST = { id: '1850000000000000001', author: '@hoops_demo', text: '明天早上勇士主場打湖人，誰會先爆發？', replies: 86, ageMinutes: 120 };
const DAY = twDay(T0);
/** 直接往清单里写一条（不经过插件接口：别的项目在 RULES 里没有，插件存不进来，只能这样造） */
async function seedQueue(product: string, postId: string, status: 'pending' | 'done' | 'skip' = 'pending', d: D1Database = db): Promise<number> {
  const r = await d.prepare("INSERT INTO queue (at, updated_at, product, platform, post_id, author, draft, status, done_day) VALUES (?1, ?1, ?2, 'x', ?3, '@a', '草稿', ?4, ?5) RETURNING id")
    .bind(T0 - 60_000, product, postId, status, status === 'done' ? DAY : null).first<{ id: number }>();
  return r!.id;
}
const approve = (postId: string, now = T0, e: Env = env()) => handle(v1('POST', '/v1/log', { product: 'forecast', platform: 'x', postId, author: '@a', score: 80, action: 'approve', draft: '回覆' }), e, now);
const setCap = (project: string, n: number | string) => db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT (key) DO UPDATE SET value = ?2').bind('reply_cap:' + project, String(n), T0).run();

// ======================================================================
describe('迁移 0007：只建 usage_by_project，不给 events 加索引（T-4），旧表不动', () => {
  it('有 0007_usage_by_project.sql，里面只有一条 CREATE TABLE（没有 INDEX、ALTER、DROP、DELETE、UPDATE、INSERT）', () => {
    expect(existsSync(path.join(MIG, M0007)), `migrations/${M0007}`).toBe(true);
    const st = stmtsOf([M0007]);
    expect(st.length).toBe(1);
    expect(st[0]).toMatch(/^CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?usage_by_project\s*\(/i);
    expect(st.join('\n')).not.toMatch(/\b(INDEX|ALTER|DROP|DELETE|UPDATE|INSERT|REPLACE)\b/i);
  });

  it('跑完全部迁移：usage_by_project (day, project, model, req, tok_in, tok_out, neurons)，主键 (day, project, model)；events 的索引还是原来两个', async () => {
    expect(await hasTable(db, 'usage_by_project')).toBe(true);
    const cols = (await db.prepare("SELECT name, pk FROM pragma_table_info('usage_by_project')").all<{ name: string; pk: number }>()).results;
    expect(cols.map((c) => c.name).sort()).toEqual(['day', 'model', 'neurons', 'project', 'req', 'tok_in', 'tok_out']);
    expect(cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name)).toEqual(['day', 'project', 'model']);
    const idx = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'events' AND name NOT LIKE 'sqlite_%' ORDER BY name").all<{ name: string }>()).results.map((x) => x.name);
    expect(idx).toEqual(['events_at', 'events_day']);
  });

  it('在"已有 0001～0006 数据"的库上跑 0007：12 张旧表的结构和数据一行不变', async () => {
    const p = await newProxy();
    try {
      const d = p.env.DB;
      const before = migs().filter((f) => f < '0007');
      expect(before).toEqual(['0001_init.sql', '0002_queue.sql', '0003_workers_ai.sql', '0004_v03.sql', '0005_company.sql', '0006_platform_reports.sql']);
      await d.batch(stmtsOf(before).map((s) => d.prepare(s)));
      await d.batch([
        d.prepare("INSERT INTO events (at, day, product, platform, post_id, author, snippet, score, action, draft) VALUES (1, '2026-11-01', 'forecast', 'x', '1', '@a', '摘要', 80, 'approve', '回覆')"),
        d.prepare("INSERT INTO events (at, day, product, platform, post_id, action) VALUES (2, '2026-11-01', 'forecast', 'threads', 'D2', 'drafted-wai')"),
        d.prepare('INSERT INTO rate (minute, n) VALUES (29000000, 7)'),
        d.prepare("INSERT INTO queue (at, updated_at, product, platform, post_id, author, draft, status, done_day, engine, reasons) VALUES (1, 2, 'forecast', 'x', '1', '@a', '草稿', 'done', '2026-11-01', 'workers-ai', '[\"理由\"]')"),
        d.prepare("INSERT INTO queue (at, updated_at, product, platform, post_id, author, draft) VALUES (3, 3, 'demo2', 'threads', 'D9', '@b', '草稿二')"),
        d.prepare("INSERT INTO auth_fail (ip, at) VALUES ('abc', 5)"),
        d.prepare("INSERT INTO auth_lock (scope, until) VALUES ('all', 9)"),
        d.prepare("INSERT INTO ai_usage (day, neurons) VALUES ('2026-11-01', 123.456)"),
        d.prepare("INSERT INTO model_usage (day, model, req, tok_in, tok_out, last_status, last_at) VALUES ('2026-11-01', 'gemini-3.6-flash', 41, 5000, 900, 200, 7)"),
        d.prepare("INSERT INTO model_usage (day, model, req, tok_in, tok_out, last_status, last_at) VALUES ('2026-11-01', 'workers-ai', 3, 300, 90, 0, 8)"),
        d.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('cap:gemini-3.6-flash', '150', 1)"),
        d.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('hook:github', '1', 1)"),
        d.prepare("INSERT INTO company_snapshot (source, kind, key, payload, status, source_at, updated_at) VALUES ('agents', 'todo', 'forecast', '{}', 'ok', 1, 1)"),
        d.prepare("INSERT INTO company_done (item_key, done_at) VALUES ('todo:forecast:T3', 5)"),
        d.prepare("INSERT INTO company_rate (source, minute, n) VALUES ('agents', 29000000, 2)"),
        d.prepare("INSERT INTO company_report (item_key, project, name, value, at) VALUES ('todo:forecast:R1', 'forecast', 'X 关注', '12', 6)"),
      ]);
      const schema = async () => (await d.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND tbl_name != 'usage_by_project' ORDER BY name").all()).results;
      const dump = async () => Promise.all(OLD_TABLES.map(async (t) => [t, (await d.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()).results]));
      const [s0, d0] = [await schema(), await dump()];
      expect(s0.length).toBeGreaterThan(12);
      expect(existsSync(path.join(MIG, M0007)), `migrations/${M0007}`).toBe(true);
      await d.batch(stmtsOf([M0007]).map((s) => d.prepare(s)));
      expect(await schema()).toEqual(s0);
      expect(await dump()).toEqual(d0);
      expect(await hasTable(d, 'usage_by_project')).toBe(true);
      // D-3：旧数据不回填，新表是空的
      expect((await d.prepare('SELECT COUNT(*) AS n FROM usage_by_project').first<{ n: number }>())!.n).toBe(0);
    } finally { await p.dispose(); }
  });
});

// ======================================================================
describe('插件不用重装、/v1/* 的请求和返回格式不变（这组在改动前就是绿的，之后必须一直绿）', () => {
  it('extension/ 一个字节不变，版本还是 0.3.5（T-4：插件 0.3.6 不做）', () => {
    const dir = path.join(ROOT, 'extension');
    const files = readdirSync(dir).filter((n) => !n.startsWith('.')).sort();
    expect(files).toEqual(['background.js', 'content.css', 'content.js', 'manifest.json', 'parse.js', 'sidepanel.css', 'sidepanel.html', 'sidepanel.js']);
    expect(JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')).version).toBe('0.3.5');
    const h = createHash('sha256');
    for (const f of files) h.update(f + '\0').update(readFileSync(path.join(dir, f)));
    // 批 1 合进 staging 时（e6c1e72）的插件；要改插件就不是这一批的范围（T-4），先回去问
    expect(h.digest('hex')).toBe(EXT_SHA256);
  });

  it('打分、写稿、记录、存清单、今天、测试 AI：请求照旧，返回的字段一个不多一个不少', async () => {
    const okG = (o: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(o) }] } }] }), { status: 200 });
    const s = await handle(v1('POST', '/v1/score', { product: 'forecast', platform: 'x', posts: [POST] }), env(), T0, async () => okG({ items: [{ id: POST.id, score: 70, reasons: ['NBA'] }] }));
    expect(s.status).toBe(200);
    expect(await s.json()).toEqual({ items: [{ id: POST.id, score: 70, reasons: ['NBA'] }], engine: 'gemini' });
    const d = await getJson<Record<string, unknown>>(handle(v1('POST', '/v1/draft', { product: 'forecast', platform: 'x', post: POST }), env(), T0, async () => okG({ drafts: [{ tone: '丢问题', text: 'Curry 今晚會先熱手嗎？', source: '' }] })));
    expect(Object.keys(d).sort()).toEqual(['drafts', 'dropped', 'engine']);
    expect(d.drafts).toEqual([{ tone: '丢问题', text: 'Curry 今晚會先熱手嗎？', source: '', engine: 'gemini' }]);
    expect(await getJson(handle(v1('POST', '/v1/queue', { product: 'forecast', platform: 'x', post: POST, score: 80, reasons: ['NBA'], draft: 'Curry 今晚會先熱手嗎？', source: '' }), env(), T0))).toEqual({ saved: true });
    expect(await getJson(approve('p1'))).toEqual({ ok: true });
    const t = await getJson<Record<string, unknown>>(handle(v1('GET', '/v1/today'), env(), T0));
    expect(Object.keys(t).sort()).toEqual(['approved', 'cap', 'day', 'items', 'saved', 'skipped']);
    expect(t).toMatchObject({ day: DAY, cap: 10, approved: 1, skipped: 0, saved: 1 });
    for (const it of t.items as Record<string, unknown>[]) expect(Object.keys(it).sort()).toEqual(['action', 'at', 'author', 'draft', 'platform', 'score']);
    const g = await getJson<{ models: Record<string, unknown>[] }>(handle(v1('GET', '/v1/diag'), env(), T0, async () => okG({ ok: true })));
    expect(Object.keys(g)).toEqual(['models']);
    for (const m of g.models) expect(Object.keys(m).sort()).toEqual(['detail', 'model', 'ms', 'ok']);
    // 到上限：还是 429 {error:'daily cap', cap}（插件 0.3.5 靠它显示"今天已经回了 N 条，到上限了"，extension/sidepanel.js:64）
    const r = await approve('p2', T0, env({ DAILY_REPLY_CAP: '1' }));
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: 'daily cap', cap: 1 });
    // 别的项目名照旧 400（RULES 只有 forecast）
    expect((await handle(v1('POST', '/v1/log', { product: 'demo2', platform: 'x', postId: 'p3', action: 'approve' }), env(), T0)).status).toBe(400);
  });

  it('只有 forecast、没设项目上限时，数值和现在一样：DAILY_REPLY_CAP 没填就是 10', async () => {
    const t = await getJson<{ cap: number }>(handle(v1('GET', '/v1/today'), env({ DAILY_REPLY_CAP: undefined }), T0));
    expect(t.cap).toBe(10);
    for (let i = 0; i < 10; i++) expect((await approve('d' + i, T0, env({ DAILY_REPLY_CAP: undefined }))).status).toBe(200);
    expect((await approve('d10', T0, env({ DAILY_REPLY_CAP: undefined }))).status).toBe(429);
  });
});

// ======================================================================
describe('每天回帖上限按项目（D-2）', () => {
  it('forecast 上限设 3：第 4 次"同意"回 429 {error, cap:3}；/v1/today 的 cap 也是 3', async () => {
    await setCap('forecast', 3);
    for (const id of ['a1', 'a2', 'a3']) expect((await approve(id)).status, id).toBe(200);
    const r = await approve('a4');
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: 'daily cap', cap: 3 });
    expect(await getJson(handle(v1('GET', '/v1/today'), env(), T0))).toMatchObject({ cap: 3, approved: 3 });
  });

  it('forecast 到上限，别的项目不受影响：demo2 的清单照样能点"我回了"；forecast 的再点 429', async () => {
    await setCap('forecast', 3);
    for (const id of ['a1', 'a2', 'a3']) await approve(id);
    const fc = await seedQueue('forecast', 'fq1');
    const other = await seedQueue('demo2', 'dq1');
    const ck = await cookie();
    const mark = (id: number) => handle(page(`/api/queue/${id}`, { method: 'POST', cookie: ck, body: JSON.stringify({ status: 'done' }) }), env(), T0);
    expect((await mark(fc)).status).toBe(429);
    const ok = await mark(other);
    expect(ok.status).toBe(200);
    // 回来的 doneToday 是这一条所在项目的数
    expect(await ok.json()).toEqual({ ok: true, doneToday: 1 });
  });

  it('别的项目回的不算进 forecast：demo2 今天回了 5 条（上限 2），forecast 照样能同意', async () => {
    await setCap('forecast', 3);
    await setCap('demo2', 2);
    for (let i = 0; i < 5; i++) await seedQueue('demo2', 'dd' + i, 'done');
    expect((await approve('a1')).status).toBe(200);
    expect(await getJson(handle(v1('GET', '/v1/today'), env(), T0))).toMatchObject({ cap: 3, approved: 1 });
  });

  it('没设 reply_cap:<项目> 时退回 DAILY_REPLY_CAP；只设了别的项目也一样', async () => {
    await setCap('demo2', 7);
    const e = env({ DAILY_REPLY_CAP: '2' });
    expect((await approve('b1', T0, e)).status).toBe(200);
    expect((await approve('b2', T0, e)).status).toBe(200);
    expect((await approve('b3', T0, e)).status).toBe(429);
    expect(await getJson(handle(v1('GET', '/v1/today'), e, T0))).toMatchObject({ cap: 2, approved: 2 });
  });

  it('/v1/today 不带项目 = forecast；"今天已回 N / 上限"和清单接口（按 forecast 筛）一模一样，也和不筛时一样', async () => {
    await setCap('forecast', 4);
    await setCap('demo2', 6);
    await approve('a1');
    await seedQueue('forecast', 'fq1', 'done');
    await seedQueue('demo2', 'dq1', 'done');
    await seedQueue('demo2', 'dq2', 'done');
    await seedQueue('demo2', 'dq3', 'done');
    const ck = await cookie();
    const t = await getJson<{ approved: number; cap: number }>(handle(v1('GET', '/v1/today'), env(), T0));
    expect([t.approved, t.cap]).toEqual([2, 4]);
    const q = (s: string) => getJson<{ doneToday: number; cap: number }>(handle(page('/api/queue' + s, { cookie: ck }), env(), T0));
    const f = await q('?status=pending&product=forecast');
    expect([f.doneToday, f.cap]).toEqual([t.approved, t.cap]);
    const all = await q('?status=pending');
    expect([all.doneToday, all.cap]).toEqual([t.approved, t.cap]);
    const d2 = await q('?status=pending&product=demo2');
    expect([d2.doneToday, d2.cap]).toEqual([3, 6]);
  });

  it('后台读上限：GET /api/reply-cap 每个有项目页的项目一行，写着上限和今天已回（和 /v1/today 一致）', async () => {
    await setCap('forecast', 3);
    await approve('a1');
    await seedQueue('forecast', 'fq1', 'done');
    const ck = await cookie();
    const r = await handle(page('/api/reply-cap', { cookie: ck }), env(), T0);
    expect(r.status).toBe(200);
    const j = (await r.json()) as { rows: { project: string; cap: number; doneToday: number }[] };
    expect(j.rows).toEqual([{ project: 'forecast', cap: 3, doneToday: 2 }]);
    // 没设时显示退回的值
    await db.prepare("DELETE FROM settings WHERE key = 'reply_cap:forecast'").run();
    expect((await getJson<{ rows: { cap: number }[] }>(handle(page('/api/reply-cap', { cookie: ck }), env({ DAILY_REPLY_CAP: '5' }), T0))).rows[0].cap).toBe(5);
  });

  it('后台保存上限：1～50 的整数才存（存在 settings 的 reply_cap:forecast）；有一个不对就 400、一个都不存', async () => {
    const ck = await cookie();
    const save = (caps: unknown, c = ck, origin?: string) => handle(page('/api/reply-cap', { method: 'POST', cookie: c, origin, body: JSON.stringify({ caps }) }), env(), T0);
    const stored = async () => (await db.prepare("SELECT key, value FROM settings WHERE key LIKE 'reply_cap:%' ORDER BY key").all<{ key: string; value: string }>()).results;
    for (const bad of [{ forecast: 0 }, { forecast: 51 }, { forecast: 2.5 }, { forecast: 'abc' }, { forecast: -1 }, { 'no-such-project': 5 }, { forecast: 5, 'no-such-project': 5 }]) {
      const r = await save(bad);
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(typeof ((await r.json()) as { error: unknown }).error).toBe('string');
    }
    expect(await stored()).toEqual([]);
    const ok = await save({ forecast: 3 });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, rows: [{ project: 'forecast', cap: 3 }] });
    expect(await stored()).toEqual([{ key: 'reply_cap:forecast', value: '3' }]);
    // 存了马上生效
    for (const id of ['a1', 'a2', 'a3']) await approve(id);
    expect((await approve('a4')).status).toBe(429);
    // 没登录 401；别的网站来的写请求 403；都不改库
    expect((await handle(page('/api/reply-cap', { method: 'POST', body: JSON.stringify({ caps: { forecast: 9 } }) }), env(), T0)).status).toBe(401);
    expect((await save({ forecast: 9 }, ck, 'https://evil.example')).status).toBe(403);
    expect(await stored()).toEqual([{ key: 'reply_cap:forecast', value: '3' }]);
  });
});

// ======================================================================
describe('用量按项目（D-3）："测试 AI"记 _platform；按项目加起来 = 总量；旧表的值和改之前一模一样', () => {
  const gOk = (inT: number, outT: number, o: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(o) }] } }], usageMetadata: { promptTokenCount: inT, candidatesTokenCount: outT } }), { status: 200 });
  const q429 = () => new Response('quota', { status: 429 });
  function seq(...rs: Response[]) { return async () => rs.shift() ?? q429(); }
  function fakeAi(...answers: unknown[]) {
    return { run: async () => answers.shift() };
  }
  /**
   * 同一组请求：① forecast 打分（3.6 超额 429、3.8 成功）② forecast 写稿（Gemini 全超额，换 Workers AI）③ "测试 AI"（三个 Gemini 模型 + Workers AI 都成功）
   */
  async function runSet(e: Env) {
    const s = await handle(v1('POST', '/v1/score', { product: 'forecast', platform: 'x', posts: [POST] }), e, T0, seq(q429(), gOk(120, 40, { items: [{ id: POST.id, score: 70, reasons: [] }] })));
    expect(s.status).toBe(200);
    const d = await handle(v1('POST', '/v1/draft', { product: 'forecast', platform: 'x', post: POST }), { ...e, AI: fakeAi({ response: JSON.stringify({ drafts: [{ tone: '丢问题', text: 'Curry 今晚會先熱手嗎？', source: '' }] }), usage: { prompt_tokens: 100, completion_tokens: 50 } }) }, T0, seq(q429(), q429(), q429()));
    expect(d.status).toBe(200);
    const g = await handle(v1('GET', '/v1/diag'), { ...e, AI: fakeAi({ response: '{"ok":true}', usage: { prompt_tokens: 10, completion_tokens: 5 } }) }, T0, seq(gOk(10, 5, { ok: true }), gOk(10, 5, { ok: true }), gOk(10, 5, { ok: true })));
    expect(g.status).toBe(200);
  }
  const N_FORECAST_WAI = (100 * 4625 + 50 * 30475) / 1e6;
  const N_PLATFORM_WAI = (10 * 4625 + 5 * 30475) / 1e6;
  type Row = { day: string; project: string; model: string; req: number; tok_in: number; tok_out: number; neurons: number };
  const byProject = async () => (await db.prepare('SELECT day, project, model, req, tok_in, tok_out, neurons FROM usage_by_project ORDER BY project, model').all<Row>()).results;

  it('同一组请求下 model_usage、ai_usage 的值和改之前一模一样（这条在改动前就是绿的）', async () => {
    await runSet(env());
    const mu = (await db.prepare('SELECT day, model, req, tok_in, tok_out, last_status, last_at FROM model_usage ORDER BY model').all()).results;
    expect(mu).toEqual(GOLDEN_MODEL_USAGE);
    const au = (await db.prepare('SELECT day, neurons FROM ai_usage').all<{ day: string; neurons: number }>()).results;
    expect(au.map((x) => x.day)).toEqual([GOLDEN_AI_USAGE.day]);
    expect(au[0].neurons).toBeCloseTo(GOLDEN_AI_USAGE.neurons, 9);
  });

  it('打分、写稿记到 forecast，"测试 AI"记到 _platform；每个模型按项目加起来 = model_usage；Workers AI neurons 加起来 = ai_usage', async () => {
    await runSet(env());
    const rows = await byProject();
    const pick = (p: string) => rows.filter((r) => r.project === p).map((r) => [r.model, r.req, r.tok_in, r.tok_out]);
    expect(pick('forecast')).toEqual([
      ['gemini-3.6-flash', 2, 0, 0], ['gemini-3.8-flash', 2, 120, 40], ['gemini-flash-latest', 1, 0, 0], ['workers-ai', 1, 100, 50],
    ]);
    expect(pick('_platform')).toEqual([
      ['gemini-3.6-flash', 1, 10, 5], ['gemini-3.8-flash', 1, 10, 5], ['gemini-flash-latest', 1, 10, 5], ['workers-ai', 1, 10, 5],
    ]);
    expect([...new Set(rows.map((r) => r.project))].sort()).toEqual(['_platform', 'forecast']);
    expect(rows.find((r) => r.project === 'forecast' && r.model === 'workers-ai')!.neurons).toBeCloseTo(N_FORECAST_WAI, 6);
    expect(rows.find((r) => r.project === '_platform' && r.model === 'workers-ai')!.neurons).toBeCloseTo(N_PLATFORM_WAI, 6);
    // 合计 = 总量（每个 day + model）
    const mu = (await db.prepare('SELECT day, model, req, tok_in, tok_out FROM model_usage ORDER BY day, model').all<{ day: string; model: string; req: number; tok_in: number; tok_out: number }>()).results;
    const sum = new Map<string, number[]>();
    for (const r of rows) { const k = r.day + '|' + r.model; const s = sum.get(k) ?? [0, 0, 0]; sum.set(k, [s[0] + r.req, s[1] + r.tok_in, s[2] + r.tok_out]); }
    expect([...sum.entries()].sort()).toEqual(mu.map((m) => [m.day + '|' + m.model, [m.req, m.tok_in, m.tok_out]]));
    const au = (await db.prepare('SELECT day, neurons FROM ai_usage').all<{ day: string; neurons: number }>()).results;
    for (const a of au) expect(rows.filter((r) => r.model === 'workers-ai' && r.day === a.day).reduce((n, r) => n + r.neurons, 0)).toBeCloseTo(a.neurons, 6);
  });

  it('Gemini 失败的请求（429、超时、5xx）也按项目记一次，和 model_usage 的算法一样', async () => {
    const timeout = async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; };
    let n = 0;
    const f = async () => { n += 1; if (n === 1) return timeout(); if (n === 2) return new Response('down', { status: 503 }); return gOk(7, 3, { items: [] }); };
    expect((await handle(v1('POST', '/v1/score', { product: 'forecast', platform: 'x', posts: [POST] }), env(), T0, f)).status).toBe(200);
    const rows = await byProject();
    const mu = (await db.prepare('SELECT model, req, tok_in, tok_out FROM model_usage ORDER BY model').all<{ model: string; req: number; tok_in: number; tok_out: number }>()).results;
    expect(rows.map((r) => [r.project, r.model, r.req, r.tok_in, r.tok_out])).toEqual(mu.map((m) => ['forecast', m.model, m.req, m.tok_in, m.tok_out]));
    expect(mu.map((m) => m.req)).toEqual([1, 1, 1]);
  });

  it('后台用量页 GET /api/usage：多一项 byProject；每个项目的 Gemini 次数加起来 = rows 里 Gemini 的请求数；rows 的字段不变', async () => {
    await runSet(env());
    const e = env({ AI: fakeAi() });
    const ck = await cookie(e);
    const u = await getJson<{ rows: Record<string, unknown>[]; byProject?: { project: string; gemini: number; workersAi: number }[] }>(handle(page('/api/usage', { cookie: ck }), e, T0));
    for (const r of u.rows) expect(Object.keys(r).sort()).toEqual(['cap', 'label', 'max', 'model', 'req', 'resetAt', 'state', 'stateText', 'tokIn', 'tokOut', 'unit', 'used']);
    expect(Array.isArray(u.byProject), 'byProject').toBe(true);
    const bp = u.byProject!;
    expect(bp.map((x) => x.project).sort()).toEqual(['_platform', 'forecast']);
    const gemTotal = u.rows.filter((r) => r.model !== 'workers-ai').reduce((n, r) => n + (r.req as number), 0);
    expect(bp.reduce((n, x) => n + x.gemini, 0)).toBe(gemTotal);
    expect(bp.find((x) => x.project === 'forecast')!.gemini).toBe(5);
    expect(bp.find((x) => x.project === '_platform')!.gemini).toBe(3);
    const wai = u.rows.find((r) => r.model === 'workers-ai')!;
    expect(Math.round(bp.reduce((n, x) => n + x.workersAi, 0))).toBe(wai.used);
    expect(bp.find((x) => x.project === 'forecast')!.workersAi).toBeCloseTo(N_FORECAST_WAI, 6);
  });

  it('usage_by_project 只记、不当限额：forecast 那行写成 99999 次，打分照样去问 Gemini', async () => {
    expect(await hasTable(db, 'usage_by_project'), 'usage_by_project').toBe(true);
    for (const m of ['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-flash-latest']) {
      await db.prepare("INSERT INTO usage_by_project (day, project, model, req, tok_in, tok_out, neurons) VALUES (?1, 'forecast', ?2, 99999, 0, 0, 0)").bind(new Date(T0 - 8 * 3600_000).toISOString().slice(0, 10), m).run();
      await db.prepare("INSERT INTO usage_by_project (day, project, model, req, tok_in, tok_out, neurons) VALUES (?1, 'forecast', ?2, 99999, 0, 0, 0)").bind(new Date(T0).toISOString().slice(0, 10), m).run();
    }
    let calls = 0;
    const r = await handle(v1('POST', '/v1/score', { product: 'forecast', platform: 'x', posts: [POST] }), env(), T0, async () => { calls += 1; return gOk(1, 1, { items: [{ id: POST.id, score: 50, reasons: [] }] }); });
    expect(r.status).toBe(200);
    expect(calls).toBe(1);
  });

  it('按项目记用量失败（例如库里还没有 usage_by_project）时，打分照常返回，model_usage 照常记（这条在改动前就是绿的）', async () => {
    const p = await newProxy();
    try {
      const d = p.env.DB;
      await d.batch(stmtsOf(migs().filter((f) => f < '0007')).map((s) => d.prepare(s)));
      expect(await hasTable(d, 'usage_by_project')).toBe(false);
      const e = env({}, d);
      const r = await handle(v1('POST', '/v1/score', { product: 'forecast', platform: 'x', posts: [POST] }), e, T0, async () => gOk(5, 5, { items: [{ id: POST.id, score: 77, reasons: [] }] }));
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ items: [{ id: POST.id, score: 77, reasons: [] }], engine: 'gemini' });
      const g = await handle(v1('GET', '/v1/diag'), e, T0, async () => gOk(1, 1, { ok: true }));
      expect(g.status).toBe(200);
      expect((await d.prepare("SELECT req FROM model_usage WHERE model = 'gemini-3.6-flash'").first<{ req: number }>())!.req).toBe(2);
    } finally { await p.dispose(); }
  });
});

// ---- 改动前的代码（e6c1e72）上实际跑出来的值：批 2 不许改旧表的记法 ----
const EXT_SHA256 = '9e184817b8286c10f1c9fadd451593513310d6056d3d4482937edd802a0a892e';
const GOLDEN_MODEL_USAGE: unknown[] = [
  { day: '2026-10-28', model: 'gemini-3.6-flash', req: 3, tok_in: 10, tok_out: 5, last_status: 200, last_at: T0 },
  { day: '2026-10-28', model: 'gemini-3.8-flash', req: 3, tok_in: 130, tok_out: 45, last_status: 200, last_at: T0 },
  { day: '2026-10-28', model: 'gemini-flash-latest', req: 2, tok_in: 10, tok_out: 5, last_status: 200, last_at: T0 },
  { day: '2026-10-29', model: 'workers-ai', req: 2, tok_in: 110, tok_out: 55, last_status: 200, last_at: T0 },
];
const GOLDEN_AI_USAGE = { day: '2026-10-29', neurons: 2.184875 };

// ======================================================================
// 批 2 追加（Amos 2026-11-02："一键发帖都可以直接在页面操作，为什么'看待办'就要跳转到GitHub呢，看待办 加载的不就是文字吗"）
// 待办正文由上报脚本一起推：PR 说明正文、要 Amos 决定的问题表（每条带建议）、周包 / 交接记录 / 状态卡里对应的那一段。
// 接口约定（测试先提；研发要改名就同一个 PR 改这里并在 PR 描述写明）：
//   prs.items[]、todo.items[]、status.waiting[] 多三个字段：body（正文，纯文字，≤ BODY_MAX = 4000 字）、body_cut（true = 正文被截断过）、
//   questions（[{q, advice}]，≤ 20 条，q、advice 各 ≤ 500 字）
//   服务端：不在白名单里的字段一律丢掉（不存）；body 超过 4000 字的不原样存——截到 4000 字并标 body_cut: true
// ======================================================================
describe('待办正文：服务端字段白名单和长度上限（批 2 追加）', () => {
  const INGEST = 'ci_only_company_ingest_token_0123456789';
  const BODY_MAX = 4000;
  const ingest = (source: string, blocks: unknown[]) =>
    handle(new Request(`${HOST}/api/company/ingest`, { method: 'POST', headers: { authorization: `Bearer ${INGEST}`, 'content-type': 'application/json' }, body: JSON.stringify({ source, blocks }) }), env({ COMPANY_INGEST_TOKEN: INGEST }), T0);
  const blocksOf = async () => {
    const e = env({ COMPANY_INGEST_TOKEN: INGEST });
    const ck = await cookie(e);
    return (await getJson<{ blocks: { source: string; kind: string; key: string; payload: Record<string, unknown> | null }[] }>(handle(page('/api/company', { cookie: ck }), e, T0))).blocks;
  };
  const XSS = '正文<script>window.__xss=1</script><img src=x onerror="window.__xss=2">结尾';
  const QS = [{ q: '要不要改首页文案？', advice: '建议改，理由见正文' }, { q: '上线时间？', advice: '建议周三' }];

  it('prs、todo、status.waiting 的条目收下 body、body_cut、questions；HTML 原样当文字存（不转义、不删）', async () => {
    const r = await ingest('agents', [
      { kind: 'prs', key: '', payload: { items: [{ number: 101, title: '【要你决定】换首页文案', url: 'https://github.com/dollar3651314/agents/pull/101', days: 0, tag: 'decide', body: XSS, questions: QS }] } },
      { kind: 'todo', key: 'forecast', payload: { product: 'forecast', items: [{ id: 'T7', type: 'confirm', text: '看周包', link: 'https://github.com/dollar3651314/agents/blob/main/x.md', link_text: '看待办', body: '周包里这一段', body_cut: true, questions: QS }] } },
      { kind: 'status', key: 'forecast', payload: { product: 'forecast', waiting: [{ text: '等你定价', body: '状态卡"在等谁"那一段的全文' }] } },
    ]);
    expect(r.status).toBe(200);
    const bs = await blocksOf();
    const pr = (bs.find((b) => b.kind === 'prs')!.payload as { items: Record<string, unknown>[] }).items[0];
    expect(pr).toMatchObject({ number: 101, body: XSS, questions: QS });
    const todo = (bs.find((b) => b.kind === 'todo')!.payload as { items: Record<string, unknown>[] }).items[0];
    expect(todo).toMatchObject({ id: 'T7', body: '周包里这一段', body_cut: true, questions: QS });
    const st = (bs.find((b) => b.kind === 'status')!.payload as { waiting: Record<string, unknown>[] }).waiting[0];
    expect(st).toMatchObject({ text: '等你定价', body: '状态卡"在等谁"那一段的全文' });
  });

  // 批 2 新口径（Amos 2026-11-02："只有agents才是公司……其他项目内不保留这些资料也不认被其他人提交上来的东西"）：测试用例修正，原来这条是"也能带 body、questions"
  it('new-forecast、marketing 推的 PR：body、body_cut、questions 一律不存（正文只认 agents）；external: true 收下', async () => {
    for (const src of ['new-forecast', 'marketing']) {
      expect((await ingest(src, [{ kind: 'prs', key: '', payload: { items: [
        { number: 5, title: '【要你决定】x', url: 'https://github.com/o/r/pull/5', days: 1, tag: 'decide', body: src + ' 的正文', body_cut: true, questions: [QS[0]] },
        { number: 6, title: '外部人改 README', url: 'https://github.com/o/r/pull/6', days: 0, external: true },
      ] } }])).status).toBe(200);
    }
    const bs = await blocksOf();
    for (const src of ['new-forecast', 'marketing']) {
      const items = (bs.find((b) => b.kind === 'prs' && b.source === src)!.payload as { items: Record<string, unknown>[] }).items;
      expect(items[0], src).toEqual({ number: 5, title: '【要你决定】x', url: 'https://github.com/o/r/pull/5', days: 1, tag: 'decide' });
      expect(items[1], src).toEqual({ number: 6, title: '外部人改 README', url: 'https://github.com/o/r/pull/6', days: 0, external: true });
    }
    // agents 推的照样收正文
    expect((await ingest('agents', [{ kind: 'prs', key: '', payload: { items: [{ number: 7, title: '【要你决定】y', url: 'https://github.com/dollar3651314/agents/pull/7', days: 0, body: 'agents 的正文' }] } }])).status).toBe(200);
    const ag = ((await blocksOf()).find((b) => b.kind === 'prs' && b.source === 'agents')!.payload as { items: Record<string, unknown>[] }).items[0];
    expect(ag.body).toBe('agents 的正文');
  });

  it('超长的不原样存：body 超过 4000 字截到 4000 并标 body_cut；questions 最多 20 条、每格最多 500 字', async () => {
    const long = '长'.repeat(BODY_MAX + 1500);
    const many = Array.from({ length: 30 }, (_, i) => ({ q: '问'.repeat(800) + i, advice: '议'.repeat(800) }));
    expect((await ingest('agents', [
      { kind: 'prs', key: '', payload: { items: [{ number: 102, title: '【要你决定】长', url: 'https://github.com/dollar3651314/agents/pull/102', days: 0, body: long, questions: many }] } },
      { kind: 'todo', key: 'forecast', payload: { product: 'forecast', items: [{ id: 'T8', type: 'action', text: '长', body: long }] } },
    ])).status).toBe(200);
    const bs = await blocksOf();
    const pr = (bs.find((b) => b.kind === 'prs')!.payload as { items: { body: string; body_cut?: boolean; questions: { q: string; advice: string }[] }[] }).items[0];
    expect(pr.body.length).toBeLessThanOrEqual(BODY_MAX);
    expect(pr.body.length).toBeGreaterThan(BODY_MAX - 50);
    expect(pr.body_cut).toBe(true);
    expect(pr.questions.length).toBe(20);
    for (const x of pr.questions) { expect(x.q.length).toBeLessThanOrEqual(500); expect(x.advice.length).toBeLessThanOrEqual(500); }
    const todo = (bs.find((b) => b.kind === 'todo')!.payload as { items: { body: string; body_cut?: boolean }[] }).items[0];
    expect(todo.body.length).toBeLessThanOrEqual(BODY_MAX);
    expect(todo.body_cut).toBe(true);
    // 没超长的不标
    expect((await ingest('agents', [{ kind: 'todo', key: 'forecast', payload: { product: 'forecast', items: [{ id: 'T9', type: 'action', text: '短', body: '短正文' }] } }])).status).toBe(200);
    const t9 = ((await blocksOf()).find((b) => b.kind === 'todo')!.payload as { items: Record<string, unknown>[] }).items[0];
    expect(t9.body).toBe('短正文');
    expect(t9.body_cut).toBeUndefined();
  });

  it('不在白名单里的字段一律不存：body_html、html、script、questions 里多的字段、类型不对的 body', async () => {
    expect((await ingest('agents', [
      { kind: 'prs', key: '', payload: { items: [{ number: 103, title: '【要你决定】x', url: 'https://github.com/dollar3651314/agents/pull/103', days: 0, body: 12345, body_html: '<b>x</b>', html: '<i>y</i>', script: 'alert(1)', questions: [{ q: '问', advice: '议', onclick: 'alert(1)' }, 'not-an-object'] }] } },
      { kind: 'todo', key: 'forecast', payload: { product: 'forecast', items: [{ id: 'T1', type: 'action', text: 'x', body: ['数组不是字符串'], body_cut: 'yes', render: 'html' }] } },
    ])).status).toBe(200);
    const bs = await blocksOf();
    const pr = (bs.find((b) => b.kind === 'prs')!.payload as { items: Record<string, unknown>[] }).items[0];
    expect(Object.keys(pr).sort()).toEqual(['days', 'number', 'questions', 'title', 'url']);
    expect(pr.questions).toEqual([{ q: '问', advice: '议' }]);
    const todo = (bs.find((b) => b.kind === 'todo')!.payload as { items: Record<string, unknown>[] }).items[0];
    expect(Object.keys(todo).sort()).toEqual(['id', 'text', 'type']);
  });
});
