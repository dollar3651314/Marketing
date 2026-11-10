/**
 * 公共工具「基金观察」的纯函数测试（src/funds.ts，无网络）。**测试会话先写（agents C154 试行）**：写的时候实现还没有，所以是红的；
 * 研发照着实现到全绿，**不改这里的断言**（底线 6）。接口测试在 test/funds-api.test.ts，页面检查在 scripts/e2e-funds.mjs。
 *
 * 标准答案从哪来（夹具都在 test/fixtures/funds/，来源写在各自的 note 里）：
 *   reference.json      参考脚本 fetch2.py 2026-11-10 实抓 45 只的结果（dash2/data.json）里摘 6 只原样搬进来：
 *                       ES3（新加坡宽基）、BYJ（单日坏报价那只）、XWR（10 月新上市、首日跳空 30%）、UPD（1 月上市，ytd / y1 不够）、
 *                       511880（Yahoo 只回 1 条、回退东方财富）、000171（东方财富场外基金）。
 *                       series = 清洗后的 [日期, 复权价]；expect = 同一次算出的各期收益和回撤（百分数）。
 *   yahoo-*.SI.json     同一天抓的 Yahoo v8 chart 原始回包（range=1y），只删掉用不到的 high/low/open/volume 缩小体积，其它一个字没改。
 * 允许误差 0.01（百分点），和 Amos 看过的原型一样只显示两位小数。
 *
 * 规则原文（主会话转述的研发接口，2026-11-10）：
 *   cleanPoints ① 前两点 adj 相差 >20% 就去掉第一点（循环）② 某点与前后两点 adj 都相差 >8% 且在同一侧就去掉 ③ 只留最后一点往前 375 天以内
 *   periodReturn d1 = 最后一点对前一点；w1/m1/y1 基准 = 日期 ≤ 最后日期减 7/30/365 天的最后一个点；ytd 基准 = 日期 ≤ 上一年 12/31 的最后一个点；找不到返回 null
 *   maxDrawdown 从基准点到最后一点这段里峰值到之后谷值的最大跌幅（≤0，没跌是 0）；'all' 用全部点；找不到基准返回 null
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanPoints, FUNDS, maxDrawdown, parseEastmoney, parseYahoo, periodReturn, summarize, type Point } from '../src/funds';
import { ROOT } from './helpers';

const FIX = path.join(ROOT, 'test/fixtures/funds');
const readFix = (f: string) => JSON.parse(readFileSync(path.join(FIX, f), 'utf8'));
type Expect = Record<'d1' | 'w1' | 'm1' | 'ytd' | 'y1' | 'dd_w1' | 'dd_m1' | 'dd_ytd' | 'dd_y1' | 'dd_all' | 'ret_all', number | null> & { currency: string; last: number; date: string; first: string; points: number };
type RefFund = { symbol: string; source: string; expect: Expect; series: [string, number][] };
const REF: Record<string, RefFund> = readFix('reference.json').funds;
/** 参考 series → Point（close 取 adj，参考数据里只存了复权价） */
const pts = (code: string): Point[] => REF[code].series.map(([d, a]) => [d, a, a] as Point);
const near = (got: number | null | undefined, want: number | null, tol = 0.01) => {
  if (want === null) expect(got).toBeNull();
  else { expect(typeof got).toBe('number'); expect(Math.abs((got as number) - want)).toBeLessThanOrEqual(tol); }
};
/** 合成数据：日期从 start 起每个工作日一个点（周六日跳过），adj 依次取 vals */
const days = (start: string, n: number): string[] => {
  const out: string[] = [];
  for (let t = Date.parse(start + 'T00:00:00Z'); out.length < n; t += 86400_000) { const w = new Date(t).getUTCDay(); if (w !== 0 && w !== 6) out.push(new Date(t).toISOString().slice(0, 10)); }
  return out;
};
const mk = (rows: [string, number][]): Point[] => rows.map(([d, a]) => [d, a, a] as Point);
const zero = (v: number | null) => { expect(typeof v).toBe('number'); expect(Math.abs(v as number)).toBeLessThan(1e-9); expect(v as number).toBeLessThanOrEqual(0); };

