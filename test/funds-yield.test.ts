/**
 * 基金观察第二版：「债券类：未来 1～3 年预期年化」的清单和解析（src/funds-yield.ts）。**测试会话先写（agents C154）**，研发不改断言（底线 6）。
 * 规格（Amos 2026-11-10 已定）：
 *   BOND_YIELDS 正好 16 只 = 清单里全部债券类（A35、MBH、SBO、O9P、0P00006FY6、AGG、BND、TLT、BSV、LQD、511990、511880、511010、511360、000171、217003）；
 *   kind 'auto' 的有 AGG、TLT、LQD、BND、BSV、O9P、511990、511880（规格写"9 只"但只列了 8 只，第 9 只按研发定——本文件不断言它）；
 *   A35、MBH、0P00006FY6、SBO、511010、511360、000171、217003 是 'approx'。
 *   解析函数 parseIshares / parseVanguard / parseBlackrockSg（单只基金页 → {ytm, duration, asOf}）、
 *   parseTreasuryCsv / parseMasHtml / parseChinabond（国债曲线 → 曲线对象），坏输入返回 null（不抛错）。
 *
 * 夹具（test/fixtures/funds/yield/，2026-11-10 测试会话各真实取一次，一共 8 个请求）：
 *   ishares-agg-239458.html.gz   www.ishares.com/us/products/239458（AGG）：Average Yield to Maturity 5.20%、Effective Duration 5.73 yrs，as of Nov 09, 2026
 *   vanguard-bnd.html.gz         investor.vanguard.com/investment-products/etfs/profile/bnd：yieldToMaturity "5.2"（11/06/2026）、averageDuration "5.7 years"
 *   blackrock-sg-251722-403.html www.blackrock.com/sg/en/products/251722 **取不到**：回 403 Access Denied（这里只用来测"坏输入返回 null"；正常页面的夹具没有）
 *   treasury-daily-2026.csv      home.treasury.gov 日收益率曲线 CSV（2026 全年）：最新一行 11/09/2026：1 Yr 4.38、2 Yr 4.56、5 Yr 4.67、10 Yr 4.88
 *   mas-form.html                eservices.mas.gov.sg BenchmarkPricesAndYields.aspx 的 GET（只有表单、没有数据 → 应返回 null）
 *   mas-benchmark-2026-10-11.html 同一页提交表单（Daily，2026-10～11，1 年 / 2 年 / 5 年 / 10 年）：最新一行 2026-11-10：1.87、1.83、1.92、2.12
 *   chinabond-txy-2026-11-10.json yield.chinabond.com.cn searchYc（中债国债收益率曲线(到期)，worktime 2026-11-10）：1 年 1.1775、3 年 1.2382、5 年 1.3097
 * 曲线对象的形状规格没定：这里只要求 ① 不是 null ② 有 asOf（= 最新那天）③ 里面的数字有最新那天的几个期限点（深搜，误差 0.0001）。
 * asOf 认 'YYYY-MM-DD' 或者能被 Date.parse 认的日期字符串（例如 'Nov 09, 2026'），比较的是那一天。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { FUNDS } from '../src/funds';
import { ROOT } from './helpers';

const FX = path.join(ROOT, 'test/fixtures/funds/yield');
const txt = (f: string) => (f.endsWith('.gz') ? new TextDecoder().decode(gunzipSync(readFileSync(path.join(FX, f)))) : readFileSync(path.join(FX, f), 'utf8'));

// 动态导入：src/funds-yield.ts 还没有时逐条红，不整文件崩（typecheck 照样会红）
let Y: Record<string, any> = {};
let loadErr = '';
try { Y = await import('../src/funds-yield' + ''); } catch (e) { loadErr = String((e as Error).message).split('\n')[0]; }
const fn = (name: string) => {
  if (typeof Y[name] !== 'function') throw new Error(`src/funds-yield.ts 没有导出 ${name}（${loadErr || '未导出'}）`);
  return Y[name] as (x: unknown) => any;
};

/** asOf → 'YYYY-MM-DD'（认 ISO 开头的，也认 Date.parse 能解析的写法，按本地日期取） */
function day(asOf: unknown): string | null {
  if (typeof asOf !== 'string' || !asOf) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(asOf)) return asOf.slice(0, 10);
  const t = Date.parse(asOf);
  if (!isFinite(t)) return null;
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** 对象里所有的数字（深搜） */
function numbers(x: unknown, out: number[] = []): number[] {
  if (typeof x === 'number' && isFinite(x)) out.push(x);
  else if (Array.isArray(x)) x.forEach((v) => numbers(v, out));
  else if (x && typeof x === 'object') Object.values(x).forEach((v) => numbers(v, out));
  return out;
}
const hasNum = (x: unknown, v: number, tol = 1e-4) => numbers(x).some((n) => Math.abs(n - v) <= tol);

