/**
 * 工作平台网页 App（PWA）第一版的验收测试（接口层；Amos 2026-11-12「都按建议」）。
 * 测试会话先写（agents C154）：写的时候功能还没做，所以"新功能"几组现在是红的；研发写代码到全绿，不改这里的断言（底线 6）。
 * "不能变"的一组（登录 12 小时、密码框 autocomplete、无定时任务）在改动前的代码上就是绿的，之后必须一直绿。
 * 浏览器里才看得出来的（SW 注册、不缓存 /api、离线提示页、standalone 的「刷新」按钮）在 scripts/e2e-pwa.mjs。
 *
 * 只在本地跑：直接调 handle()，D1 是 Miniflare 的本地 SQLite；不连外网。
 *
 * 约定（研发要改名就同一个 PR 改这里并在 PR 描述写明）：
 *   GET /manifest.webmanifest   不要登录；content-type 含 manifest+json；JSON 含
 *       id "/"、start_url "/"、scope "/"、display "standalone"、name "工作平台"、short_name "工作台"、theme_color、background_color、
 *       icons：至少一个 192x192 PNG、一个 512x512 PNG、一个 purpose 含 maskable 的 512x512；每个 sizes 只写一个尺寸
 *   每个图标地址（manifest 里的、apple-touch-icon、favicon）GET 不要登录：200、image/png（favicon 可以是 image/*）、PNG 头里的宽高和声明一致
 *   GET /sw.js                  不要登录；200、content-type 含 javascript、cache-control 含 no-cache
 *   页面（/）<head>：<link rel="manifest" href="/manifest.webmanifest">、<link rel="apple-touch-icon" href=…>（180x180 PNG）、
 *       <meta name="theme-color">、<meta name="apple-mobile-web-app-capable" content="yes">、<meta name="apple-mobile-web-app-title" content="工作台">；
 *       <meta name="apple-mobile-web-app-status-bar-style" content="black">（产品复核 11/12）；<title> 不长于 6 个字符；favicon = <link rel="icon" href=…>，没写就是 /favicon.ico
 *   以上地址都由 Worker 的 handle() 回（和 /api/extension.zip 一样内嵌，不走 wrangler [assets]），所以这里直接调 handle() 就能验。
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import { ROOT, T0 } from './helpers';

const PASS = 'ci_only_copilot_password_01';
const HOST = 'https://copilot.example.test';
const MIG = path.join(ROOT, 'migrations');
const stmtsOf = (files: string[]) => files.map((f) => readFileSync(path.join(MIG, f), 'utf8').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n'))
  .join(';\n').split(';').map((s) => s.trim()).filter(Boolean);

let db: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: path.join(ROOT, 'test/wrangler.test.toml'), persist: false, remoteBindings: false, envFiles: [] });
  db = proxy.env.DB;
  dispose = proxy.dispose;
  await db.batch(stmtsOf(readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort()).map((s) => db.prepare(s)));
});
afterAll(async () => dispose());
beforeEach(async () => { await db.batch(['auth_fail', 'auth_lock'].map((t) => db.prepare(`DELETE FROM ${t}`))); });

const env = (over: Partial<Env> = {}): Env => ({ DB: db, ENVIRONMENT: 'test', COPILOT_PASSWORD: PASS, ...over });
/** 不带 cookie 的 GET（"不要登录"） */
const get = (p: string) => handle(new Request(new URL(p, HOST).toString(), { headers: { 'cf-connecting-ip': '203.0.113.9' } }), env(), T0);

/** PNG 头：签名 8 字节 + IHDR，宽在第 16～19 字节、高在第 20～23 字节 */
function pngSize(b: Uint8Array): { w: number; h: number } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || !sig.every((x, i) => b[i] === x)) return null;
  if (String.fromCharCode(b[12], b[13], b[14], b[15]) !== 'IHDR') return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { w: dv.getUint32(16), h: dv.getUint32(20) };
}
/** 取一个图标：状态、类型、PNG 宽高 */
async function icon(src: string) {
  const r = await get(src);
  const buf = new Uint8Array(await r.arrayBuffer());
  return { src, status: r.status, type: r.headers.get('content-type') ?? '', size: pngSize(buf) };
}
/** <head> 里的 <link> / <meta>，属性不分先后 */
function tags(html: string, name: 'link' | 'meta'): Record<string, string>[] {
  const head = (/<head[\s>][\s\S]*?<\/head>/i.exec(html) ?? [''])[0];
  return [...head.matchAll(new RegExp(`<${name}\\b([^>]*)>`, 'gi'))].map((m) => {
    const a: Record<string, string> = {};
    for (const x of m[1].matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) a[x[1].toLowerCase()] = x[3] ?? x[4] ?? x[5] ?? '';
    return a;
  });
}
const rels = (a: Record<string, string>) => (a.rel ?? '').toLowerCase().split(/\s+/);