// ======================================================================
describe('1. 清单 FUNDS：45 只，和参考脚本 fetch2.py 的 L 一字不差、顺序一样', () => {
  // [市场, 类别, 显示名, Yahoo 代码 / 东方财富基金代码, 来源, 标签]，照抄 fetch2.py 的 L（y → yahoo，em → eastmoney）
  const L: [string, string, string, string, string, string][] = [
    ['新加坡', '宽基', 'SPDR 海峡时报指数 ETF', 'ES3.SI', 'yahoo', ''],
    ['新加坡', '宽基', 'Amova-StraitsTrading 亚洲除日本 REIT ETF', 'CFA.SI', 'yahoo', ''],
    ['新加坡', '宽基', 'Lion-OCBC 恒生科技 ETF', 'HST.SI', 'yahoo', ''],
    ['新加坡', '宽基', 'Xtrackers 标普500 UCITS ETF', 'XUS.SI', 'yahoo', '10 月新上市'],
    ['新加坡', '宽基', 'Xtrackers MSCI World UCITS ETF', 'XWR.SI', 'yahoo', '10 月新上市'],
    ['新加坡', '债券', 'ABF 新加坡债券指数基金', 'A35.SI', 'yahoo', ''],
    ['新加坡', '债券', 'Amova 新元投资级公司债 ETF', 'MBH.SI', 'yahoo', ''],
    ['新加坡', '债券', 'Lion 短久期债券主动 ETF', 'SBO.SI', 'yahoo', ''],
    ['新加坡', '债券', 'iShares 亚洲美元高收益债 ETF', 'O9P.SI', 'yahoo', '美元'],
    ['新加坡', '债券', 'Amova 亚洲收益债券基金（原 Shenton Income）', '0P00006FY6.SI', 'yahoo', '场外 · 推断对应'],
    ['新加坡', '红利', 'Lion-Phillip S-REIT ETF', 'CLR.SI', 'yahoo', ''],
    ['新加坡', '红利', 'CSOP iEdge S-REIT 领袖 ETF', 'SRT.SI', 'yahoo', ''],
    ['新加坡', '红利', 'Phillip SGX 亚太红利 REIT ETF', 'BYJ.SI', 'yahoo', '替代 #13'],
    ['新加坡', '红利', 'UOBAM 平安富时东盟红利 ETF', 'UPD.SI', 'yahoo', '1 月新上市'],
    ['美国', '宽基', 'Vanguard 标普500', 'VOO', 'yahoo', ''],
    ['美国', '宽基', 'iShares 核心标普500', 'IVV', 'yahoo', ''],
    ['美国', '宽基', 'SPDR 标普500', 'SPY', 'yahoo', ''],
    ['美国', '宽基', 'Vanguard Morningstar 美国全市场', 'VTI', 'yahoo', '7/29 改名'],
    ['美国', '宽基', 'Invesco 纳斯达克100', 'QQQ', 'yahoo', ''],
    ['美国', '债券', 'iShares 美国综合债', 'AGG', 'yahoo', ''],
    ['美国', '债券', 'Vanguard 全市场债', 'BND', 'yahoo', ''],
    ['美国', '债券', 'iShares 20 年以上美债', 'TLT', 'yahoo', ''],
    ['美国', '债券', 'Vanguard 短期债', 'BSV', 'yahoo', ''],
    ['美国', '债券', 'iShares 投资级公司债', 'LQD', 'yahoo', ''],
    ['美国', '红利', 'Vanguard 股息增值', 'VIG', 'yahoo', ''],
    ['美国', '红利', 'Schwab 美国股息', 'SCHD', 'yahoo', ''],
    ['美国', '红利', 'Vanguard 高股息', 'VYM', 'yahoo', ''],
    ['美国', '红利', 'iShares 核心股息增长', 'DGRO', 'yahoo', ''],
    ['美国', '红利', 'SPDR 标普股息', 'SDY', 'yahoo', ''],
    ['中国', '宽基', '华泰柏瑞沪深300ETF', '510300.SS', 'yahoo', ''],
    ['中国', '宽基', '易方达沪深300ETF', '510310.SS', 'yahoo', ''],
    ['中国', '宽基', '华夏上证50ETF', '510050.SS', 'yahoo', ''],
    ['中国', '宽基', '南方中证500ETF', '510500.SS', 'yahoo', ''],
    ['中国', '宽基', '华夏科创50ETF', '588000.SS', 'yahoo', ''],
    ['中国', '债券', '华宝添益ETF', '511990.SS', 'yahoo', '货币'],
    ['中国', '债券', '银华日利ETF', '511880.SS', 'yahoo', '货币'],
    ['中国', '债券', '国泰上证5年期国债ETF', '511010.SS', 'yahoo', '原写的 511010'],
    ['中国', '债券', '海富通短融ETF', '511360.SS', 'yahoo', ''],
    ['中国', '债券', '易方达裕丰回报债券A', '000171', 'eastmoney', '场外 · 含少量股票'],
    ['中国', '债券', '招商安泰债券A', '217003', 'eastmoney', '场外'],
    ['中国', '红利', '华泰柏瑞红利ETF', '510880.SS', 'yahoo', ''],
    ['中国', '红利', '景顺长城红利低波100ETF', '515100.SS', 'yahoo', ''],
    ['中国', '红利', '招商中证红利ETF', '515080.SS', 'yahoo', ''],
    ['中国', '红利', '易方达中证红利ETF', '515180.SS', 'yahoo', ''],
    ['中国', '红利', '华宝标普A股红利ETF', '562060.SS', 'yahoo', ''],
  ];

  it('正好 45 只；新加坡 14、美国 15、中国 16', () => {
    expect(FUNDS).toHaveLength(45);
    const n = (m: string) => FUNDS.filter((f) => f.market === m).length;
    expect([n('新加坡'), n('美国'), n('中国')]).toEqual([14, 15, 16]);
  });

  it('每一只的市场、类别、名字、code、symbol、source、tag 和顺序都和 L 一样（code = 去掉 .SI / .SS）', () => {
    expect(FUNDS.map((f) => [f.market, f.category, f.name, f.code, f.symbol, f.source, f.tag])).toEqual(
      L.map(([m, c, n, sym, src, tag]) => [m, c, n, sym.replace(/\.(SI|SS)$/, ''), sym, src, tag]),
    );
  });

  it('code 不重复；只有 000171、217003 是 eastmoney（511880 在清单里仍是 yahoo，取数时才回退）', () => {
    expect(new Set(FUNDS.map((f) => f.code)).size).toBe(45);
    expect(FUNDS.filter((f) => f.source === 'eastmoney').map((f) => f.code)).toEqual(['000171', '217003']);
    expect(FUNDS.find((f) => f.code === '511880')).toMatchObject({ source: 'yahoo', symbol: '511880.SS' });
  });
});

