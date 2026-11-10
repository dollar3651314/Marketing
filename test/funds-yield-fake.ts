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
    case 'chinabond.com.cn': return new Response(fx('chinabond-txy-2026-11-10.json'), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return null;
}
