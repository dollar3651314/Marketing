/**
 * 基金观察第二版：接口这一侧（GET /api/funds 多 band、债券多 yield；refresh 规则照旧；不加定时触发）。**测试会话先写（agents C154）**，研发不改断言（底线 6）。
 * 规格（Amos 2026-11-10 已定）：
 *   - GET /api/funds 每只多 `band`（[lo95, lo68, mid, hi68, hi95] 百分数或 null）；股票类区间中心 c = 0（债券类中心规格没定死，这里只看形状）；
 *   - 16 只债券多 `yield: {value, kind, label, duration, asOf, stale}`；某来源失败时**保留上次的值且 stale=true，不出现 0**；
 *   - refresh 单次对外请求仍 ≤ 45、25 秒截止规则照旧；**不新增任何定时触发**（wrangler.toml 没有 crons）。
 * 做法同 test/funds-api.test.ts：本地 D1（Miniflare 的真 SQLite）+ 替身 fetch（价格走 Yahoo / 东方财富替身，债券收益率走 test/funds-yield-fake.ts 的实抓夹具），不连网。
 * band 的标准答案在测试里按规格公式从 GET 回来的 series 现算（"过去一年"用全部点或只用最后 365 天，两种都认，误差 0.02 个百分点）。
 * 本文件不断言：债券的 band 中心、第 9 只 auto 是谁、511990 / 511880 的 7 日年化从哪取（替身认不出的地址回 404，那两只的值允许是 null）、O9P（BlackRock 新加坡页实抓回 403，值允许是 null）。
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import { yieldHost, yieldResponse, YIELD_HOSTS } from './funds-yield-fake';
import { ROOT } from './helpers';

const PASS = 'ci_only_copilot_password_01';
const HOST = 'https://copilot.example.test';
const MIG = path.join(ROOT, 'migrations');
const NOW = Date.UTC(2026, 10, 10, 10, 0, 0);
const LIMIT = 45;
const BUDGET_MS = 25_000;

const stmtsOf = (files: string[]) =>
  files.map((f) => readFileSync(path.join(MIG, f), 'utf8').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n'))
    .join(';\n').split(';').map((s) => s.trim()).filter(Boolean);

const BONDS = ['A35', 'MBH', 'SBO', 'O9P', '0P00006FY6', 'AGG', 'BND', 'TLT', 'BSV', 'LQD', '511990', '511880', '511010', '511360', '000171', '217003'];
const AUTO8 = ['AGG', 'TLT', 'LQD', 'BND', 'BSV', 'O9P', '511990', '511880'];
const APPROX8 = ['A35', 'MBH', '0P00006FY6', 'SBO', '511010', '511360', '000171', '217003'];
/** 替身里来源一定取得到的：iShares（AGG、TLT、LQD）、Vanguard（BND、BSV）、近似的 8 只（MAS / 中债 / 美国国债曲线都有夹具） */
const MUST = ['AGG', 'TLT', 'LQD', 'BND', 'BSV', ...APPROX8];

const REF: Record<string, { series: [string, number][] }> = JSON.parse(readFileSync(path.join(ROOT, 'test/fixtures/funds/reference.json'), 'utf8')).funds;
function synth(code: string): [string, number][] {
  let s = [...code].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const out: [string, number][] = [];
  let v = 10 + rnd() * 90;
  for (let t = Date.UTC(2025, 8, 16); t <= Date.UTC(2026, 10, 10); t += 86400_000) {
    const w = new Date(t).getUTCDay();
    if (w === 0 || w === 6) continue;
    v *= 1 + (rnd() - 0.5) * 0.02;
    out.push([new Date(t).toISOString().slice(0, 10), Math.round(v * 1e4) / 1e4]);
  }
  return out;
}
const seriesOf = (code: string): [string, number][] => (REF[code] ? REF[code].series : synth(code));