const BONDS = ['A35', 'MBH', 'SBO', 'O9P', '0P00006FY6', 'AGG', 'BND', 'TLT', 'BSV', 'LQD', '511990', '511880', '511010', '511360', '000171', '217003'];
const AUTO8 = ['AGG', 'TLT', 'LQD', 'BND', 'BSV', 'O9P', '511990', '511880'];
const APPROX8 = ['A35', 'MBH', '0P00006FY6', 'SBO', '511010', '511360', '000171', '217003'];

/** BOND_YIELDS 可能是数组（每项带 code）或以 code 为键的对象，两种都认 */
function bondTable(): Record<string, any> {
  const b = Y.BOND_YIELDS;
  if (Array.isArray(b)) return Object.fromEntries(b.map((x: any) => [x?.code, x]));
  if (b && typeof b === 'object') return b as Record<string, any>;
  throw new Error(`src/funds-yield.ts 没有导出 BOND_YIELDS（${loadErr || '未导出'}）`);
}

describe('BOND_YIELDS：16 只债券类', () => {
  it('正好 16 只，就是清单里类别为"债券"的全部', () => {
    const t = bondTable();
    expect(Object.keys(t).sort()).toEqual([...BONDS].sort());
    expect(FUNDS.filter((f) => f.category === '债券').map((f) => f.code).sort()).toEqual([...BONDS].sort());
  });
  it('AGG、TLT、LQD、BND、BSV、O9P、511990、511880 是 auto（第 9 只 auto 由研发定，这里不断言）', () => {
    const t = bondTable();
    expect(AUTO8.map((c) => [c, t[c]?.kind])).toEqual(AUTO8.map((c) => [c, 'auto']));
  });
  it('A35、MBH、0P00006FY6、SBO、511010、511360、000171、217003 是 approx', () => {
    const t = bondTable();
    expect(APPROX8.map((c) => [c, t[c]?.kind])).toEqual(APPROX8.map((c) => [c, 'approx']));
  });
  it('kind 只有 auto / approx 两种，auto 的数量是 8 或 9', () => {
    const kinds = Object.values(bondTable()).map((x: any) => x?.kind);
    expect(kinds.every((k) => k === 'auto' || k === 'approx'), JSON.stringify(kinds)).toBe(true);
    expect([8, 9]).toContain(kinds.filter((k) => k === 'auto').length);
  });
});

describe('单只基金页的解析（实抓夹具）', () => {
  it('parseIshares：AGG 页 → ytm 5.20、duration 5.73、asOf 2026-11-09', () => {
    const r = fn('parseIshares')(txt('ishares-agg-239458.html.gz'));
    expect(r, JSON.stringify(r)).not.toBeNull();
    expect(r.ytm).toBeCloseTo(5.2, 2);
    expect(r.duration).toBeCloseTo(5.73, 2);
    expect(day(r.asOf)).toBe('2026-11-09');
  });
  it('parseVanguard：BND 页 → ytm 5.2、duration 5.7、asOf 2026-11-06（YTM 的日期）', () => {
    const r = fn('parseVanguard')(txt('vanguard-bnd.html.gz'));
    expect(r, JSON.stringify(r)).not.toBeNull();
    expect(r.ytm).toBeCloseTo(5.2, 2);
    expect(r.duration).toBeCloseTo(5.7, 2);
    expect(day(r.asOf)).toBe('2026-11-06');
  });
  it('parseBlackrockSg：实抓回的是 403 Access Denied 页 → null（不抛错）', () => {
    const f = fn('parseBlackrockSg');
    expect(() => f(txt('blackrock-sg-251722-403.html'))).not.toThrow();
    expect(f(txt('blackrock-sg-251722-403.html'))).toBeNull();
  });
});

