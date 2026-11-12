#!/usr/bin/env node
/**
 * 工作平台网页 App（PWA）第一版的浏览器级验收测试（Amos 2026-11-12「都按建议」；接口层在 test/pwa.test.ts）。
 * 测试会话先写（agents C154）：写的时候功能还没做，所以现在是红的；研发写代码到全绿，不改这里的断言（底线 6）。
 *   node scripts/e2e-pwa.mjs
 *
 * 覆盖：
 *   A. manifest、图标、sw.js 在真的 wrangler dev 上不登录就取得到（manifest+json；图标 200、image/png、PNG 头宽高 = 声明；sw.js no-cache）；
 *      页面 <head> 有 manifest、apple-touch-icon（180）、theme-color、apple-mobile-web-app-capable、apple-mobile-web-app-title=工作台；<title> ≤ 6 字。
 *   B. Chromium 里页面自己注册 SW 成功（作用域 /），重新打开后页面受它控制。
 *   C. SW 不缓存 /api/*：在线拉一次 /api/reply-cap（200）→ 离线 → 同一个请求必须失败（拿不到缓存的那份）。
 *   D. 离线时打开 / 显示含"连不上工作台"的提示页；恢复在线后再打开 / 正常（登录后的页面，没有那句提示）。
 *   E. standalone（装到主屏幕后）顶栏 #top 有「刷新」按钮，点了整页重新加载；普通浏览器里没有。
 *   F. 登录密码框 autocomplete="current-password"。
 *
 * 怎么模拟"离线"（测试会话 2026-11-12 实测 Playwright 1.56.1 / Chromium 141）：
 *   context.setOffline(true) 管不到 Service Worker 自己发的 fetch——SW 在"离线"时照样连得上服务器，
 *   缓存了 /api 的 SW 也会因为直接拿到新数据而测不出来。所以浏览器连的是本脚本起的一个 TCP 转发（BASE），
 *   "离线" = 转发口把已有连接全断掉、新连接一来就关（页面和 SW 的请求都连不上），同时也 setOffline(true)；"恢复" = 两样都恢复。
 * 怎么模拟 standalone：Playwright 不能模拟 CSS 的 display-mode（CDP Emulation.setEmulatedMedia 的 display-mode 也不生效，同日实测），
 *   所以用 addInitScript 让 matchMedia('(display-mode: standalone)') 返回 matches=true、navigator.standalone=true。
 *   约定：「刷新」按钮显不显示由脚本按 matchMedia('(display-mode: standalone)') 或 navigator.standalone 判断（只靠 CSS @media 测不到）。
 * 按钮定位：#top 里 role=button、名字含"刷新"的那个。
 * 每段单独 try：一段没做出来不影响别的段报结果。任何一条不符就以非 0 退出。不连外网。
 */
import net from 'node:net';
import { chromium } from 'playwright';
import { startServer, PASS, checker } from './e2e-server.mjs';

const { fails, check } = checker();
const WAIT = 5000;
const srv = await startServer({ name: 'e2e-pwa' });

// ---- 可以拔线的 TCP 转发：浏览器只连这里 ----
const up = new URL(srv.BASE);
let down = false;
const socks = new Set();
const proxy = net.createServer((c) => {
  if (down) { c.destroy(); return; }
  const u = net.connect(Number(up.port), up.hostname);
  socks.add(c); socks.add(u);
  const kill = () => { c.destroy(); u.destroy(); socks.delete(c); socks.delete(u); };
  c.on('error', kill); u.on('error', kill); c.on('close', kill); u.on('close', kill);
  c.pipe(u); u.pipe(c);
}).listen(0, '127.0.0.1');
await new Promise((r) => proxy.on('listening', r));
const BASE = `http://127.0.0.1:${proxy.address().port}`;
async function offline(ctx, v) {
  down = v;
  if (v) for (const s of socks) s.destroy();
  await ctx.setOffline(v);
}