interface Icon { src: string; sizes?: string; type?: string; purpose?: string }
async function manifest(): Promise<{ r: Response; m: Record<string, unknown> & { icons?: Icon[] } }> {
  const r = await get('/manifest.webmanifest');
  let m: Record<string, unknown> = {};
  try { m = JSON.parse(await r.text()); } catch { /* 下面断言会报 */ }
  return { r, m };
}

// ======================================================================
describe('1. /manifest.webmanifest', () => {
  it('不要登录：200，content-type 含 manifest+json', async () => {
    const { r } = await manifest();
    expect([r.status, r.headers.get('content-type') ?? '']).toEqual([200, expect.stringContaining('manifest+json')]);
  });
  it('id、start_url、scope 都是 "/"，display standalone，name 工作平台，short_name 工作台，theme_color、background_color 有值', async () => {
    const { m } = await manifest();
    expect({ id: m.id, start_url: m.start_url, scope: m.scope, display: m.display, name: m.name, short_name: m.short_name })
      .toEqual({ id: '/', start_url: '/', scope: '/', display: 'standalone', name: '工作平台', short_name: '工作台' });
    expect(typeof m.theme_color === 'string' && /^#[0-9a-f]{3,8}$/i.test(m.theme_color as string), `theme_color ${m.theme_color}`).toBe(true);
    expect(typeof m.background_color === 'string' && /^#[0-9a-f]{3,8}$/i.test(m.background_color as string), `background_color ${m.background_color}`).toBe(true);
  });
  it('icons 至少有 192 和 512 的 PNG，还有一个 purpose 含 maskable 的 512', async () => {
    const icons = (await manifest()).m.icons ?? [];
    const png = (x: Icon) => (x.type ?? 'image/png') === 'image/png' && /\.png(\?|$)/i.test(x.src);
    const has = (s: string, maskable = false) => icons.some((x) => png(x) && (x.sizes ?? '').split(/\s+/).includes(s) && (!maskable || (x.purpose ?? '').split(/\s+/).includes('maskable')));
    expect({ p192: has('192x192'), p512: has('512x512'), maskable512: has('512x512', true) }).toEqual({ p192: true, p512: true, maskable512: true });
  });
  it('每个图标地址不要登录也取得到：200、image/png、PNG 头的宽高和 sizes 一致', async () => {
    const icons = (await manifest()).m.icons ?? [];
    expect(icons.length).toBeGreaterThanOrEqual(2);
    for (const x of icons) {
      const want = /^(\d+)x(\d+)$/.exec(x.sizes ?? '');
      const got = await icon(x.src);
      expect({ src: x.src, sizes: x.sizes, status: got.status, type: got.type.split(';')[0], size: got.size })
        .toEqual({ src: x.src, sizes: x.sizes, status: 200, type: 'image/png', size: want ? { w: Number(want[1]), h: Number(want[2]) } : 'sizes 要写成 NxN' });
    }
  });
});

describe('2. 页面 <head>：manifest、apple-touch-icon、theme-color、iOS 主屏幕、标题', () => {
  const html = async () => { const r = await get('/'); expect(r.status).toBe(200); return r.text(); };
  it('<link rel="manifest" href="/manifest.webmanifest">', async () => {
    const l = tags(await html(), 'link').filter((a) => rels(a).includes('manifest'));
    expect(l.map((a) => a.href)).toEqual(['/manifest.webmanifest']);
  });
  it('apple-touch-icon：180x180 PNG，不要登录取得到', async () => {
    const l = tags(await html(), 'link').filter((a) => rels(a).includes('apple-touch-icon'));
    expect(l.length, '没有 <link rel="apple-touch-icon">').toBeGreaterThanOrEqual(1);
    const got = await icon(l[0].href);
    expect({ status: got.status, type: got.type.split(';')[0], size: got.size }).toEqual({ status: 200, type: 'image/png', size: { w: 180, h: 180 } });
  });
  it('favicon 取得到（<link rel="icon"> 的地址，没写就是 /favicon.ico）：200、image/*', async () => {
    const l = tags(await html(), 'link').filter((a) => rels(a).includes('icon'));
    const srcs = l.length ? l.map((a) => a.href) : ['/favicon.ico'];
    for (const s of srcs) {
      const r = await get(s);
      expect({ s, status: r.status, image: (r.headers.get('content-type') ?? '').startsWith('image/') }).toEqual({ s, status: 200, image: true });
    }
  });
  it('meta：theme-color 有值、apple-mobile-web-app-capable = yes、apple-mobile-web-app-title = 工作台', async () => {
    const m = tags(await html(), 'meta');
    const of = (n: string) => m.filter((a) => (a.name ?? '').toLowerCase() === n).map((a) => a.content);
    expect(of('theme-color').length, '没有 <meta name="theme-color">').toBeGreaterThanOrEqual(1);
    expect(of('theme-color').every((c) => /^#[0-9a-f]{3,8}$/i.test(c ?? ''))).toBe(true);
    expect(of('apple-mobile-web-app-capable')).toEqual(['yes']);
    expect(of('apple-mobile-web-app-title')).toEqual(['工作台']);
  });
  it('meta：apple-mobile-web-app-status-bar-style = black（产品复核 11/12）', async () => {
    const m = tags(await html(), 'meta');
    expect(m.filter((a) => (a.name ?? '').toLowerCase() === 'apple-mobile-web-app-status-bar-style').map((a) => a.content)).toEqual(['black']);
  });
  it('<title> 不长于 6 个字符（主屏幕上不截断）', async () => {
    const t = (/<title>([^<]*)<\/title>/i.exec(await html()) ?? [, ''])[1]!.trim();
    expect([t, t.length > 0 && [...t].length <= 6]).toEqual([t, true]);
  });
  it('/queue 是同一个页面，同样带 manifest link', async () => {
    const r = await get('/queue');
    expect(tags(await r.text(), 'link').filter((a) => rels(a).includes('manifest')).map((a) => a.href)).toEqual(['/manifest.webmanifest']);
  });
});

describe('3. /sw.js', () => {
  it('不要登录：200、javascript、cache-control 含 no-cache', async () => {
    const r = await get('/sw.js');
    expect({ status: r.status, js: /javascript/.test(r.headers.get('content-type') ?? ''), noCache: /no-cache/.test(r.headers.get('cache-control') ?? '') })
      .toEqual({ status: 200, js: true, noCache: true });
  });
  it('SW 里没有定时 / 后台任务（periodicsync、sync、push 事件）', async () => {
    const t = await (await get('/sw.js')).text();
    expect(t.length).toBeGreaterThan(0);
    expect(/addEventListener\(\s*['"](periodicsync|sync|push)['"]/.test(t) || /\bon(periodicsync|sync|push)\s*=/.test(t)).toBe(false);
  });
});

describe('5、6. 登录：密码框和 12 小时（回归，现在就该是绿的）', () => {
  it('密码框 autocomplete="current-password"', async () => {
    const html = await (await get('/')).text();
    const pw = /<input\b[^>]*\bid="pw"[^>]*>/.exec(html)?.[0] ?? '';
    expect([pw.includes('type="password"'), /autocomplete="current-password"/.test(pw)]).toEqual([true, true]);
  });
  it('登录 cookie：Max-Age=43200（12 小时），HttpOnly、Secure、SameSite=Strict、Path=/；带了 Expires 也得是 12 小时后', async () => {
    const r = await handle(new Request(`${HOST}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: HOST, 'cf-connecting-ip': '203.0.113.9' }, body: JSON.stringify({ password: PASS }) }), env(), T0);
    expect(r.status).toBe(200);
    const c = r.headers.get('set-cookie') ?? '';
    const parts = c.split(';').map((s) => s.trim());
    expect(parts.filter((s) => /^max-age=/i.test(s))).toEqual(['Max-Age=43200']);
    expect(['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/'].every((k) => parts.includes(k))).toBe(true);
    const exp = parts.find((s) => /^expires=/i.test(s));
    if (exp) expect(Math.abs(Date.parse(exp.slice(8)) - (T0 + 12 * 3600_000))).toBeLessThanOrEqual(1000);
    // cookie 里写的到期时间也是 12 小时后
    expect(/=(\d+)\./.exec(c)?.[1]).toBe(String(T0 + 12 * 3600_000));
  });
});

describe('7. 无定时任务', () => {
  it('wrangler.toml 和 test/wrangler.test.toml 都没有 [triggers] / crons；src/index.ts 不导出 scheduled', () => {
    for (const f of ['wrangler.toml', 'test/wrangler.test.toml']) {
      const t = readFileSync(path.join(ROOT, f), 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
      expect([f, /\[\s*(env\.[\w-]+\.)?triggers\s*\]/.test(t) || /\bcrons\s*=/.test(t)]).toEqual([f, false]);
    }
    const idx = readFileSync(path.join(ROOT, 'src/index.ts'), 'utf8');
    expect(/\bscheduled\s*[(:]/.test(idx) || /export\s+(async\s+)?function\s+scheduled/.test(idx)).toBe(false);
  });
});