describe('国债曲线的解析（实抓夹具）', () => {
  it('parseTreasuryCsv：最新一行 11/09/2026 → asOf 2026-11-09，含 1 年 4.38、2 年 4.56、5 年 4.67、10 年 4.88', () => {
    const r = fn('parseTreasuryCsv')(txt('treasury-daily-2026.csv'));
    expect(r, JSON.stringify(r)?.slice(0, 300)).not.toBeNull();
    expect(day(r.asOf)).toBe('2026-11-09');
    for (const v of [4.38, 4.56, 4.67, 4.88]) expect([v, hasNum(r, v)]).toEqual([v, true]);
  });
  it('parseMasHtml：提交表单后的结果页 → asOf 2026-11-10，含 2 年 1.83、5 年 1.92、10 年 2.12', () => {
    const r = fn('parseMasHtml')(txt('mas-benchmark-2026-10-11.html'));
    expect(r, JSON.stringify(r)?.slice(0, 300)).not.toBeNull();
    expect(day(r.asOf)).toBe('2026-11-10');
    for (const v of [1.83, 1.92, 2.12]) expect([v, hasNum(r, v)]).toEqual([v, true]);
  });
  it('parseMasHtml：只有表单、没有数据的那一页（直接 GET）→ null', () => {
    expect(fn('parseMasHtml')(txt('mas-form.html'))).toBeNull();
  });
  it('parseChinabond：searchYc 回包 → asOf 2026-11-10，含 1 年 1.1775、3 年 1.2382、5 年 1.3097', () => {
    const raw = txt('chinabond-txy-2026-11-10.json');
    const r = fn('parseChinabond')(JSON.parse(raw));
    expect(r, JSON.stringify(r)?.slice(0, 300)).not.toBeNull();
    expect(day(r.asOf)).toBe('2026-11-10');
    for (const v of [1.1775, 1.2382, 1.3097]) expect([v, hasNum(r, v)]).toEqual([v, true]);
  });
});

describe('坏输入一律返回 null、不抛错', () => {
  const junk: [string, unknown][] = [['空串', ''], ['null', null], ['undefined', undefined], ['空页面', '<html><body></body></html>'], ['乱码', '\u0000\u0001<<>>{{'], ['数字', 42], ['空对象', {}], ['空数组', []]];
  for (const name of ['parseIshares', 'parseVanguard', 'parseBlackrockSg', 'parseTreasuryCsv', 'parseMasHtml', 'parseChinabond']) {
    it(`${name}：${junk.map((j) => j[0]).join('、')} → null`, () => {
      const f = fn(name);
      const bad = junk.filter(([, x]) => { try { return f(x) !== null; } catch { return true; } }).map(([n]) => n);
      expect(bad).toEqual([]);
    });
  }
  it('parseChinabond：回包里 seriesData 不是数组、或是空数组 → null', () => {
    const f = fn('parseChinabond');
    expect(f([{ worktime: '2026-11-10', seriesData: 'x' }])).toBeNull();
    expect(f([{ worktime: '2026-11-10', seriesData: [] }])).toBeNull();
  });
  it('parseTreasuryCsv：只有表头 → null', () => {
    expect(fn('parseTreasuryCsv')(txt('treasury-daily-2026.csv').split('\n')[0])).toBeNull();
  });
});