const browser = await chromium.launch();
const errors = [];
async function open({ standalone = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  if (standalone) {
    await ctx.addInitScript(() => {
      const orig = window.matchMedia.bind(window);
      window.matchMedia = (q) => {
        if (/display-mode\s*:\s*standalone/.test(q)) {
          return { matches: true, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } };
        }
        if (/display-mode\s*:/.test(q)) {
          return { matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } };
        }
        return orig(q);
      };
      try { Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true, configurable: true }); } catch { /* 不支持就算了 */ }
    });
  }
  const page = await ctx.newPage();
  page.setDefaultTimeout(WAIT);
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page };
}
async function login(page) {
  await page.goto(BASE + '/');
  await page.fill('#pw', PASS);
  await page.click('#go');
  await page.waitForSelector('#app:not([hidden])', { timeout: WAIT });
}
async function section(name, fn) {
  try { await fn(); } catch (e) { check(`${name}：没跑完`, false, String((e && e.message) || e).split('\n')[0]); }
}
function pngSize(b) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || !sig.every((x, i) => b[i] === x) || b.toString('latin1', 12, 16) !== 'IHDR') return null;
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
}
async function getIcon(src) {
  const r = await fetch(new URL(src, BASE));
  return { status: r.status, type: (r.headers.get('content-type') ?? '').split(';')[0], size: pngSize(Buffer.from(await r.arrayBuffer())) };
}
const refreshBtn = (page) => page.locator('#top').getByRole('button', { name: '刷新' });

// ---------------- A ----------------
await section('A', async () => {
  const r = await fetch(BASE + '/manifest.webmanifest');
  check('A1 /manifest.webmanifest 不登录 200、manifest+json', r.status === 200 && /manifest\+json/.test(r.headers.get('content-type') ?? ''), [r.status, r.headers.get('content-type')]);
  let m = {};
  try { m = JSON.parse(await r.text()); } catch { /* 下面报 */ }
  const want = { id: '/', start_url: '/', scope: '/', display: 'standalone', name: '工作平台', short_name: '工作台' };
  const got = Object.fromEntries(Object.keys(want).map((k) => [k, m[k]]));
  check('A2 manifest 字段（id、start_url、scope、display、name、short_name）', JSON.stringify(got) === JSON.stringify(want), got);
  check('A3 theme_color、background_color 有值', !!m.theme_color && !!m.background_color, [m.theme_color, m.background_color]);
  const icons = Array.isArray(m.icons) ? m.icons : [];
  const has = (s, mask = false) => icons.some((x) => (x.sizes ?? '').split(/\s+/).includes(s) && (!mask || (x.purpose ?? '').split(/\s+/).includes('maskable')));
  check('A4 icons 有 192、512、maskable 的 512', has('192x192') && has('512x512') && has('512x512', true), icons);
  for (const x of icons) {
    const g = await getIcon(x.src);
    check(`A5 图标 ${x.src}（${x.sizes}）200、image/png、宽高一致`, g.status === 200 && g.type === 'image/png' && g.size === x.sizes, g);
  }
  const sw = await fetch(BASE + '/sw.js');
  check('A6 /sw.js 200、cache-control 含 no-cache', sw.status === 200 && /no-cache/.test(sw.headers.get('cache-control') ?? ''), [sw.status, sw.headers.get('cache-control')]);

  const { ctx, page } = await open();
  await page.goto(BASE + '/');
  const head = await page.evaluate(() => {
    const l = (rel) => [...document.querySelectorAll('head link')].filter((e) => (e.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).includes(rel)).map((e) => e.getAttribute('href'));
    const meta = (n) => [...document.querySelectorAll(`head meta[name="${n}"]`)].map((e) => e.getAttribute('content'));
    return { manifest: l('manifest'), apple: l('apple-touch-icon'), icon: l('icon'), theme: meta('theme-color'), capable: meta('apple-mobile-web-app-capable'), title: meta('apple-mobile-web-app-title'), docTitle: document.title };
  });
  check('A7 <link rel=manifest href=/manifest.webmanifest>', JSON.stringify(head.manifest) === '["/manifest.webmanifest"]', head.manifest);
  check('A8 theme-color、apple-mobile-web-app-capable=yes、apple-mobile-web-app-title=工作台', head.theme.length >= 1 && !!head.theme[0] && JSON.stringify(head.capable) === '["yes"]' && JSON.stringify(head.title) === '["工作台"]', head);
  check('A9 <title> 不长于 6 个字符', head.docTitle.length > 0 && [...head.docTitle].length <= 6, head.docTitle);
  if (check('A10 有 apple-touch-icon', head.apple.length >= 1, head.apple)) {
    const g = await getIcon(head.apple[0]);
    check('A11 apple-touch-icon 200、image/png、180x180', g.status === 200 && g.type === 'image/png' && g.size === '180x180', g);
  }
  for (const s of head.icon.length ? head.icon : ['/favicon.ico']) {
    const fr = await fetch(new URL(s, BASE));
    check(`A12 favicon ${s} 取得到`, fr.status === 200 && (fr.headers.get('content-type') ?? '').startsWith('image/'), [fr.status, fr.headers.get('content-type')]);
  }
  await ctx.close();
});