// ======================================================================
describe('2. parseYahoo：Yahoo v8 chart 回包 → {currency, points}', () => {
  it('XWR 实抓回包：币种 SGD，21 个点，日期按 timestamp + gmtoffset（+8 小时）换算，第一天 2026-10-12、最后一天 2026-11-10（盘中时间戳也算当天）', () => {
    const r = parseYahoo(readFix('yahoo-XWR.SI.json'));
    expect(r.currency).toBe('SGD');
    expect(r.points).toHaveLength(21);
    expect(r.points[0][0]).toBe('2026-10-12');
    expect(r.points.at(-1)![0]).toBe('2026-11-10');
    for (const p of r.points) expect(p[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const ds = r.points.map((p) => p[0]);
    expect([...ds].sort()).toEqual(ds);
  });

  it('adj 取 adjclose、close 取 quote.close（两者不同时不能混）', () => {
    const t = Date.UTC(2026, 10, 9, 1) / 1000;
    const r = parseYahoo({ chart: { result: [{ meta: { currency: 'USD', gmtoffset: 0 }, timestamp: [t, t + 86400], indicators: { quote: [{ close: [10, 11] }], adjclose: [{ adjclose: [9.5, 10.5] }] } }] } });
    expect(r.currency).toBe('USD');
    expect(r.points).toEqual([['2026-11-09', 10, 9.5], ['2026-11-10', 11, 10.5]]);
  });

  it('gmtoffset 决定日期：UTC 2026-11-09 20:00 在 +8 时区是 11-10、在 0 时区是 11-09、在 −5 时区是 11-09', () => {
    const t = Date.UTC(2026, 10, 9, 20) / 1000;
    const one = (off: number) => parseYahoo({ chart: { result: [{ meta: { currency: 'X', gmtoffset: off }, timestamp: [t], indicators: { quote: [{ close: [1] }], adjclose: [{ adjclose: [1] }] } }] } }).points[0][0];
    expect([one(28800), one(0), one(-18000)]).toEqual(['2026-11-10', '2026-11-09', '2026-11-09']);
  });

  it('close 或 adjclose 是 null 的那天丢掉（Yahoo 停牌日会给 null）', () => {
    const t = Date.UTC(2026, 10, 2, 1) / 1000;
    const r = parseYahoo({ chart: { result: [{ meta: { currency: 'SGD', gmtoffset: 28800 }, timestamp: [t, t + 86400, t + 2 * 86400, t + 3 * 86400], indicators: { quote: [{ close: [1, null, 1.2, 1.3] }], adjclose: [{ adjclose: [1, 1.1, null, 1.3] }] } }] } });
    expect(r.points.map((p) => p[0])).toEqual(['2026-11-02', '2026-11-05']);
  });

  it('查不到的代码（Yahoo 回 result: null，实抓 CFAU.SI 就是这样）不能当成有数据：要么抛错，要么 points 为空', () => {
    const bad = { chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } } };
    let r: { points: Point[] } | null = null;
    try { r = parseYahoo(bad); } catch { r = null; }
    expect(r === null || r.points.length === 0).toBe(true);
  });
});

