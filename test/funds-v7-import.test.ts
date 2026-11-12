/**
 * 基金观察「估值：导入的历史」（2026-11-12，Amos 11/12 都按建议；I2 未定，默认导入数据不进顶部总结句）——接口一侧。
 * **测试会话先写（agents C154）**，研发不改断言（底线 6）；页面一侧在 scripts/e2e-funds.mjs 的 IM 段。
 * 规格（主会话派工单，逐条）：
 *   ① POST /api/funds/valuation/import 要登录（未登录 401）；接收 {asOf, indexes:[{code,name,funds,source,basis,series:{pe,pb,dy}}]}，请求体 ≤ 2MB；
 *      校验：code 必须是基金观察 45 只之一、日期 YYYY-MM、数值有限且 > 0、每个序列 ≤ 600 点；不合格的进 skipped（含原因），合格的按 code 覆盖写入；
 *      回 {imported, replaced, skipped}；同一只再导入覆盖旧的。
 *   ② GET /api/funds 带 val_import。选指标：pe ≥ 36 点且最近一个点在 12 个月内 → 用 pe；否则 dy ≥ 24 点 → 用 dy；否则只有当前值。
 *      百分位用最近 120 个点；dy 的"贵的程度" = 100 − 百分位；不足 120 点标 short（页面写"上市以来"）。
 *   ④ 数据不进仓库：夹具是自造的 test/fixtures/funds/val-import-qa.json（5 只、公式生成）+ 本文件里现造的边界数据。
 *
 * 接口约定（测试会话定，研发照做；要改名在同一个提交里改这里和 e2e IM 段，并写明）：
 *   - 回包 imported / replaced：这次写入 / 覆盖了几只（数字；给代码数组也认，按长度算）；skipped：数组，每项 {code, reason}，reason 是非空中文原因。
 *   - GET /api/funds 顶层 val_import = { items: ImpItem[] }（直接给数组也认）。ImpItem：
 *       code、name、funds、source、basis（照导入的原样）、market（按 45 只清单：新加坡 / 美国 / 中国）、
 *       metric：'pe' | 'dy' | null（null = 只有当前值）、now：当前值（所选序列最后一个点；null 时取有值的序列最后一个点，pe 优先）、now_date：'YYYY-MM'、
 *       n：百分位用了几个点（≤ 120）、pct：百分位（窗口里 ≤ 当前值的点占比 × 100，和现有估值卡同一算法，1 位小数；只有当前值时 null）、
 *       dear：贵的程度（pe 时 = pct，dy 时 = 100 − pct；只有当前值时 null）、short：n < 120。
 * 测试会话的理解（研发有异议走主会话，不私下改）：
 *   - 校验按"只"整只判：一只里任何一个点不合格（日期不是 YYYY-MM、值不是有限正数、某个序列超过 600 点）就整只进 skipped，不是丢掉那个点照写。
 *   - "12 个月内"按服务器现在的时间（UTC+8 的年月）算；本文件只用离边界很远的数据（2026-08 算新、2020-09 和 2025-06 算旧），不测恰好 12 个月。
 *   - 请求体超过 2MB 回 413（回 400 也认），什么都不写；JSON 坏了回 400。
 *   - 导入的数据不混进原来的 valuation（6 个指数的卡片），也不让 45 只的快照变。
 * 做法：本地 D1（Miniflare 真 SQLite，每个 describe 一个新库）+ 替身 fetch（任何对外请求都记下来并失败）。不连网。
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import { FUNDS } from '../src/funds';
import { ROOT } from './helpers';

const PASS = 'ci_only_copilot_password_01';
const HOST = 'https://copilot.example.test';
const MIG = path.join(ROOT, 'migrations');
const NOW = Date.UTC(2026, 10, 12, 3, 0, 0); // 2026-11-12 11:00（UTC+8）
const FX = JSON.parse(readFileSync(path.join(ROOT, 'test/fixtures/funds/val-import-qa.json'), 'utf8')) as Imp;
const MARKET = Object.fromEntries(FUNDS.map((f) => [f.code, f.market]));

type Pt = [string, number];
type Idx = { code: string; name: string; funds: string[]; source: string; basis: string; series: { pe: unknown[]; pb: unknown[]; dy: unknown[] } };
type Imp = { asOf: string; note?: string; indexes: Idx[] };

// ---------------------------------------------------------------- 参考算法（按规格②自己写一遍，不引用 src）
const ym = (t: number) => { const d = new Date(t + 8 * 3600_000); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
const ymOf = (s: string) => Number(s.slice(0, 4)) * 12 + Number(s.slice(5, 7)) - 1;
function expectOf(x: Idx, now = NOW) {
  const pe = x.series.pe as Pt[], dy = x.series.dy as Pt[];
  const peFresh = pe.length >= 36 && ym(now) - ymOf(pe[pe.length - 1][0]) <= 12;
  const metric: 'pe' | 'dy' | null = peFresh ? 'pe' : dy.length >= 24 ? 'dy' : null;
  const s = metric === 'pe' ? pe : metric === 'dy' ? dy : pe.length ? pe : dy;
  const last = s[s.length - 1];
  if (!metric) return { metric, now: last[1], now_date: last[0], pct: null, dear: null, n: null as number | null, short: null as boolean | null };
  const w = s.slice(-120).map((p) => p[1]);
  const pct = Math.round((w.filter((v) => v <= last[1]).length / w.length) * 1000) / 10;
  return { metric, now: last[1], now_date: last[0], pct, dear: metric === 'pe' ? pct : Math.round((100 - pct) * 10) / 10, n: w.length, short: w.length < 120 };
}

// ---------------------------------------------------------------- 现造数据
const months = (end: string, n: number) => { let y = Number(end.slice(0, 4)), m = Number(end.slice(5, 7)); const o: string[] = []; for (let i = 0; i < n; i++) { o.unshift(`${y}-${String(m).padStart(2, '0')}`); if (!--m) { m = 12; y--; } } return o; };
const ser = (end: string, n: number, base: number, span: number, last?: number): Pt[] => months(end, n).map((d, i) => [d, i === n - 1 && last != null ? last : Math.round((base + span * (((i * 37) % n) / n)) * 1000) / 1000]);
const idx = (code: string, series: Partial<Idx['series']>, extra: Partial<Idx> = {}): Idx => ({ code, name: `${code}（QA 现造）`, funds: [code], source: 'QA 现造', basis: 'QA 现造口径', series: { pe: [], pb: [], dy: [], ...series }, ...extra });

// ---------------------------------------------------------------- D1、接口
let db: D1Database;
let dispose: (() => Promise<void>) | null = null;
const ext: string[] = [];
const fake = async (input: unknown) => { const u = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input); ext.push(u); throw new TypeError('测试里不许连外网：' + u); };
const stmtsOf = (files: string[]) =>
  files.map((f) => readFileSync(path.join(MIG, f), 'utf8').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n'))
    .join(';\n').split(';').map((s) => s.trim()).filter(Boolean);
async function freshDb() {
  if (dispose) await dispose();
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: path.join(ROOT, 'test/wrangler.test.toml'), persist: false, remoteBindings: false, envFiles: [] });
  db = proxy.env.DB;
  dispose = proxy.dispose;
  await db.batch(stmtsOf(readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort()).map((s) => db.prepare(s)));
  ext.length = 0;
}
const env = (): Env => ({ DB: db, ENVIRONMENT: 'test', COPILOT_PASSWORD: PASS });
let ck = '';
const req = (p: string, init: RequestInit & { cookie?: string } = {}) =>
  new Request(`${HOST}${p}`, { ...init, headers: { 'content-type': 'application/json', origin: HOST, 'cf-connecting-ip': '203.0.113.9', ...(init.cookie ? { cookie: init.cookie } : {}) } });
async function login() {
  const r = await handle(req('/api/login', { method: 'POST', body: JSON.stringify({ password: PASS }) }), env(), NOW);
  ck = r.headers.get('set-cookie')!.split(';')[0];
}
async function post(body: string, cookie = ck): Promise<{ status: number; j: any }> {
  const r = await handle(req('/api/funds/valuation/import', { method: 'POST', cookie, body }), env(), NOW, fake as never);
  let j: any = null;
  try { j = await r.json(); } catch { j = null; }
  return { status: r.status, j };
}
const imp = (x: Imp) => post(JSON.stringify(x));
async function getFunds(): Promise<any> {
  const r = await handle(req('/api/funds', { cookie: ck }), env(), NOW, fake as never);
  expect(r.status).toBe(200);
  return r.json();
}
async function items(): Promise<Record<string, any>> {
  const j = await getFunds();
  const v = j?.val_import;
  const arr: any[] = Array.isArray(v) ? v : Array.isArray(v?.items) ? v.items : [];
  return Object.fromEntries(arr.map((x) => [x.code, x]));
}
const count = (v: unknown) => (Array.isArray(v) ? v.length : typeof v === 'number' ? v : NaN);
const near = (a: unknown, b: number | null, tol = 0.15) => (b === null ? a === null || a === undefined : typeof a === 'number' && Math.abs(a - b) <= tol);
/** 一只卡和参考算法对不上的字段 */
function diff(x: any, ref: Idx): string[] {
  const e = expectOf(ref);
  const bad: string[] = [];
  if (!x) return ['没有这一只'];
  if (x.name !== ref.name) bad.push(`name=${x.name}`);
  if (JSON.stringify(x.funds) !== JSON.stringify(ref.funds)) bad.push(`funds=${JSON.stringify(x.funds)}`);
  if (x.source !== ref.source) bad.push(`source=${x.source}`);
  if (x.basis !== ref.basis) bad.push(`basis=${x.basis}`);
  if (x.market !== MARKET[ref.code]) bad.push(`market=${x.market}，应为 ${MARKET[ref.code]}`);
  if ((x.metric ?? null) !== e.metric) bad.push(`metric=${x.metric}，应为 ${e.metric}`);
  if (!near(x.now, e.now, 0.001)) bad.push(`now=${x.now}，应为 ${e.now}`);
  if (x.now_date !== e.now_date) bad.push(`now_date=${x.now_date}，应为 ${e.now_date}`);
  if (!near(x.pct, e.pct)) bad.push(`pct=${x.pct}，应为 ${e.pct}`);
  if (!near(x.dear, e.dear)) bad.push(`dear=${x.dear}，应为 ${e.dear}`);
  if (e.metric) {
    if (x.n !== e.n) bad.push(`n=${x.n}，应为 ${e.n}`);
    if (x.short !== e.short) bad.push(`short=${x.short}，应为 ${e.short}`);
  }
  return bad;
}

