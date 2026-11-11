/**
 * 基金观察第三版：取数来源调整（Amos 2026-11-11「都按建议」，安全经理条款核对：Yahoo、iShares / BlackRock 条款禁止自动抓取）。
 * **测试会话先写（agents C154）**，研发不改断言（底线 6）。
 * 规格：
 *   S1. 中国 14 只场内 ETF（510300、510310、510050、510500、588000、511990、511880、511010、511360、510880、515100、515080、515180、562060）
 *       价格不再从 Yahoo 取，改用东方财富 lsjz（DWJZ 作 close、LJJZ 作 adj，带 Referer），source = 'eastmoney'（页面"来源"写东方财富净值）；
 *       Yahoo 只剩美国 15 只 + 新加坡 14 只。东方财富增量取：库里已有这只的序列时，只翻到比库里最后日期更早的那一页为止（通常 1 页），首次才全量；
 *       单次调用对外请求仍 ≤ 45。
 *   S2. AGG、TLT、LQD、O9P 不再抓 iShares / BlackRock 页面，改成"美国同期限国债 + 利差"近似（kind 'approx'，页面标"近似"、≈）；
 *       refresh 不向 ishares.com / blackrock.com 发任何请求。BOND_YIELDS 的 auto 只剩 BND、BSV、511990、511880，其余 12 只 approx。
 * 做法同 test/funds-v2-api.test.ts：本地 D1（Miniflare 真 SQLite）+ 替身 fetch（债券收益率来源走 test/funds-yield-fake.ts 的实抓夹具），不连网。
 * 替身东方财富：DWJZ = LJJZ × 0.5（看得出 close / adj 有没有接反）；序列的最后一天可以往后挪一天（模拟第二天再刷）。
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/env';
import { FUNDS } from '../src/funds';
import { BOND_YIELDS } from '../src/funds-yield';
import { handle } from '../src/index';
import { yieldHost, yieldResponse } from './funds-yield-fake';
import { ROOT } from './helpers';

const PASS = 'ci_only_copilot_password_01';
const HOST = 'https://copilot.example.test';
const MIG = path.join(ROOT, 'migrations');
const DAY1 = Date.UTC(2026, 10, 10, 10, 0, 0);
const DAY2 = Date.UTC(2026, 10, 11, 10, 0, 0);
const LIMIT = 45;
const CN14 = ['510300', '510310', '510050', '510500', '588000', '511990', '511880', '511010', '511360', '510880', '515100', '515080', '515180', '562060'];
const SG14 = ['ES3', 'CFA', 'HST', 'XUS', 'XWR', 'A35', 'MBH', 'SBO', 'O9P', '0P00006FY6', 'CLR', 'SRT', 'BYJ', 'UPD'];
const US15 = ['VOO', 'IVV', 'SPY', 'VTI', 'QQQ', 'AGG', 'BND', 'TLT', 'BSV', 'LQD', 'VIG', 'SCHD', 'VYM', 'DGRO', 'SDY'];
const AUTO4 = ['BND', 'BSV', '511990', '511880'];
const TO_APPROX = ['AGG', 'TLT', 'LQD', 'O9P'];

const stmtsOf = (files: string[]) =>
  files.map((f) => readFileSync(path.join(MIG, f), 'utf8').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n'))
    .join(';\n').split(';').map((s) => s.trim()).filter(Boolean);

/** 合成走势：2025-09-16 起到 end 的工作日，按代码做种子（end 往后挪不改变前面的点） */
let END = '2026-11-10';
function synth(code: string): [string, number][] {
  let s = [...code].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const out: [string, number][] = [];
  let v = 10 + rnd() * 90;
  for (let t = Date.UTC(2025, 8, 16); new Date(t).toISOString().slice(0, 10) <= END; t += 86400_000) {
    const w = new Date(t).getUTCDay();
    if (w === 0 || w === 6) continue;
    v *= 1 + (rnd() - 0.5) * 0.02;
    out.push([new Date(t).toISOString().slice(0, 10), Math.round(v * 1e4) / 1e4]);
  }
  return out;
}