// ======================================================================
describe('3. parseEastmoney：东方财富 lsjz 多页回包合并（close = DWJZ、adj = LJJZ，去重、升序）', () => {
  // 用 000171 参考 series 造回包：东方财富按日期从新到旧、每页 100 条、字段是字符串；DWJZ 按参考的最新价 / 最新复权价比例倒推（参考数据只存了 LJJZ）
  const ref = REF['000171'];
  const ratio = ref.expect.last / ref.series.at(-1)![1];
  const rows = [...ref.series].reverse().map(([d, a]) => ({ FSRQ: d, DWJZ: (a * ratio).toFixed(4), LJJZ: String(a), SDATE: null, JZZZL: '0.00' }));
  const page = (list: object[], i: number) => ({ Data: { LSJZList: list }, ErrCode: 0, ErrMsg: null, TotalCount: rows.length, PageSize: 100, PageIndex: i });
  const pages = [page(rows.slice(0, 100), 1), page(rows.slice(99, 200), 2) /* 和第 1 页重 1 条 */, page(rows.slice(200), 3), page([], 4)];

  it('三页合并成 249 个点，按日期升序，没有重复日期', () => {
    const p = parseEastmoney(pages);
    expect(p).toHaveLength(ref.series.length);
    expect(p.map((x) => x[0])).toEqual(ref.series.map((x) => x[0]));
  });

  it('close = DWJZ、adj = LJJZ（转成数字）；最新一天 2026-11-09，单位净值 1.9474', () => {
    const p = parseEastmoney(pages);
    expect(typeof p[0][1]).toBe('number');
    expect(typeof p[0][2]).toBe('number');
    expect(p.at(-1)![0]).toBe('2026-11-09');
    near(p.at(-1)![1], 1.9474, 0.0001);
    near(p.at(-1)![2], 2.4144, 0.0001);
    p.forEach((x, i) => near(x[2], ref.series[i][1], 1e-9));
  });

  it('页的顺序打乱也一样（并发取页时回来的先后不定）', () => {
    expect(parseEastmoney([pages[2], pages[0], pages[3], pages[1]])).toEqual(parseEastmoney(pages));
  });
});