afterAll(async () => { if (dispose) await dispose(); });

describe('① 登录、大小、格式', () => {
  beforeAll(freshDb);
  it('未登录 POST /api/funds/valuation/import → 401，什么都没写', async () => {
    const r = await post(JSON.stringify(FX), '');
    expect(r.status).toBe(401);
    await login();
    expect(Object.keys(await items())).toEqual([]);
  });
  it('登录后导入夹具 → 200，回 {imported: 5, replaced: 0, skipped: []}', async () => {
    await login();
    const r = await imp(FX);
    expect(r.status, JSON.stringify(r.j)).toBe(200);
    expect(count(r.j?.imported)).toBe(5);
    expect(count(r.j?.replaced)).toBe(0);
    expect(Array.isArray(r.j?.skipped) ? r.j.skipped : null).toEqual([]);
  });
  it('请求体超过 2MB → 413（400 也认），什么都没改', async () => {
    await login();
    const before = await items();
    const big = { ...FX, note: 'x'.repeat(2 * 1024 * 1024 + 10_240), indexes: [idx('VOO', { dy: ser('2026-11', 30, 1, 1) })] };
    const r = await imp(big);
    expect([400, 413]).toContain(r.status);
    const after = await items();
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    expect(after.VOO).toBeUndefined();
  });
  it('请求体 1.9MB 以内照常收（≤ 2MB）', async () => {
    await login();
    const r = await imp({ ...FX, note: 'x'.repeat(1_900_000), indexes: [idx('VOO', { dy: ser('2026-11', 30, 1, 1) })] });
    expect(r.status, JSON.stringify(r.j)?.slice(0, 200)).toBe(200);
    expect(count(r.j?.imported)).toBe(1);
    expect((await items()).VOO).toBeTruthy();
  });
  it('JSON 坏了 → 400', async () => {
    await login();
    const r = await post('{"asOf":"2026-11-12","indexes":[');
    expect(r.status).toBe(400);
  });
  it('全程没有对外请求', () => { expect(ext).toEqual([]); });
});

