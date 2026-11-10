/**
 * 基金观察第二版 研发自测（src/funds.ts rangeBand / bandCoverage、src/funds-yield.ts 解析和近似）。
 * 页面片段按 2026-11-10 实抓的页面结构缩写（原页面 iShares 约 2MB、BlackRock 约 1MB，不进仓库）。测试会话的用例另写，这里只守研发自己的口径。
 */
import { describe, expect, it } from 'vitest';
import { bandCoverage, bondCenter, rangeBand } from '../src/funds';
import {
  approxYield, BOND_YIELDS, curveAt, parseBlackrockSg, parseChinabond, parseEm7d, parseEmNav, parseIshares, parseMasHtml, parseTreasuryCsv, parseVanguard,
} from '../src/funds-yield';
import { FUNDS } from '../src/funds';

/** 从 2026-01-02 起的工作日序列，价格 p(i) */
function series(n: number, p: (i: number) => number): [string, number][] {
  const out: [string, number][] = [];
  let t = Date.UTC(2025, 10, 3);
  for (let i = 0; out.length < n; i++, t += 86_400_000) {
    const wd = new Date(t).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    out.push([new Date(t).toISOString().slice(0, 10), p(out.length)]);
  }
  return out;
}

describe('rangeBand / bandCoverage', () => {
  it('交替 ±1% 的价格：σ ≈ 1%，h = σ√21，五个数按 exp(c ± z·h) − 1 排好', () => {
    const s = series(200, (i) => 100 * (i % 2 ? 1.01 : 1));
    const b = rangeBand(s, 0)!;
    const r = Math.log(1.01);
    const sd = Math.sqrt((r * r * 199) / 198 - 0); // 均值近 0 时的近似，只看量级
    expect(b).toHaveLength(5);
    expect(b[2]).toBe(0);
    expect(b[0]).toBeLessThan(b[1]);
    expect(b[3]).toBeLessThan(b[4]);
    expect(b[3]).toBeCloseTo((Math.exp(sd * Math.sqrt(21)) - 1) * 100, 0);
  });
  it('少于 40 个日收益返回 null；正好 40 个能算', () => {
    expect(rangeBand(series(40, (i) => 100 + i), 0)).toBeNull();
    expect(rangeBand(series(41, (i) => 100 + (i % 3)), 0)).not.toBeNull();
    expect(bandCoverage(series(40, (i) => 100 + i))).toBeNull();
  });
  it('债券中心：c = ln(1+5%)/12，中间那个数 = exp(c) − 1', () => {
    const c = bondCenter(5);
    expect(c).toBeCloseTo(Math.log(1.05) / 12, 10);
    const b = rangeBand(series(100, (i) => 100 * (i % 2 ? 1.001 : 1)), c)!;
    expect(b[2]).toBeCloseTo((Math.exp(c) - 1) * 100, 8);
    expect(bondCenter(null)).toBe(0);
  });
  it('Point 形状（[日期, 收盘, 复权]）用最后一个数（复权价）', () => {
    const s = series(80, (i) => 100 * (i % 2 ? 1.02 : 1));
    const pts = s.map(([d, a]) => [d, 999, a] as [string, number, number]);
    expect(rangeBand(pts, 0)).toEqual(rangeBand(s, 0));
  });
  it('覆盖率在 0～1 之间', () => {
    const v = bandCoverage(series(250, (i) => 100 * Math.exp(0.01 * Math.sin(i / 3))))!;
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });
});

