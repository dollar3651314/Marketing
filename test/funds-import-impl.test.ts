/**
 * 基金观察估值"参考：导入的历史"（Amos 2026-11-12：D1～D4、I1、I3 都按建议）研发自测：
 * 校验（parseImport）、选指标 / 百分位 / 贵的程度 / 标签（impCard）、接口（要登录、≤2MB、按 code 覆盖、GET 多回 val_import）。
 * 数据全是这里现造的小夹具（**不放导入文件的真数据**：仓库公开，第三方数据不能转载）。D1 用 getPlatformProxy 的本地 SQLite。
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import { basisOf, DJ_TAG, impCard, IMP_MAX_BYTES, isDanjuan, parseImport, type ImpStored } from '../src/funds-import';
import { ROOT } from './helpers';

const PASS = 'ci_only_copilot_password_01';
const HOST = 'https://copilot.example.test';
const MIG = path.join(ROOT, 'migrations');
const NOW = Date.UTC(2026, 10, 12, 2, 0, 0);

const stmtsOf = (files: string[]) =>
  files.map((f) => readFileSync(path.join(MIG, f), 'utf8').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n'))
    .join(';\n').split(';').map((s) => s.trim()).filter(Boolean);

/** n 个月的序列，最后一个月是 end，值 = f(i) */
function months(n: number, end: string, f: (i: number) => number): [string, number][] {
  const [y, m] = end.split('-').map(Number);
  const e = y * 12 + m - 1;
  return Array.from({ length: n }, (_, i) => { const k = e - (n - 1 - i); return [`${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}`, f(i)] as [string, number]; });
}
const st = (over: Partial<ImpStored>): ImpStored => ({ name: 'X', funds: ['X'], source: '', basis: '', as_of: '2026-11-12', series: {}, ...over });

describe('parseImport 校验', () => {
  it('整个文件不对回 error；code 不在 45 只、日期不是 YYYY-MM、值不是正数、超过 600 点、重复月份、重复 code 都整只跳过并写原因', () => {
    expect(parseImport(null, '2026-11-12')).toHaveProperty('error');
    expect(parseImport({ indexes: 1 }, '2026-11-12')).toHaveProperty('error');
    const r = parseImport({ asOf: '2026-11-12', indexes: [
      { code: 'QQQ', name: '纳指', funds: ['QQQ'], source: 's', basis: 'b', series: { pe: [['2026-10', 30], ['2026-09', 29]] } },
      { code: 'ZZZ', name: 'z', series: { pe: [['2026-10', 1]] } },
      { code: 'VIG', name: 'v', series: { dy: [['2026/10', 1]] } },
      { code: 'VYM', name: 'v', series: { dy: [['2026-10', -1]] } },
      { code: 'SDY', name: 'v', series: { dy: [['2026-10', Infinity]] } },
      { code: 'DGRO', name: 'v', series: { dy: months(601, '2026-11', () => 1) } },
      { code: 'SCHD', name: 'v', series: { dy: [['2026-10', 1], ['2026-10', 2]] } },
      { code: 'QQQ', name: 'again', series: { pe: [['2026-10', 1]] } },
      { code: 'VTI', name: 'v', series: { pe: [], dy: [] } },
      { code: 'ES3', name: 'v', series: { dy: [['2026-13', 1]] } },
    ] }, '2026-11-12');
    if ('error' in r) throw new Error(r.error);
    expect(r.ok.map((x) => x.code)).toEqual(['QQQ']);
    expect(r.ok[0].stored.series.pe).toEqual([['2026-09', 29], ['2026-10', 30]]); // 升序
    expect(r.skipped.map((x) => x.code)).toEqual(['ZZZ', 'VIG', 'VYM', 'SDY', 'DGRO', 'SCHD', 'QQQ', 'VTI', 'ES3']);
    expect(r.skipped[0].reason).toContain('45 只');
    expect(r.skipped[4].reason).toContain('600');
    expect(r.skipped.every((x) => x.reason.length > 0)).toBe(true);
  });
  it('alternates 不存；seriesMeta 只留 source / basis 文字；没写 asOf 用今天', () => {
    const r = parseImport({ indexes: [{ code: '588000', name: '科创50', funds: ['588000'], source: 'a；b', basis: 'pe=x', series: { pe: [['2026-10', 50]] }, seriesMeta: { pe: { source: '中证', basis: 'peg', n: 3 } }, alternates: [{ metric: 'pe', series: [['2026-10', 1]] }] }] }, '2026-11-12');
    if ('error' in r) throw new Error(r.error);
    expect(r.ok[0].stored.as_of).toBe('2026-11-12');
    expect(r.ok[0].stored.meta).toEqual({ pe: { source: '中证', basis: 'peg' } });
    expect(JSON.stringify(r.ok[0].stored)).not.toContain('alternates');
  });
});