describe('① 校验：不合格的整只进 skipped（带原因），合格的照写', () => {
  beforeAll(freshDb);
  const good = idx('VTI', { pe: ser('2026-08', 40, 18, 8), dy: ser('2026-11', 30, 1, 1) });
  const bads: [string, Idx][] = [
    ['不在 45 只里', idx('NOPE', { dy: ser('2026-11', 30, 1, 1) })],
    ['指数代码不是基金代码', idx('000300', { pe: ser('2026-11', 40, 10, 5) })],
    ['日期 2026/01', idx('CFA', { dy: [...ser('2025-12', 30, 5, 1), ['2026/01', 5.5]] })],
    ['日期 2026-13', idx('CLR', { dy: [...ser('2025-12', 30, 5, 1), ['2026-13', 5.5]] })],
    ['值为 0', idx('SRT', { dy: ser('2026-11', 30, 5, 1).map((p, i) => (i === 3 ? [p[0], 0] : p)) })],
    ['值为负数', idx('BYJ', { dy: ser('2026-11', 30, 3, 1).map((p, i) => (i === 3 ? [p[0], -1.2] : p)) })],
    ['值是字符串', idx('XWR', { dy: ser('2026-11', 30, 1, 1).map((p, i) => (i === 3 ? [p[0], '1.5'] : p)) })],
    ['值是 null', idx('VOO', { pe: ser('2026-11', 40, 20, 5).map((p, i) => (i === 5 ? [p[0], null] : p)) })],
    ['一个序列 601 点', idx('HST', { dy: ser('2026-07', 601, 0.5, 1) })],
  ];
  let r: { status: number; j: any };
  beforeAll(async () => { await login(); r = await imp({ asOf: '2026-11-12', indexes: [good, ...bads.map((b) => b[1])] }); });
  it('回 200：imported = 1（只有 VTI），replaced = 0', () => {
    expect(r.status, JSON.stringify(r.j)).toBe(200);
    expect(count(r.j?.imported)).toBe(1);
    expect(count(r.j?.replaced)).toBe(0);
  });
  it.each(bads.map(([why, x]) => [why, x.code]))('%s（%s）→ 在 skipped 里，带非空原因', (_why, code) => {
    const sk = (Array.isArray(r.j?.skipped) ? r.j.skipped : []) as any[];
    const hit = sk.find((s) => s?.code === code);
    expect(hit, JSON.stringify(sk)).toBeTruthy();
    expect(typeof hit.reason === 'string' && hit.reason.trim().length > 0, JSON.stringify(hit)).toBe(true);
  });
  it('skipped 正好 9 只', () => { expect((r.j?.skipped ?? []).length).toBe(bads.length); });
  it('GET /api/funds：val_import 只有 VTI，不合格的一只都没写进去', async () => {
    const it2 = await items();
    expect(Object.keys(it2)).toEqual(['VTI']);
    expect(diff(it2.VTI, good)).toEqual([]);
  });
  it('一个序列正好 600 点照收', async () => {
    const x = idx('HST', { dy: ser('2026-07', 600, 0.5, 1) });
    const r2 = await imp({ asOf: '2026-11-12', indexes: [x] });
    expect(r2.status).toBe(200);
    expect(count(r2.j?.imported)).toBe(1);
    expect(diff((await items()).HST, x)).toEqual([]);
  });
});