describe('解析（按 2026-11-10 实抓页面的结构）', () => {
  const q = (s: string) => s.replace(/"/g, '&quot;');
  it('iShares：反转义后取 label 前面那一项的 formattedValue 和 asOfDate', () => {
    const html = '<div data-x="' + q('{"x":{"asOfDate":20261109,"formattedAsOfDate":"Nov 09, 2026","formattedValue":"5.20%","label":"Average Yield to Maturity","asOfLabel":""},"y":{"asOfDate":20261109,"formattedAsOfDate":"Nov 09, 2026","formattedValue":"5.73 yrs","label":"Effective Duration"}}') + '"></div>';
    expect(parseIshares(html)).toEqual({ ytm: 5.2, duration: 5.73, asOf: '2026-11-09' });
    expect(parseIshares('<html>Access Denied</html>')).toBeNull();
  });
  it('Vanguard：&#34; 转义的 yieldToMaturity / yieldToMaturityDate / averageDuration（第一处）', () => {
    const e = (s: string) => s.replace(/"/g, '&#34;');
    const html = e('{"averageDuration":"5.7 years","yieldToMaturity":"5.2","yieldToMaturityDate":"11/06/2026","benchmark":{"averageDuration":"5.9 years"}}');
    expect(parseVanguard(html)).toEqual({ ytm: 5.2, duration: 5.7, asOf: '2026-11-06' });
    expect(parseVanguard('')).toBeNull();
  });
  it('BlackRock 新加坡：去标签后 "Weighted Avg YTM as of 09-Nov-2026 8.30%"', () => {
    const html = '<li><span>Weighted Avg YTM</span><span class="as-of">as of 09-Nov-2026</span><span>8.30%</span></li><li><span>Effective Duration</span> <span>as of 09-Nov-2026</span> <span>2.98</span></li>';
    expect(parseBlackrockSg(html)).toEqual({ ytm: 8.3, duration: 2.98, asOf: '2026-11-09' });
  });
  it('美国财政部 CSV：取最新一天', () => {
    const c = parseTreasuryCsv('Date,"1 Mo","1 Yr","2 Yr","5 Yr","10 Yr"\n11/09/2026,4.04,4.38,4.56,4.67,4.88\n11/06/2026,4.02,4.33,4.51,4.64,4.86\n')!;
    expect(c.asOf).toBe('2026-11-09');
    expect(c[5]).toBe(4.67);
    expect(curveAt(c, 7.5)).toBeCloseTo(4.775, 6);
    expect(parseTreasuryCsv('<html>')).toBeNull();
  });
  it('MAS 表：年、月只写在每段第一行；"-" 不算', () => {
    const html = '<table class="results-table"><thead><tr><th colspan="3">End of<Br>Period</th><th>1-Year<Br>T-Bill Yield</th><th>2-Year<Br>Bond Yield</th><th>7-Year<Br>Bond Yield</th></tr></thead><tbody>'
      + '<tr><td class="year">2026</td><td class="month">Oct</td><td class="date">30</td><td>1.80</td><td>1.85</td><td>-</td></tr>'
      + '<tr><td class="year"></td><td class="month">Nov</td><td class="date">10</td><td>1.87</td><td>1.83</td><td>-</td></tr></tbody></table>';
    expect(parseMasHtml(html)).toEqual({ asOf: '2026-11-10', 1: 1.87, 2: 1.83 });
  });
  it('中债：seriesData [[期限, 收益率]]', () => {
    expect(parseChinabond([{ worktime: '2026-11-09', seriesData: [[1, 1.2], [3, 1.3]] }])).toEqual({ asOf: '2026-11-09', 1: 1.2, 3: 1.3 });
    expect(parseChinabond({ heList: [] })).toBeNull();
  });
  it('东方财富：511990 取 LJJZ；511880 用 DWJZ 自算 7 日年化（往前 7 个日历日）', () => {
    const L = (rows: [string, string, string][]) => ({ Data: { LSJZList: rows.map(([FSRQ, DWJZ, LJJZ]) => ({ FSRQ, DWJZ, LJJZ })) } });
    expect(parseEm7d(L([['2026-11-10', '0.2683', '1.0040'], ['2026-11-09', '0.2720', '1.0080']]))).toEqual({ ytm: 1.004, duration: null, asOf: '2026-11-10' });
    const v = parseEmNav(L([['2026-11-10', '100.9535', '134'], ['2026-11-04', '100.9349', '134'], ['2026-11-03', '100.9321', '134']]))!;
    expect(v.ytm).toBeCloseTo((100.9535 / 100.9321 - 1) * (365 / 7) * 100, 3);
  });
});

describe('BOND_YIELDS 配置和近似', () => {
  it('正好 16 只，和 FUNDS 里债券类一一对应；8 只自动、8 只近似（任务写 9 / 7，逐只列出的是 8 + 8，按逐只列的做）', () => {
    const bonds = FUNDS.filter((f) => f.category === '债券').map((f) => f.code).sort();
    expect(BOND_YIELDS.map((d) => d.code).sort()).toEqual(bonds);
    expect(BOND_YIELDS.filter((d) => d.kind === 'auto')).toHaveLength(8);
    expect(BOND_YIELDS.filter((d) => d.kind === 'approx')).toHaveLength(8);
    expect(BOND_YIELDS.filter((d) => d.kind === 'approx').every((d) => d.curve && d.spread !== undefined && d.spreadNote)).toBe(true);
  });
  it('近似 = 曲线插值 + 利差；自动的兜底标"近似"并写明页面没取到', () => {
    const sbo = BOND_YIELDS.find((d) => d.code === 'SBO')!;
    expect(approxYield(sbo, { sgs: { asOf: '2026-11-10', 1: 1.87, 2: 1.83, 5: 1.92 } })).toMatchObject({ value: 3.27, kind: 'approx', asOf: '2026-11-10' });
    const agg = BOND_YIELDS.find((d) => d.code === 'AGG')!;
    const a = approxYield(agg, { ust: { asOf: '2026-11-09', 5: 4.67, 7: 4.76 } })!;
    expect(a.kind).toBe('approx');
    expect(a.label).toContain('近似');
    expect(approxYield(agg, {})).toBeNull();
  });
});
