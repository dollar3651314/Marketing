#!/usr/bin/env node
/**
 * 公共工具「基金观察」的浏览器级检查。**测试会话先写（agents C154 试行）**：写的时候页面还没做，所以是红的；研发照着做到全绿，不改这里的断言（底线 6）。
 * 依据：Amos 2026-11-10 原话"还是放到 工作台吧……让我可以在页面上主动刷新……每个时间段的最大回撤也显示出来，最好图形化 美化一下"；
 *   他已确认放在"公共工具"下、叫"基金观察"，涨绿跌红；页面以他看过的高保真原型《基金观察原型.html》为准（主会话 scratchpad，未进仓库）。
 *   node scripts/e2e-funds.mjs                    # CI 里跑这个（本地 wrangler dev + 本地 D1；/api/funds 和 /api/funds/refresh 在浏览器这一侧用替身）
 *   node scripts/e2e-funds.mjs --proto <原型.html>  # 只核对本脚本的定位方式和原型一致（不起服务、不登录、不测入口和刷新），CI 不跑
 *
 * 数据：test/fixtures/funds/snapshot.json（fetch2.py 2026-11-10 实抓 45 只换成 GET /api/funds 的形状）。原型里的数字是同一次抓的，两边能对上。
 *
 * 覆盖：
 *   A. 入口：登录后在"公共工具"那一页（一级菜单、二级菜单 #sub-tools 或页面里的链接）点得到"基金观察"，点了出现 #t-funds（或独立一页 #v-funds）、地址是 #/tools/funds 或 #/funds；
 *      直接打开这个地址也行。打开时**不自动刷新**（不发 POST /api/funds/refresh，取数由 Amos 主动点）。
 *   B. 页面元素：刷新按钮；四个时间段（role=group「时间段」里 4 个按钮：近 1 周 / 近 1 月 / 今年以来 / 近 1 年，aria-pressed）；
 *      市场切换（role=tablist「市场」：全部 45 / 新加坡 14 / 美国 15 / 中国 16，aria-selected）；散点图（svg[role=img]，近 1 年 + 全部时 ≥ 42 个点）；
 *      "逐只对比"标题和每只一行（[data-code][aria-expanded]）；单日 ±3% 标签（2026-11-10 只有 QQQ +3.54%）。
 *   C. 切时间段：按下的那个 aria-pressed=true、其他 false；ES3 那一行同时显示这一段的收益和最大回撤（参考值，1 位或 2 位小数都认）。
 *   D. 切市场：行数 = 14 / 15 / 16 / 45，且只有这个市场的代码；散点跟着变少。
 *   E. 涨绿跌红：QQQ 的 +3.54% 字是绿色系（G 明显大于 R）、HST 的 −0.31% 是红色系（R 明显大于 G）。明暗两种都量。
 *   F. 点一行展开详情：aria-expanded=true、多出一张图（svg）；再点收起。
 *   G. 400 宽：没有横向滚动（展开详情后也没有）。
 *   H. 对比度：浅色、深色下 #t-funds 里文字对比度 ≥ 4.5（大字 ≥ 3），量法 scripts/e2e-look.mjs 的 lowContrast。
 *   I. 刷新：点"刷新"→ 进行中按钮变灰（防重复点）→ 页面按 next 循环调 POST /api/funds/refresh（第二次 body.cursor = 第一次回的 next）直到 next 为 null
 *      → 再读一次 GET /api/funds → 失败的那只（VOO）在页面上写明没取到。
 *   J. 空状态（C32）：从没刷新过（items 只有定义、没有数值）时页面不报错、刷新按钮在、写明还没有数据。
 *   第二轮修改（主会话 2026-11-10 定的约定；接口 / 计时那两条在 test/funds-round2.test.ts）：
 *   K. 标题下数据时间写"（新加坡时间）"、按 UTC+8 换算；页面任何地方不出现"台湾"（约定 1）。
 *   L. 整次失败（服务器回 500 / 网络断了）：写"这次没取到、显示的还是 <时间> 的数据、可以再点一次"，不说"已存好"、不逐个列代码（约定 2）。
 *   M. 中途断了：写"前 N 只已更新，其余 M 只还是 <旧时间> 的数据，再点会从头取"，写库失败那批不说"已存好"；没更新的那几只标出"上次数据"（约定 2、3）。
 *   N. 1200 宽：刷新结果文字再长，刷新按钮前后位置不变、仍在右上（约定 4）。
 *   O. 手机（触屏）点散点：先出浮框（名字、收益、回撤、"看这一只"），页面不动；再点"看这一只"才跳到那一行（约定 5）。
 *   P. 详情表里上市不足的格子写"上市不足"不写"—"；散点副标题写"N 只上市不满这段时间"（约定 6）。
 *   Q. 每次进入 #/funds 都重新 GET /api/funds（约定 7）。
 *   R. 刷完汇总里从没取到过的那只单独说"没取到数据"，不算进"那几行显示的是上次的数据"（约定 10）。
 *   S. 400 宽：每行的"1 日"有标签（约定 11）。
 *   全程没有页面脚本报错（pageerror）。
 *
 * 页面约定（研发照加；要改名就在同一个提交里改这里并写明）：
 *   模块 #t-funds（或独立一页 #v-funds，下面统称 #t-funds）；地址 #/tools/funds（或 #/funds）；每只一行带 data-code="<code>"（ES3、511880 这种，不带 .SI/.SS）和 aria-expanded；
 *   时间段按钮组 role="group" aria-label="时间段"、按钮用 aria-pressed；市场 role="tablist" aria-label="市场"、role="tab" 用 aria-selected；
 *   刷新按钮的可见文字含"刷新"；单日 ±3% 的标签不在行里面（原型是顶上一排 .alert）。
 * T-4 提醒：公共工具二级菜单上限 8 项、现在正好 8 项（agents 工作平台/工具台账.md；test/drill.test.ts、test/tts.test.ts、e2e-tools J/H 段守着）。
 *   本脚本不规定入口放哪（二级菜单 / 一级菜单 / 页面里的链接都认），**但上面那些已有的检查不会为它放宽**。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { ROOT, startServer, PASS, checker } from './e2e-server.mjs';
import { lowContrast } from './e2e-look.mjs';

const protoAt = process.argv.indexOf('--proto');
const PROTO = protoAt > 0 ? path.resolve(process.argv[protoAt + 1]) : '';
const { fails, check } = checker();
const WAIT = 5000;
// 容器：模块 #t-funds（放在公共工具页里）或独立一页 #v-funds（一级菜单一项，不占公共工具二级菜单，T-4）都认，进页面时按哪个看得见定下来（测试用例修正 3）
let R = PROTO ? 'main' : '#t-funds';
const ROOTS = ['#t-funds', '#v-funds'];
const SNAP = JSON.parse(readFileSync(path.join(ROOT, 'test/fixtures/funds/snapshot.json'), 'utf8'));
const BY = Object.fromEntries(SNAP.items.map((x) => [x.code, x]));
const CODES_OF = (m) => SNAP.items.filter((x) => x.market === m).map((x) => x.code);
const PERIODS = [['近 1 周', 'w1'], ['近 1 月', 'm1'], ['今年以来', 'ytd'], ['近 1 年', 'y1']];
const MARKETS = [['新加坡', 14], ['美国', 15], ['中国', 16], ['全部', 45]];
/** 一个百分数在页面上的写法：+ / − / -，1 位或 2 位小数 */
const pctRe = (v) => {
  const a = Math.abs(v);
  const alts = [a.toFixed(1), a.toFixed(2)].map((s) => s.replace('.', '\\.'));
  const sign = v > 0 ? '\\+?' : v < 0 ? '[−-]' : '[+−-]?';
  return new RegExp(`(^|[^\\d.])${sign}(${alts.join('|')})%`);
};

