/**
 * 基金观察 refresh 的超时和分批约定（主会话 2026-11-10 裁决的新约定）。**测试会话先写（agents C154 试行）**，研发不改断言（底线 6）。
 *
 * 约定：单次外部请求超时 8 秒、最多试 2 次；一次 refresh 约 25 秒内返回，15 秒后不再开始新的一只，没处理的留给 next；
 *   一批最多 12 只；每次 refresh 对外请求 ≤ 45（含重试）。
 * 做法：vitest 假时钟（Date.now、setTimeout 都是假的，测试不真等）；替身 fetch 按 AbortSignal 中止；D1 用一个只记语句的替身
 *   （写库在 test/funds-api.test.ts、test/funds-impl.test.ts 用真 SQLite 测过，这里只看时间和请求数）。
 *
 * 守的事：
 *   1. 某只一直不回（在批首）：这次 refresh ≤ 25 秒返回；这只的同一个地址只试 2 次；next = 下一只（没处理的），不跳过任何一只
 *   2. 某只一直不回（在批中）：前面的照常 updated；这只 failed；15 秒后不再开新的一只，next 指向它后面第一只没处理的
 *   3. 所有数据源都一直不回：45 个起点逐个调一次，每次 ≤ 25 秒、≤ 45 个请求、同一地址 ≤ 2 次；updated + failed 正好是 [cursor, next) 这一段
 *   4. 每个请求都慢（7 秒才回）：一路调到 next 为 null，每次 ≤ 25 秒、≤ 45 个请求；45 只每只恰好处理一次；没有一只因为"慢但回了"进 failed 以外的地方丢掉
 *   5. 都很快：一批最多 12 只（next = cursor + 12），请求 ≤ 45
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { FUNDS } from '../src/funds';
import { refreshBatch, type FetchLike, type RefreshResult } from '../src/funds-api';

const NOW = Date.UTC(2026, 10, 10, 10, 0, 0);
const DAY = 86_400_000;
const BUDGET = 25_000;
const SLACK = 50; // 假时钟每步推进 10ms，留一点余量
const LIMIT = 45;

// ---------- 替身数据 ----------
function pts(n = 300): [string, number][] {
  const end = Date.UTC(2026, 10, 9);
  return Array.from({ length: n }, (_, i) => [new Date(end - (n - 1 - i) * DAY).toISOString().slice(0, 10), 100 + i * 0.01]);
}
const P = pts();
const yahooBody = () => ({ chart: { result: [{ meta: { currency: 'USD', gmtoffset: 0 }, timestamp: P.map((p) => Date.parse(p[0] + 'T08:00:00Z') / 1000), indicators: { quote: [{ close: P.map((p) => p[1]) }], adjclose: [{ adjclose: P.map((p) => p[1]) }] } }] } });
function emBody(page: number) {
  const desc = P.slice().reverse().slice((page - 1) * 20, page * 20);
  return { Data: { LSJZList: desc.map((p) => ({ FSRQ: p[0], DWJZ: String(p[1]), LJJZ: String(p[1]) })) } };
}
const bodyOf = (u: string) => (u.includes('eastmoney') ? emBody(Number(new URL(u).searchParams.get('pageIndex'))) : yahooBody());
const symOf = (u: string) => {
  const x = new URL(u);
  return x.hostname.includes('eastmoney') ? x.searchParams.get('fundCode')! : decodeURIComponent(x.pathname.split('/').pop()!);
};

/** 替身 fetch：hang(sym) 为真时永远不回（直到被 abort）；否则 delay 毫秒后回数据 */
function makeFetch(hang: (sym: string) => boolean, delay = 0) {
  const urls: string[] = [];
  const f: FetchLike = (u, init) => {
    urls.push(u);
    return new Promise<Response>((res, rej) => {
      const sig = init?.signal;
      if (sig?.aborted) return rej(new DOMException('aborted', 'AbortError'));
      let t: ReturnType<typeof setTimeout> | undefined;
      sig?.addEventListener('abort', () => { if (t) clearTimeout(t); rej(new DOMException('aborted', 'AbortError')); });
      if (hang(symOf(u))) return;
      t = setTimeout(() => res(new Response(JSON.stringify(bodyOf(u)), { status: 200 })), delay);
    });
  };
  return { f, urls };
}

// ---------- 替身 D1：只记语句 ----------
function fakeEnv(): Env {
  const stmt = (sql: string) => ({ sql, bind: (..._a: unknown[]) => ({ sql }) });
  return { DB: { prepare: stmt, batch: async (s: unknown[]) => s.map(() => ({ success: true })) } as unknown as D1Database, ENVIRONMENT: 'test', COPILOT_PASSWORD: 'x' } as Env;
}

