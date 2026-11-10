/**
 * 基金观察第二版测试用的"债券收益率来源"替身（不连网）：认出 6 个来源的地址，回 test/fixtures/funds/yield/ 里的实抓夹具。
 * 给 test/funds-v2-api.test.ts 和 test/funds-api.test.ts 的替身 fetch 用。认不出的地址回 null（由调用方当成 unknown 记下）。
 *   ishares.com            → ishares-agg-239458.html.gz（AGG 页；TLT、LQD 也回它——这里只看接口形状，不看数值对不对得上那只）
 *   vanguard.com           → vanguard-bnd.html.gz（BSV 也回它）
 *   blackrock.com          → 403 Access Denied（2026-11-10 实抓就是这样）
 *   treasury.gov           → treasury-daily-2026.csv
 *   mas.gov.sg             → GET 回表单页 mas-form.html，POST 回结果页 mas-benchmark-2026-10-11.html
 *   chinabond.com.cn       → chinabond-txy-2026-11-10.json
 * down：这些主机名（或其后缀）一律回 500，用来测"某来源失败时保留上次的值且 stale=true"。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { ROOT } from './helpers';

const FX = path.join(ROOT, 'test/fixtures/funds/yield');
const cache = new Map<string, string>();
const fx = (f: string) => {
  if (!cache.has(f)) cache.set(f, f.endsWith('.gz') ? new TextDecoder().decode(gunzipSync(readFileSync(path.join(FX, f)))) : readFileSync(path.join(FX, f), 'utf8'));
  return cache.get(f)!;
};

/**
 * 中债 searchYc 实测取得到曲线的那组参数（测试会话 2026-11-10 实际执行，HTTP 200、7126 字节，即夹具 chinabond-txy-2026-11-10.json）：
 *   POST https://yield.chinabond.com.cn/cbweb-mn/yc/searchYc?xyzSelect=txy&&workTimes=2026-11-10&&dxbj=0&&qxll=0,&&yqqxN=N&&yqqxK=K&&ycDefIds=2c9081e50a2f9606010a3068cae70001&&wrjxCBFlag=0&&locale=zh_CN
 *   请求头：User-Agent 浏览器 UA、Referer https://yield.chinabond.com.cn/cbweb-mn/yield_main?locale=zh_CN；没有请求体。
 *   同一组参数 workTimes 留空 → 回 []。
 */
export const CGB_OK_PARAMS: Record<string, string> = { xyzSelect: 'txy', dxbj: '0', qxll: '0,', yqqxN: 'N', yqqxK: 'K', ycDefIds: '2c9081e50a2f9606010a3068cae70001', wrjxCBFlag: '0', locale: 'zh_CN' };

export const YIELD_HOSTS = ['ishares.com', 'vanguard.com', 'blackrock.com', 'treasury.gov', 'mas.gov.sg', 'chinabond.com.cn'] as const;

/** 这个地址是不是债券收益率来源（按主机名后缀） */
export const yieldHost = (url: string): string | null => {
  let h = '';
  try { h = new URL(url).hostname; } catch { return null; }
  return YIELD_HOSTS.find((x) => h === x || h.endsWith('.' + x)) ?? null;
};

/** 替身回包；不是债券来源回 null */
export function yieldResponse(url: string, init: RequestInit | undefined, down: Set<string> = new Set()): Response | null {
  const host = yieldHost(url);
  if (!host) return null;
  if (down.has(host)) return new Response('upstream error', { status: 500 });
  const html = (s: string, status = 200) => new Response(s, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
  switch (host) {
    case 'ishares.com': return html(fx('ishares-agg-239458.html.gz'));
    case 'vanguard.com': return html(fx('vanguard-bnd.html.gz'));
    case 'blackrock.com': return html(fx('blackrock-sg-251722-403.html'), 403);
    case 'treasury.gov': return new Response(fx('treasury-daily-2026.csv'), { status: 200, headers: { 'content-type': 'text/csv' } });
    case 'mas.gov.sg': return html(String(init?.method ?? 'GET').toUpperCase() === 'POST' ? fx('mas-benchmark-2026-10-11.html') : fx('mas-form.html'));
    case 'chinabond.com.cn': {
      // 照实抓：只有下面这组参数（CGB_OK_PARAMS）、POST、workTimes 写了日期才回曲线；别的参数组合回 []（2026-11-10 实测：workTimes 留空回 []；研发用 dsmSelect=1&locale=cn_ZH 那组也回 []）
      const q = new URL(url).searchParams;
      const ok = String(init?.method ?? 'GET').toUpperCase() === 'POST' && /^\d{4}-\d{2}-\d{2}$/.test(q.get('workTimes') ?? '') && Object.entries(CGB_OK_PARAMS).every(([k, v]) => q.get(k) === v);
      return new Response(ok ? fx('chinabond-txy-2026-11-10.json') : '[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }
  }
  return null;
}