const srv = PROTO ? null : await startServer({ name: 'e2e-funds' });
const BASE = srv?.BASE ?? '';
const browser = await chromium.launch();
const errors = [];

/**
 * 打开一个页面；/api/funds 和 /api/funds/refresh 在浏览器这一侧用替身（服务端的取数在 test/funds-api.test.ts 测）。
 * api.snap：GET 回什么；api.posts：收到的 refresh 请求体；api.gets：GET 次数；api.onRefresh(body, n)：返回 refresh 的回包（可以是 Promise，用来扣住）
 */
async function open({ width = 1280, height = 900, colorScheme = 'light', snap = SNAP, onRefresh, touch = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme, ...(touch ? { hasTouch: true, isMobile: true } : {}) });
  const api = { snap, posts: [], gets: 0 };
  api.onRefresh = onRefresh ?? (() => ({ next: null, done: true, total: 45, updated: [], failed: [] }));
  await ctx.route(/\/api\/funds\/refresh(\?.*)?$/, async (r) => {
    const body = (() => { try { return JSON.parse(r.request().postData() || '{}'); } catch { return { bad: r.request().postData() }; } })();
    api.posts.push(body);
    const res = await api.onRefresh(body, api.posts.length);
    // 第二轮加：{ __abort: true } = 网络断了；{ __status, body } = 服务器回错（例如 D1 写库失败的 500）
    if (res && res.__abort) return r.abort('connectionreset');
    if (res && res.__status) return r.fulfill({ status: res.__status, contentType: 'application/json', body: JSON.stringify(res.body ?? {}) });
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(res) });
  });
  // 第二版（研发加的替身，不是断言）：刷完 45 只后页面会调一次 POST /api/funds/yields（债券收益率），这里替掉，免得 CI 里的本地服务真去外网取
  await ctx.route(/\/api\/funds\/yields(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ updated: [], failed: [], requests: 0, curves: {} }) }));
  await ctx.route(/\/api\/funds(\?.*)?$/, async (r) => {
    if (r.request().method() !== 'GET') return r.fallback();
    api.gets++;
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(api.snap) });
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(WAIT);
  page.on('pageerror', (e) => errors.push(`${width}/${colorScheme}：${e.message}`));
  return { page, api, ctx };
}
/** 登录后从公共工具点进基金观察；proto 模式直接打开原型文件 */
async function enter(page) {
  if (PROTO) { await page.goto(pathToFileURL(PROTO).href); await page.waitForSelector('[data-code][aria-expanded]'); return { entry: 'proto' }; }
  await page.goto(BASE + '/#/tools');
  await page.fill('#pw', PASS);
  await page.click('#go');
  await page.waitForSelector('#app:not([hidden])', { timeout: WAIT });
  const link = page.locator('nav.nav1 a, #sub-tools a, #v-tools a').filter({ hasText: '基金观察' }).filter({ visible: true }).first();
  const entry = (await link.count()) ? await link.evaluate((a) => (a.closest('#sub-tools') ? '二级菜单' : a.closest('nav.nav1') ? '一级菜单' : '公共工具页里的链接')) : '';
  if (entry) await link.click();
  else await page.goto(BASE + '/#/tools/funds'); // 找不到入口也接着测页面本身（入口那条单独报红）
  await page.waitForFunction((rs) => rs.some((r) => document.querySelector(r)?.getClientRects().length), ROOTS, { timeout: WAIT }).catch(() => {});
  R = (await page.evaluate((rs) => rs.find((r) => document.querySelector(r)?.getClientRects().length), ROOTS)) ?? '#t-funds';
  await page.locator(`${R} [data-code][aria-expanded]`).first().waitFor({ state: 'visible', timeout: WAIT }).catch(() => {});
  return { entry, hash: await page.evaluate(() => location.hash) };
}
const rows = (page) => page.locator(`${R} [data-code][aria-expanded]`).filter({ visible: true });
const rowCodes = (page) => rows(page).evaluateAll((es) => es.map((e) => e.getAttribute('data-code')));
const rowText = (page, code) => page.locator(`${R} [data-code="${code}"][aria-expanded]`).first().innerText({ timeout: 2000 }).catch(() => '');
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
/** 散点图：#t-funds 里点（circle）最多的那张 svg[role=img] 的点数 */
const scatterN = (page) => page.evaluate((R) => Math.max(0, ...[...document.querySelectorAll(R + ' svg[role="img"]')].filter((s) => s.getClientRects().length).map((s) => s.querySelectorAll('circle').length)), R);
const visibleSvgs = (page) => page.evaluate((R) => [...document.querySelectorAll(R + ' svg')].filter((s) => s.getClientRects().length).length, R);
/** 一行里自己文字正好匹配 re 的元素的颜色 */
const colorIn = (page, code, re) => page.evaluate(({ R, code, src }) => {
  const re = new RegExp(src);
  const row = document.querySelector(`${R} [data-code="${code}"][aria-expanded]`);
  if (!row) return null;
  for (const e of row.querySelectorAll('*')) {
    const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    if (re.test(own) && e.getClientRects().length) { const m = getComputedStyle(e).color.match(/[\d.]+/g).map(Number); return { text: own, r: m[0], g: m[1], b: m[2] }; }
  }
  return null;
}, { R, code, src: re.source });
const greenish = (c) => !!c && c.g - c.r >= 40;
const reddish = (c) => !!c && c.r - c.g >= 40;
/** 单日 ±3% 标签：行外面、看得见、写着 QQQ（或它的名字）和 3.54% 的元素 */
const hotTag = (page) => page.evaluate((R) => {
  const root = document.querySelector(R);
  if (!root) return null;
  const hit = [...root.querySelectorAll('*')].filter((e) => e.getClientRects().length && !e.closest('[data-code][aria-expanded]') && !e.closest('svg'))
    .filter((e) => /3\.54%/.test(e.innerText || '') && /(QQQ|纳斯达克100)/.test(e.innerText || '') && (e.innerText || '').length <= 80);
  return hit.length ? hit.at(-1).innerText.replace(/\s+/g, ' ').trim() : null;
}, R);
async function section(name, fn) {
  try { await fn(); } catch (e) { check(`${name}：没跑完`, false, String(e && e.message || e).split('\n')[0]); }
}