// ---------------- 替身 fetch ----------------
const down = new Set<string>();
let outbound: string[] = [];
const realFetch = globalThis.fetch;
const urlOf = (input: unknown) => (typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url);
const jsonRes = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
function yahooBody(sym: string) {
  const code = sym.replace(/\.(SI|SS)$/, '');
  let ser = seriesOf(code);
  if (sym === '511880.SS') ser = ser.slice(-1);
  const ts = ser.map(([d]) => Date.parse(d + 'T01:00:00Z') / 1000);
  const adj = ser.map(([, a]) => a);
  const currency = sym.endsWith('.SI') ? 'SGD' : sym.endsWith('.SS') ? 'CNY' : 'USD';
  return { chart: { result: [{ meta: { currency, symbol: sym, gmtoffset: 28800 }, timestamp: ts, indicators: { quote: [{ close: adj.slice() }], adjclose: [{ adjclose: adj }] } }], error: null } };
}
function emBody(code: string, pageIndex: number, pageSize: number) {
  const rows = [...seriesOf(code)].reverse().map(([d, a]) => ({ FSRQ: d, DWJZ: a.toFixed(4), LJJZ: a.toFixed(6) }));
  return { Data: { LSJZList: rows.slice((pageIndex - 1) * pageSize, pageIndex * pageSize) }, ErrCode: 0, TotalCount: rows.length };
}
const fake = vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
  const url = urlOf(input);
  const u = new URL(url);
  if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') return realFetch(input as RequestInfo, init);
  outbound.push(url);
  const yr = yieldResponse(url, init ?? (input instanceof Request ? { method: input.method } : undefined), down);
  if (yr) return yr;
  const y = /finance\.yahoo\.com\/v[78]\/finance\/chart\/([^/?]+)/.exec(url);
  const e = /eastmoney\.com/.test(u.hostname) && /lsjz/i.test(url) ? u.searchParams.get('fundCode') : null;
  if (y) return jsonRes(yahooBody(decodeURIComponent(y[1])));
  if (e) return jsonRes(emBody(e, Number(u.searchParams.get('pageIndex') ?? 1), Number(u.searchParams.get('pageSize') ?? 20)));
  return new Response('not found', { status: 404 });
});

let db: D1Database;
let dispose: () => Promise<void>;
let ck = '';
const env = (): Env => ({ DB: db, ENVIRONMENT: 'test', COPILOT_PASSWORD: PASS });
const req = (p: string, init: RequestInit & { cookie?: string } = {}) =>
  new Request(`${HOST}${p}`, { ...init, headers: { 'content-type': 'application/json', origin: HOST, 'cf-connecting-ip': '203.0.113.9', ...(init.cookie ? { cookie: init.cookie } : {}) } });
beforeAll(async () => {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: path.join(ROOT, 'test/wrangler.test.toml'), persist: false, remoteBindings: false, envFiles: [] });
  db = proxy.env.DB;
  dispose = proxy.dispose;
  await db.batch(stmtsOf(readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort()).map((s) => db.prepare(s)));
  const r = await handle(req('/api/login', { method: 'POST', body: JSON.stringify({ password: PASS }) }), env(), NOW);
  ck = r.headers.get('set-cookie')!.split(';')[0];
  vi.stubGlobal('fetch', fake);
});
afterAll(async () => { vi.unstubAllGlobals(); await dispose(); });

type Item = Record<string, any> & { code: string };
const getItems = async (): Promise<Record<string, Item>> => {
  const r = await handle(req('/api/funds', { cookie: ck }), env(), NOW, fake as never);
  expect(r.status).toBe(200);
  const b = (await r.json()) as { items: Item[] };
  return Object.fromEntries(b.items.map((x) => [x.code, x]));
};
async function refreshAll() {
  const rounds: { sent: number; ms: number; status: number; body: any; yieldSent: number }[] = [];
  let cursor: number | undefined;
  for (let i = 0; i < 30; i++) {
    outbound = [];
    const t0 = Date.now();
    const r = await handle(req('/api/funds/refresh', { method: 'POST', cookie: ck, body: JSON.stringify(cursor === undefined ? {} : { cursor }) }), env(), NOW, fake as never);
    const body = await r.json() as any;
    rounds.push({ sent: outbound.length, ms: Date.now() - t0, status: r.status, body, yieldSent: outbound.filter((u) => yieldHost(u)).length });
    if (r.status !== 200 || body.next == null) break;
    cursor = body.next;
  }
  return rounds;
}

