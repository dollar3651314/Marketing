/**
 * 公司运营仪表盘（src/company.ts）：推送接口的令牌、白名单、大小、限流、覆盖写入、解析失败保留旧内容；
 * 后台读取（会话、超过 7 天、周报切换）；"我做了"写入 / 取消 / 90 天清理；未登录 401、跨站 403；旧路由不受影响。
 * D1 用 Miniflare 的本地 SQLite（和 relay.test.ts 同一种做法）。
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import { ROOT, T0 } from './helpers';

const PASS = 'ci_only_copilot_password_01';
const INGEST = 'ci_only_company_ingest_token_0123456789';
const HOST = 'https://copilot.example.test';
const DAY = 24 * 3600_000;
let db: D1Database;
let dispose: () => Promise<void>;

beforeAll(async () => {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: path.join(ROOT, 'test/wrangler.test.toml'), persist: false, remoteBindings: false, envFiles: [] });
  db = proxy.env.DB;
  dispose = proxy.dispose;
  const sql = readdirSync(path.join(ROOT, 'migrations')).filter((f) => f.endsWith('.sql')).sort()
    .map((f) => readFileSync(path.join(ROOT, 'migrations', f), 'utf8').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')).join(';\n');
  await db.batch(sql.split(';').map((s) => s.trim()).filter(Boolean).map((s) => db.prepare(s)));
});
afterAll(async () => dispose());
beforeEach(async () => {
  await db.batch(['company_snapshot', 'company_done', 'company_rate', 'auth_fail', 'auth_lock'].map((t) => db.prepare(`DELETE FROM ${t}`)));
});

const env = (over: Partial<Env> = {}): Env => ({ DB: db, ENVIRONMENT: 'test', COPILOT_PASSWORD: PASS, COMPANY_INGEST_TOKEN: INGEST, ...over });
const ingest = (body: unknown, now = T0, e = env(), token = INGEST) =>
  handle(new Request(`${HOST}/api/company/ingest`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }), e, now);
const page = (p: string, init: RequestInit & { cookie?: string; origin?: string } = {}) =>
  new Request(`${HOST}${p}`, { ...init, headers: { 'content-type': 'application/json', origin: init.origin ?? HOST, 'cf-connecting-ip': '203.0.113.9', ...(init.cookie ? { cookie: init.cookie } : {}) } });
async function cookie(): Promise<string> {
  const r = await handle(page('/api/login', { method: 'POST', body: JSON.stringify({ password: PASS }) }), env(), T0);
  return r.headers.get('set-cookie')!.split(';')[0];
}
interface Block { source: string; kind: string; key: string; payload: Record<string, unknown> | null; status: string; error: string; source_at: number; updated_at: number; stale: boolean }
interface Company { configured: boolean; blocks: Block[]; weeks: string[]; weekly: Block | null; done: { key: string; at: number }[] }
const read = async (ck: string, q = '', now = T0) => (await (await handle(page('/api/company' + q, { cookie: ck }), env(), now)).json()) as Company;
const STATUS = { product: 'forecast', state: '预热暂停', level: 'warn', metrics: [{ name: '关注', now: '3', target: '50', pct: 6 }], waiting: [{ id: 'W1', text: '确认内测人选' }] };

describe('推送接口 POST /api/company/ingest', () => {
  it('没填令牌（或不到 32 个字符）时 404，健康检查显示 not_configured；填了显示 ok', async () => {
    for (const t of [undefined, '', 'short_token_0123456789']) {
      expect((await ingest({ source: 'agents', blocks: [] }, T0, env({ COMPANY_INGEST_TOKEN: t }))).status).toBe(404);
      expect(await (await handle(new Request(`${HOST}/health`), env({ COMPANY_INGEST_TOKEN: t }), T0)).json()).toMatchObject({ company: 'not_configured' });
    }
    const h = await (await handle(new Request(`${HOST}/health`), env(), T0)).json();
    expect(h).toMatchObject({ company: 'ok' });
    expect(JSON.stringify(h)).not.toContain(INGEST);
    // GET 也是 404（只接受 POST）
    expect((await handle(new Request(`${HOST}/api/company/ingest`, { headers: { authorization: `Bearer ${INGEST}` } }), env(), T0)).status).toBe(404);
  });

  it('令牌不对 401；只依赖这个令牌：后台密码没填时照样能推', async () => {
    expect((await ingest({ source: 'agents', blocks: [{ kind: 'ci', payload: {} }] }, T0, env(), 'wrong_token_wrong_token_wrong_token_x')).status).toBe(401);
    expect((await handle(new Request(`${HOST}/api/company/ingest`, { method: 'POST', body: '{}' }), env(), T0)).status).toBe(401);
    const r = await ingest({ source: 'marketing', blocks: [{ kind: 'ci', payload: { conclusion: 'success' } }] }, T0, env({ COPILOT_PASSWORD: undefined }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, written: 1 });
  });

  it('source、kind 白名单，key、status、时间、payload 不对 400，一次报全部问题、一块都不写', async () => {
    expect((await ingest({ source: 'evil', blocks: [{ kind: 'ci', payload: {} }] })).status).toBe(400);
    expect((await ingest('not json')).status).toBe(400);
    expect((await ingest({ source: 'agents', blocks: [] })).status).toBe(400);
    // new-forecast、Marketing 只能报 prs / ci
    expect((await ingest({ source: 'marketing', blocks: [{ kind: 'status', key: 'x', payload: {} }] })).status).toBe(400);
    const r = await ingest({ source: 'agents', blocks: [
      { kind: 'ci', payload: { conclusion: 'success' } },
      { kind: 'secrets', payload: {} },
      { kind: 'weekly', key: '11/1', payload: {} },
      { kind: 'status', key: 'forecast', status: 'maybe', payload: {} },
      { kind: 'status', key: 'forecast', source_at: T0 + 3 * DAY, payload: {} },
      { kind: 'todo', key: 'forecast', payload: 'x' },
    ] });
    expect(r.status).toBe(400);
    const j = (await r.json()) as { detail: string[] };
    expect(j.detail.map((d) => d.slice(0, 9))).toEqual(['blocks[1]', 'blocks[2]', 'blocks[3]', 'blocks[4]', 'blocks[5]']);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM company_snapshot').first<{ n: number }>())!.n).toBe(0);
  });

  it('超过 256 KB 413', async () => {
    const big = { source: 'agents', blocks: [{ kind: 'handoff', key: '研发', payload: { done: 'x'.repeat(270_000) } }] };
    expect((await ingest(big)).status).toBe(413);
  });

  it('每个来源每分钟最多 6 次，第 7 次 429；别的来源、下一分钟不受影响', async () => {
    const one = (source: string, now = T0) => ingest({ source, blocks: [{ kind: 'ci', payload: { conclusion: 'success' } }] }, now);
    for (let i = 0; i < 6; i++) expect((await one('agents')).status).toBe(200);
    expect((await one('agents')).status).toBe(429);
    expect((await one('new-forecast')).status).toBe(200);
    expect((await one('agents', T0 + 60_000)).status).toBe(200);
  });

  it('同一 (source, kind, key) 覆盖；不认识的字段丢掉，字符串和数组按上限截断，不是 https 的链接丢掉', async () => {
    expect((await ingest({ source: 'agents', blocks: [{ kind: 'status', key: 'forecast', source_at: T0 - 3600_000, payload: { ...STATUS, secret: 'x', week: 'y'.repeat(3000), link: 'javascript:alert(1)', open: Array.from({ length: 150 }, (_, i) => ({ what: 'w' + i, hack: 1 })) } }] })).status).toBe(200);
    expect((await ingest({ source: 'agents', blocks: [{ kind: 'status', key: 'forecast', source_at: T0 - 600_000, payload: { ...STATUS, state: '正常', level: 'ok' } }] }, T0 + 1000)).status).toBe(200);
    const rows = await db.prepare('SELECT * FROM company_snapshot').all<{ payload: string; source_at: number; updated_at: number }>();
    expect(rows.results).toHaveLength(1);
    expect(JSON.parse(rows.results[0].payload)).toMatchObject({ state: '正常', level: 'ok' });
    expect(rows.results[0]).toMatchObject({ source_at: T0 - 600_000, updated_at: T0 + 1000 });
    // 截断和丢字段看第一次写入的那份
    await ingest({ source: 'agents', blocks: [{ kind: 'status', key: 'p2', payload: { ...STATUS, secret: 'x', week: 'y'.repeat(3000), link: 'javascript:alert(1)', open: Array.from({ length: 150 }, (_, i) => ({ what: 'w' + i, hack: 1 })) } }] }, T0 + 2000);
    const p2 = JSON.parse((await db.prepare("SELECT payload FROM company_snapshot WHERE key = 'p2'").first<{ payload: string }>())!.payload);
    expect(p2.secret).toBeUndefined();
    expect(p2.link).toBeUndefined();
    expect(p2.week).toHaveLength(2000);
    expect(p2.open).toHaveLength(100);
    expect(p2.open[0]).toEqual({ what: 'w0' });
  });

  it('解析失败的块：只更新原因，保留上次成功的内容和它的时间；之后成功再清掉原因', async () => {
    await ingest({ source: 'agents', blocks: [{ kind: 'status', key: 'forecast', source_at: T0 - 3600_000, payload: STATUS }] });
    expect((await ingest({ source: 'agents', blocks: [{ kind: 'status', key: 'forecast', status: 'error', error: "状态卡：找不到'## 数字'表", payload: { junk: 1 } }] }, T0 + 5000)).status).toBe(200);
    const ck = await cookie();
    let b = (await read(ck, '', T0 + 6000)).blocks[0];
    expect(b).toMatchObject({ status: 'error', error: "状态卡：找不到'## 数字'表", source_at: T0 - 3600_000, updated_at: T0 + 5000 });
    expect(b.payload).toMatchObject({ state: '预热暂停', metrics: [{ name: '关注' }] });
    // 从来没成功过的块：内容为空，只有原因
    await ingest({ source: 'agents', blocks: [{ kind: 'todo', key: 'forecast', status: 'error', error: '两个标题都没有' }] }, T0 + 7000);
    const todo = (await read(ck, '', T0 + 8000)).blocks.find((x) => x.kind === 'todo')!;
    expect(todo).toMatchObject({ status: 'error', payload: null, error: '两个标题都没有' });
    await ingest({ source: 'agents', blocks: [{ kind: 'status', key: 'forecast', payload: STATUS }] }, T0 + 9000);
    b = (await read(ck, '', T0 + 9000)).blocks.find((x) => x.kind === 'status')!;
    expect(b).toMatchObject({ status: 'ok', error: '', source_at: T0 + 9000 });
  });
});

describe('后台读取 GET /api/company 和"我做了"', () => {
  it('没登录 401；后台密码没填时 404', async () => {
    expect((await handle(page('/api/company'), env(), T0)).status).toBe(401);
    expect((await handle(page('/api/company'), env({ COPILOT_PASSWORD: undefined }), T0)).status).toBe(404);
  });

  it('返回所有块、超过 7 天标 stale（正好 7 天不算）；周报默认最新一期，?week= 取某一期；没开通时 configured = false', async () => {
    await ingest({ source: 'agents', blocks: [
      { kind: 'status', key: 'forecast', source_at: T0 - 7 * DAY, payload: STATUS },
      { kind: 'handoff', key: '研发', source_at: T0 - 7 * DAY - 1, payload: { role: '研发', done: '仪表盘' } },
      { kind: 'weekly', key: '2026-10-24', source_at: T0 - 5 * DAY, payload: { title: '第 0 期' } },
      { kind: 'weekly', key: '2026-10-31', source_at: T0 - DAY, payload: { title: '第 1 期', next: [{ what: '经营会', who: '全体', when: '11/7', status: '未开始' }] } },
    ] });
    await ingest({ source: 'new-forecast', blocks: [{ kind: 'ci', payload: { conclusion: 'failure', sha: 'f534f23abc' } }] });
    const ck = await cookie();
    const j = await read(ck);
    expect(j.configured).toBe(true);
    expect(j.blocks.map((b) => `${b.source}/${b.kind}/${b.key}:${b.stale}`).sort()).toEqual(['agents/handoff/研发:true', 'agents/status/forecast:false', 'new-forecast/ci/:false']);
    expect(j.weeks).toEqual(['2026-10-31', '2026-10-24']);
    expect(j.weekly).toMatchObject({ key: '2026-10-31', payload: { title: '第 1 期' } });
    expect((await read(ck, '?week=2026-10-24')).weekly).toMatchObject({ key: '2026-10-24', payload: { title: '第 0 期' } });
    expect((await read(ck, '?week=bad')).weekly).toMatchObject({ key: '2026-10-31' });
    const off = (await (await handle(page('/api/company', { cookie: ck }), env({ COMPANY_INGEST_TOKEN: undefined }), T0)).json()) as Company;
    expect(off.configured).toBe(false);
  });

  it('"我做了"：写入、取消；90 天前的顺手删掉；跨站 403、没登录 401、请求不对 400', async () => {
    const ck = await cookie();
    const done = (body: unknown, now = T0, init: { origin?: string; cookie?: string } = { cookie: ck }) =>
      handle(page('/api/company/done', { method: 'POST', body: JSON.stringify(body), ...init }), env(), now);
    // 一条 91 天前的旧记录
    await db.prepare('INSERT INTO company_done (item_key, done_at) VALUES (?1, ?2)').bind('todo:forecast:T0', T0 - 91 * DAY).run();
    const r = await done({ key: 'todo:forecast:T3', done: true }, T0 + 1234);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, key: 'todo:forecast:T3', at: T0 + 1234 });
    expect((await db.prepare('SELECT item_key FROM company_done').all<{ item_key: string }>()).results.map((x) => x.item_key)).toEqual(['todo:forecast:T3']);
    expect((await read(ck)).done).toEqual([{ key: 'todo:forecast:T3', at: T0 + 1234 }]);
    expect((await done({ key: 'todo:forecast:T3', done: false })).status).toBe(200);
    expect((await read(ck)).done).toEqual([]);
    // 跨站 403、没登录 401、请求不对 400
    expect((await done({ key: 'a', done: true }, T0, { origin: 'https://evil.example', cookie: ck })).status).toBe(403);
    expect((await done({ key: 'a', done: true }, T0, {})).status).toBe(401);
    for (const bad of [{ key: '', done: true }, { key: 'a'.repeat(201), done: true }, { key: 'a', done: 'yes' }, { done: true }]) expect((await done(bad)).status).toBe(400);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM company_done').first<{ n: number }>())!.n).toBe(0);
  });

  it('后台页面有第四页"公司"，旧三页还在；页面脚本里没有模板字符串残留', async () => {
    const html = await (await handle(page('/'), env(), T0)).text();
    for (const s of ['id="v-list"', 'id="v-usage"', 'id="v-ext"', 'id="v-company"', 'id="conav"', '>公司</button>']) expect(html).toContain(s);
    expect(html).not.toContain('${');
    // 页面上不出现技术词（C128）：公司页的固定文字里没有 JSON、payload、token
    const co = html.slice(html.indexOf('<section id="v-company"'), html.indexOf('</main>'));
    expect(co).not.toMatch(/JSON|payload|token|source/i);
  });
});