// ---------------------------------------------------------------- A + B～H：1280 宽浅色
await section('1280 浅色', async () => {
  const { page, api, ctx } = await open();
  const at = await enter(page);
  if (!PROTO) {
    check('A 公共工具页点得到"基金观察"（一级菜单 / 二级菜单 / 页面里的链接任一）', !!at.entry, at);
    check('A 点进去地址是 #/tools/funds 或 #/funds，#t-funds（或 #v-funds）看得见', /^#\/(tools\/)?funds\b/.test(at.hash) && (await page.locator(R).isVisible()), at);
    check('A 打开页面不自动刷新（没有 POST /api/funds/refresh），读了 GET /api/funds', api.posts.length === 0 && api.gets >= 1, { posts: api.posts.length, gets: api.gets });
  }
  // B
  check('B 有"刷新"按钮', await page.locator(R).getByRole('button', { name: /刷新/ }).first().isVisible().catch(() => false), null);
  const pg = page.locator(R).getByRole('group', { name: '时间段' });
  const pBtns = await pg.getByRole('button').allInnerTexts().catch(() => []);
  check('B 时间段四个按钮：近 1 周 / 近 1 月 / 今年以来 / 近 1 年', JSON.stringify(pBtns.map((s) => s.trim())) === JSON.stringify(PERIODS.map((p) => p[0])), pBtns);
  const tl = page.locator(R).getByRole('tablist', { name: '市场' });
  const tabs = (await tl.getByRole('tab').allInnerTexts().catch(() => [])).map((s) => s.replace(/\s+/g, ' ').trim());
  check('B 市场切换：全部 45 / 新加坡 14 / 美国 15 / 中国 16', tabs.length === 4 && ['全部', '新加坡', '美国', '中国'].every((m, i) => tabs[i]?.startsWith(m)) && [45, 14, 15, 16].every((n, i) => (tabs[i] || '').includes(String(n))), tabs);
  check('B 散点图：近 1 年、全部时 ≥ 42 个点（XUS、XWR、UPD 不满一年）', (await scatterN(page)) >= 42, await scatterN(page));
  check('B 有"逐只对比"标题', await page.locator(R).getByRole('heading', { name: /逐只对比/ }).first().isVisible().catch(() => false), null);
  check('B 逐只对比 45 行', (await rows(page).count()) === 45, await rows(page).count());
  const tag = await hotTag(page);
  check('B 单日 ±3% 标签：QQQ +3.54%（行外面单独一个标签）', !!tag && /\+3\.54%/.test(tag), tag);

  // C 切时间段
  for (const [label, p] of PERIODS) {
    await pg.getByRole('button', { name: label }).click();
    const pressed = await pg.getByRole('button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-pressed')));
    const t = await rowText(page, 'ES3');
    const r = BY.ES3[p], d = BY.ES3['dd_' + p];
    check(`C 点"${label}"：只有它 aria-pressed=true；ES3 那行显示这一段的收益 ${r} 和最大回撤 ${d}`,
      pressed.filter((x) => x === 'true').length === 1 && pressed[PERIODS.findIndex((x) => x[1] === p)] === 'true' && pctRe(r).test(t) && pctRe(d).test(t), { pressed, t: t.replace(/\s+/g, ' ').slice(0, 160) });
  }
  // D 切市场（近 1 年）
  await pg.getByRole('button', { name: '近 1 年' }).click();
  const all = await scatterN(page);
  for (const [m, n] of MARKETS) {
    await tl.getByRole('tab', { name: new RegExp('^\\s*' + m) }).click();
    const sel = await tl.getByRole('tab').evaluateAll((ts) => ts.map((t) => t.getAttribute('aria-selected')));
    const codes = await rowCodes(page);
    const want = m === '全部' ? SNAP.items.map((x) => x.code) : CODES_OF(m);
    const sn = await scatterN(page);
    check(`D 点"${m}"：选中它、${n} 行且都是这个市场的、散点 ${m === '全部' ? '回到全部' : '变少'}`,
      sel.filter((x) => x === 'true').length === 1 && codes.length === n && codes.every((c) => want.includes(c)) && (m === '全部' ? sn === all : sn < all && sn >= 1),
      { sel, n: codes.length, bad: codes.filter((c) => !want.includes(c)), scatter: sn, all });
  }
  // E 涨绿跌红
  const up = await colorIn(page, 'QQQ', /^[+]?3\.54%$/), down = await colorIn(page, 'HST', /^[−-]0\.31%$/);
  check('E 浅色：QQQ 单日 +3.54% 绿、HST −0.31% 红', greenish(up) && reddish(down), { up, down });
  // F 展开详情
  const s0 = await visibleSvgs(page);
  const es3 = page.locator(`${R} [data-code="ES3"][aria-expanded]`).first();
  await es3.click();
  const opened = await es3.getAttribute('aria-expanded');
  const s1 = await visibleSvgs(page);
  check('F 点 ES3 一行：aria-expanded=true，多出一张走势 / 回撤图', opened === 'true' && s1 > s0, { opened, svgs: [s0, s1] });
  await page.locator(`${R} [data-code="ES3"][aria-expanded]`).first().click();
  const closed = await page.locator(`${R} [data-code="ES3"][aria-expanded]`).first().getAttribute('aria-expanded');
  check('F 再点一次收起', closed === 'false' && (await visibleSvgs(page)) === s0, { closed, svgs: await visibleSvgs(page) });
  // H 浅色对比度
  const lc = await lowContrast(page, [R]);
  check('H 浅色：#t-funds 文字对比度够', lc.bad.length === 0, lc.bad);
  await ctx.close();
});