describe('② GET /api/funds 的 val_import：选指标、百分位、贵的程度、short', () => {
  beforeAll(freshDb);
  const edge: [string, Idx][] = [
    ['pe 正好 36 点、新 → pe', idx('VYM', { pe: ser('2026-10', 36, 15, 6, 17.5), dy: ser('2026-11', 30, 2, 2) })],
    ['pe 35 点 → 退到 dy（正好 24 点）', idx('SDY', { pe: ser('2026-11', 35, 15, 6), dy: ser('2026-11', 24, 2, 1, 2.2) })],
    ['没有 pe、dy 23 点 → 只有当前值', idx('DGRO', { dy: ser('2026-11', 23, 2, 1, 2.31) })],
    ['pe 50 点但最近点 2025-06（超过 12 个月）→ dy', idx('VIG', { pe: ser('2025-06', 50, 20, 5), dy: ser('2026-11', 24, 1.5, 1, 1.4) })],
  ];
  beforeAll(async () => {
    await login();
    const a = await imp(FX);
    expect(a.status).toBe(200);
    const b = await imp({ asOf: '2026-11-12', indexes: edge.map((e) => e[1]) });
    expect(b.status).toBe(200);
  });
  it('夹具 5 只：参考算法核对（QQQ pe 120 点 / ES3 pe 太旧用 dy / 588000 pe 60 点 / SCHD pe 不够 36 用 dy / UPD 只有一个点）', async () => {
    const got = await items();
    const bad = FX.indexes.map((x) => [x.code, diff(got[x.code], x)] as const).filter(([, d]) => d.length);
    expect(bad).toEqual([]);
  });
  it('夹具的预期本身：QQQ=pe·不 short·贵 >70；ES3=dy·short·贵 <30；588000=pe·short·30～70；SCHD=dy；UPD=只有当前值 7.43', async () => {
    const got = await items();
    expect([got.QQQ?.metric, got.QQQ?.n, got.QQQ?.short]).toEqual(['pe', 120, false]);
    expect(got.QQQ?.dear).toBeGreaterThan(70);
    expect([got.ES3?.metric, got.ES3?.short]).toEqual(['dy', true]);
    expect(got.ES3?.dear).toBeLessThan(30);
    expect(near(got.ES3?.dear, 100 - got.ES3?.pct)).toBe(true);
    expect([got['588000']?.metric, got['588000']?.n, got['588000']?.short]).toEqual(['pe', 60, true]);
    expect(got['588000']?.dear).toBeGreaterThanOrEqual(30);
    expect(got['588000']?.dear).toBeLessThanOrEqual(70);
    expect(got.SCHD?.metric).toBe('dy');
    expect([got.UPD?.metric ?? null, got.UPD?.now, got.UPD?.dear ?? null]).toEqual([null, 7.43, null]);
  });
  it.each(edge.map(([why, x]) => [why, x.code]))('%s（%s）', async (_why, code) => {
    const got = await items();
    expect(diff(got[code], edge.find((e) => e[1].code === code)![1])).toEqual([]);
  });
  it('只有当前值的（DGRO、UPD）pct、dear 是 null（页面写"攒够历史前不比贵贱"）', async () => {
    const got = await items();
    for (const c of ['DGRO', 'UPD']) expect([got[c]?.metric ?? null, got[c]?.pct ?? null, got[c]?.dear ?? null]).toEqual([null, null, null]);
  });
  it('导入的不混进原来的 valuation（6 个指数的卡片），也不改 45 只的快照', async () => {
    const j = await getFunds();
    const v = j?.valuation;
    const codes = [...(v?.items ?? []), ...(v?.missing ?? [])].map((x: any) => x.code);
    for (const c of FX.indexes.map((x) => x.code)) expect(codes).not.toContain(c);
    expect(Array.isArray(j?.items) && j.items.length).toBe(45);
    expect(j.items.every((x: any) => x.pe_now === undefined && x.val_import === undefined)).toBe(true);
  });
  it('全程没有对外请求', () => { expect(ext).toEqual([]); });
});

