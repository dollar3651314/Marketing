/**
 * 工作台"添加到主屏幕"（PWA 第一版，2026-11-12，Amos"都按建议"：H1 图标候选 A、H2 登录有效期 12 小时不改、H3 只做"能装上"、H4 复核后直接上生产）。
 * 这里只放 PWA 自己的东西，admin-page.ts 只插两处（<head> 的 PWA_HEAD、页尾的 PWA_JS）和顶栏一个按钮，少碰别的窗口在改的代码。
 * - GET /manifest.webmanifest、/sw.js、图标：不要登录（浏览器取这些时不带登录态也得能取到）；和后台页面一样，COPILOT_PASSWORD 没填时 404（默认关着，C102）。
 * - /sw.js：接口 /api/…、/v1/…、/hooks/… 一律不拦截、不缓存；页面导航先联网，失败或 3 秒没回应才显示内置的离线提示页；
 *   只缓存图标（离线页写在 sw.js 里，不用缓存）。缓存名带版本号，activate 删掉所有别的缓存。**页面和数据从不进缓存，不会让人看到旧数据。**
 * - 改了 sw.js 的逻辑或图标，把 SW_VERSION 加一（浏览器按字节比对 sw.js 发现新版本，activate 时删旧缓存）。
 */
import { FAVICON_SVG, PWA_PNG } from './pwa-icons';

export const SW_VERSION = 'v1';
export const APP_NAME = '工作平台';
export const SHORT_NAME = '工作台';
const NAVY = '#0F1B33';
const NAVY_DARK = '#08101F';

export const MANIFEST = {
  id: '/',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  name: APP_NAME,
  short_name: SHORT_NAME,
  lang: 'zh-Hans',
  theme_color: NAVY,
  background_color: NAVY,
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

/** SW 预先缓存的图标（只有这些进缓存） */
export const SW_CACHED = ['/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png', '/favicon-32.png', '/favicon.svg'];

/** 离线提示页：不引任何外部资源，图标内联 */
export const OFFLINE_HTML = `<!doctype html><html lang="zh-Hans"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="${NAVY}"><title>${SHORT_NAME}</title><style>
:root{--bg:#F3F5F8;--ink:#13203A;--muted:#616D80;--btn:#0B7A6E;color-scheme:light}
@media (prefers-color-scheme: dark){:root{--bg:#0B1220;--ink:#E7ECF4;--muted:#8D99AE;--btn:#14B8A6;color-scheme:dark}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.6 "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif;padding:16px;box-sizing:border-box}
main{text-align:center;max-width:320px}svg{width:72px;height:72px}h1{font-size:18px;margin:16px 0 4px}p{margin:0 0 20px;color:var(--muted)}
button{font:inherit;font-weight:700;min-height:44px;padding:0 28px;border:0;border-radius:10px;background:var(--btn);color:#fff;cursor:pointer}
button:focus-visible{outline:2px solid #B45309;outline-offset:2px}
</style></head><body><main id="offline">${FAVICON_SVG.replace('<svg ', '<svg aria-hidden="true" ')}
<h1>连不上工作台，联网后点刷新</h1><p>现在没有网络，或者服务器没回应。页面上的数据都要联网读，这里不显示旧数据。</p>
<button type="button" id="offline-reload" onclick="location.reload()">刷新</button></main></body></html>`;

export const SW_JS = `// 工作台 Service Worker（src/pwa.ts 生成）。只为"能装到主屏幕"+ 离线时给一句提示；页面和数据从不缓存。
const VERSION = ${JSON.stringify(SW_VERSION)};
const CACHE = 'wt-pwa-' + VERSION;
const CACHED = ${JSON.stringify(SW_CACHED)};
const OFFLINE_HTML = ${JSON.stringify(OFFLINE_HTML)};
const NAV_TIMEOUT_MS = 3000;
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CACHED)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
function offline() {
  return new Response(OFFLINE_HTML, { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
function navigate(req) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done) { done = true; clearTimeout(t); resolve(r); } };
    const t = setTimeout(() => finish(offline()), NAV_TIMEOUT_MS);
    fetch(req).then(finish, () => finish(offline()));
  });
}
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin) return;
  // 接口一律不拦截、不缓存（浏览器直接走网络）
  if (/^\\/(api|v1|hooks)(\\/|$)/.test(u.pathname)) return;
  if (req.mode === 'navigate') { e.respondWith(navigate(req)); return; }
  if (CACHED.includes(u.pathname)) e.respondWith(caches.match(req, { ignoreSearch: true }).then((r) => r || fetch(req)));
});
`;

/** 插进后台页面 <head>；<title> 保持"工作平台"（华为用它当桌面名称） */
export const PWA_HEAD = `<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="${NAVY}"><meta name="theme-color" media="(prefers-color-scheme: dark)" content="${NAVY_DARK}">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="${SHORT_NAME}">`;

/**
 * 插在后台页面最后：① 只在装到主屏幕后打开（standalone）时显示顶栏「刷新」（#pwa-refresh），点了整页重新加载（地址的 #/… 保留，停在原处）；
 * ② 支持才注册 /sw.js。整段 try/catch，出错不影响页面其他部分。注意：这段会被插进 ADMIN_PAGE 的模板字符串，里面不能有反引号和 \${。
 */
export const PWA_JS = `<script>(function(){try{
var b=document.getElementById('pwa-refresh');
var mq=window.matchMedia?window.matchMedia('(display-mode: standalone)'):null;
function sa(){return !!(mq&&mq.matches)||window.navigator.standalone===true;}
function upd(){if(b)b.hidden=!sa();}
upd();if(mq&&mq.addEventListener)mq.addEventListener('change',upd);
if(b)b.addEventListener('click',function(){b.disabled=true;b.textContent='刷新中…';location.reload();});
if('serviceWorker' in navigator&&window.isSecureContext){navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(function(e){console.log('sw register failed',e&&e.message);});}
}catch(e){}})();</script>`;

const LONG = 'public, max-age=2592000';
const BASE_HEADERS = { 'x-robots-tag': 'noindex', 'x-content-type-options': 'nosniff' };

function b64ToBytes(s: string): ArrayBuffer {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export function isPwaPath(p: string): boolean {
  return p === '/manifest.webmanifest' || p === '/sw.js' || p === '/favicon.svg' || p === '/favicon.ico' || p in PWA_PNG;
}

/** 只认 GET；路径不是 PWA 的返回 null */
export function pwaResponse(p: string): Response | null {
  if (p === '/manifest.webmanifest') return new Response(JSON.stringify(MANIFEST), { headers: { ...BASE_HEADERS, 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'public, max-age=86400' } });
  if (p === '/sw.js') return new Response(SW_JS, { headers: { ...BASE_HEADERS, 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache', 'service-worker-allowed': '/' } });
  if (p === '/favicon.svg') return new Response(FAVICON_SVG, { headers: { ...BASE_HEADERS, 'content-type': 'image/svg+xml', 'cache-control': LONG } });
  // 浏览器会自己去要 /favicon.ico：给 32 的 PNG（各浏览器都认按内容识别）
  const png = PWA_PNG[p === '/favicon.ico' ? '/favicon-32.png' : p];
  if (png) return new Response(b64ToBytes(png), { headers: { ...BASE_HEADERS, 'content-type': 'image/png', 'cache-control': LONG } });
  return null;
}
