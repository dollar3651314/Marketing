/**
 * 基金观察第二轮修改：接口 / 计时这一侧（主会话 2026-11-10 定的约定 8、9）。**测试会话先写（agents C154 试行）**，研发不改断言（底线 6）。
 * 页面那几条（约定 1～7、10、11）在 scripts/e2e-funds.mjs 的 K～S 段。
 *
 * 做法和 test/funds-timeout.test.ts 一样：vitest 假时钟（Date.now、setTimeout 都是假的，不真等）；替身 fetch 按 AbortSignal 中止；
 *   D1 用一个只记语句和参数的替身。**不连任何真实数据源。**
 *
 * 守的事：
 *   8a. 被 25 秒截止打断的那只（不在批首；例：VOO、IVV 各花 4.5～7.9 秒，SPY 一直不回）留给下一批：next 指向它，不进 failed、不写 error（D1 里不出现带它的 err 语句）；
 *       前面取到的照常 updated。没被截止打断、正常试满 2 次都没回应的，照常进 failed（"8 秒没回应（试了 2 次）"）。
 *   8b. 失败原因里"等了几秒、试了几次"写实际值：不出现"0 秒没回应""1 秒没回应"；"试了 N 次"的 N = 那个数据源实际发出的次数。
 *   9.  Yahoo 回 chart.error（404 带说明、或 200 但 result 为 null 带说明）时，chart.error.description 带进失败原因。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { FUNDS } from '../src/funds';
import { refreshBatch, type FetchLike, type RefreshResult } from '../src/funds-api';

const NOW = Date.UTC(2026, 10, 10, 10, 0, 0);
const DAY = 86_400_000;
const BUDGET = 25_000;
const SLACK = 50;

function pts(n = 300): [string, number][] {
  const end = Date.UTC(2026, 10, 9);
  return Array.from({ length: n }, (_, i) => [new Date(end - (n - 1 - i) * DAY).toISOString().slice(0, 10), 100 + i * 0.01]);
}
const yahooBody = (P = pts()) => ({ chart: { result: [{ meta: { currency: 'USD', gmtoffset: 0 }, timestamp: P.map((p) => Date.parse(p[0] + 'T08:00:00Z') / 1000), indicators: { quote: [{ close: P.map((p) => p[1]) }], adjclose: [{ adjclose: P.map((p) => p[1]) }] } }], error: null } });
function emBody(page: number) {
  const desc = pts().reverse().slice((page - 1) * 20, page * 20);
  return { Data: { LSJZList: desc.map((p) => ({ FSRQ: p[0], DWJZ: String(p[1]), LJJZ: String(p[1]) })) } };
}
const isEm = (u: string) => new URL(u).hostname.includes('eastmoney');
const symOf = (u: string) => {
  const x = new URL(u);
  return isEm(u) ? x.searchParams.get('fundCode')! : decodeURIComponent(x.pathname.split('/').pop()!);
};
const rangeOf = (u: string) => new URL(u).searchParams.get('range');

/** 一个请求怎么回：hang = 一直不回（直到被 abort）；否则 delay 毫秒后回 status / body（body 缺省 = 正常数据） */
type Plan = { hang?: boolean; delay?: number; status?: number; body?: unknown };
function makeFetch(plan: (u: string) => Plan) {
  const urls: string[] = [];
  const f: FetchLike = (u, init) => {
    urls.push(u);
    return new Promise<Response>((res, rej) => {
      const sig = init?.signal;
      if (sig?.aborted) return rej(new DOMException('aborted', 'AbortError'));
      let t: ReturnType<typeof setTimeout> | undefined;
      sig?.addEventListener('abort', () => { if (t) clearTimeout(t); rej(new DOMException('aborted', 'AbortError')); });
      const p = plan(u);
      if (p.hang) return;
      const body = p.body ?? (isEm(u) ? emBody(Number(new URL(u).searchParams.get('pageIndex'))) : yahooBody());
      t = setTimeout(() => res(new Response(JSON.stringify(body), { status: p.status ?? 200 })), p.delay ?? 0);
    });
  };
  return { f, urls };
}