describe('① 同一只再导入：覆盖旧的（不合并），别的只不动', () => {
  beforeAll(freshDb);
  it('第二次导入 QQQ（pe 只有 40 点、数值全换）→ replaced = 1，QQQ 只剩新的，ES3 等仍在', async () => {
    await login();
    expect((await imp(FX)).status).toBe(200);
    const q2 = idx('QQQ', { pe: ser('2026-11', 40, 50, 10, 51.234) }, { name: '纳斯达克100（QA 第二次）', source: 'QA 第二次', basis: 'pe=第二次' });
    const r = await imp({ asOf: '2026-11-12', indexes: [q2] });
    expect(r.status, JSON.stringify(r.j)).toBe(200);
    expect(count(r.j?.imported)).toBe(1);
    expect(count(r.j?.replaced)).toBe(1);
    const got = await items();
    expect(diff(got.QQQ, q2)).toEqual([]);
    expect([got.QQQ?.n, got.QQQ?.short, got.QQQ?.now]).toEqual([40, true, 51.234]);
    expect(Object.keys(got).sort()).toEqual(FX.indexes.map((x) => x.code).sort());
  });
  it('数据库里 QQQ 不留第一次的点（不是合并）', async () => {
    const old = (FX.indexes.find((x) => x.code === 'QQQ')!.series.pe as Pt[])[0];
    const ts = ((await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'").all<{ name: string }>()).results ?? []).map((x) => x.name);
    const hits: string[] = [];
    for (const t of ts) {
      const cols = ((await db.prepare(`PRAGMA table_info("${t}")`).all<{ name: string; type: string }>()).results ?? []).filter((c) => !/blob/i.test(c.type)).map((c) => c.name);
      for (const c of cols) {
        const n = await db.prepare(`SELECT COUNT(*) AS n FROM "${t}" WHERE typeof("${c}") = 'text' AND instr("${c}", ?1) > 0 AND instr("${c}", ?2) > 0`).bind('纳斯达克100（QA）', old[0]).first<{ n: number }>();
        if (Number(n?.n ?? 0) > 0) hits.push(`${t}.${c}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