describe('impCard 选指标与口径', () => {
  const up = (i: number) => 10 + i; // 单调升：现在是最高
  it('pe ≥36 点且最近一点在 12 个月内 → pe；百分位用最近 120 点（不高于现在的占比，1 位小数），贵的程度 = 百分位', () => {
    const c = impCard('QQQ', st({ series: { pe: months(130, '2026-11', up), dy: months(130, '2026-11', up) } }), NOW);
    expect(c.metric).toBe('pe');
    expect(c.n).toBe(120);
    expect(c.pct).toBe(100); // 120/120
    expect(c.dear).toBe(100);
    expect(c.expensive).toBe(100);
    const mid = impCard('QQQ', st({ series: { pe: months(40, '2026-11', (i) => (i === 39 ? 10.5 : 10 + (i % 3))) } }), NOW);
    expect(mid.pct).toBe(35); // 14/40
    expect(mid.now_date).toBe('2026-11');
    expect(c.short).toBe(false);
    expect(c.series.length).toBe(120);
    expect(c.start).toBe('2016-12');
    expect(c.market).toBe('美国');
  });
  it('pe 太旧（最后一点超过 12 个月）或不足 36 点 → dy；dy 贵的程度 = 100 − 百分位', () => {
    const old = impCard('ES3', st({ series: { pe: months(200, '2020-09', up), dy: months(60, '2026-11', up) } }), NOW);
    expect(old.metric).toBe('dy');
    expect(old.pct).toBe(100); // 60/60
    expect(old.dear).toBe(0);
    expect(old.short).toBe(true);
    expect(old.market).toBe('新加坡');
    const few = impCard('SCHD', st({ series: { pe: months(29, '2026-08', up), dy: months(24, '2026-11', up) } }), NOW);
    expect(few.metric).toBe('dy');
    // 刚好 36 点、最后一点正好 12 个月前 → 仍用 pe
    expect(impCard('VTI', st({ series: { pe: months(36, '2025-11', up) } }), NOW).metric).toBe('pe');
    expect(impCard('VTI', st({ series: { pe: months(36, '2025-10', up) } }), NOW).metric).toBe(null);
  });
  it('都不够 → metric = null，只给当前值（只有一个点）', () => {
    const c = impCard('UPD', st({ series: { dy: [['2025-11', 7.43]] } }), NOW);
    expect(c).toMatchObject({ metric: null, shown: 'dy', now: 7.43, date: '2025-11', points: 1, series: [] });
    expect([c.pct, c.dear]).toEqual([null, null]);
  });
  it('代理：选用指标的口径含"代理 / 自算"；蛋卷标签按选用指标的来源（seriesMeta 优先；588000 的 pe 来自中证不加）', () => {
    const qqq = st({ source: 'Yahoo chart QQQ；蛋卷基金 pe_history', basis: 'dy=ETF代理：分红；pe=蛋卷口径；pb=蛋卷口径', series: { pe: months(40, '2026-11', up), dy: months(40, '2026-11', up) } });
    const c = impCard('QQQ', qqq, NOW);
    expect(c.proxy).toBe(false);
    expect(c.source_tag).toBe(DJ_TAG); // basis 的 pe 段写了蛋卷
    const k = impCard('588000', st({ source: '中证；蛋卷', basis: 'pb=蛋卷口径；pe=中证官网 peg 字段', series: { pe: months(77, '2026-11', up) }, meta: { pe: { source: '中证指数官网 index-perf', basis: '中证官网 peg' }, pb: { source: '蛋卷基金' } } }), NOW);
    expect(k.source_tag).toBe(null);
    const d = impCard('515100', st({ basis: 'dy=自算：全收益；pe=中证', series: { dy: months(30, '2026-11', up) } }), NOW);
    expect(d.metric).toBe('dy');
    expect(d.proxy).toBe(true);
  });
  it('basisOf：口径里自己的"；"不切开；isDanjuan 判断不了回 null', () => {
    expect(basisOf('pb=A；半年一个点；pe=B；dy=C', 'pb')).toBe('A；半年一个点');
    expect(basisOf('pb=A；pe=B', 'dy')).toBe('');
    expect(basisOf('只有一段', 'dy')).toBe('只有一段');
    expect(isDanjuan(st({ source: 'Yahoo；蛋卷', basis: '' }), 'dy')).toBe(null);
    expect(isDanjuan(st({ source: 'Yahoo；中证', basis: '' }), 'dy')).toBe(false);
    expect(isDanjuan(st({ source: '蛋卷基金', basis: '' }), 'pe')).toBe(true);
  });
});