let outbound: string[] = [];
const realFetch = globalThis.fetch;
const urlOf = (input: unknown) => (typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url);
const jsonRes = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const isYahoo = (u: string) => /(^|\.)yahoo\.com$/.test(new URL(u).hostname);
const yahooSym = (u: string) => decodeURIComponent(/\/chart\/([^/?]+)/.exec(u)?.[1] ?? '');
const emCode = (u: string) => { const x = new URL(u); return /eastmoney\.com$/.test(x.hostname) && /lsjz/i.test(u) ? x.searchParams.get('fundCode') : null; };
const fake = vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
  const url = urlOf(input);
  const u = new URL(url);
  if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') return realFetch(input as RequestInfo, init);
  outbound.push(url);
  const yr = yieldResponse(url, init ?? (input instanceof Request ? { method: input.method } : undefined));
  if (yr) return yr;
  if (isYahoo(url) && /\/chart\//.test(url)) {
    const sym = yahooSym(url);
    const ser = synth(sym.replace(/\.(SI|SS)$/, ''));
    const adj = ser.map(([, a]) => a);
    return jsonRes({ chart: { result: [{ meta: { currency: sym.endsWith('.SI') ? 'SGD' : sym.endsWith('.SS') ? 'CNY' : 'USD', symbol: sym, gmtoffset: 28800 }, timestamp: ser.map(([d]) => Date.parse(d + 'T01:00:00Z') / 1000), indicators: { quote: [{ close: adj.slice() }], adjclose: [{ adjclose: adj }] } }], error: null } });
  }
  const e = emCode(url);
  if (e) {
    const rows = [...synth(e)].reverse().map(([d, a]) => ({ FSRQ: d, DWJZ: (a * 0.5).toFixed(4), LJJZ: a.toFixed(4) }));
    const pi = Number(u.searchParams.get('pageIndex') ?? 1), ps = Number(u.searchParams.get('pageSize') ?? 20);
    return jsonRes({ Data: { LSJZList: rows.slice((pi - 1) * ps, pi * ps) }, ErrCode: 0, TotalCount: rows.length, PageSize: ps, PageIndex: pi });
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
  const r = await handle(req('/api/login', { method: 'POST', body: JSON.stringify({ password: PASS }) }), env(), DAY1);
  ck = r.headers.get('set-cookie')!.split(';')[0];
  vi.stubGlobal('fetch', fake);
});
afterAll(async () => { vi.unstubAllGlobals(); await dispose(); });

type Item = Record<string, any> & { code: string };
const getItems = async (now: number): Promise<Record<string, Item>> => {
  const r = await handle(req('/api/funds', { cookie: ck }), env(), now, fake as never);
  expect(r.status).toBe(200);
  return Object.fromEntries(((await r.json()) as { items: Item[] }).items.map((x) => [x.code, x]));
};
/** 一路调到 next 为 null；返回每次的对外请求和回包 */
async function refreshAll(now: number) {
  const rounds: { urls: string[]; status: number; body: any }[] = [];
  let cursor: number | undefined;
  for (let i = 0; i < 60; i++) {
    outbound = [];
    const r = await handle(req('/api/funds/refresh', { method: 'POST', cookie: ck, body: JSON.stringify(cursor === undefined ? {} : { cursor }) }), env(), now, fake as never);
    const body = await r.json() as any;
    rounds.push({ urls: outbound.slice(), status: r.status, body });
    if (r.status !== 200 || body.next == null) break;
    cursor = body.next;
  }
  return rounds;
}
const yahooCodes = (urls: string[]) => [...new Set(urls.filter((u) => isYahoo(u)).map((u) => yahooSym(u).replace(/\.(SI|SS)$/, '')))];

describe('S1 / S2 清单（静态）', () => {
  it('S1：中国 14 只场内 ETF 的 source 是 eastmoney；Yahoo 只剩新加坡 14 只 + 美国 15 只', () => {
    const by = Object.fromEntries(FUNDS.map((f) => [f.code, f]));
    expect(CN14.filter((c) => by[c]?.source !== 'eastmoney').map((c) => `${c}：${by[c]?.source}`)).toEqual([]);
    expect(FUNDS.filter((f) => f.source === 'yahoo').map((f) => f.code).sort()).toEqual([...SG14, ...US15].sort());
  });
  it('S2：BOND_YIELDS 的 auto 只剩 BND、BSV、511990、511880；AGG、TLT、LQD、O9P 是 approx；approx 一共 12 只', () => {
    expect(BOND_YIELDS.filter((d) => d.kind === 'auto').map((d) => d.code).sort()).toEqual([...AUTO4].sort());
    expect(TO_APPROX.map((c) => [c, BOND_YIELDS.find((d) => d.code === c)?.kind])).toEqual(TO_APPROX.map((c) => [c, 'approx']));
    expect(BOND_YIELDS.filter((d) => d.kind === 'approx')).toHaveLength(12);
  });
});