// ---------------- B、C、D ----------------
await section('B～D', async () => {
  const { ctx, page } = await open();
  try {
    await login(page);
    const reg = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return { err: '没有 serviceWorker' };
      const t = new Promise((r) => setTimeout(() => r(null), 4000));
      const ready = await Promise.race([navigator.serviceWorker.ready, t]);
      return ready ? { scope: ready.scope, active: !!ready.active } : { err: '4 秒内没注册好' };
    });
    check('B1 页面自己注册 SW 成功、作用域 /', reg.active === true && reg.scope === BASE + '/', reg);
    await page.reload();
    await page.waitForSelector('#app:not([hidden])', { timeout: WAIT });
    const ctrl = await page.evaluate(() => !!navigator.serviceWorker && !!navigator.serviceWorker.controller);
    check('B2 重新打开后页面受 SW 控制', ctrl, ctrl);

    const api = () => page.evaluate(async () => {
      try { const r = await fetch('/api/reply-cap', { credentials: 'same-origin' }); return { ok: r.ok, status: r.status, body: await r.text() }; } catch (e) { return { err: String(e && e.message || e) }; }
    });
    const first = await api();
    check('C1 在线时 /api/reply-cap 200', first.status === 200, first);
    await offline(ctx, true);
    const second = await api();
    // 失败 = 请求抛错，或者回的不是 2xx 且不是在线时那一份
    const failed = !!second.err || (!second.ok && second.body !== first.body);
    check('C2 离线时同一个 /api 请求失败（SW 不缓存 /api/*）', failed, second);

    let nav = '';
    try { await page.goto(BASE + '/', { timeout: WAIT }); } catch (e) { nav = String(e.message).split('\n')[0]; }
    const offTxt = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
    check('D1 离线打开 / 显示"连不上工作台"提示页', offTxt.includes('连不上工作台'), nav || offTxt.slice(0, 200));

    await offline(ctx, false);
    await page.goto(BASE + '/');
    const back = await page.waitForSelector('#app:not([hidden])', { timeout: WAIT }).then(() => true, () => false);
    const backTxt = await page.locator('body').innerText().catch(() => '');
    check('D2 恢复在线后打开 / 正常（登录后的页面、没有离线提示）', back && !backTxt.includes('连不上工作台'), backTxt.slice(0, 200));
    const again = await api();
    check('D3 恢复在线后 /api 正常', again.status === 200, again);
  } finally {
    down = false;
    await ctx.close();
  }
});

// ---------------- E ----------------
await section('E 非 standalone', async () => {
  const { ctx, page } = await open();
  await login(page);
  await page.waitForTimeout(300);
  const n = await refreshBtn(page).count();
  const shown = n ? await refreshBtn(page).first().isVisible() : false;
  check('E1 普通浏览器里顶栏没有「刷新」按钮', !shown, { n, shown });
  await ctx.close();
});
await section('E standalone', async () => {
  const { ctx, page } = await open({ standalone: true });
  await login(page);
  const btn = refreshBtn(page).first();
  const shown = await btn.waitFor({ state: 'visible', timeout: WAIT }).then(() => true, () => false);
  if (check('E2 standalone 时顶栏有「刷新」按钮', shown, await refreshBtn(page).count())) {
    await page.evaluate(() => { window.__e2eMark = 1; });
    await Promise.all([page.waitForEvent('load', { timeout: WAIT }), btn.click()]);
    const mark = await page.evaluate(() => window.__e2eMark ?? null);
    check('E3 点「刷新」整页重新加载', mark === null, mark);
    const still = await page.waitForSelector('#app:not([hidden])', { timeout: WAIT }).then(() => true, () => false);
    check('E4 重新加载后还是登录状态', still, still);
  }
  await ctx.close();
});

// ---------------- F ----------------
await section('F', async () => {
  const { ctx, page } = await open();
  await page.goto(BASE + '/');
  const ac = await page.getAttribute('#pw', 'autocomplete');
  check('F1 密码框 autocomplete="current-password"', ac === 'current-password', ac);
  await ctx.close();
});

check('没有页面脚本报错', errors.length === 0, errors.slice(0, 5));
await browser.close();
proxy.close();
srv.stop();
if (fails.length) {
  console.error(`\n不通过 ${fails.length} 条：\n- ${fails.join('\n- ')}`);
  process.exit(1);
}
console.log('\n全部通过');
process.exit(0);