// ---------------------------------------------------------------- G + H + E：400 宽深色
await section('400 深色', async () => {
  const { page, ctx } = await open({ width: 400, height: 860, colorScheme: 'dark' });
  await enter(page);
  check('G 400 宽：页面有内容（45 行）且没有横向滚动', (await rows(page).count()) === 45 && (await noHScroll(page)), { rows: await rows(page).count(), sw: await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]) });
  await page.locator(`${R} [data-code="ES3"][aria-expanded]`).first().click();
  check('G 400 宽：展开 ES3 详情后也没有横向滚动', (await page.locator(`${R} [data-code="ES3"][aria-expanded]`).first().getAttribute('aria-expanded')) === 'true' && (await noHScroll(page)), await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]));
  const lc = await lowContrast(page, [R]);
  check('H 深色：#t-funds 文字对比度够（展开详情时）', lc.bad.length === 0, lc.bad);
  const up = await colorIn(page, 'QQQ', /^[+]?3\.54%$/), down = await colorIn(page, 'HST', /^[−-]0\.31%$/);
  check('E 深色：QQQ +3.54% 绿、HST −0.31% 红', greenish(up) && reddish(down), { up, down });
  await ctx.close();
});

if (!PROTO) {
  // ---------------------------------------------------------------- I 刷新
  await section('I 刷新', async () => {
    let release;
    const hold = new Promise((ok) => { release = ok; });
    const FIRST = SNAP.items.slice(0, 23).map((x) => x.code), REST = SNAP.items.slice(23).map((x) => x.code).filter((c) => c !== 'VOO');
    const after = { ...SNAP, fetched_at: '2026-11-10T10:00:00Z', items: SNAP.items.map((x) => (x.code === 'VOO' ? { ...x, error: '取不到：HTTP 500' } : x)) };
    const { page, api, ctx } = await open({
      onRefresh: async (body, n) => {
        if (n === 1) { await hold; return { next: 23, done: false, total: 45, updated: FIRST, failed: [] }; }
        api.snap = after;
        return { next: null, done: true, total: 45, updated: REST, failed: [{ code: 'VOO', reason: 'HTTP 500' }] };
      },
    });
    await enter(page);
    const gets0 = api.gets;
    const btn = page.locator(R).getByRole('button', { name: /刷新/ }).first();
    await btn.click();
    await page.waitForFunction(() => true);
    const t0 = Date.now();
    while (api.posts.length < 1 && Date.now() - t0 < WAIT) await new Promise((ok) => setTimeout(ok, 20));
    check('I 点"刷新"后发出第一次 POST /api/funds/refresh（不带 cursor 或 cursor=0）', api.posts.length === 1 && (api.posts[0].cursor === undefined || api.posts[0].cursor === 0), api.posts);
    check('I 刷新进行中按钮变灰（防重复点）', await btn.isDisabled().catch(() => false), null);
    release();
    const t1 = Date.now();
    while ((api.posts.length < 2 || api.gets <= gets0) && Date.now() - t1 < WAIT) await new Promise((ok) => setTimeout(ok, 20));
    await page.waitForTimeout(300); // 只为了看"有没有多发"：next 为 null 以后不能再发第 3 次
    check('I 按 next 接着调：第二次 body.cursor = 23，next 为 null 后停（一共 2 次）', api.posts.length === 2 && api.posts[1].cursor === 23, api.posts);
    check('I 刷完再读一次 GET /api/funds', api.gets > gets0, { before: gets0, after: api.gets });
    const failNote = await page.waitForFunction((R) => {
      const root = document.querySelector(R);
      const hit = root && [...root.querySelectorAll('*')].filter((e) => e.getClientRects().length && (e.innerText || '').length <= 200 && /(VOO|Vanguard 标普500)/.test(e.innerText || '') && /(失败|取不到|没取到|没更新|未更新)/.test(e.innerText || ''));
      return hit && hit.length ? hit.at(-1).innerText.replace(/\s+/g, ' ').trim() : false;
    }, R, { timeout: WAIT }).then((h) => h.jsonValue(), () => null);
    check('I 页面上写明 VOO 这次没取到（保留旧数据、标出失败）', !!failNote, failNote);
    check('I 刷完按钮恢复可点', await btn.isEnabled().catch(() => false), null);
    await ctx.close();
  });

  // ---------------------------------------------------------------- J 空状态
  await section('J 空状态', async () => {
    const empty = { fetched_at: null, items: SNAP.items.map(({ market, category, name, code, symbol, source, tag }) => ({ market, category, name, code, symbol, source, tag })) };
    const { page, ctx } = await open({ snap: empty });
    await enter(page);
    const txt = await page.locator(R).innerText({ timeout: 2000 }).catch(() => '');
    check('J 从没刷新过：#t-funds 在、刷新按钮在、写明还没有数据', (await page.locator(R).getByRole('button', { name: /刷新/ }).first().isVisible().catch(() => false)) && /(还没|暂无|没有数据)/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 200));
    await ctx.close();
  });
}