/** 替身 D1：记下每条语句和绑定的参数 */
function fakeEnv() {
  const log: { sql: string; args: unknown[] }[] = [];
  const env = {
    DB: {
      prepare: (sql: string) => ({ sql, bind: (...args: unknown[]) => ({ sql, args }) }),
      batch: async (s: { sql: string; args: unknown[] }[]) => { log.push(...s); return s.map(() => ({ success: true })); },
    } as unknown as D1Database,
    ENVIRONMENT: 'test',
    COPILOT_PASSWORD: 'x',
  } as Env;
  return { env, log };
}

async function run(cursor: number, plan: (u: string) => Plan) {
  const { f, urls } = makeFetch(plan);
  const { env, log } = fakeEnv();
  const t0 = Date.now();
  let out: RefreshResult | undefined, err: unknown;
  const p = refreshBatch(env, cursor, NOW, f).then((r) => (out = r), (e) => (err = e));
  for (let i = 0; i < 20_000 && out === undefined && err === undefined; i++) await vi.advanceTimersByTimeAsync(10);
  await p;
  if (err) throw err;
  expect(out, '假时钟推进 200 秒还没返回').toBeDefined();
  return { r: out!, ms: Date.now() - t0, urls, log };
}

const idx = (code: string) => FUNDS.findIndex((x) => x.code === code);
/** D1 里有没有给这只写 error 的语句（绑定参数里有这个 code、且语句里 err 被设成非 NULL） */
const wroteErr = (log: { sql: string; args: unknown[] }[], code: string) => log.some((s) => s.args?.[0] === code && /err\s*=\s*\?/i.test(s.sql));
/** 原因里"…N 秒没回应（试了 K 次）"逐段取出：[来源, 秒, 次] */
function waits(reason: string): [string, number, number | null][] {
  const out: [string, number, number | null][] = [];
  const re = /(Yahoo|东方财富)?[^，。；（]*?(\d+) ?秒没(?:有)?回应(?:（试了 ?(\d+) ?次）)?/g;
  for (const m of reason.matchAll(re)) out.push([m[1] ?? '', Number(m[2]), m[3] ? Number(m[3]) : null]);
  return out;
}

beforeEach(() => { vi.useFakeTimers({ now: NOW, toFake: ['setTimeout', 'clearTimeout', 'Date'] }); });
afterEach(() => { vi.useRealTimers(); });

describe('基金观察第二轮：被截止打断的那只留给下一批（约定 8）', () => {
  // 单次请求 8 秒超时，所以让前面两只各花几秒（都 < 8 秒）：VOO a 毫秒、IVV b 毫秒后回，SPY 一直不回。
  // SPY 在 a + b 时开始，8 + 1 + 8 = 17 秒才能试满 2 次；a + b > 8 秒时第二次一定被 25 秒截止打断
  for (const [a, b] of [[4_500, 4_500], [6_000, 6_000], [7_000, 7_000], [7_000, 7_900]]) {
    it(`8a. VOO ${a / 1000} 秒、IVV ${b / 1000} 秒才回、SPY 一直不回：SPY 被截止打断 → next 指向 SPY，不进 failed、不写 error`, async () => {
      const { r, ms, log } = await run(idx('VOO'), (u) => (symOf(u) === 'VOO' ? { delay: a } : symOf(u) === 'IVV' ? { delay: b } : symOf(u) === 'SPY' ? { hang: true } : {}));
      expect(ms).toBeLessThanOrEqual(BUDGET + SLACK);
      expect({ updated: r.updated, failed: r.failed, next: r.next }).toEqual({ updated: ['VOO', 'IVV'], failed: [], next: idx('SPY') });
      expect(wroteErr(log, 'SPY'), 'D1 里给 SPY 写了 error').toBe(false);
    });
  }

  it('8a. 对照：VOO、IVV 各 2 秒回、SPY 一直不回（4 + 17 = 21 秒，没被截止打断）→ SPY 照常进 failed，原因写"8 秒没回应（试了 2 次）"，next 指向 VTI', async () => {
    const { r } = await run(idx('VOO'), (u) => (['VOO', 'IVV'].includes(symOf(u)) ? { delay: 2_000 } : symOf(u) === 'SPY' ? { hang: true } : {}));
    expect(r.updated).toEqual(['VOO', 'IVV']);
    expect(r.failed.map((x) => x.code)).toEqual(['SPY']);
    expect(r.failed[0].reason).toMatch(/8 ?秒没回应/);
    expect(r.failed[0].reason).toMatch(/试了 ?2 ?次/);
    expect(r.next).toBe(idx('VTI'));
  });
});