// ======================================================================
describe('4. cleanPoints：首日异常、单日坏报价、只留 375 天', () => {
  it('① XWR 实抓：上市首日 161.44 → 次日 209.00（差 29.5%）去掉第一点，剩 20 点从 2026-10-13 开始，和参考 series 一样', () => {
    const c = cleanPoints(parseYahoo(readFix('yahoo-XWR.SI.json')).points);
    expect(c).toHaveLength(20);
    expect(c[0][0]).toBe('2026-10-13');
    expect(c.map((p) => p[0])).toEqual(REF.XWR.series.map((p) => p[0]));
    c.forEach((p, i) => near(p[2], REF.XWR.series[i][1], 1e-5));
  });

  it('① XUS 实抓：首日 15.16 → 次日 19.67（差 29.7%）同样去掉，从 2026-10-13 开始', () => {
    const c = cleanPoints(parseYahoo(readFix('yahoo-XUS.SI.json')).points);
    expect(c).toHaveLength(20);
    expect(c[0][0]).toBe('2026-10-13');
  });

  it('① 是循环：连续两次 >20% 跳空，前两点都去掉', () => {
    const d = days('2026-10-01', 6);
    const c = cleanPoints(mk([[d[0], 10], [d[1], 13.5], [d[2], 18], [d[3], 18.1], [d[4], 18.2], [d[5], 18.3]]));
    expect(c.map((p) => p[0])).toEqual(d.slice(2));
  });

  it('① 差 19%（不到 20%）不动', () => {
    const d = days('2026-10-01', 4);
    expect(cleanPoints(mk([[d[0], 10], [d[1], 11.9], [d[2], 12], [d[3], 12.1]]))).toHaveLength(4);
  });

  it('② BYJ：2026-07-15 那天 1.009（前一天 1.121、后一天 1.126，比两边都低 10% 以上）去掉；把它塞回参考 series 再清洗，结果和参考 series 一样', () => {
    const ref = pts('BYJ');
    const i = ref.findIndex((p) => p[0] > '2026-07-15');
    const withBad = [...ref.slice(0, i), ['2026-07-15', 1.0089999437332153, 1.0089999437332153] as Point, ...ref.slice(i)];
    expect(withBad).toHaveLength(257);
    const c = cleanPoints(withBad);
    expect(c.map((p) => p[0])).toEqual(ref.map((p) => p[0]));
  });

  it('② BYJ 实抓回包（range=1y）清洗后没有 07-15，07-14、07-16 都在', () => {
    const raw = parseYahoo(readFix('yahoo-BYJ.SI.json')).points;
    expect(raw.some((p) => p[0] === '2026-07-15')).toBe(true);
    const ds = cleanPoints(raw).map((p) => p[0]);
    expect(ds).not.toContain('2026-07-15');
    expect(ds).toContain('2026-07-14');
    expect(ds).toContain('2026-07-16');
  });

  it('② 单日冲高同样去掉（比两边都高 >8%）', () => {
    const d = days('2026-10-01', 5);
    expect(cleanPoints(mk([[d[0], 1], [d[1], 1], [d[2], 1.1], [d[3], 1], [d[4], 1]])).map((p) => p[0])).toEqual([d[0], d[1], d[3], d[4]]);
  });

  it('② 不在同一侧不去：台阶式下跌（跌 10% 后一直在低位）、连续两天各涨 10%', () => {
    const d = days('2026-10-01', 5);
    expect(cleanPoints(mk([[d[0], 1], [d[1], 1], [d[2], 0.9], [d[3], 0.9], [d[4], 0.9]]))).toHaveLength(5);
    expect(cleanPoints(mk([[d[0], 1], [d[1], 1], [d[2], 1.1], [d[3], 1.21], [d[4], 1.21]]))).toHaveLength(5);
  });

  it('② 只偏离 8% 以内不去（7.9%）', () => {
    const d = days('2026-10-01', 5);
    expect(cleanPoints(mk([[d[0], 1], [d[1], 1], [d[2], 0.921], [d[3], 1], [d[4], 1]]))).toHaveLength(5);
  });

  it('③ 只留最后一点往前 375 天以内：最后 2026-11-10 → 2025-10-31 留、2025-10-30 去（参考 ES3 也是从 2025-10-31 开始）', () => {
    const d = days('2025-01-01', 600).filter((x) => x <= '2026-11-10');
    const c = cleanPoints(mk(d.map((x, i) => [x, 100 + i * 0.01])));
    expect(c[0][0]).toBe('2025-10-31');
    expect(c.at(-1)![0]).toBe('2026-11-10');
    expect(c.length).toBe(d.filter((x) => x >= '2025-10-31').length);
  });

  it('参考 6 只已经清洗过，再洗一遍点数不变（和参考的 points 一样）', () => {
    for (const code of Object.keys(REF)) expect([code, cleanPoints(pts(code)).length]).toEqual([code, REF[code].expect.points]);
  });
});

