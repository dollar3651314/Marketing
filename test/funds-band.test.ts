/**
 * 基金观察第二版：「未来 1 个月的可能区间」的纯计算（src/funds.ts 的 rangeBand / bandCoverage）。**测试会话先写（agents C154）**，研发不改断言（底线 6）。
 * 规格（Amos 2026-11-10 已定）：
 *   rangeBand(points, center) → [lo95, lo68, mid, hi68, hi95]（百分数）或 null；
 *     σ = 过去一年每日对数收益的样本标准差（n−1），h = σ√21；区间 exp(c ± h) − 1、exp(c ± 1.96h) − 1，mid = exp(c) − 1；少于 40 个日收益返回 null。
 *   bandCoverage(points) = 每段 21 天真实对数收益 |x| ≤ h 的比例（0～1），不够返回 null。
 * 标准答案：test/fixtures/funds/band-ref.json，python 按上面的公式另算（2026-11-10 实抓 45 只）。例：ES3 c=0 的 68% 约 −3.50%～+3.63%；QQQ −6.03%～+6.41%；全体平均覆盖率 67.1%。
 *
 * 两处规格没写死、两种都认（写在提交说明里）：
 *   ①"过去一年"：用传进来的全部点（series 已经是清洗后 ≤375 天）或只用最后一天往前 365 天内的点，两种标准答案都在夹具里（band / band_365）；
 *   ② 点的形状：传 [日期, 复权价, 复权价]——Point（第 3 个是复权价）和 series（第 2 个是复权价）两种读法都读到同一个数。
 * 覆盖率按"逐日滚动的每个 21 天窗口"算（这样全体平均才是规格说的约 67%；不重叠分段只有 65.6%），平均值容差 ±0.01。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as funds from '../src/funds';
import { ROOT } from './helpers';

type Ref = { series: [string, number][]; band: number[] | null; band_365: number[] | null; band_c001: number[] | null; coverage: number | null; coverage_365: number | null };
const REF = JSON.parse(readFileSync(path.join(ROOT, 'test/fixtures/funds/band-ref.json'), 'utf8')) as { avg_coverage: number; funds: Record<string, Ref> };

// 实现还没有时 typecheck 会红（这是先写的检查），运行时取不到函数也逐条红、不整文件崩
const rangeBand = (funds as any).rangeBand as (points: unknown, center: number) => number[] | null;
const bandCoverage = (funds as any).bandCoverage as (points: unknown) => number | null;
const asPoints = (s: [string, number][]) => s.map(([d, a]) => [d, a, a] as [string, number, number]);
const TOL = 0.02; // 百分点

function closeTo(got: number[] | null, ...wants: (number[] | null)[]) {
  if (!Array.isArray(got) || got.length !== 5) return false;
  return wants.some((w) => w && w.every((v, i) => Math.abs(got[i] - v) <= TOL));
}

describe('rangeBand：未来 1 个月的可能区间', () => {
  it('函数存在', () => {
    expect(typeof rangeBand).toBe('function');
    expect(typeof bandCoverage).toBe('function');
  });

  it('ES3 c=0：68% 约 −3.5%～+3.6%、95% 约 −6.8%～+7.2%，mid = 0（和 python 标准答案误差 ≤ 0.02 个百分点）', () => {
    const r = REF.funds.ES3;
    const got = rangeBand(asPoints(r.series), 0);
    expect(got, JSON.stringify(got)).not.toBeNull();
    expect(closeTo(got, r.band, r.band_365), `${JSON.stringify(got)} vs ${JSON.stringify(r.band)} / ${JSON.stringify(r.band_365)}`).toBe(true);
    expect(got![2]).toBeCloseTo(0, 9);
  });

  it('QQQ c=0：68% 约 −6.0%～+6.4%', () => {
    const r = REF.funds.QQQ;
    const got = rangeBand(asPoints(r.series), 0);
    expect(closeTo(got, r.band, r.band_365), JSON.stringify(got)).toBe(true);
  });

  it('45 只全部和标准答案一致；上市不满两个月（XUS、XWR，只有 20 个点）返回 null', () => {
    const bad: string[] = [];
    for (const [code, r] of Object.entries(REF.funds)) {
      let got: number[] | null;
      try { got = rangeBand(asPoints(r.series), 0); } catch (e) { bad.push(`${code} 抛错：${(e as Error).message}`); continue; }
      if (r.band === null) { if (got !== null) bad.push(`${code} 应为 null，得到 ${JSON.stringify(got)}`); continue; }
      if (!closeTo(got, r.band, r.band_365)) bad.push(`${code}：${JSON.stringify(got)}，应为 ${JSON.stringify(r.band.map((v) => +v.toFixed(3)))}`);
    }
    expect(bad).toEqual([]);
    expect(REF.funds.XUS.band).toBeNull();
  });

  it('五个数从小到大：lo95 < lo68 < mid < hi68 < hi95，而且不对称（对数正态：上沿离 mid 比下沿远）', () => {
    const got = rangeBand(asPoints(REF.funds['588000'].series), 0)!;
    expect(got).not.toBeNull();
    for (let i = 1; i < 5; i++) expect(got[i]).toBeGreaterThan(got[i - 1]);
    expect(got[4] - got[2]).toBeGreaterThan(got[2] - got[0]);
  });

  it('center 是对数中心：c = 0.01 时 mid = (e^0.01 − 1)×100 ≈ 1.005%，两边按 exp(c ± h) − 1', () => {
    const r = REF.funds.ES3;
    const got = rangeBand(asPoints(r.series), 0.01);
    expect(got).not.toBeNull();
    expect(got![2]).toBeCloseTo((Math.exp(0.01) - 1) * 100, 6);
    // c=0.01 的整组和 python 一致（"过去一年"两种切法都认：用 band_365 推出 h 再算一组）
    const h365 = Math.log(1 + REF.funds.ES3.band_365![3] / 100);
    const alt = [-1.96, -1, 0, 1, 1.96].map((k) => (Math.exp(0.01 + k * h365) - 1) * 100);
    expect(closeTo(got, r.band_c001, alt), JSON.stringify(got)).toBe(true);
  });

  it('边界：41 个点（40 个日收益）能算；40 个点（39 个日收益）返回 null', () => {
    const s = REF.funds.ES3.series.slice(-41);
    expect(rangeBand(asPoints(s), 0)).not.toBeNull();
    expect(rangeBand(asPoints(s.slice(1)), 0)).toBeNull();
  });

  it('坏输入不抛错：空数组、null 返回 null', () => {
    expect(() => rangeBand([], 0)).not.toThrow();
    expect(rangeBand([], 0)).toBeNull();
    expect(rangeBand(null, 0)).toBeNull();
  });

  it('手算小例：价格交替 ×1.01 / ÷1.01（60 个点），σ 按样本标准差（n−1）', () => {
    const s: [string, number][] = [];
    let v = 100;
    for (let i = 0; i < 60; i++) { s.push([new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10), v]); v = i % 2 ? v / 1.01 : v * 1.01; }
    const r = s.slice(1).map((p, i) => Math.log(p[1] / s[i][1]));
    const m = r.reduce((a, b) => a + b, 0) / r.length;
    const sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1));
    const h = sd * Math.sqrt(21);
    const want = [-1.96, -1, 0, 1, 1.96].map((k) => (Math.exp(k * h) - 1) * 100);
    const got = rangeBand(asPoints(s), 0);
    expect(got).not.toBeNull();
    got!.forEach((g, i) => expect(g).toBeCloseTo(want[i], 6));
  });
});

describe('bandCoverage：回测覆盖率', () => {
  it('45 只：能算的都在 0～1 之间，和逐日滚动 21 天窗口的标准答案一致（误差 ≤ 0.02）；XUS、XWR 返回 null', () => {
    const bad: string[] = [];
    const vals: number[] = [];
    for (const [code, r] of Object.entries(REF.funds)) {
      let got: number | null;
      try { got = bandCoverage(asPoints(r.series)); } catch (e) { bad.push(`${code} 抛错：${(e as Error).message}`); continue; }
      if (r.coverage === null) { if (got !== null) bad.push(`${code} 应为 null，得到 ${got}`); continue; }
      if (typeof got !== 'number' || got < 0 || got > 1) { bad.push(`${code}：${got} 不在 0～1`); continue; }
      vals.push(got);
      if (Math.abs(got - r.coverage) > 0.02 && Math.abs(got - (r.coverage_365 ?? -9)) > 0.02) bad.push(`${code}：${got.toFixed(3)}，应为 ${r.coverage.toFixed(3)}`);
    }
    expect(bad).toEqual([]);
    expect(vals.length).toBe(43);
  });

  it('全体平均覆盖率约 67%（0.66～0.68；页面"平均 67% 的时候落在深色段里"就是这个数）', () => {
    const vals = Object.values(REF.funds).map((r) => bandCoverage(asPoints(r.series))).filter((x): x is number => typeof x === 'number');
    expect(vals.length).toBe(43);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    expect(avg).toBeGreaterThanOrEqual(0.66);
    expect(avg).toBeLessThanOrEqual(0.68);
  });

  it('坏输入不抛错：空数组、null、太短（20 个点）返回 null', () => {
    expect(bandCoverage([])).toBeNull();
    expect(bandCoverage(null)).toBeNull();
    expect(bandCoverage(asPoints(REF.funds.XUS.series))).toBeNull();
  });
});
