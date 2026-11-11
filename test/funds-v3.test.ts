/**
 * 基金观察第三版小改（Amos 2026-11-11 已定）：接口这一侧守住"刷新后收益率提示按每只 yield.stale / yield.approx 分三种说"所依据的数据口径。
 * **测试会话先写（agents C154）**，研发不改断言（底线 6）。页面那一侧的检查在 scripts/e2e-funds.mjs 的 X 段。
 * 场景：第一次刷新时 iShares 页面网络失败（回 500），美国国债曲线取得到 → 服务端给 AGG / TLT / LQD 写近似值：
 *   GET /api/funds 里这三只 approx = true、stale = false、value > 0；但最后一批回包的 yields.failed 里照样有它们。
 *   所以页面不能把 yields.failed 里"有值的"一律说成"过期 / 显示的是上次的值"，要看每只的 yield.stale / yield.approx。
 * 做法同 test/funds-v2-api.test.ts：本地 D1 + 替身 fetch（test/funds-yield-fake.ts），不连网。
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import { yieldResponse } from './funds-yield-fake';
import { ROOT } from './helpers';

const PASS = 'ci_only_copilot_password_01';
const HOST = 'https://copilot.example.test';
const MIG = path.join(ROOT, 'migrations');
const NOW = Date.UTC(2026, 10, 11, 10, 0, 0);
const ISHARES = ['AGG', 'TLT', 'LQD'];

const stmtsOf = (files: string[]) =>
  files.map((f) => readFileSync(path.join(MIG, f), 'utf8').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n'))
    .join(';\n').split(';').map((s) => s.trim()).filter(Boolean);

/** 价格：每只一段确定的合成走势（Yahoo / 东方财富两种形状） */
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
const down = new Set<string>(['ishares.com']);
const realFetch = globalThis.fetch;
const urlOf = (input: unknown) => (typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url);
const jsonRes = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const fake = vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
  const url = urlOf(input);
  const u = new URL(url);
  if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') return realFetch(input as RequestInfo, init);
  const yr = yieldResponse(url, init ?? (input instanceof Request ? { method: input.method } : undefined), down);
  if (yr) return yr;
  const y = /finance\.yahoo\.com\/v[78]\/finance\/chart\/([^/?]+)/.exec(url);
  if (y) {
    const sym = decodeURIComponent(y[1]);
    const ser = synth(sym.replace(/\.(SI|SS)$/, ''));
    const adj = ser.map(([, a]) => a);
    return jsonRes({ chart: { result: [{ meta: { currency: sym.endsWith('.SI') ? 'SGD' : sym.endsWith('.SS') ? 'CNY' : 'USD', symbol: sym, gmtoffset: 28800 }, timestamp: ser.map(([d]) => Date.parse(d + 'T01:00:00Z') / 1000), indicators: { quote: [{ close: adj.slice() }], adjclose: [{ adjclose: adj }] } }], error: null } });
  }
  const e = /eastmoney\.com/.test(u.hostname) && /lsjz/i.test(url) ? u.searchParams.get('fundCode') : null;
  if (e) {
    const rows = [...synth(e)].reverse().map(([d, a]) => ({ FSRQ: d, DWJZ: a.toFixed(4), LJJZ: a.toFixed(6) }));
    const pi = Number(u.searchParams.get('pageIndex') ?? 1), ps = Number(u.searchParams.get('pageSize') ?? 20);
    return jsonRes({ Data: { LSJZList: rows.slice((pi - 1) * ps, pi * ps) }, ErrCode: 0, TotalCount: rows.length });
  }
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

describe('第三版：第一次刷新时 iShares 页面没取到、服务端给了近似值', () => {
  it('GET 里 AGG / TLT / LQD 是 approx = true、stale = false、value > 0；最后一批的 yields.failed 里照样有它们（页面要按每只的状态说，不能说成"过期"）', async () => {
    let cursor: number | undefined;
    let last: any = null;
    for (let i = 0; i < 30; i++) {
      const r = await handle(req('/api/funds/refresh', { method: 'POST', cookie: ck, body: JSON.stringify(cursor === undefined ? {} : { cursor }) }), env(), NOW, fake as never);
      expect(r.status).toBe(200);
      last = await r.json();
      if (last.next == null) break;
      cursor = last.next;
    }
    expect(last?.next).toBeNull();
    const failed: string[] = (last?.yields?.failed ?? []).map((x: { code: string }) => x.code);
    const g = await handle(req('/api/funds', { cookie: ck }), env(), NOW, fake as never);
    const items = Object.fromEntries(((await g.json()) as { items: any[] }).items.map((x) => [x.code, x]));
    const bad = ISHARES.filter((c) => {
      const y = items[c]?.yield;
      return !(y && typeof y.value === 'number' && y.value > 0 && y.approx === true && y.stale === false);
    }).map((c) => `${c}：${JSON.stringify(items[c]?.yield)}`);
    expect(bad).toEqual([]);
    expect(ISHARES.filter((c) => !failed.includes(c)), `yields.failed = ${JSON.stringify(last?.yields?.failed)}`).toEqual([]);
  });
});
