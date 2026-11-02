/**
 * 公司平台批 1 的验收测试（接口层；agents 公司平台/技术方案-公司平台-测试与风险.md 第二节 PR 1 一行，PR 与数据页第一、二、五、六、七节）。
 * 测试会话先写（agents C145 第 3 条），写的时候功能还没做，所以现在是红的；研发写代码到全绿，不改这里的断言（底线 6）。
 * 覆盖：迁移 0006 只建表（空库、已有 0001～0005 数据的库都能跑，旧数据不动）；推送新字段 due / tag / opened_at 收得下、不认识的丢掉；
 * 新 kind pack（周包，key = 项目，只有 agents 能推）；打勾带 seen：对不上回 409、和库里一样直接成功、不带 seen 照旧、老 key 的勾保留；
 * 填数字：全角数字和空格规范化、错的格一次全报、保存 = 写回报 + 打勾在同一次、只存 D1（company_report）、读回来有最新值、要会话和本站来源。
 *
 * 接口约定（测试按技术方案定的名字；方案里没写死的由测试先提，研发要改名就同一个 PR 改这里并在 PR 描述写明）：
 *   POST /api/company/done    {key, done, seen?}         seen = 页面上次看到的 done_at（没勾是 null）；409 时回 {error, key, done, at}
 *   POST /api/company/report  {key, project, values:{名称: 文本}}   成功 {ok, key, at}；不对 400 {error, bad:[{name, why}]}（一次列出全部错的格）
 *     名称：X 关注、Threads 关注、名单人数（非负整数）；Claude 用量（0～100）
 *   GET  /api/company          多一项 reports: [{item_key, project, name, value, at}]（每个 项目 + 名称 最新一条）
 *   pack 块 payload：{project, date, link, due, steps:[{n, text, link}], posts:[{n, title, at, at_text, deadline}], matches:[{league, home, away, time, note}]}
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import { ROOT, T0 } from './helpers';

const PASS = 'ci_only_copilot_password_01';
const INGEST = 'ci_only_company_ingest_token_0123456789';
const HOST = 'https://copilot.example.test';
const H = 3600_000;
const MIG = path.join(ROOT, 'migrations');

/** 迁移文件按顺序读出、去掉注释、拆成语句 */
const stmtsOf = (files: string[]) => files.map((f) => readFileSync(path.join(MIG, f), 'utf8').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n'))
  .join(';\n').split(';').map((s) => s.trim()).filter(Boolean);
const migs = () => readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
const M0006 = '0006_platform_reports.sql';

let db: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: path.join(ROOT, 'test/wrangler.test.toml'), persist: false, remoteBindings: false, envFiles: [] });
  db = proxy.env.DB;
  dispose = proxy.dispose;
  await db.batch(stmtsOf(migs()).map((s) => db.prepare(s)));
});
afterAll(async () => dispose());
const hasTable = async (d: D1Database, t: string) => !!(await d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1").bind(t).first());
beforeEach(async () => {
  const ts = ['company_snapshot', 'company_done', 'company_rate', 'auth_fail', 'auth_lock'];
  if (await hasTable(db, 'company_report')) ts.push('company_report');
  await db.batch(ts.map((t) => db.prepare(`DELETE FROM ${t}`)));
});

const env = (over: Partial<Env> = {}): Env => ({ DB: db, ENVIRONMENT: 'test', COPILOT_PASSWORD: PASS, COMPANY_INGEST_TOKEN: INGEST, ...over });
const ingest = (body: unknown, now = T0) =>
  handle(new Request(`${HOST}/api/company/ingest`, { method: 'POST', headers: { authorization: `Bearer ${INGEST}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }), env(), now);
const page = (p: string, init: RequestInit & { cookie?: string; origin?: string } = {}) =>
  new Request(`${HOST}${p}`, { ...init, headers: { 'content-type': 'application/json', origin: init.origin ?? HOST, 'cf-connecting-ip': '203.0.113.9', ...(init.cookie ? { cookie: init.cookie } : {}) } });
async function cookie(): Promise<string> {
  const r = await handle(page('/api/login', { method: 'POST', body: JSON.stringify({ password: PASS }) }), env(), T0);
  return r.headers.get('set-cookie')!.split(';')[0];
}
interface Block { source: string; kind: string; key: string; payload: Record<string, unknown> | null; status: string }
interface Report { item_key: string; project: string; name: string; value: string; at: number }
interface Company { blocks: Block[]; done: { key: string; at: number }[]; reports?: Report[] }
const read = async (ck: string, now = T0) => (await (await handle(page('/api/company', { cookie: ck }), env(), now)).json()) as Company;
const post = (p: string, body: unknown, ck: string, now = T0, origin?: string) => handle(page(p, { method: 'POST', body: JSON.stringify(body), cookie: ck, origin }), env(), now);

// ---------------- 迁移 0006 ----------------
describe('迁移 0006：只建新表，不改旧表、不删任何东西', () => {
  it('有 0006_platform_reports.sql，里面只有 CREATE TABLE / CREATE INDEX（没有 ALTER、DROP、DELETE、UPDATE、INSERT）', () => {
    expect(existsSync(path.join(MIG, M0006)), `migrations/${M0006}`).toBe(true);
    const st = stmtsOf([M0006]);
    expect(st.length).toBeGreaterThan(0);
    for (const s of st) expect(s, s).toMatch(/^CREATE\s+(TABLE|INDEX|UNIQUE\s+INDEX)\s/i);
    expect(st.join('\n')).not.toMatch(/\b(ALTER|DROP|DELETE|UPDATE|INSERT|REPLACE)\b/i);
  });

  it('跑完全部迁移后有 company_report（id, item_key, project, name, value, at）和 at 上的索引', async () => {
    expect(await hasTable(db, 'company_report')).toBe(true);
    const cols = (await db.prepare("SELECT name, \"notnull\" AS nn, pk FROM pragma_table_info('company_report')").all<{ name: string; nn: number; pk: number }>()).results;
    expect(cols.map((c) => c.name).sort()).toEqual(['at', 'id', 'item_key', 'name', 'project', 'value']);
    expect(cols.find((c) => c.name === 'id')!.pk).toBe(1);
    for (const c of ['item_key', 'project', 'name', 'value', 'at']) expect(cols.find((x) => x.name === c)!.nn, c + ' NOT NULL').toBe(1);
    const idx = (await db.prepare("SELECT il.name AS idx, ii.name AS col FROM pragma_index_list('company_report') il JOIN pragma_index_info(il.name) ii").all<{ idx: string; col: string }>()).results;
    expect(idx.some((x) => x.col === 'at')).toBe(true);
  });

  it('在"已有 0001～0005 数据"的库上跑 0006：旧表结构和数据一行不变', async () => {
    const p = await getPlatformProxy<{ DB: D1Database }>({ configPath: path.join(ROOT, 'test/wrangler.test.toml'), persist: false, remoteBindings: false, envFiles: [] });
    try {
      const d = p.env.DB;
      const before = migs().filter((f) => f < '0006');
      expect(before).toEqual(['0001_init.sql', '0002_queue.sql', '0003_workers_ai.sql', '0004_v03.sql', '0005_company.sql']);
      await d.batch(stmtsOf(before).map((s) => d.prepare(s)));
      await d.batch([
        d.prepare("INSERT INTO queue (at, updated_at, product, platform, post_id, author, draft, status) VALUES (1, 1, 'forecast', 'x', '1', '@a', '草稿', 'pending')"),
        d.prepare("INSERT INTO events (at, day, product, platform, post_id, action) VALUES (1, '2026-11-01', 'forecast', 'x', '1', 'approve')"),
        d.prepare("INSERT INTO company_done (item_key, done_at) VALUES ('todo:forecast:T3', 5)"),
        d.prepare("INSERT INTO company_snapshot (source, kind, key, payload, status, source_at, updated_at) VALUES ('agents', 'todo', 'forecast', '{}', 'ok', 1, 1)"),
        d.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('cap:x', '5', 1)"),
      ]);
      const schema = async () => (await d.prepare("SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'company_report' AND tbl_name != 'company_report' ORDER BY name").all<{ name: string; sql: string }>()).results;
      const dump = async () => Promise.all(['queue', 'events', 'company_done', 'company_snapshot', 'settings'].map(async (t) => (await d.prepare(`SELECT * FROM ${t}`).all()).results));
      const [s0, d0] = [await schema(), await dump()];
      expect(existsSync(path.join(MIG, M0006)), `migrations/${M0006}`).toBe(true);
      await d.batch(stmtsOf([M0006]).map((s) => d.prepare(s)));
      expect(await schema()).toEqual(s0);
      expect(await dump()).toEqual(d0);
      expect(await hasTable(d, 'company_report')).toBe(true);
    } finally { await p.dispose(); }
  });
});

// ---------------- 推送的新字段、周包 ----------------
const PACK = {
  project: 'forecast', date: '2026-11-02', link: 'https://github.com/dollar3651314/agents/blob/main/x.md', due: T0 + 3 * H,
  steps: [{ n: 1, text: '先发置顶帖' }, { n: 2, text: '名单页导入焦点战' }],
  posts: [{ n: 1, title: '欧冠第 4 轮', at: T0 + 3 * H, at_text: '11/3（二）21:00', deadline: '11/4 01:45 开赛前' }],
  matches: [{ league: '歐冠', home: '巴塞隆納', away: '阿斯頓維拉', time: '2026-11-04 04:00', note: '第4輪' }],
};
describe('推送：待办 due、PR 的 tag / opened_at、周包 pack', () => {
  it('todo 的 item 收下 due（毫秒）；prs 的 item 收下 tag（decide / look）、opened_at；不认识的值丢掉', async () => {
    const r = await ingest({ source: 'agents', blocks: [
      { kind: 'todo', key: 'forecast', payload: { product: 'forecast', items: [{ id: 'T4', type: 'action', text: '发置顶帖', due: T0 - 50 * H, hack: 1 }, { id: 'T3', type: 'action', text: '简介加链接', due: 'tomorrow' }] } },
      { kind: 'prs', key: '', payload: { items: [{ number: 89, title: '【只看】更正', url: 'https://github.com/o/r/pull/89', days: 0, tag: 'look', opened_at: T0 - 47 * H }, { number: 9, title: '【要你决定】x', url: 'https://github.com/o/r/pull/9', days: 1, tag: 'other' }] } },
    ] });
    expect(r.status).toBe(200);
    const blocks = (await read(await cookie())).blocks;
    const todo = blocks.find((b) => b.kind === 'todo')!.payload as { items: Record<string, unknown>[] };
    expect(todo.items[0]).toEqual({ id: 'T4', type: 'action', text: '发置顶帖', due: T0 - 50 * H });
    expect(todo.items[1]).toEqual({ id: 'T3', type: 'action', text: '简介加链接' });
    const prs = blocks.find((b) => b.kind === 'prs')!.payload as { items: Record<string, unknown>[] };
    expect(prs.items[0]).toMatchObject({ number: 89, tag: 'look', opened_at: T0 - 47 * H });
    expect(prs.items[1].tag).toBeUndefined();
  });

  it('老的上报脚本不带新字段：照常收（兼容）', async () => {
    const r = await ingest({ source: 'agents', blocks: [{ kind: 'todo', key: 'forecast', payload: { product: 'forecast', items: [{ id: 'T2', type: 'action', text: '走一遍报名' }] } }] });
    expect(r.status).toBe(200);
  });

  it('kind = pack（周包，key = 项目）：agents 能推、字段收下；new-forecast、marketing 不能推（400）', async () => {
    const r = await ingest({ source: 'agents', blocks: [{ kind: 'pack', key: 'forecast', payload: { ...PACK, secret: 'x' } }] });
    expect(r.status).toBe(200);
    const pk = (await read(await cookie())).blocks.find((b) => b.kind === 'pack' && b.key === 'forecast');
    expect(pk?.payload).toEqual(PACK);
    for (const source of ['new-forecast', 'marketing']) expect((await ingest({ source, blocks: [{ kind: 'pack', key: 'forecast', payload: PACK }] }, T0 + 60_000)).status).toBe(400);
  });

  it('交接记录 key 用"项目/岗位"：收下；同一岗位两个项目各一块；没有斜杠的旧 key 也照收', async () => {
    const hand = (key: string, role: string) => ({ kind: 'handoff', key, payload: { role, date: '2026-11-01', done: key } });
    expect((await ingest({ source: 'agents', blocks: [hand('forecast/市场', '市场'), hand('工作平台/市场', '市场'), hand('研发', '研发')] })).status).toBe(200);
    const keys = (await read(await cookie())).blocks.filter((b) => b.kind === 'handoff').map((b) => b.key).sort();
    expect(keys).toEqual(['forecast/市场', '工作平台/市场', '研发']);
  });
});

// ---------------- 打勾跨设备：seen ----------------
describe('打勾带 seen（另一处改过就 409）', () => {
  it('不带 seen：照旧（老页面兼容）；老 key todo:… 的勾保留', async () => {
    const ck = await cookie();
    await db.prepare('INSERT INTO company_done (item_key, done_at) VALUES (?1, ?2)').bind('todo:forecast:T3', T0 - H).run();
    expect((await post('/api/company/done', { key: 'pr:agents:89', done: true }, ck, T0)).status).toBe(200);
    expect((await read(ck)).done.map((x) => x.key).sort()).toEqual(['pr:agents:89', 'todo:forecast:T3']);
  });

  it('要改的状态和库里一样：直接成功（两台设备都点了"做完"）', async () => {
    const ck = await cookie();
    expect((await post('/api/company/done', { key: 'todo:forecast:T3', done: true, seen: null }, ck, T0)).status).toBe(200);
    // 另一台设备也是从"没勾"点"做完"：库里已经是做完，直接成功，不报冲突
    const r = await post('/api/company/done', { key: 'todo:forecast:T3', done: true, seen: null }, ck, T0 + 1000);
    expect(r.status).toBe(200);
  });

  it('seen 对不上、要改的状态又和库里不一样：409，带回库里现在的状态，库不变', async () => {
    const ck = await cookie();
    // 设备 B 看到 T3 在 t1 做完；设备 A 先撤销、再在 t2 重新打勾；B 拿着旧的 t1 去撤销
    expect((await post('/api/company/done', { key: 'todo:forecast:T3', done: true, seen: null }, ck, T0)).status).toBe(200);
    expect((await post('/api/company/done', { key: 'todo:forecast:T3', done: false, seen: T0 }, ck, T0 + 1000)).status).toBe(200);
    expect((await post('/api/company/done', { key: 'todo:forecast:T3', done: true, seen: null }, ck, T0 + 2000)).status).toBe(200);
    const r = await post('/api/company/done', { key: 'todo:forecast:T3', done: false, seen: T0 }, ck, T0 + 3000);
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ key: 'todo:forecast:T3', done: true, at: T0 + 2000 });
    expect((await read(ck)).done).toEqual([{ key: 'todo:forecast:T3', at: T0 + 2000 }]);
    // 反过来：B 看到没勾（seen null），A 打勾后又撤销……库里没勾；B 以为在 t 做完了去撤销 → 和库里一样，直接成功
    expect((await post('/api/company/done', { key: 'todo:forecast:T2', done: false, seen: T0 }, ck, T0 + 4000)).status).toBe(200);
    // B 看到 T2 在 t 做完（seen = t），实际已被撤销；B 再点"做完"→ 库里没勾、seen 对不上 → 409
    const r2 = await post('/api/company/done', { key: 'todo:forecast:T2', done: true, seen: T0 }, ck, T0 + 5000);
    expect(r2.status).toBe(409);
    expect(await r2.json()).toMatchObject({ key: 'todo:forecast:T2', done: false, at: null });
  });

  it('seen 对得上：正常改', async () => {
    const ck = await cookie();
    await post('/api/company/done', { key: 'step:forecast:2026-11-02:1', done: true, seen: null }, ck, T0);
    expect((await post('/api/company/done', { key: 'step:forecast:2026-11-02:1', done: false, seen: T0 }, ck, T0 + 1000)).status).toBe(200);
    expect((await read(ck)).done).toEqual([]);
  });

  it('seen 类型不对 400（只能是毫秒整数或 null）', async () => {
    const ck = await cookie();
    for (const seen of ['昨天', -1, 1.5, {}]) expect((await post('/api/company/done', { key: 'todo:forecast:T3', done: true, seen }, ck)).status).toBe(400);
  });
});

// ---------------- 填数字 ----------------
const REP = { key: 'todo:forecast:R1', project: 'forecast' };
describe('填数字 POST /api/company/report（只存 D1）', () => {
  it('全角数字、前后空格规范化；写 company_report + 给这件待办打勾，读回来有最新值', async () => {
    const ck = await cookie();
    const r = await post('/api/company/report', { ...REP, values: { 'X 关注': '１２', 'Threads 关注': ' 5 ', '名单人数': '0' } }, ck, T0);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, key: REP.key, at: T0 });
    const rows = (await db.prepare('SELECT item_key, project, name, value, at FROM company_report ORDER BY name').all<Report>()).results;
    expect(rows).toEqual([
      { item_key: REP.key, project: 'forecast', name: 'Threads 关注', value: '5', at: T0 },
      { item_key: REP.key, project: 'forecast', name: 'X 关注', value: '12', at: T0 },
      { item_key: REP.key, project: 'forecast', name: '名单人数', value: '0', at: T0 },
    ]);
    const c = await read(ck, T0 + 1000);
    expect(c.done).toEqual([{ key: REP.key, at: T0 }]);
    expect((c.reports ?? []).map((x) => [x.name, x.value]).sort()).toEqual([['Threads 关注', '5'], ['X 关注', '12'], ['名单人数', '0']]);
    // 再填一次：读回来是最新的值，每个名称一条
    expect((await post('/api/company/report', { ...REP, values: { 'X 关注': '13', 'Threads 关注': '6', '名单人数': '2' } }, ck, T0 + 2000)).status).toBe(200);
    const c2 = await read(ck, T0 + 3000);
    expect((c2.reports ?? []).filter((x) => x.name === 'X 关注')).toEqual([{ item_key: REP.key, project: 'forecast', name: 'X 关注', value: '13', at: T0 + 2000 }]);
  });

  it('错的格一次全报（C108）：一行都不写、不打勾', async () => {
    const ck = await cookie();
    const r = await post('/api/company/report', { ...REP, values: { 'X 关注': 'abc', 'Threads 关注': '-1', '名单人数': '1.5' } }, ck);
    expect(r.status).toBe(400);
    const j = (await r.json()) as { bad: { name: string; why: string }[] };
    expect(j.bad.map((x) => x.name).sort()).toEqual(['Threads 关注', 'X 关注', '名单人数']);
    expect(j.bad.every((x) => typeof x.why === 'string' && x.why.length > 0)).toBe(true);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM company_report').first<{ n: number }>())!.n).toBe(0);
    expect((await read(ck)).done).toEqual([]);
  });

  it('Claude 用量 0～100：101 不收、空的不收，100 收', async () => {
    const ck = await cookie();
    const use = { key: 'todo:公司:U1', project: '公司' };
    expect((await post('/api/company/report', { ...use, values: { 'Claude 用量': '101' } }, ck)).status).toBe(400);
    expect((await post('/api/company/report', { ...use, values: { 'Claude 用量': '  ' } }, ck)).status).toBe(400);
    expect((await post('/api/company/report', { ...use, values: { 'Claude 用量': '１００' } }, ck)).status).toBe(200);
  });

  it('不认识的名称、空的 values、key 不对：400', async () => {
    const ck = await cookie();
    for (const body of [{ ...REP, values: { 密码: '1' } }, { ...REP, values: {} }, { project: 'forecast', values: { 'X 关注': '1' } }, { ...REP, key: 'a'.repeat(201), values: { 'X 关注': '1' } }]) {
      expect((await post('/api/company/report', body, ck)).status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
  });

  // 研发补（批 1 审查 P-7）：project 只能是有项目页的项目（PROJECT_PAGES）或"公司"
  it('project 不在白名单：400，一行都不写', async () => {
    const ck = await cookie();
    for (const project of ['报价', 'forecast2', '', 'x'.repeat(65)]) expect((await post('/api/company/report', { ...REP, project, values: { 'X 关注': '1' } }, ck)).status, project).toBe(400);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM company_report').first<{ n: number }>())!.n).toBe(0);
    expect((await post('/api/company/report', { ...REP, project: '公司', values: { 'X 关注': '1' } }, ck)).status).toBe(200);
  });

  it('没登录 401、跨站 403', async () => {
    const ck = await cookie();
    expect((await handle(page('/api/company/report', { method: 'POST', body: JSON.stringify({ ...REP, values: { 'X 关注': '1' } }) }), env(), T0)).status).toBe(401);
    expect((await post('/api/company/report', { ...REP, values: { 'X 关注': '1' } }, ck, T0, 'https://evil.example')).status).toBe(403);
  });
});