describe('接口', () => {
  let db: D1Database;
  let dispose: () => Promise<void>;
  beforeAll(async () => {
    const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: path.join(ROOT, 'test/wrangler.test.toml'), persist: false, remoteBindings: false, envFiles: [] });
    db = proxy.env.DB;
    dispose = proxy.dispose;
    await db.batch(stmtsOf(readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort()).map((s) => db.prepare(s)));
  });
  afterAll(async () => dispose());
  beforeEach(async () => { await db.prepare('DELETE FROM fund_val_import').run(); });
  const env = (): Env => ({ DB: db, ENVIRONMENT: 'test', COPILOT_PASSWORD: PASS });
  async function cookie() {
    const login = await handle(new Request(HOST + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: HOST, 'cf-connecting-ip': '203.0.113.7' }, body: JSON.stringify({ password: PASS }) }), env(), NOW);
    return login.headers.get('set-cookie')!.split(';')[0];
  }
  const post = (body: string, ck?: string) => handle(new Request(HOST + '/api/funds/valuation/import', { method: 'POST', headers: { ...(ck ? { cookie: ck } : {}), origin: HOST, 'content-type': 'application/json' }, body }), env(), NOW);
  const file = (codes: string[], v = 1) => JSON.stringify({ asOf: '2026-11-12', indexes: codes.map((c) => ({ code: c, name: c + ' 指数', funds: [c], source: 'Yahoo chart ' + c, basis: 'dy=ETF代理：分红', series: { dy: months(30, '2026-11', (i) => v + i * 0.01) } })) });

  it('没登录 401；不是 JSON 400；超过 2MB 413', async () => {
    expect((await post(file(['VIG']))).status).toBe(401);
    const ck = await cookie();
    expect((await post('{oops', ck)).status).toBe(400);
    expect((await post(' '.repeat(IMP_MAX_BYTES + 1), ck)).status).toBe(413);
  });
  it('导入 → 再导入同一只算覆盖；GET /api/funds 多回 val_import（45 只顺序、按 code 覆盖成新值）', async () => {
    const ck = await cookie();
    const a = await (await post(file(['VIG', 'XX1']), ck)).json();
    expect(a).toEqual({ imported: 1, replaced: 0, skipped: [{ code: 'XX1', reason: '不在基金观察 45 只里' }] });
    const b = await (await post(file(['VIG', 'CFA'], 5), ck)).json();
    expect(b).toEqual({ imported: 2, replaced: 1, skipped: [] });
    const g = await (await handle(new Request(HOST + '/api/funds', { headers: { cookie: ck } }), env(), NOW)).json() as { val_import: { code: string; now: number; metric: string; proxy: boolean; series: unknown[]; imported_at: string }[] };
    expect(g.val_import.map((x) => x.code)).toEqual(['CFA', 'VIG']); // FUNDS 的顺序：新加坡在前
    const vig = g.val_import.find((x) => x.code === 'VIG')!;
    expect(vig.now).toBeCloseTo(5.29, 6);
    expect(vig).toMatchObject({ metric: 'dy', proxy: true });
    expect(vig.series.length).toBe(30);
    expect(vig.imported_at).toBe(new Date(NOW).toISOString());
    const row = await db.prepare('SELECT source, basis FROM fund_val_import WHERE code = ?1').bind('VIG').first<{ source: string; basis: string }>();
    expect(row).toEqual({ source: 'Yahoo chart VIG', basis: 'dy=ETF代理：分红' });
  });
});