describe('S1 / S2 接口（本地 D1 + 替身 fetch）', () => {
  let first: Awaited<ReturnType<typeof refreshAll>> = [];
  let day1: Record<string, Item> = {};

  it('第一次全量刷新：每次 ≤ 45 个对外请求、45 只都更新、没有失败；Yahoo 只被请求新加坡 / 美国那 29 只，中国 14 只一个 Yahoo 请求都没有', async () => {
    END = '2026-11-10';
    first = await refreshAll(DAY1);
    expect(first.every((r) => r.status === 200)).toBe(true);
    expect(first.at(-1)!.body.next).toBeNull();
    expect(first.map((r) => r.urls.length).filter((n) => n > LIMIT)).toEqual([]);
    expect([...new Set(first.flatMap((r) => r.body.updated))].sort()).toEqual(FUNDS.map((f) => f.code).sort());
    expect(first.flatMap((r) => r.body.failed)).toEqual([]);
    const all = first.flatMap((r) => r.urls);
    const y = yahooCodes(all);
    expect(y.filter((c) => CN14.includes(c) || /\.SS$/.test(c)), '中国场内 ETF 不该再请求 Yahoo').toEqual([]);
    expect(all.filter((u) => isYahoo(u) && /\.SS\b/.test(u)).slice(0, 3)).toEqual([]);
    expect(y.filter((c) => ![...SG14, ...US15].includes(c))).toEqual([]);
    // 中国 14 只都去东方财富取了价格
    const em = new Set(all.map(emCode).filter(Boolean));
    expect(CN14.filter((c) => !em.has(c))).toEqual([]);
  });

  it('S2：整个刷新过程不向 ishares.com / blackrock.com 发任何请求', () => {
    const bad = first.flatMap((r) => r.urls).filter((u) => ['ishares.com', 'blackrock.com'].includes(yieldHost(u) ?? '') || /(^|\.)(ishares|blackrock)\.com$/.test(new URL(u).hostname));
    expect(bad).toEqual([]);
  });

  it('S1：GET 里中国 14 只 source = eastmoney、last = 最新一天的 DWJZ（单位净值）、有一年的序列（y1 不为空）', async () => {
    day1 = await getItems(DAY1);
    const bad: string[] = [];
    for (const c of CN14) {
      const x = day1[c];
      const lastRow = synth(c).at(-1)!;
      if (!x || x.source !== 'eastmoney') bad.push(`${c} source = ${x?.source}`);
      else if (!(typeof x.last === 'number' && Math.abs(x.last - +(lastRow[1] * 0.5).toFixed(4)) < 1e-4)) bad.push(`${c} last = ${x.last}，应为 DWJZ ${(lastRow[1] * 0.5).toFixed(4)}`);
      else if (x.date !== lastRow[0] || typeof x.y1 !== 'number' || !Array.isArray(x.series) || x.series.length < 200) bad.push(`${c} date=${x.date} y1=${x.y1} series=${x.series?.length}`);
    }
    expect(bad).toEqual([]);
  });

  it('S2：GET 里 AGG、TLT、LQD、O9P 是近似（kind approx、approx = true）、value > 0、stale = false、口径写美国国债', async () => {
    const bad = TO_APPROX.map((c) => [c, day1[c]?.yield] as const).filter(([, y]) => !(y && y.kind === 'approx' && y.approx === true && typeof y.value === 'number' && y.value > 0 && y.stale === false && /美国.*国债|美债/.test(String(y.label))))
      .map(([c, y]) => `${c}：${JSON.stringify(y)}`);
    expect(bad).toEqual([]);
  });

  it('S1 增量：第二天再刷（库里已有序列）→ 中国 14 只每只只发 1 个东方财富价格请求；新的一天进来了、旧的一年没丢', async () => {
    END = '2026-11-11';
    // 第二天重新登录一次（会话有时效，和本条要守的事无关）
    const lg = await handle(req('/api/login', { method: 'POST', body: JSON.stringify({ password: PASS }) }), env(), DAY2);
    ck = lg.headers.get('set-cookie')!.split(';')[0];
    const rounds = await refreshAll(DAY2);
    expect(rounds.filter((r) => r.status !== 200).map((r) => [r.status, r.body])).toEqual([]);
    expect(rounds.at(-1)!.body.next).toBeNull();
    expect(rounds.map((r) => r.urls.length).filter((n) => n > LIMIT)).toEqual([]);
    expect(rounds.flatMap((r) => r.body.failed)).toEqual([]);
    const all = rounds.flatMap((r) => r.urls);
    expect(yahooCodes(all).filter((c) => CN14.includes(c))).toEqual([]);
    // 511990 / 511880 的债券收益率（7 日年化）也读同一个 lsjz 第 1 页，最多再多 1 个
    const yieldEm = new Set(BOND_YIELDS.filter((d) => d.url && emCode(d.url)).map((d) => d.code));
    const bad = CN14.map((c) => [c, all.filter((u) => emCode(u) === c).length] as const).filter(([c, n]) => !(n >= 1 && n <= (yieldEm.has(c) ? 2 : 1))).map(([c, n]) => `${c}：${n} 个`);
    expect(bad, '已有序列时应只取 1 页').toEqual([]);
    const day2 = await getItems(DAY2);
    const lost = CN14.filter((c) => {
      const a = day1[c], b = day2[c];
      return !(b && b.date === '2026-11-11' && typeof b.y1 === 'number' && Array.isArray(b.series) && b.series.length >= a.series.length - 2);
    }).map((c) => `${c}：date ${day2[c]?.date}，series ${day1[c]?.series?.length} → ${day2[c]?.series?.length}，y1 ${day2[c]?.y1}`);
    expect(lost).toEqual([]);
  });
});