/** 在假时钟下跑一次 refreshBatch（不注入 sleep：重试间隔也走假时钟），返回结果、耗时、请求 */
async function run(cursor: number, hang: (sym: string) => boolean, delay = 0) {
  const { f, urls } = makeFetch(hang, delay);
  const t0 = Date.now();
  let out: RefreshResult | undefined, err: unknown;
  const p = refreshBatch(fakeEnv(), cursor, NOW, f).then((r) => (out = r), (e) => (err = e));
  for (let i = 0; i < 20_000 && out === undefined && err === undefined; i++) await vi.advanceTimersByTimeAsync(10);
  await p;
  if (err) throw err;
  expect(out, '假时钟推进 200 秒还没返回').toBeDefined();
  const perUrl = new Map<string, number>();
  for (const u of urls) perUrl.set(u, (perUrl.get(u) ?? 0) + 1);
  return { r: out!, ms: Date.now() - t0, urls, maxPerUrl: Math.max(0, ...perUrl.values()), perUrl };
}

/** updated + failed 正好是 [cursor, next) 这一段、每只一次、没有跳过 */
function coversExactly(r: RefreshResult, cursor: number) {
  const end = r.next ?? FUNDS.length;
  const want = FUNDS.slice(cursor, end).map((x) => x.code).sort();
  const got = [...r.updated, ...r.failed.map((x) => x.code)].sort();
  expect(got).toEqual(want);
  expect(r.done).toBe(end);
}

beforeEach(() => { vi.useFakeTimers({ now: NOW, toFake: ['setTimeout', 'clearTimeout', 'Date'] }); });
afterEach(() => { vi.useRealTimers(); });

describe('基金观察 refresh：超时和分批（主会话 2026-11-10 约定）', () => {
  it('1. 批首那只一直不回：≤ 25 秒返回，同一地址只试 2 次，next 指向下一只', async () => {
    const i = FUNDS.findIndex((x) => x.code === 'VIG');
    const { r, ms, maxPerUrl, urls } = await run(i, (s) => s === 'VIG');
    expect(ms).toBeLessThanOrEqual(BUDGET + SLACK);
    expect(maxPerUrl).toBeLessThanOrEqual(2);
    expect(urls.filter((u) => symOf(u) === 'VIG').length).toBe(2); // 2y 试 2 次就放弃（不再去试 1y）
    expect(r.failed.map((x) => x.code)).toEqual(['VIG']);
    expect(r.requests).toBeLessThanOrEqual(LIMIT);
    expect(r.next).toBe(i + 1); // 8 + 1 + 8 = 17 秒 > 15 秒，不再开新的一只
    coversExactly(r, i);
  });

  it('2. 批中那只一直不回：前面的照常更新，15 秒后不再开新的一只，next 指向第一只没处理的', async () => {
    const i = FUNDS.findIndex((x) => x.code === 'VOO');
    const { r, ms, maxPerUrl } = await run(i, (s) => s === 'SPY'); // VOO、IVV 很快，SPY 卡住
    expect(ms).toBeLessThanOrEqual(BUDGET + SLACK);
    expect(maxPerUrl).toBeLessThanOrEqual(2);
    expect(r.updated).toEqual(['VOO', 'IVV']);
    expect(r.failed.map((x) => x.code)).toEqual(['SPY']);
    expect(r.next).toBe(FUNDS.findIndex((x) => x.code === 'VTI'));
    coversExactly(r, i);
  });

  it('3. 所有数据源都一直不回：45 个起点各调一次，每次 ≤ 25 秒、≤ 45 个请求、同一地址 ≤ 2 次，不漏不重', async () => {
    for (let c = 0; c < FUNDS.length; c++) {
      const { r, ms, maxPerUrl, urls } = await run(c, () => true);
      expect([c, ms <= BUDGET + SLACK]).toEqual([c, true]);
      expect([c, urls.length <= LIMIT, r.requests === urls.length]).toEqual([c, true, true]);
      expect([c, maxPerUrl]).toEqual([c, Math.min(maxPerUrl, 2)]);
      expect(r.next === null || r.next > c).toBe(true); // 一定往前走
      coversExactly(r, c);
    }
  });

  it('4. 每个请求都 7 秒才回：一路调到 next 为 null，每次 ≤ 25 秒、≤ 45 个请求，45 只每只恰好处理一次', async () => {
    let c: number | null = 0, calls = 0;
    const seen: string[] = [];
    while (c !== null) {
      const { r, ms, maxPerUrl, urls } = await run(c, () => false, 7_000);
      expect(ms).toBeLessThanOrEqual(BUDGET + SLACK);
      expect(urls.length).toBeLessThanOrEqual(LIMIT);
      expect(maxPerUrl).toBeLessThanOrEqual(2);
      coversExactly(r, c);
      seen.push(...r.updated, ...r.failed.map((x) => x.code));
      c = r.next;
      expect(++calls).toBeLessThanOrEqual(45);
    }
    expect(seen.sort()).toEqual(FUNDS.map((x) => x.code).sort());
  });

  it('5. 都很快：一批最多 12 只，请求 ≤ 45', async () => {
    const { r, urls } = await run(0, () => false, 0);
    expect(r.updated.length + r.failed.length).toBe(12);
    expect(r.next).toBe(12);
    expect(urls.length).toBeLessThanOrEqual(LIMIT);
  });
});