// ======================================================================
describe('5. 各期收益和最大回撤：和参考脚本 2026-11-10 实算的一样（误差 ≤ 0.01）', () => {
  const P = ['d1', 'w1', 'm1', 'ytd', 'y1'] as const;
  const D = ['w1', 'm1', 'ytd', 'y1'] as const;
  for (const code of ['ES3', 'BYJ', 'XWR', 'UPD', '511880', '000171']) {
    it(`${code}：d1 / w1 / m1 / ytd / y1 和 dd_w1 / dd_m1 / dd_ytd / dd_y1 / dd_all`, () => {
      const p = cleanPoints(pts(code));
      const e = REF[code].expect;
      for (const k of P) near(periodReturn(p, k), e[k]);
      for (const k of D) near(maxDrawdown(p, k), e[`dd_${k}`]);
      near(maxDrawdown(p, 'all'), e.dd_all);
    });
  }

  it('参考里能对上的几个具体数（防夹具搬错）：ES3 近 1 年 +21.10%、回撤 −10.87%；BYJ 近 1 周回撤 0；XWR 上市以来回撤 −5.93%', () => {
    near(periodReturn(cleanPoints(pts('ES3')), 'y1'), 21.101);
    near(maxDrawdown(cleanPoints(pts('ES3')), 'y1'), -10.873);
    zero(maxDrawdown(cleanPoints(pts('BYJ')), 'w1'));
    near(maxDrawdown(cleanPoints(pts('XWR')), 'all'), -5.929);
  });
});

// ======================================================================
describe('6. 边界：基准怎么找、历史不够、没跌、ytd 跨年', () => {
  it('w1 基准 = 日期 ≤ 最后日期减 7 天的最后一个点：最后 11-10，11-03 有就用 11-03（含当天）', () => {
    const p = mk([['2026-10-30', 90], ['2026-11-02', 100], ['2026-11-03', 110], ['2026-11-06', 120], ['2026-11-10', 121]]);
    near(periodReturn(p, 'w1'), 10);
  });

  it('w1：11-03 没有交易就往前找 11-02', () => {
    const p = mk([['2026-10-30', 90], ['2026-11-02', 100], ['2026-11-06', 120], ['2026-11-10', 121]]);
    near(periodReturn(p, 'w1'), 21);
  });

  it('d1 = 最后一点对前一点（不管隔了几天）', () => {
    near(periodReturn(mk([['2026-11-06', 100], ['2026-11-10', 103]]), 'd1'), 3);
  });

  it('m1、y1 的基准同理（30 天、365 天）', () => {
    const p = mk([['2025-11-10', 50], ['2025-11-11', 60], ['2026-10-11', 80], ['2026-10-12', 90], ['2026-11-10', 100]]);
    near(periodReturn(p, 'm1'), 25); // ≤ 10-11 的最后一点是 10-11（80）
    near(periodReturn(p, 'y1'), 100); // ≤ 2025-11-10 的最后一点是它本身（50）
  });

  it('历史不够返回 null：只有一个点时 d1 也是 null；最早一点晚于基准日时 w1/m1/ytd/y1 和对应回撤都是 null', () => {
    const one = mk([['2026-11-10', 1]]);
    for (const k of ['d1', 'w1', 'm1', 'ytd', 'y1'] as const) expect(periodReturn(one, k)).toBeNull();
    const p = mk(days('2026-11-04', 5).map((d, i) => [d, 10 + i]));
    expect(p[0][0]).toBe('2026-11-04');
    for (const k of ['w1', 'm1', 'ytd', 'y1'] as const) { expect(periodReturn(p, k)).toBeNull(); expect(maxDrawdown(p, k)).toBeNull(); }
    expect(maxDrawdown(p, 'all')).not.toBeNull();
  });

  it('参考实例：XWR（10/13 上市）m1、ytd、y1 是 null，w1 有；UPD（1/29 上市）ytd、y1 是 null，m1 有', () => {
    const x = cleanPoints(pts('XWR'));
    expect([periodReturn(x, 'm1'), periodReturn(x, 'ytd'), periodReturn(x, 'y1'), maxDrawdown(x, 'm1')]).toEqual([null, null, null, null]);
    expect(periodReturn(x, 'w1')).not.toBeNull();
    const u = cleanPoints(pts('UPD'));
    expect([periodReturn(u, 'ytd'), periodReturn(u, 'y1'), maxDrawdown(u, 'ytd'), maxDrawdown(u, 'y1')]).toEqual([null, null, null, null]);
    expect(periodReturn(u, 'm1')).not.toBeNull();
  });

  it('没跌回撤是 0（不是 null、不是负数）：一路涨的合成数据，和参考 511880（货币 ETF）各期回撤', () => {
    const p = mk(days('2025-10-01', 300).map((d, i) => [d, 100 + i]));
    for (const k of ['w1', 'm1', 'ytd', 'y1', 'all'] as const) zero(maxDrawdown(p, k));
    const m = cleanPoints(pts('511880'));
    for (const k of ['w1', 'm1', 'ytd', 'y1', 'all'] as const) zero(maxDrawdown(m, k));
  });

  it('回撤是"峰值到之后的谷值"：先低后高不算回撤；多段取最大的', () => {
    const d = days('2026-10-01', 5);
    near(maxDrawdown(mk([[d[0], 50], [d[1], 100], [d[2], 90], [d[3], 95], [d[4], 99]]), 'all'), -10);
    near(maxDrawdown(mk([[d[0], 100], [d[1], 120], [d[2], 84], [d[3], 130], [d[4], 117]]), 'all'), -30);
  });

  it('回撤只看基准点以后：基准之前的大跌不算进 dd_w1，算进 dd_all', () => {
    const p = mk([['2026-10-01', 200], ['2026-10-02', 100], ['2026-11-03', 100], ['2026-11-05', 100], ['2026-11-10', 100]]);
    zero(maxDrawdown(p, 'w1'));
    near(maxDrawdown(p, 'all'), -50);
  });

  it('ytd 跨年：基准是 2025-12-31 那一点；回撤从基准点算起', () => {
    const p = mk([['2025-12-30', 100], ['2025-12-31', 110], ['2026-01-02', 121], ['2026-01-05', 115.5]]);
    near(periodReturn(p, 'ytd'), 5);
    near(maxDrawdown(p, 'ytd'), (115.5 / 121 - 1) * 100);
  });

  it('ytd 跨年：12/31 休市就用 12/31 之前最后一点（12/30）', () => {
    const p = mk([['2025-12-29', 90], ['2025-12-30', 100], ['2026-01-02', 121], ['2026-01-05', 115.5]]);
    near(periodReturn(p, 'ytd'), 15.5);
  });

  it('ytd：上一年没有任何点（今年才上市）返回 null；年底最后一天的 ytd 用的是上一年的 12/31', () => {
    expect(periodReturn(mk([['2026-01-05', 1], ['2026-03-02', 2]]), 'ytd')).toBeNull();
    near(periodReturn(mk([['2025-12-31', 100], ['2026-12-30', 140], ['2026-12-31', 150]]), 'ytd'), 50);
  });
});