/** 规格公式：series 的 [日期, 复权价] → band（c = 0）；mode 'all' 用全部点，'365' 只用最后一天往前 365 天 */
function expectBand(series: [string, number][], mode: 'all' | '365'): number[] | null {
  let s = series;
  if (mode === '365') { const cut = new Date(Date.parse(s.at(-1)![0]) - 365 * 86_400_000).toISOString().slice(0, 10); s = s.filter((p) => p[0] >= cut); }
  const r = s.slice(1).map((p, i) => Math.log(p[1] / s[i][1]));
  if (r.length < 40) return null;
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const h = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1)) * Math.sqrt(21);
  return [-1.96, -1, 0, 1, 1.96].map((k) => (Math.exp(k * h) - 1) * 100);
}
const near = (got: unknown, want: number[] | null) => Array.isArray(got) && got.length === 5 && !!want && want.every((v, i) => Math.abs(got[i] - v) <= 0.02);
const zeros = (items: Record<string, Item>) => Object.values(items).filter((x) => x.yield && x.yield.value === 0).map((x) => x.code);

// ======================================================================
describe('不新增定时触发', () => {
  it('wrangler.toml（正式 + staging）和 test/wrangler.test.toml 都没有 [triggers] / crons；src/index.ts 不导出 scheduled', () => {
    for (const f of ['wrangler.toml', 'test/wrangler.test.toml']) {
      const t = readFileSync(path.join(ROOT, f), 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
      expect([f, /\[\s*(env\.[\w-]+\.)?triggers\s*\]/.test(t) || /\bcrons\s*=/.test(t)]).toEqual([f, false]);
    }
    const idx = readFileSync(path.join(ROOT, 'src/index.ts'), 'utf8');
    expect(/\bscheduled\s*[(:]/.test(idx) || /export\s+(async\s+)?function\s+scheduled/.test(idx)).toBe(false);
  });
});

describe('基金观察第二版接口', () => {
  let first: Awaited<ReturnType<typeof refreshAll>> = [];
  let before: Record<string, Item> = {};

  it('1. 一路刷到 next 为 null：每次对外请求（价格 + 债券收益率合计）≤ 45、每次 ≤ 25 秒；债券收益率来源确实被请求过', async () => {
    first = await refreshAll();
    expect(first.every((r) => r.status === 200)).toBe(true);
    expect(first.at(-1)!.body.next).toBeNull();
    expect(first.map((r) => r.sent).filter((n) => n > LIMIT)).toEqual([]);
    expect(first.map((r) => r.ms).filter((ms) => ms > BUDGET_MS + 2_000)).toEqual([]);
    const hit = first.reduce((a, r) => a + r.yieldSent, 0);
    expect(hit, `债券收益率来源（${YIELD_HOSTS.join('、')}）一个都没请求`).toBeGreaterThan(0);
  });

  it('2. GET：每只都有 band 字段；股票类（c = 0）和规格公式一致；上市不满两个月的（XWR）是 null；债券类是 5 个从小到大的数或 null', async () => {
    before = await getItems();
    const bad: string[] = [];
    for (const it2 of Object.values(before)) {
      if (!('band' in it2)) { bad.push(`${it2.code} 没有 band`); continue; }
      const b = it2.band;
      if (b !== null && !(Array.isArray(b) && b.length === 5 && b.every((v: unknown) => typeof v === 'number' && isFinite(v as number)) && b.every((v: number, i: number) => i === 0 || v > b[i - 1]))) { bad.push(`${it2.code} band 形状不对：${JSON.stringify(b)}`); continue; }
      if (it2.category === '债券') continue;
      const s = it2.series as [string, number][];
      const wa = expectBand(s, 'all'), w3 = expectBand(s, '365');
      if (wa === null && w3 === null) { if (b !== null) bad.push(`${it2.code} 点不够应为 null：${JSON.stringify(b)}`); continue; }
      if (!near(b, wa) && !near(b, w3)) bad.push(`${it2.code}：${JSON.stringify(b)}，应为 ${JSON.stringify(wa?.map((v) => +v.toFixed(3)))}`);
    }
    expect(bad).toEqual([]);
    expect(before.XWR.band).toBeNull();
    expect(Array.isArray(before.ES3.band)).toBe(true);
  });

  it('3. 16 只债券都有 yield {value, kind, label, duration, asOf, stale}；kind 照规格；股票类没有 yield', async () => {
    const bad: string[] = [];
    for (const code of BONDS) {
      const y = before[code]?.yield;
      if (!y || typeof y !== 'object') { bad.push(`${code} 没有 yield`); continue; }
      for (const k of ['value', 'kind', 'label', 'duration', 'asOf', 'stale']) if (!(k in y)) bad.push(`${code}.yield 缺 ${k}`);
      if (AUTO8.includes(code) && y.kind !== 'auto') bad.push(`${code} kind 应为 auto：${y.kind}`);
      if (APPROX8.includes(code) && y.kind !== 'approx') bad.push(`${code} kind 应为 approx：${y.kind}`);
      if (y.value !== null && !(typeof y.value === 'number' && y.value > 0)) bad.push(`${code} value 应为正数或 null：${y.value}`);
      if (typeof y.stale !== 'boolean') bad.push(`${code} stale 应为布尔：${y.stale}`);
    }
    for (const it2 of Object.values(before)) if (it2.category !== '债券' && it2.yield != null) bad.push(`${it2.code} 不是债券却有 yield`);
    expect(bad).toEqual([]);
  });

  it('4. 来源取得到的（iShares、Vanguard、近似的 8 只）：value > 0、label 有字、asOf 有值、stale = false；AGG 5.20 / 久期 5.73、BND 5.2 / 5.7（实抓夹具）', async () => {
    const bad: string[] = [];
    for (const code of MUST) {
      const y = before[code]?.yield;
      if (!(y && typeof y.value === 'number' && y.value > 0 && typeof y.label === 'string' && y.label.trim() && y.asOf && y.stale === false)) bad.push(`${code}：${JSON.stringify(y)}`);
    }
    expect(bad).toEqual([]);
    expect(before.AGG.yield.value).toBeCloseTo(5.2, 2);
    expect(before.AGG.yield.duration).toBeCloseTo(5.73, 2);
    expect(before.BND.yield.value).toBeCloseTo(5.2, 2);
    expect(before.BND.yield.duration).toBeCloseTo(5.7, 2);
    expect(zeros(before)).toEqual([]);
  });

  it('5. iShares、Vanguard 回 500：AGG / TLT / LQD / BND / BSV 保留上次的 value、asOf，stale = true，不出现 0；近似的那几只不受影响（stale = false）', async () => {
    down.add('ishares.com'); down.add('vanguard.com');
    const rounds = await refreshAll();
    down.clear();
    expect(rounds.map((r) => r.sent).filter((n) => n > LIMIT)).toEqual([]);
    expect(rounds.at(-1)!.body.next).toBeNull();
    const after = await getItems();
    const bad: string[] = [];
    for (const code of ['AGG', 'TLT', 'LQD', 'BND', 'BSV']) {
      const a = after[code]?.yield, b = before[code]?.yield;
      if (!(a && a.value === b.value && a.asOf === b.asOf && a.stale === true)) bad.push(`${code}：之前 ${JSON.stringify(b)}，之后 ${JSON.stringify(a)}`);
    }
    for (const code of APPROX8) if (after[code]?.yield?.stale !== false) bad.push(`${code} 不该变 stale：${JSON.stringify(after[code]?.yield)}`);
    expect(bad).toEqual([]);
    expect(zeros(after)).toEqual([]);
  });

  it('6. 六个来源全都回 500：有过值的都保留、stale = true，没有一只是 0；价格照常更新；再恢复后 stale 回到 false', async () => {
    for (const h of YIELD_HOSTS) down.add(h);
    const rounds = await refreshAll();
    down.clear();
    expect(rounds.at(-1)!.body.next).toBeNull();
    expect(rounds.map((r) => r.sent).filter((n) => n > LIMIT)).toEqual([]);
    const after = await getItems();
    const bad: string[] = [];
    for (const code of MUST) {
      const a = after[code]?.yield, b = before[code]?.yield;
      if (!(a && a.value === b.value && a.stale === true)) bad.push(`${code}：之前 ${JSON.stringify(b)}，之后 ${JSON.stringify(a)}`);
    }
    expect(bad).toEqual([]);
    expect(zeros(after)).toEqual([]);
    expect(after.ES3.error ?? null).toBeNull();

    await refreshAll();
    const again = await getItems();
    expect(MUST.filter((c) => again[c]?.yield?.stale !== false)).toEqual([]);
  });
});
