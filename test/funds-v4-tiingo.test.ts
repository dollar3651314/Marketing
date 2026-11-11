/**
 * 基金观察第四版 A / B：美国 15 只价格改 Tiingo（Amos 2026-11-11「都按建议」）。**测试会话先写（agents C154）**，研发不改断言（底线 6）。
 * 规格：
 *   A1. 配置了环境变量 TIINGO_API_TOKEN 时，美国 15 只（VOO、IVV、SPY、VTI、QQQ、AGG、BND、TLT、BSV、LQD、VIG、SCHD、VYM、DGRO、SDY）
 *       不向 query1.finance.yahoo.com 发请求、向 api.tiingo.com/tiingo/daily/<代码>/prices 各发 1 个；adjClose 作复权价（series / 收益），close 作最新价（last）；
 *       快照 source = 'tiingo'、price_kind = 'price'。
 *   A2. token 不出现在任何返回给页面的 JSON（refresh 回包、GET /api/funds、估值接口）、错误文字里（检查 token 任意 ≥ 6 个字符的片段）。
 *   A3. 新加坡 14 只（尤其 CFA、SRT——Tiingo 上同名的是美国代码）绝不向 Tiingo 发请求；中国 14 只也不发。
 *   A4. 没配置 token：一个 Tiingo 请求都不发，美国 15 只照旧走 Yahoo、取到值（不显示 0）。
 *       Tiingo 失败（5xx、404、回空数组、401）：那几只退回 Yahoo、取到值、不进 failed（不显示 0）。
 *   A5. 单次 refresh 对外请求 ≤ 45、约 25 秒截止照旧（Tiingo 一直不回时，假时钟下每次 ≤ 25 秒；45 只每只恰好处理一次；美国 15 只最后都退回 Yahoo 取到）。
 *   B.  GET /health 多一个字段 tiingo，值只能是 "ok"（配置了）或 "not_configured"（没配置 / 空串），不含 token 的任何部分。
 * 做法：本地 D1（Miniflare 真 SQLite，test/wrangler.test.toml）+ 替身 fetch（test/funds-v4-fake.ts；Tiingo 按官方文档格式构造，没连过 Tiingo）。
 * A5 用 vitest 假时钟 + 只记语句的替身 D1（同 test/funds-timeout.test.ts）。
 * 环境变量名照规格：TIINGO_API_TOKEN（研发在 src/env.ts 加；项目索引"5. 环境变量"那一节由研发补）。
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/env';
import { FUNDS } from '../src/funds';
import { refreshBatch, type FetchLike, type RefreshResult } from '../src/funds-api';
import { handle } from '../src/index';
import {
  fakeResponse, isTiingo, isYahoo, leakOf, SG14, synth, tiingoClose, tiingoSym, urlOf, US15, YAHOO_US_MULT, yahooSym, type TiingoMode,
} from './funds-v4-fake';
import { ROOT } from './helpers';

const PASS = 'ci_only_copilot_password_01';
const HOST = 'https://copilot.example.test';
const MIG = path.join(ROOT, 'migrations');
const NOW = Date.UTC(2026, 10, 11, 10, 0, 0);
const END = '2026-11-10';
const LIMIT = 45;
/** 替身 token（不是真的；故意长、少见，便于查泄露） */
const TOKEN = 'tgCI7Q2xV9mK4pR8sL1nB6wZ3jH5';
const CN14 = FUNDS.filter((f) => f.market === '中国').map((f) => f.code);

type XEnv = Env & { TIINGO_API_TOKEN?: string };

const stmtsOf = (files: string[]) =>
  files.map((f) => readFileSync(path.join(MIG, f), 'utf8').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n'))
    .join(';\n').split(';').map((s) => s.trim()).filter(Boolean);

let outbound: string[] = [];
let tiingoMode: (sym: string) => TiingoMode = () => 'ok';
const realFetch = globalThis.fetch;
const fake = vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
  const url = urlOf(input);
  const h = new URL(url).hostname;
  if (h === '127.0.0.1' || h === 'localhost') return realFetch(input as RequestInfo, init);
  outbound.push(url);
  return fakeResponse(input, init, { end: END, token: TOKEN, tiingo: (s) => tiingoMode(s) });
});