// ======================================================================
describe('7. summarize：快照字段', () => {
  it('ES3：各字段齐全；last / date 是最后一点的 close / 日期；first 是第一点日期；series = [日期, adj]；数值和参考一致', () => {
    const def = FUNDS.find((f) => f.code === 'ES3')!;
    const p = cleanPoints(pts('ES3')).map((x) => [x[0], Math.round(x[2] * 0.97 * 1e6) / 1e6, x[2]] as Point); // close 故意和 adj 不同
    const s = summarize(def, 'SGD', p);
    for (const k of ['last', 'date', 'd1', 'w1', 'm1', 'ytd', 'y1', 'dd_w1', 'dd_m1', 'dd_ytd', 'dd_y1', 'ret_all', 'dd_all', 'first', 'series']) expect(s).toHaveProperty(k);
    expect(s.last).toBe(p.at(-1)![1]);
    expect(s.date).toBe('2026-11-10');
    expect(s.first).toBe('2025-10-31');
    expect(s.series).toEqual(p.map((x) => [x[0], x[2]]));
    const e = REF.ES3.expect;
    for (const k of ['d1', 'w1', 'm1', 'ytd', 'y1', 'dd_w1', 'dd_m1', 'dd_ytd', 'dd_y1', 'dd_all', 'ret_all'] as const) near(s[k], e[k]);
  });

  it('XWR：历史不够的格子是 null，ret_all / dd_all 用上市以来（−2.91% / −5.93%）', () => {
    const def = FUNDS.find((f) => f.code === 'XWR')!;
    const s = summarize(def, 'SGD', cleanPoints(pts('XWR')));
    expect([s.m1, s.ytd, s.y1, s.dd_m1, s.dd_ytd, s.dd_y1]).toEqual([null, null, null, null, null, null]);
    near(s.ret_all, -2.914);
    near(s.dd_all, -5.929);
    expect(s.first).toBe('2026-10-13');
  });
});