describe('基金观察第二轮：失败原因里的秒数和次数写实际值（约定 8）', () => {
  // 批首的 .SS（510300）：Yahoo 怎么都不行 → 回退东方财富时剩下的时间不够 8 秒；批首必须有进展，所以它进 failed，但原因要写实
  const cases: [string, (u: string) => Plan][] = [
    // Yahoo 2y 两次都不回（0→8、9→17），东方财富从 17 秒开始，只剩 8 秒、只来得及试 1 次
    ['Yahoo 一直不回，东方财富也不回（只来得及试 1 次）', () => ({ hang: true })],
    // Yahoo 2y 7 秒后回 1 条（不够 30 点）→ 1y 两次都不回（7→15、16→24）→ 东方财富 24 秒开始，只剩 1 秒
    ['Yahoo 2y 只回 1 条、1y 不回，东方财富只剩 1 秒', (u) => (isEm(u) ? { hang: true } : rangeOf(u) === '2y' ? { delay: 7_000, body: yahooBody(pts(1)) } : { hang: true })],
  ];
  for (const [name, plan] of cases) {
    it(`8b. 510300 批首：${name} → 进 failed，原因里没有"0 秒 / 1 秒没回应"，"试了 N 次"= 实际次数`, async () => {
      const { r, ms, urls } = await run(idx('510300'), plan);
      expect(ms).toBeLessThanOrEqual(BUDGET + SLACK);
      expect(r.failed.map((x) => x.code)).toEqual(['510300']);
      const reason = r.failed[0].reason;
      expect(reason, reason).not.toMatch(/(^|[^\d])[01] ?秒没(有)?回应/);
      const sent = (host: string) => {
        const per = new Map<string, number>();
        for (const u of urls) if (symOf(u).startsWith('510300') && (host === '东方财富') === isEm(u)) per.set(u, (per.get(u) ?? 0) + 1);
        return [...per.values()];
      };
      for (const [src, , tries] of waits(reason)) {
        if (tries == null) continue;
        const counts = sent(src || (reason.includes('东方财富') ? '东方财富' : 'Yahoo'));
        // 写的"试了 N 次"要对得上那个来源某个地址实际发出的次数（最后出错的那个地址）
        expect(counts, `${reason}：${src} 实际每个地址发了 ${JSON.stringify(counts)} 次`).toContain(tries);
        expect(tries, reason).toBeLessThanOrEqual(Math.max(...counts));
      }
      // 东方财富那段：实际只发了 1 次时不能写"试了 2 次"
      const em = sent('东方财富');
      if (em.length && Math.max(...em) === 1) expect(reason, reason).not.toMatch(/东方财富[^；。]*试了 ?2 ?次/);
    });
  }

  it('8b. 所有源都不回、45 个起点各调一次：所有失败原因里都没有"0 秒没回应""1 秒没回应"', async () => {
    const bad: string[] = [];
    for (let c = 0; c < FUNDS.length; c++) {
      const { r } = await run(c, () => ({ hang: true }));
      for (const x of r.failed) if (/(^|[^\d])[01] ?秒没(有)?回应/.test(x.reason)) bad.push(`${x.code}：${x.reason}`);
    }
    expect(bad).toEqual([]);
  });
});

describe('基金观察第二轮：Yahoo 的 chart.error 说明带进原因（约定 9）', () => {
  const DESC = 'No data found, symbol may be delisted';
  const errBody = { chart: { result: null, error: { code: 'Not Found', description: DESC } } };
  it('9. VOO 回 404 + chart.error → failed 的原因里有 description', async () => {
    const { r } = await run(idx('VOO'), (u) => (symOf(u) === 'VOO' ? { status: 404, body: errBody } : {}));
    const f = r.failed.find((x) => x.code === 'VOO');
    expect(f, JSON.stringify(r.failed)).toBeDefined();
    expect(f!.reason).toContain(DESC);
  });
  it('9. VOO 回 200 但 result 为 null、带 chart.error → failed 的原因里有 description', async () => {
    const { r } = await run(idx('VOO'), (u) => (symOf(u) === 'VOO' ? { status: 200, body: errBody } : {}));
    const f = r.failed.find((x) => x.code === 'VOO');
    expect(f, JSON.stringify(r.failed)).toBeDefined();
    expect(f!.reason).toContain(DESC);
  });
});