let db: D1Database;
let dispose: () => Promise<void>;
let ck = '';
// 研发第四版交付时改（不动断言）：原来 `token = TOKEN` 的默认值让 env(undefined) 也变成「配了 token」（JS 默认参数遇到 undefined 就用默认值），
// 「没配置」的两处测的其实是配置了的情况；所有「配置了」的调用都显式传了 TOKEN，去掉默认值后语义和文件头写的一致
const env = (token?: string): XEnv => ({ DB: db, ENVIRONMENT: 'test', COPILOT_PASSWORD: PASS, ...(token === undefined ? {} : { TIINGO_API_TOKEN: token }) });
const req = (p: string, init: RequestInit & { cookie?: string } = {}) =>
  new Request(`${HOST}${p}`, { ...init, headers: { 'content-type': 'application/json', origin: HOST, 'cf-connecting-ip': '203.0.113.9', ...(init.cookie ? { cookie: init.cookie } : {}) } });

/** 所有交给页面的回包原文（查 token 泄露） */
const shown: string[] = [];
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
async function getItems(token?: string): Promise<Record<string, Item>> {
  const r = await handle(req('/api/funds', { cookie: ck }), env(token), NOW, fake as never);
  const t = await r.text();
  shown.push(t);
  expect(r.status).toBe(200);
  return Object.fromEntries((JSON.parse(t) as { items: Item[] }).items.map((x) => [x.code, x]));
}
/** 一次完整刷新：/api/funds/refresh 一路调到 next 为 null；有估值刷新接口（不是 404）就接着调它（见 test/funds-v4-valuation.test.ts 的约定） */
async function refreshAll(token?: string) {
  const rounds: { urls: string[]; status: number; body: any; text: string }[] = [];
  let cursor: number | undefined;
  for (let i = 0; i < 60; i++) {
    outbound = [];
    const r = await handle(req('/api/funds/refresh', { method: 'POST', cookie: ck, body: JSON.stringify(cursor === undefined ? {} : { cursor }) }), env(token), NOW, fake as never);
    const text = await r.text();
    shown.push(text);
    const body = JSON.parse(text);
    rounds.push({ urls: outbound.slice(), status: r.status, body, text });
    if (r.status !== 200 || body.next == null) break;
    cursor = body.next;
  }
  for (let i = 0; i < 10; i++) {
    outbound = [];
    const r = await handle(req('/api/funds/valuation/refresh', { method: 'POST', cookie: ck, body: '{}' }), env(token), NOW, fake as never);
    if (r.status === 404) break;
    const text = await r.text();
    shown.push(text);
    let body: any = {};
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    rounds.push({ urls: outbound.slice(), status: r.status, body, text });
    if (body?.next == null) break;
  }
  return rounds;
}
const codeOfYahoo = (u: string) => yahooSym(u).replace(/\.(SI|SS)$/, '');
const tiingoOf = (urls: string[]) => urls.filter(isTiingo).map(tiingoSym);
const yahooOf = (urls: string[]) => urls.filter((u) => isYahoo(u)).map(codeOfYahoo);
const count = (xs: string[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>());

describe('A1 / A3：配置了 token，Tiingo 都正常', () => {
  let rounds: Awaited<ReturnType<typeof refreshAll>> = [];
  let items: Record<string, Item> = {};
  it('完整刷新：每次 ≤ 45 个对外请求、45 只都更新、没有失败', async () => {
    tiingoMode = () => 'ok';
    rounds = await refreshAll(TOKEN);
    expect(rounds.filter((r) => r.status !== 200).map((r) => [r.status, r.text.slice(0, 200)])).toEqual([]);
    expect(rounds.map((r) => r.urls.length).filter((n) => n > LIMIT)).toEqual([]);
    expect([...new Set(rounds.flatMap((r) => r.body.updated ?? []))].filter((c) => FUNDS.some((f) => f.code === c)).sort()).toEqual(FUNDS.map((f) => f.code).sort());
    expect(rounds.flatMap((r) => (r.body.failed ?? []))).toEqual([]);
  });
  it('A1：美国 15 只不向 Yahoo 发请求；向 api.tiingo.com/tiingo/daily/<代码>/prices 各发正好 1 个', () => {
    const all = rounds.flatMap((r) => r.urls);
    expect(yahooOf(all).filter((c) => US15.includes(c)), '美国 15 只不该再请求 Yahoo').toEqual([]);
    expect(all.filter((u) => /query\d?\.finance\.yahoo\.com/.test(u) && US15.some((c) => codeOfYahoo(u) === c))).toEqual([]);
    const n = count(tiingoOf(all));
    expect(US15.map((c) => [c, n.get(c) ?? 0])).toEqual(US15.map((c) => [c, 1]));
    expect(all.filter(isTiingo).filter((u) => !/^https:\/\/api\.tiingo\.com\/tiingo\/daily\/[A-Za-z]+\/prices(\?|$)/.test(u))).toEqual([]);
  });
  it('A3：新加坡 14 只（尤其 CFA、SRT）和中国 14 只一个 Tiingo 请求都没有；Tiingo 只被请求美国 15 只', () => {
    const t = tiingoOf(rounds.flatMap((r) => r.urls));
    expect(t.filter((c) => SG14.includes(c) || ['CFA', 'SRT'].includes(c))).toEqual([]);
    expect(t.filter((c) => CN14.includes(c))).toEqual([]);
    expect([...new Set(t)].filter((c) => !US15.includes(c))).toEqual([]);
    // 新加坡 14 只照旧走 Yahoo
    const y = new Set(yahooOf(rounds.flatMap((r) => r.urls)));
    expect(SG14.filter((c) => !y.has(c))).toEqual([]);
  });
  it('A1：GET 里美国 15 只 source = tiingo、price_kind = price、last = 最后一天的 close、series 用 adjClose、日期对、有一年的数据', async () => {
    items = await getItems(TOKEN);
    const bad: string[] = [];
    for (const c of US15) {
      const x = items[c];
      const ser = synth(c, END);
      const [d, adj] = ser.at(-1)!;
      if (!x) { bad.push(`${c}：没有`); continue; }
      if (x.source !== 'tiingo') bad.push(`${c} source = ${x.source}`);
      if (x.price_kind !== 'price') bad.push(`${c} price_kind = ${x.price_kind}`);
      if (!(typeof x.last === 'number' && Math.abs(x.last - tiingoClose(adj)) < 1e-3)) bad.push(`${c} last = ${x.last}，应为 close ${tiingoClose(adj)}`);
      const s = x.series as [string, number][];
      if (!(Array.isArray(s) && s.length >= 200 && Math.abs(s.at(-1)![1] - adj) < 1e-3)) bad.push(`${c} series 最后 = ${JSON.stringify(s?.at?.(-1))}，应为 adjClose ${adj}（${s?.length} 点）`);
      if (x.date !== d) bad.push(`${c} date = ${x.date}，应为 ${d}`);
      if (typeof x.y1 !== 'number' || x.y1 === 0) bad.push(`${c} y1 = ${x.y1}`);
      if (x.error) bad.push(`${c} error = ${x.error}`);
    }
    expect(bad).toEqual([]);
    // 收益按 adjClose 算：y1 = 最后 adj / 一年前 adj − 1（不是 close）
    const s = synth('VOO', END);
    const base = [...s].reverse().find(([d]) => d <= new Date(Date.parse(END) - 365 * 86400_000).toISOString().slice(0, 10))!;
    expect(items.VOO.y1).toBeCloseTo((s.at(-1)![1] / base[1] - 1) * 100, 3);
  });
  it('A3：GET 里新加坡 14 只 source 仍是 yahoo', () => {
    expect(SG14.filter((c) => items[c]?.source !== 'yahoo').map((c) => `${c}：${items[c]?.source}`)).toEqual([]);
  });
});

describe('A4：没配置 token / Tiingo 失败时退回 Yahoo', () => {
  it('没配置 TIINGO_API_TOKEN：一个 Tiingo 请求都不发；美国 15 只走 Yahoo、都取到（source = yahoo、last > 0、y1 有值）', async () => {
    tiingoMode = () => 'ok';
    const rounds = await refreshAll(undefined);
    expect(rounds.filter((r) => r.status !== 200).map((r) => r.status)).toEqual([]);
    expect(rounds.map((r) => r.urls.length).filter((n) => n > LIMIT)).toEqual([]);
    const all = rounds.flatMap((r) => r.urls);
    expect(all.filter(isTiingo)).toEqual([]);
    const y = new Set(yahooOf(all));
    expect(US15.filter((c) => !y.has(c))).toEqual([]);
    expect(rounds.flatMap((r) => r.body.failed ?? [])).toEqual([]);
    const items = await getItems(undefined);
    const bad = US15.filter((c) => {
      const x = items[c], last = synth(c, END).at(-1)![1] * YAHOO_US_MULT;
      return !(x && x.source === 'yahoo' && typeof x.last === 'number' && Math.abs(x.last - last) < 1e-2 && typeof x.y1 === 'number' && !x.error);
    }).map((c) => `${c}：source ${items[c]?.source} last ${items[c]?.last} y1 ${items[c]?.y1} error ${items[c]?.error}`);
    expect(bad).toEqual([]);
  });

  it('TIINGO_API_TOKEN 是空串：当没配置（不发 Tiingo 请求）', async () => {
    const rounds = await refreshAll('');
    expect(rounds.flatMap((r) => r.urls).filter(isTiingo)).toEqual([]);
    expect(rounds.flatMap((r) => r.body.failed ?? [])).toEqual([]);
  });

  const MIX: Record<string, TiingoMode> = { VOO: 500, QQQ: 404, SPY: 'empty', TLT: 401 };
  it('Tiingo 部分失败（VOO 回 500、QQQ 回 404、SPY 回空数组、TLT 回 401）：这 4 只退回 Yahoo 取到，不进 failed；其余 11 只仍只走 Tiingo', async () => {
    tiingoMode = (s) => MIX[s] ?? 'ok';
    const rounds = await refreshAll(TOKEN);
    expect(rounds.filter((r) => r.status !== 200).map((r) => r.status)).toEqual([]);
    expect(rounds.map((r) => r.urls.length).filter((n) => n > LIMIT)).toEqual([]);
    expect(rounds.flatMap((r) => r.body.failed ?? [])).toEqual([]);
    const all = rounds.flatMap((r) => r.urls);
    const y = new Set(yahooOf(all));
    expect(Object.keys(MIX).filter((c) => !y.has(c)), '失败的那几只应退回 Yahoo').toEqual([]);
    expect(US15.filter((c) => !MIX[c] && y.has(c)), 'Tiingo 正常的不该再去 Yahoo').toEqual([]);
    expect(tiingoOf(all).filter((c) => !US15.includes(c))).toEqual([]);
    const items = await getItems(TOKEN);
    const bad = US15.map((c) => [c, items[c]] as const).filter(([c, x]) => {
      const fb = !!MIX[c];
      const want = fb ? synth(c, END).at(-1)![1] * YAHOO_US_MULT : tiingoClose(synth(c, END).at(-1)![1]);
      return !(x && x.source === (fb ? 'yahoo' : 'tiingo') && typeof x.last === 'number' && x.last > 0 && Math.abs(x.last - want) < 1e-2 && typeof x.y1 === 'number' && x.y1 !== 0 && !x.error);
    }).map(([c, x]) => `${c}：source ${x?.source} last ${x?.last} y1 ${x?.y1} error ${x?.error}`);
    expect(bad).toEqual([]);
  });

  it('Tiingo 全部回 401（回包里带着收到的 token）：美国 15 只都退回 Yahoo 取到；没有失败', async () => {
    tiingoMode = () => 401;
    const rounds = await refreshAll(TOKEN);
    expect(rounds.flatMap((r) => r.body.failed ?? [])).toEqual([]);
    const y = new Set(yahooOf(rounds.flatMap((r) => r.urls)));
    expect(US15.filter((c) => !y.has(c))).toEqual([]);
    const items = await getItems(TOKEN);
    expect(US15.filter((c) => !(items[c]?.last > 0 && !items[c]?.error))).toEqual([]);
  });

  it('A2：以上所有交给页面的回包（refresh、GET /api/funds、估值接口）都不含 token 的任何片段（≥ 6 个字符）', async () => {
    // 再要一次估值的 GET（有这个接口才算）
    for (const p of ['/api/funds/valuation']) {
      const r = await handle(req(p, { cookie: ck }), env(TOKEN), NOW, fake as never);
      if (r.status !== 404) shown.push(await r.text());
    }
    expect(shown.length).toBeGreaterThan(5);
    const leaks = shown.map((t, i) => [i, leakOf(t, TOKEN)] as const).filter(([, l]) => l);
    expect(leaks).toEqual([]);
    // D1 里存的错误文字（会原样显示给页面）也不含
    const rows = (await db.prepare('SELECT code, err, data FROM fund_snapshot').all<{ code: string; err: string | null; data: string | null }>()).results ?? [];
    expect(rows.filter((r) => leakOf(`${r.err ?? ''}${r.data ?? ''}`, TOKEN)).map((r) => r.code)).toEqual([]);
  });
});

describe('A2 / A5：Tiingo 失败原因不带 token；假时钟下一直不回仍守 25 秒、45 个', () => {
  const rd = { all: async () => ({ results: [] }), first: async () => null };
  const stmt = (sql: string) => ({ sql, ...rd, bind: (..._a: unknown[]) => ({ sql, ...rd }) });
  const fakeEnv = (): XEnv => ({ DB: { prepare: stmt, batch: async (s: unknown[]) => s.map(() => ({ success: true })) } as unknown as D1Database, ENVIRONMENT: 'test', COPILOT_PASSWORD: 'x', TIINGO_API_TOKEN: TOKEN });

  it('A5：Tiingo 一直不回（直到被中止）：每次 refreshBatch ≤ 25 秒、≤ 45 个请求；从 0 一路到 next 为 null，45 只每只恰好处理一次；美国 15 只都退回 Yahoo 取到；失败原因不含 token', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    try {
      const seen: string[] = [];
      const updated: string[] = [];
      const reasons: string[] = [];
      let cursor: number | null = 0;
      const bad: unknown[] = [];
      for (let round = 0; round < 60 && cursor !== null; round++) {
        const urls: string[] = [];
        const f: FetchLike = (u, init) => { urls.push(u); return fakeResponse(u, init, { end: END, token: TOKEN, tiingo: () => 'hang' }); };
        const t0 = Date.now();
        let out: RefreshResult | undefined, err: unknown;
        const p = refreshBatch(fakeEnv(), cursor, NOW, f).then((r) => (out = r), (e) => (err = e));
        for (let i = 0; i < 20_000 && out === undefined && err === undefined; i++) await vi.advanceTimersByTimeAsync(10);
        await p;
        if (err) throw err;
        expect(out, '假时钟推进 200 秒还没返回').toBeDefined();
        const ms = Date.now() - t0;
        if (ms > 25_000 + 50 || urls.length > LIMIT) bad.push({ round, cursor, ms, requests: urls.length });
        const codes = [...out!.updated.filter((c) => FUNDS.some((x) => x.code === c)), ...out!.failed.map((x) => x.code).filter((c) => FUNDS.some((x) => x.code === c))];
        seen.push(...codes);
        updated.push(...out!.updated);
        reasons.push(...out!.failed.map((x) => x.reason), ...(out!.yields?.failed ?? []).map((x) => x.reason));
        cursor = out!.next;
      }
      expect(bad, '每次 ≤ 25 秒、≤ 45 个请求').toEqual([]);
      expect(cursor, '60 次内应走完').toBeNull();
      const dup = [...count(seen)].filter(([, n]) => n > 1);
      expect(dup, '每只只处理一次').toEqual([]);
      expect(FUNDS.map((f) => f.code).filter((c) => !seen.includes(c))).toEqual([]);
      expect(US15.filter((c) => !updated.includes(c)), 'Tiingo 不回时美国 15 只应退回 Yahoo 取到').toEqual([]);
      expect(reasons.filter((r) => leakOf(r, TOKEN))).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  }, 120_000);
});

describe('B：/health 的 tiingo 字段', () => {
  const health = async (e: XEnv) => {
    const r = await handle(new Request(`${HOST}/health`), e, NOW);
    expect(r.status).toBe(200);
    const t = await r.text();
    return { t, j: JSON.parse(t) as Record<string, unknown> };
  };
  it('配置了 → tiingo = "ok"；没配置 / 空串 → "not_configured"；值只能是这两个；不含 token 的任何片段（≥ 6 个字符）', async () => {
    const a = await health(env(TOKEN));
    expect(a.j.tiingo).toBe('ok');
    expect(leakOf(a.t, TOKEN)).toBeNull();
    expect(leakOf(a.t, TOKEN, 4)).toBeNull();
    const b = await health(env(undefined));
    expect(b.j.tiingo).toBe('not_configured');
    const c = await health(env(''));
    expect(c.j.tiingo).toBe('not_configured');
    for (const x of [a, b, c]) expect(['ok', 'not_configured']).toContain(x.j.tiingo);
    // 其余字段照旧
    expect(a.j).toMatchObject({ status: 'UP' });
  });
});