if (!PROTO) {
  // ================================================================ 第二轮修改（主会话 2026-11-10 定的约定 1～7、10、11；测试先写，C154）
  // 接口 / 计时那两条（约定 8、9）在 test/funds-round2.test.ts。
  /** ISO → 新加坡时间（UTC+8）的 { day: 'YYYY-MM-DD', md: 'MM-DD', hm: 'HH:MM' } */
  const sgt = (iso) => { const d = new Date(Date.parse(iso) + 8 * 3600_000).toISOString(); return { day: d.slice(0, 10), md: d.slice(5, 10), hm: d.slice(11, 16) }; };
  const OLD = sgt(SNAP.fetched_at); // 2026-11-10T08:59Z → 16:59
  const CODES = SNAP.items.map((x) => x.code);
  /** #v-funds 里（行外面、图外面）看得见、文字匹配 re 的最小那个元素的文字 */
  const note = (page, re) => page.evaluate(({ R, src }) => {
    const re = new RegExp(src);
    const root = document.querySelector(R);
    if (!root) return null;
    const hit = [...root.querySelectorAll('*')].filter((e) => e.getClientRects().length && !e.closest('[data-code][aria-expanded]') && !e.closest('svg') && !e.closest('[data-detail]'))
      .map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter((t) => t.length <= 400 && re.test(t));
    return hit.length ? hit.sort((a, b) => a.length - b.length)[0] : null;
  }, { R, src: re.source });
  /** 点"刷新"，等到发了 n 次 POST、按钮恢复可点，再多等一会儿让结果文字和重读的数据画上去 */
  async function doRefresh(page, api, n) {
    const btn = page.locator(R).getByRole('button', { name: /刷新/ }).first();
    await btn.click();
    const t0 = Date.now();
    while (Date.now() - t0 < WAIT && (api.posts.length < n || !(await btn.isEnabled().catch(() => false)))) await new Promise((ok) => setTimeout(ok, 30));
    await page.waitForTimeout(400);
    return btn;
  }
  const noTaiwan = (page) => page.evaluate((R) => !/台湾/.test(document.querySelector(R)?.textContent || '') && !/台湾/.test(document.title), R);
  const FIRST23 = CODES.slice(0, 23), REST22 = CODES.slice(23);

  // ---------------------------------------------------------------- K 数据时间写新加坡时间（约定 1）
  await section('K 新加坡时间', async () => {
    const { page, ctx } = await open();
    await enter(page);
    const m = await note(page, /数据时间/);
    check(`K 标题下数据时间写"（新加坡时间）"、按 UTC+8 换算（${SNAP.fetched_at} → ${OLD.day} ${OLD.hm}）`, !!m && /（新加坡时间）/.test(m) && m.includes(OLD.hm) && (m.includes(OLD.day) || m.includes(OLD.md)), m);
    check('K 页面任何地方不出现"台湾"', await noTaiwan(page), m);
    await ctx.close();
  });

  // ---------------------------------------------------------------- L 整次失败的提示（约定 2）
  for (const [how, res] of [['服务器回 500（例如 D1 写库失败）', { __status: 500, body: { error: '服务器出错了' } }], ['网络断了', { __abort: true }]]) {
    await section(`L 整次失败：${how}`, async () => {
      const { page, api, ctx } = await open({ onRefresh: () => res });
      await enter(page);
      await doRefresh(page, api, 1);
      const t = await note(page, /没取到|停了|失败|出错|断了/);
      check(`L 整次失败（${how}）：写"这次没取到"、写明显示的还是 ${OLD.hm} 的数据、可以再点一次`, !!t && /没取到/.test(t) && t.includes(OLD.hm) && /再点/.test(t), t);
      check(`L 整次失败（${how}）：不说"已存好"，不逐个列代码`, !!t && !/存好/.test(t) && !CODES.some((c) => t.includes(c)), t);
      await ctx.close();
    });
  }

  // ---------------------------------------------------------------- M 中途断了（约定 2、3）
  await section('M 中途断了', async () => {
    const NEW_AT = '2026-11-10T10:30:00Z';
    const { page, api, ctx } = await open({
      onRefresh: (body, n) => {
        if (n === 1) { api.snap = { ...SNAP, fetched_at: NEW_AT }; return { next: 23, done: 23, total: 45, updated: FIRST23, failed: [], requests: 40 }; }
        return { __status: 500, body: { error: '服务器出错了' } }; // 第二批 D1 写库失败
      },
    });
    await enter(page);
    await doRefresh(page, api, 2);
    const t = await note(page, /前 ?23 ?只/);
    check(`M 中途断了：写"前 23 只已更新，其余 22 只还是 ${OLD.hm} 的数据，再点会从头取"`, !!t && /前 ?23 ?只[^；;。]*更新/.test(t) && /其余 ?22 ?只/.test(t) && t.includes(OLD.hm) && /再点/.test(t) && /从头/.test(t), t ?? (await note(page, /停了|没取到|失败|出错/)));
    const any = t ?? (await note(page, /停了|没取到|失败|出错/)) ?? '';
    check('M 中途断了：第二批（写库失败那批）不说成"已存好"', !/存好/.test(any), any);
    // 约定 3：没更新的 22 只要标出是上次的数据——标题上写明"有 22 只是旧时间的"，或者这 22 行每行都标"上次数据"（更新了的 23 行不标）
    const meta = (await note(page, /数据时间/)) ?? '';
    const restMarked = await Promise.all(REST22.map(async (c) => /上次/.test(await rowText(page, c))));
    const firstMarked = await Promise.all(FIRST23.map(async (c) => /上次/.test(await rowText(page, c))));
    const byMeta = /22 ?只/.test(meta) && /(上次|旧)/.test(meta);
    const byRows = restMarked.every(Boolean) && !firstMarked.some(Boolean);
    check('M 中途断了：没更新的 22 只标出是上次的数据（标题写明 22 只是旧时间的，或这 22 行都标"上次数据"、更新了的不标）', byMeta || byRows,
      { meta, restMarked: restMarked.filter(Boolean).length, firstMarked: firstMarked.filter(Boolean).length });
    await ctx.close();
  });

  // ---------------------------------------------------------------- N 刷新结果再长，按钮位置不变（约定 4）
  const LONG = SNAP.items.slice(0, 20).map((x) => ({ code: x.code, reason: 'Yahoo 8 秒没回应（试了 2 次）；东方财富 8 秒没回应（试了 2 次）：' + 'No data found, symbol may be delisted' }));
  for (const [how, onRefresh] of [
    ['20 只没取到（原因很长）', () => ({ next: null, done: 45, total: 45, updated: CODES.slice(20), failed: LONG, requests: 45 })],
    ['中途断了（服务器回一段很长的错）', (b, n) => (n === 1 ? { next: 12, done: 12, total: 45, updated: CODES.slice(0, 12), failed: [], requests: 30 } : { __status: 500, body: { error: '服务器出错了：' + '写库失败，'.repeat(30) } })],
  ]) {
    await section(`N 按钮位置：${how}`, async () => {
      const { page, api, ctx } = await open({ width: 1200, height: 900, onRefresh });
      await enter(page);
      const btn = page.locator(R).getByRole('button', { name: /刷新/ }).first();
      const b0 = await btn.boundingBox();
      await doRefresh(page, api, how.startsWith('中途') ? 2 : 1);
      const b1 = await btn.boundingBox();
      const same = !!b0 && !!b1 && Math.abs(b0.x - b1.x) <= 1 && Math.abs(b0.y - b1.y) <= 1;
      const topRight = !!b1 && b1.x + b1.width >= 1200 * 0.7 && b1.y <= 250;
      check(`N 1200 宽、${how}：刷新按钮前后位置不变、仍在右上`, same && topRight, { before: b0, after: b1 });
      await ctx.close();
    });
  }

  // ---------------------------------------------------------------- O 手机点散点：先出浮框，再点"看这一只"才跳（约定 5）
  await section('O 手机点散点', async () => {
    const { page, ctx } = await open({ width: 400, height: 860, colorScheme: 'light', touch: true });
    await enter(page);
    await page.locator(`${R} svg[role="img"]`).filter({ has: page.locator('circle') }).first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    // 选一个在视口里、中心点上最上面就是它自己的点
    const pick = await page.evaluate((R) => {
      const svg = [...document.querySelectorAll(R + ' svg[role="img"]')].filter((s) => s.getClientRects().length).sort((a, b) => b.querySelectorAll('circle[data-code]').length - a.querySelectorAll('circle[data-code]').length)[0];
      for (const c of svg ? svg.querySelectorAll('circle[data-code]') : []) {
        const r = c.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        if (y > 0 && y < innerHeight && document.elementFromPoint(x, y) === c) return { code: c.getAttribute('data-code'), x, y };
      }
      return null;
    }, R);
    if (!pick) { check('O 散点图里找得到一个点得着的点', false, null); await ctx.close(); return; }
    const name = BY[pick.code].name;
    const y0 = await page.evaluate(() => scrollY);
    await page.touchscreen.tap(pick.x, pick.y);
    await page.waitForTimeout(500);
    const y1 = await page.evaluate(() => scrollY);
    const go = page.locator(R).getByRole('button', { name: /看这一只/ }).or(page.locator(R).getByRole('link', { name: /看这一只/ })).filter({ visible: true }).first();
    const hasGo = await go.isVisible().catch(() => false);
    const tip = hasGo ? await go.evaluate((b, name) => { let e = b; while (e && !(e.innerText || '').includes(name)) e = e.parentElement; return e ? e.innerText.replace(/\s+/g, ' ').trim() : ''; }, name) : '';
    check(`O 手机点散点（${pick.code}）：先出浮框，写着名字、收益、回撤和"看这一只"`, hasGo && tip.includes(name) && /收益/.test(tip) && /回撤/.test(tip), { tip, hasGo });
    check('O 手机点散点：不直接滚走（页面不动、没有展开哪一行）', Math.abs(y1 - y0) <= 2 && (await page.locator(`${R} [data-code][aria-expanded="true"]`).count()) === 0, { y0, y1 });
    if (hasGo) {
      await go.tap().catch(() => go.click());
      await page.waitForTimeout(800);
      const inView = await page.evaluate(({ R, code }) => { const r = document.querySelector(`${R} [data-code="${code}"][aria-expanded]`)?.getBoundingClientRect(); return !!r && r.top >= 0 && r.bottom <= innerHeight; }, { R, code: pick.code });
      check(`O 再点"看这一只"：跳到 ${pick.code} 那一行（在视口里）`, inView, null);
    }
    await ctx.close();
  });

  // ---------------------------------------------------------------- P "上市不足"（约定 6）
  await section('P 上市不足', async () => {
    const { page, ctx } = await open();
    await enter(page);
    const pg = page.locator(R).getByRole('group', { name: '时间段' });
    await pg.getByRole('button', { name: '近 1 年' }).click();
    const short = SNAP.items.filter((x) => Array.isArray(x.series) && x.series.length && (x.y1 == null || x.dd_y1 == null)).length; // 3（XUS、XWR、UPD）
    const sub = await page.evaluate((R) => {
      const svg = [...document.querySelectorAll(R + ' svg[role="img"]')].filter((s) => s.getClientRects().length).sort((a, b) => b.querySelectorAll('circle').length - a.querySelectorAll('circle').length)[0];
      const card = svg?.closest('section') ?? svg?.parentElement;
      return card ? card.innerText.replace(/\s+/g, ' ').trim().slice(0, 400) : '';
    }, R);
    check(`P 散点副标题写出"${short} 只上市不满这段时间"（近 1 年、全部）`, new RegExp(`${short} ?只上市不满`).test(sub), sub.slice(0, 200));
    await page.locator(`${R} [data-code="XUS"][aria-expanded]`).first().click();
    await page.waitForTimeout(200);
    const cells = await page.evaluate(({ R, labels }) => {
      const tb = [...document.querySelectorAll(R + ' table')].filter((t) => t.getClientRects().length);
      const out = {};
      for (const t of tb) for (const tr of t.querySelectorAll('tr')) {
        const c = [...tr.children].map((x) => (x.innerText || '').trim());
        if (labels.includes(c[0])) out[c[0]] = c.slice(1);
      }
      return out;
    }, { R, labels: PERIODS.map((p) => p[0]) });
    const nullPeriods = PERIODS.filter(([, p]) => BY.XUS[p] == null).map(([l]) => l); // 今年以来、近 1 年
    const bad = nullPeriods.filter((l) => !cells[l] || cells[l].some((v) => v === '—' || v === '-') || !cells[l].some((v) => /上市不足/.test(v)));
    check(`P XUS 详情表里上市不足的格子（${nullPeriods.join('、')}）写"上市不足"不写"—"`, nullPeriods.length > 0 && bad.length === 0, { cells, bad });
    await ctx.close();
  });

  // ---------------------------------------------------------------- Q 每次进入都重新读（约定 7）
  await section('Q 每次进入都重新读', async () => {
    const { page, api, ctx } = await open();
    await enter(page);
    const g1 = api.gets;
    await page.evaluate(() => { location.hash = '#/tools'; });
    await page.waitForTimeout(300);
    await page.evaluate(() => { location.hash = '#/funds'; });
    const t0 = Date.now();
    while (api.gets <= g1 && Date.now() - t0 < 3000) await new Promise((ok) => setTimeout(ok, 30));
    check('Q 离开 #/funds 再回来：又发了一次 GET /api/funds', api.gets > g1, { before: g1, after: api.gets });
    await ctx.close();
  });

  // ---------------------------------------------------------------- R 从没取到过的那只单独说"没取到数据"（约定 10）
  await section('R 从没取到的那只', async () => {
    const strip = ({ market, category, name, code, symbol, source, tag }) => ({ market, category, name, code, symbol, source, tag });
    const before = { ...SNAP, items: SNAP.items.map((x) => (x.code === 'XUS' ? { ...strip(x), error: '还没取过' } : x)) };
    const after = { ...SNAP, fetched_at: '2026-11-10T10:30:00Z', items: SNAP.items.map((x) => (x.code === 'XUS' ? { ...strip(x), error: 'Yahoo 回 404' } : x.code === 'VOO' ? { ...x, error: 'Yahoo 8 秒没回应（试了 2 次）', error_at: '2026-11-10T10:30:00Z' } : x)) };
    const { page, api, ctx } = await open({
      snap: before,
      onRefresh: () => { api.snap = after; return { next: null, done: 45, total: 45, updated: CODES.filter((c) => c !== 'XUS' && c !== 'VOO'), failed: [{ code: 'VOO', reason: 'Yahoo 8 秒没回应（试了 2 次）' }, { code: 'XUS', reason: 'Yahoo 回 404' }], requests: 45 }; },
    });
    await enter(page);
    await doRefresh(page, api, 1);
    const t = (await note(page, /已更新|更新了/)) ?? '';
    const clauses = t.split(/[；;。]/);
    const xus = clauses.filter((c) => c.includes('XUS') || c.includes(BY.XUS.name));
    const n = [...t.matchAll(/(\d+) ?只[^；;。]*上次/g)].map((m) => Number(m[1]));
    check('R 刷完汇总：从没取到过的 XUS 单独说"没取到数据"，"那几行显示的是上次的数据"只算有旧数据的那 1 只（VOO）',
      /没取到数据/.test(t) && xus.every((c) => !/上次/.test(c) && /没取到数据/.test(c)) && n.every((x) => x === 1), { t, xus, n });
    await ctx.close();
  });

  // ---------------------------------------------------------------- S 手机上"1 日"有标签（约定 11）
  await section('S 手机 1 日标签', async () => {
    const { page, ctx } = await open({ width: 400, height: 860 });
    await enter(page);
    const t = (await rowText(page, 'QQQ')).replace(/\s+/g, ' ');
    check('S 400 宽：每行的"1 日"有标签可读（QQQ 那行读得到"1 日 +3.54%"）', /1 ?日[：: ]*\+?3\.54%/.test(t), t.slice(0, 160));
    await ctx.close();
  });
}

check('全程没有页面脚本报错', errors.length === 0, errors.slice(0, 5));
await browser.close();
srv?.stop();
if (fails.length) { console.error(`\n✗ 基金观察有 ${fails.length} 项不通过`); process.exit(1); }
console.log('\n✓ 基金观察全部通过');
process.exit(0);
