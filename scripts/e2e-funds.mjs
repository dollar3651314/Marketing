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
 *   第二版（Amos 2026-11-10 已定；数据 test/fixtures/funds/snapshot-v2.json；页面约定见 V 段开头）：
 *   V1. 1280 浅色："未来 1 个月的可能区间"板块每只一行、算不出的写"上市不满两个月"、ES3 / QQQ 写 68% 区间；"债券类：未来 1～3 年预期年化"16 行、
 *       近似的带"近似"和"≈"；写"不是投资建议"；展开 ES3 看得到"未来 1 个月"区间和喇叭区域；43 只详情里"最深 …"和喇叭区域包围盒不重叠；
 *       子菜单在主菜单下方一排、7 项（总结 / 市场 / 散点 / 可能区间 / 债券预期 / 逐只对比 / 说明）、点了滚到对应板块、滚动后高亮跟着变；对比度。
 *   V2. 400 深色：子菜单可横滑（或放得下）、页面不横向溢出、详情里"最深"不压喇叭、对比度。
 *   第三版小改（Amos 2026-11-11 已定；页面约定见 W 段开头）：
 *   W. 可能区间默认只显示从宽到窄的前 10 行 + 按钮"展开其余 N 只"（aria-expanded=false）→ 点了全显示、"收起"、aria-expanded=true；切市场 / 时间段恢复折叠；
 *      ≤ 10 行没有按钮（替身数据：新加坡只留 10 只）；按钮高 ≥ 44px；1200 浅色和 400 深色都折叠；子菜单点"可能区间"仍定位到板块。
 *   X. 刷新后债券提示按每只 yield.stale / yield.approx 分"过期 / 近似 / 没有收益率数据"、和行里的标签一致（服务端给了近似值的那只不说"过期""上次的值"）；
 *      refreshYields 整体失败（yields.failed 里 code 为 '*'）时不写"（*）"。
 *   第三版取数来源（Amos 2026-11-11「都按建议」，安全经理条款核对）：AGG、TLT、LQD、O9P 改近似（V1 的 auto / approx 名单和夹具同步改成 4 / 12）；
 *   Z. 产品复核（2026-11-11）：Z1 511990（price_kind=index）行不写 CNY、写"收益指数（起点 100）"，"说明"讲 511990 是指数不是价格、讲溢价 / 折价，
 *      中国 ETF 详情来源写"不是场内成交价"；Z2 可能区间展开后滚到底点"收起"，按钮在吸顶栏下方可见、子菜单 aria-current 仍是"可能区间"（1200、400）。
 *   Y. 中国场内 ETF（510300）展开详情，"来源"写东方财富净值（"东方财富净值"或"东方财富累计净值"都认），不写 Yahoo。接口一侧（不请求 Yahoo / iShares / BlackRock、增量取）在 test/funds-v3-sources.test.ts。
 *   测试用例修正 4（第三版）：V1 / V2 原来断言可能区间"全部时 45 行"，第三版默认折叠到 10 行，改成先点"展开其余 N 只"再数（不改判定口径）。
 *   第四版 ② 估值（Amos 2026-11-11「都按建议」；页面约定见 VA 段开头；接口一侧在 test/funds-v4-valuation.test.ts）：
 *   估值取数修复（2026-11-11，规格 5 文案；接口一侧在 test/funds-v5-valfix.test.ts）：VD1～VD3 从没取到过的写"还没有数据"、不出现"显示的是上次的数据"；有旧数据的才出现。
 *   VA. 1200 浅色："估值：现在贵不贵"6 张卡（data-val-code）、数值和判词（< 30 / 30～70 / > 70）、"不是预测、不是投资建议"、来源"中证指数有限公司、Robert Shiller"、
 *       子菜单"估值"点了定位 / 滚动高亮、切"美国"只剩标普500、"中国"5 张、"新加坡"只剩标普500（含 XUS；主会话规格更正，依据原型 v3）、对比度；VB. 判词分界；VC. 400 深色不横向溢出、对比度。
 *   估值"导入的历史"（2026-11-12，Amos 11/12 都按建议；I2 未定，默认导入数据不进顶部总结句；接口一侧在 test/funds-v7-import.test.ts；页面约定见 IM 段开头）：
 *   IM1. 1200 浅色：估值板块里有"参考：导入的历史"和按钮"导入估值历史"；选文件上传 → POST /api/funds/valuation/import（JSON 原样）→ "已导入 X 只…"；
 *        卡片判词"比过去 10 年 / 上市以来 X% 的时间都贵"、三档、单点写"等下次导入更长的历史再比贵贱"、"代理"按选用指标那段口径、小卡按文件顺序；
 *        市场切换过滤；顶部总结句导入前后文字相同；原来 6 张估值卡不变；免责在；对比度。IM2. 400 深色：不横向溢出、对比度、市场切换。IM3. 部分失败（真走本地服务器）：提示不写 dy / pe / pb、写"跳过的几只保留原来的数据"。
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

if (!PROTO) {
  // ================================================================ 第二版（Amos 2026-11-10 已定：① 未来 1 个月可能区间 ③ 债券类预期年化、展开详情的喇叭形区间、页面子菜单）
  // 测试先写（C154）。数据：test/fixtures/funds/snapshot-v2.json（snapshot.json + 每只 band + 16 只债券 yield，替身数据）。
  // 页面约定（研发照加；要改名就在同一个提交里改这里并写明）：
  //   可能区间板块：标题含"未来 1 个月的可能区间"，每只一行带 data-band-code="<code>"；
  //   债券板块：标题含"债券类：未来 1～3 年预期年化"，每只一行带 data-yield-code="<code>"；
  //   展开详情 [data-detail="<code>"]（现有）里写"未来 1 个月"和 68% 区间；喇叭区域的图形元素带 data-band（例如 data-band="68" / "95"）；
  //   子菜单：主菜单下方一排，<nav>（或 role=navigation，不是 #nav1），每项是 a 或 button，用 data-target="<板块 id>"（或 href="#<id>" / aria-controls）指到板块；
  //     当前板块那一项带 aria-current（或 class on / active / current）。
  const SNAP2 = JSON.parse(readFileSync(path.join(ROOT, 'test/fixtures/funds/snapshot-v2.json'), 'utf8'));
  const BY2 = Object.fromEntries(SNAP2.items.map((x) => [x.code, x]));
  const BONDS = SNAP2.items.filter((x) => x.category === '债券').map((x) => x.code);
  // 第三版规格变化（Amos 2026-11-11「都按建议」，安全经理条款核对：iShares / BlackRock 条款禁止自动抓取）：AGG、TLT、LQD、O9P 改成美国国债 + 利差近似，
  // auto 只剩 4 只、approx 12 只（夹具 snapshot-v2.json 同步改了；原来是 8 + 8，规格变化不是放宽）
  const AUTO8 = ['BND', 'BSV', '511990', '511880'];
  const APPROX8 = ['A35', 'MBH', '0P00006FY6', 'SBO', '511010', '511360', '000171', '217003', 'AGG', 'TLT', 'LQD', 'O9P'];
  const SUBS = [['总结', /总结/], ['市场', /市场/], ['散点', /散点|赚了多少/], ['可能区间', /区间/], ['债券预期', /债券/], ['逐只对比', /逐只/], ['说明', /说明/]];
  const pct1 = (v) => { const a = Math.abs(v).toFixed(1).replace('.', '\\.'); return new RegExp(`(^|[^\\d.])${v > 0 ? '\\+?' : v < 0 ? '[−-]' : '[+−-]?'}${a}%`); };
  const bandRows = (page) => page.locator(`${R} [data-band-code]`).filter({ visible: true });
  const yieldRows = (page) => page.locator(`${R} [data-yield-code]`).filter({ visible: true });
  const headingVisible = (page, re) => page.locator(R).getByRole('heading', { name: re }).first().isVisible().catch(() => false);
  /** 找子菜单：看得见的 nav / [role=navigation]（不是一级菜单），里面的 a / button 文字能对上 7 个板块；找到就打上 data-qa-subnav */
  const findSub = (page) => page.evaluate((pats) => {
    const res = pats.map(([, src]) => new RegExp(src));
    for (const n of document.querySelectorAll('nav, [role="navigation"]')) {
      if (n.id === 'nav1' || n.closest('#nav1') || !n.getClientRects().length) continue;
      const items = [...n.querySelectorAll('a, button')];
      const texts = items.map((a) => (a.textContent || '').replace(/\s+/g, ' ').trim());
      const idx = res.map((re) => texts.findIndex((t) => re.test(t)));
      if (idx.every((i) => i >= 0)) {
        n.setAttribute('data-qa-subnav', '');
        items.forEach((a, i) => a.setAttribute('data-qa-i', String(i)));
        const top = document.getElementById('nav1')?.getBoundingClientRect();
        const r = n.getBoundingClientRect();
        const tops = idx.map((i) => Math.round(items[i].getBoundingClientRect().top));
        return { idx, texts, belowMain: !top || r.top >= top.bottom - 1, oneRow: Math.max(...tops) - Math.min(...tops) <= 4, tops, rect: [r.left, r.top, r.width, r.height] };
      }
    }
    return null;
  }, SUBS.map(([n, re]) => [n, re.source]));
  /** 子菜单第 i 项指到的板块元素（data-target / href="#id" / aria-controls），打上 data-qa-target=<i> */
  const markTarget = (page, i) => page.evaluate((i) => {
    const a = document.querySelector(`[data-qa-subnav] [data-qa-i="${i}"]`);
    if (!a) return null;
    const href = a.getAttribute('href') || '';
    const id = a.getAttribute('data-target') || a.getAttribute('aria-controls') || (href.startsWith('#') && !href.startsWith('#/') ? href.slice(1) : '');
    const t = id && (document.getElementById(id.replace(/^#/, '')) || document.querySelector(id));
    if (!t) return { id, found: false };
    document.querySelectorAll('[data-qa-target]').forEach((x) => x.removeAttribute('data-qa-target'));
    t.setAttribute('data-qa-target', String(i));
    return { id, found: true, text: (t.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60) };
  }, i);
  const targetPos = (page) => page.evaluate(() => {
    const t = document.querySelector('[data-qa-target]');
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, atBottom: scrollY + innerHeight >= document.documentElement.scrollHeight - 2, hash: location.hash };
  });
  const activeIdx = (page) => page.evaluate(() => [...document.querySelectorAll('[data-qa-subnav] [data-qa-i]')]
    .filter((a) => { const c = a.getAttribute('aria-current'); return (c && c !== 'false') || /\b(on|active|current|is-active|cur)\b/.test(a.className && a.className.baseVal !== undefined ? a.className.baseVal : a.className); })
    .map((a) => Number(a.getAttribute('data-qa-i'))));
  /** 展开 code 的详情：量"最深 …"文字和喇叭区域（[data-band]）的包围盒有没有重叠 */
  async function deepVsCone(page, code) {
    const row = page.locator(`${R} [data-code="${code}"][aria-expanded]`).first();
    await row.scrollIntoViewIfNeeded().catch(() => {});
    await row.click();
    await page.locator(`${R} [data-detail="${code}"]`).first().waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
    const r = await page.evaluate(({ R, code }) => {
      const d = document.querySelector(`${R} [data-detail="${code}"]`);
      if (!d) return { err: '没有展开详情' };
      const cone = [...d.querySelectorAll('[data-band]')].filter((e) => e.getClientRects().length).map((e) => e.getBoundingClientRect());
      const deep = [...d.querySelectorAll('text, span, div')].filter((e) => e.getClientRects().length && /^最深/.test((e.textContent || '').trim()) && e.children.length === 0).map((e) => e.getBoundingClientRect());
      const hit = deep.some((a) => cone.some((b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5));
      return { cone: cone.length, deep: deep.length, hit, text: (d.innerText || '').replace(/\s+/g, ' ').slice(0, 300) };
    }, { R, code });
    await row.click().catch(() => {});
    return r;
  }

  // 第三版（Amos 2026-11-11 已定）可能区间折叠按钮：板块里（不在 [data-code] 行、[data-detail] 里）看得见的 button / [role=button]，
  //   文字是"展开其余 N 只"或"收起"，带 aria-expanded；找到就打上 data-qa-fold（每次重新找，按钮被重画也不怕）
  const foldBtn = (page) => page.evaluate((R) => {
    document.querySelectorAll('[data-qa-fold]').forEach((x) => x.removeAttribute('data-qa-fold'));
    const root = document.querySelector(R);
    if (!root) return null;
    const b = [...root.querySelectorAll('button, [role="button"]')].find((e) => e.getClientRects().length && !e.closest('[data-code]') && !e.closest('[data-detail]')
      && /^(展开其余\s*\d+\s*只|收起)$/.test((e.textContent || '').replace(/\s+/g, ' ').trim())
      && (() => { let s = e.parentElement; while (s && s !== root) { if (s.querySelector('[data-band-code]')) return true; s = s.parentElement; } return false; })());
    if (!b) return null;
    b.setAttribute('data-qa-fold', '');
    const r = b.getBoundingClientRect();
    return { text: (b.textContent || '').replace(/\s+/g, ' ').trim(), expanded: b.getAttribute('aria-expanded'), h: Math.round(r.height * 10) / 10, w: Math.round(r.width) };
  }, R);
  /** 可能区间板块有折叠按钮、且是折叠着的，就点开（老的检查要看全部 45 行） */
  async function expandBands(page) {
    const f = await foldBtn(page);
    if (f && f.expanded === 'false') { await page.locator('[data-qa-fold]').click(); await page.waitForTimeout(150); }
  }

  // ---------------------------------------------------------------- V1：1280 浅色
  await section('V1 第二版 1280 浅色', async () => {
    const { page, ctx } = await open({ snap: SNAP2 });
    await enter(page);
    // 可能区间
    check('V1 有"未来 1 个月的可能区间"板块', await headingVisible(page, /未来 ?1 ?个月的可能区间/), null);
    await expandBands(page); // 第三版起默认只显示前 10 行，先点"展开其余 N 只"（测试用例修正 4）
    const bcodes = await bandRows(page).evaluateAll((es) => es.map((e) => e.getAttribute('data-band-code')));
    check('V1 可能区间：全部时（展开后）每只一行（45 行，[data-band-code]）', bcodes.length === 45 && SNAP2.items.every((x) => bcodes.includes(x.code)), { n: bcodes.length, missing: SNAP2.items.map((x) => x.code).filter((c) => !bcodes.includes(c)) });
    const rt = async (sel) => (await page.locator(`${R} ${sel}`).first().innerText({ timeout: 1500 }).catch(() => '')).replace(/\s+/g, ' ');
    const short = [];
    for (const c of ['XUS', 'XWR']) short.push([c, await rt(`[data-band-code="${c}"]`)]);
    check('V1 可能区间：算不出的（XUS、XWR）那行写"上市不满两个月"', short.every(([, t]) => /上市不满两个月/.test(t)), short);
    for (const c of ['ES3', 'QQQ']) {
      const t = await rt(`[data-band-code="${c}"]`), b = BY2[c].band;
      check(`V1 可能区间：${c} 那行写 68% 区间 ${b[1].toFixed(1)}% ～ +${b[3].toFixed(1)}%`, pct1(b[1]).test(t) && pct1(b[3]).test(t), t.slice(0, 160));
    }
    // 债券
    check('V1 有"债券类：未来 1～3 年预期年化"板块', await headingVisible(page, /债券类[：:]\s*未来 ?1 ?[～~-] ?3 ?年预期年化/), null);
    const ycodes = await yieldRows(page).evaluateAll((es) => es.map((e) => e.getAttribute('data-yield-code')));
    check('V1 债券板块 16 行（[data-yield-code]），就是 16 只债券', ycodes.length === 16 && BONDS.every((c) => ycodes.includes(c)), { n: ycodes.length, ycodes });
    const badA = [], badB = [];
    for (const c of APPROX8) { const t = await rt(`[data-yield-code="${c}"]`); const v = BY2[c].yield.value; if (!(/近似/.test(t) && /≈/.test(t) && (t.includes(v.toFixed(2)) || t.includes(v.toFixed(1))))) badA.push([c, t.slice(0, 120)]); }
    for (const c of AUTO8) { const t = await rt(`[data-yield-code="${c}"]`); const v = BY2[c].yield.value; if (/≈/.test(t) || !(t.includes(v.toFixed(2)) || t.includes(v.toFixed(1)))) badB.push([c, t.slice(0, 120)]); }
    check('V1 债券：近似的 12 只带"近似"标签和"≈"，并写出数值', badA.length === 0, badA);
    check('V1 债券：自动取的 4 只写出数值、不带"≈"', badB.length === 0, badB);
    // 不是投资建议
    const all = await page.locator(R).innerText().catch(() => '');
    check('V1 页面写"不是投资建议"（看得见的文字）', /不是投资建议/.test(all), null);
    // 展开详情
    const es3 = page.locator(`${R} [data-code="ES3"][aria-expanded]`).first();
    await es3.scrollIntoViewIfNeeded().catch(() => {});
    await es3.click();
    const dt = (await page.locator(`${R} [data-detail="ES3"]`).first().innerText({ timeout: 2000 }).catch(() => '')).replace(/\s+/g, ' ');
    const cones = await page.locator(`${R} [data-detail="ES3"] svg [data-band]`).count();
    const b = BY2.ES3.band;
    check(`V1 展开 ES3：详情写"未来 1 个月"和区间 ${b[1].toFixed(1)}% ～ +${b[3].toFixed(1)}%，图上有喇叭区域（[data-band]）`, /未来 ?1 ?个月/.test(dt) && pct1(b[1]).test(dt) && pct1(b[3]).test(dt) && cones >= 1, { cones, dt: dt.slice(0, 200) });
    await es3.click();
    // "最深 …" 和喇叭区域不重叠（每只有区间的都量）
    const over = [], miss = [];
    for (const x of SNAP2.items.filter((x) => x.band)) {
      const r = await deepVsCone(page, x.code);
      if (r.err || !r.cone) miss.push([x.code, r.err || '没有 [data-band]']);
      else if (r.hit) over.push(x.code);
    }
    check('V1 1280 宽：43 只的详情里都有喇叭区域', miss.length === 0, miss.slice(0, 6));
    check('V1 1280 宽：每只详情里"最深 …"标注和喇叭区域的包围盒不重叠', over.length === 0, over);
    // 子菜单
    await page.evaluate(() => scrollTo(0, 0));
    const sub = await findSub(page);
    check('V1 子菜单：有一排（不是一级菜单）包含 总结 / 市场 / 散点 / 可能区间 / 债券预期 / 逐只对比 / 说明 7 项', !!sub, sub);
    if (sub) {
      check('V1 子菜单在主菜单下方、排成一排', sub.belowMain && sub.oneRow, sub);
      const badClick = [];
      for (let k = 0; k < SUBS.length; k++) {
        const i = sub.idx[k];
        const tg = await markTarget(page, i);
        if (!tg?.found) { badClick.push([SUBS[k][0], '找不到指向的板块', tg]); continue; }
        await page.evaluate((top) => scrollTo(0, top), k === 0 ? 99999 : 0);
        await page.waitForTimeout(200);
        await page.locator(`[data-qa-subnav] [data-qa-i="${i}"]`).click();
        await page.waitForTimeout(900);
        const p = await targetPos(page);
        const ok = !!p && /^#\/(tools\/)?funds/.test(p.hash) && p.top < p.vh && p.bottom > 0 && (p.top >= -4 && p.top <= p.vh * 0.4 || p.atBottom);
        if (!ok) badClick.push([SUBS[k][0], tg.id, p]);
      }
      check('V1 子菜单：点每一项都滚到对应板块（板块顶在视口上部 40% 内，或已到页底），地址仍是 #/funds', badClick.length === 0, badClick);
      const badHl = [];
      let n = 0;
      for (let k = 0; k < SUBS.length; k++) {
        const i = sub.idx[k];
        const tg = await markTarget(page, i);
        if (!tg?.found) continue;
        await page.evaluate(() => { const t = document.querySelector('[data-qa-target]'); scrollTo(0, scrollY + t.getBoundingClientRect().top - 140); });
        await page.waitForTimeout(500);
        const p = await targetPos(page);
        if (!p || Math.abs(p.top - 140) > 40) continue; // 页底够不着的板块不量
        n++;
        const act = await activeIdx(page);
        if (!(act.length === 1 && act[0] === i)) badHl.push([SUBS[k][0], act.map((a) => sub.texts[a])]);
      }
      check('V1 子菜单：滚动（不点）到某个板块，高亮跟着变成那一项（至少量到 4 个板块）', n >= 4 && badHl.length === 0, { n, badHl });
      const lc = await lowContrast(page, [R, '[data-qa-subnav]']);
      check('V1 浅色：#v-funds 和子菜单文字对比度 ≥ 4.5', lc.bad.length === 0, lc.bad);
    }
    await ctx.close();
  });

  // ---------------------------------------------------------------- V2：400 深色
  await section('V2 第二版 400 深色', async () => {
    const { page, ctx } = await open({ snap: SNAP2, width: 400, height: 860, colorScheme: 'dark' });
    await enter(page);
    await expandBands(page); // 第三版：先展开（测试用例修正 4）
    check('V2 400 宽：有可能区间 45 行（展开后）、债券 16 行', (await bandRows(page).count()) === 45 && (await yieldRows(page).count()) === 16, { band: await bandRows(page).count(), yld: await yieldRows(page).count() });
    const sub = await findSub(page);
    check('V2 400 宽：子菜单在（7 项）', !!sub, sub);
    if (sub) {
      const sw = await page.evaluate(() => {
        const n = document.querySelector('[data-qa-subnav]');
        const items = [...n.querySelectorAll('[data-qa-i]')];
        const inView = items.every((a) => { const r = a.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; });
        // 可横滑：nav 自己或里面某一层能横向滚动
        const sc = [n, ...n.querySelectorAll('*')].find((e) => e.scrollWidth > e.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(e).overflowX));
        let moved = false;
        if (sc) { const s0 = sc.scrollLeft; sc.scrollLeft = s0 + 200; moved = sc.scrollLeft > s0; sc.scrollLeft = s0; }
        return { inView, scrollable: !!sc, moved };
      });
      check('V2 400 宽：子菜单放不下时可以横滑（或 7 项都在屏幕里）', sw.inView || (sw.scrollable && sw.moved), sw);
    }
    check('V2 400 宽：页面不横向溢出', await noHScroll(page), await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]));
    const over = [], miss = [];
    for (const c of ['ES3', 'QQQ', 'HST', '588000', 'TLT', 'UPD', 'BYJ']) {
      const r = await deepVsCone(page, c);
      if (r.err || !r.cone) miss.push([c, r.err || '没有 [data-band]']); else if (r.hit) over.push(c);
    }
    check('V2 400 宽：详情里有喇叭区域，"最深 …"和它不重叠（ES3、QQQ、HST、588000、TLT、UPD、BYJ）', miss.length === 0 && over.length === 0, { miss, over });
    await page.locator(`${R} [data-code="ES3"][aria-expanded]`).first().click();
    check('V2 400 宽：展开 ES3 后页面不横向溢出', await noHScroll(page), await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]));
    const lc = await lowContrast(page, sub ? [R, '[data-qa-subnav]'] : [R]);
    check('V2 深色：#v-funds（含新板块、展开详情）和子菜单文字对比度 ≥ 4.5', lc.bad.length === 0, lc.bad);
    await ctx.close();
  });

  /** 点"刷新"、等发了 1 次 POST 且按钮恢复可点，再等结果文字画上去（同第二轮的 doRefresh，那个在别的块里够不着） */
  async function refreshOnce(page, api) {
    const btn = page.locator(R).getByRole('button', { name: /刷新/ }).first();
    await btn.click();
    const t0 = Date.now();
    while (Date.now() - t0 < WAIT && (api.posts.length < 1 || !(await btn.isEnabled().catch(() => false)))) await new Promise((ok) => setTimeout(ok, 30));
    await page.waitForTimeout(400);
  }
  // ================================================================ 第三版小改（Amos 2026-11-11 已定；测试先写，C154）
  // W. 可能区间板块默认只显示前 10 行（从宽到窄），下面一个按钮"展开其余 N 只"（N = 当前市场的总行数 − 10）、aria-expanded=false；
  //    点了全部显示、按钮写"收起"、aria-expanded=true；再点收回 10 行；切市场 / 时间段后恢复折叠；行数 ≤ 10 时没有这个按钮；
  //    按钮高 ≥ 44px；1200 和 400 宽都折叠；子菜单点"可能区间"仍定位到板块。
  //    页面约定：按钮是 button（或 role=button），在可能区间板块里、不带 data-code；文字正好是"展开其余 N 只"或"收起"。
  // X. 刷新后债券那块的提示按每只 yield.stale / yield.approx 分三种说（"过期" / "近似" / "还没有收益率数据"），和那一行的标签一致；
  //    refreshYields 整体失败（yields.failed 里 code 为 '*'）时不显示"（*）"。
  const bw = (f) => f.band[3] - f.band[1];
  /** 某个市场（'' = 全部）在可能区间板块里应有的行：有区间的按 68% 段从宽到窄，算不出的排最后 */
  const bandOrder = (snap, m) => { const xs = snap.items.filter((x) => !m || x.market === m); return [...xs.filter((x) => x.band).sort((a, b) => bw(b) - bw(a)), ...xs.filter((x) => !x.band)].map((x) => x.code); };
  const bandCodes = (page) => bandRows(page).evaluateAll((es) => es.map((e) => e.getAttribute('data-band-code')));
  const clickFold = async (page) => { await foldBtn(page); await page.locator('[data-qa-fold]').click(); await page.waitForTimeout(150); };
  /** 量一次：看得见的行、按钮状态 */
  const foldState = async (page) => ({ codes: await bandCodes(page), btn: await foldBtn(page) });
  const tabOf = (page, m) => page.locator(R).getByRole('tablist', { name: '市场' }).getByRole('tab', { name: new RegExp('^\\s*' + (m || '全部')) });
  const periodOf = (page, label) => page.locator(R).getByRole('group', { name: '时间段' }).getByRole('button', { name: label });

  for (const [vw, scheme] of [[1200, 'light'], [400, 'dark']]) {
    await section(`W 可能区间折叠 ${vw} ${scheme}`, async () => {
      const { page, ctx } = await open({ snap: SNAP2, width: vw, height: 900, colorScheme: scheme });
      await enter(page);
      await page.locator(`${R} [data-band-code]`).first().waitFor({ state: 'attached', timeout: WAIT }).catch(() => {});
      const all45 = bandOrder(SNAP2, '');
      let s = await foldState(page);
      check(`W ${vw} 宽：默认只显示前 10 行，就是从宽到窄的前 10 只`, s.codes.length === 10 && JSON.stringify(s.codes) === JSON.stringify(all45.slice(0, 10)), { got: s.codes, want: all45.slice(0, 10) });
      check(`W ${vw} 宽：下面有按钮"展开其余 35 只"、aria-expanded=false`, !!s.btn && /^展开其余 ?35 ?只$/.test(s.btn.text) && s.btn.expanded === 'false', s.btn);
      check(`W ${vw} 宽：按钮高 ≥ 44px`, !!s.btn && s.btn.h >= 44, s.btn);
      if (vw === 400) check('W 400 宽：折叠时页面不横向溢出', await noHScroll(page), await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]));
      if (!s.btn) { await ctx.close(); return; }
      await clickFold(page);
      s = await foldState(page);
      check(`W ${vw} 宽：点了全部 45 行显示（顺序仍从宽到窄、算不出的在最后）、按钮写"收起"、aria-expanded=true`,
        s.codes.length === 45 && JSON.stringify(s.codes) === JSON.stringify(all45) && !!s.btn && s.btn.text === '收起' && s.btn.expanded === 'true', { n: s.codes.length, btn: s.btn });
      check(`W ${vw} 宽：展开后按钮高仍 ≥ 44px`, !!s.btn && s.btn.h >= 44, s.btn);
      if (vw === 400) check('W 400 宽：展开后页面不横向溢出', await noHScroll(page), await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]));
      if (s.btn) {
        await clickFold(page);
        s = await foldState(page);
        check(`W ${vw} 宽：再点"收起"回到 10 行、按钮回到"展开其余 35 只"、aria-expanded=false`, s.codes.length === 10 && !!s.btn && /^展开其余 ?35 ?只$/.test(s.btn.text) && s.btn.expanded === 'false', { n: s.codes.length, btn: s.btn });
      }
      // 展开着切市场：恢复折叠；N 按这个市场算
      for (const [m, n] of [['美国', 15], ['中国', 16], ['新加坡', 14]]) {
        await expandBands(page);
        const opened = (await bandCodes(page)).length;
        await tabOf(page, m).click();
        await page.waitForTimeout(150);
        s = await foldState(page);
        const want = bandOrder(SNAP2, m);
        check(`W ${vw} 宽：展开着切到"${m}"→ 恢复折叠，显示这个市场从宽到窄的前 10 只，按钮"展开其余 ${n - 10} 只"、aria-expanded=false`,
          opened > 10 && JSON.stringify(s.codes) === JSON.stringify(want.slice(0, 10)) && !!s.btn && new RegExp(`^展开其余 ?${n - 10} ?只$`).test(s.btn.text) && s.btn.expanded === 'false',
          { opened, got: s.codes, want: want.slice(0, 10), btn: s.btn });
      }
      // 展开着切时间段：恢复折叠
      await tabOf(page, '').click();
      await page.waitForTimeout(150);
      await expandBands(page);
      const opened = (await bandCodes(page)).length;
      await periodOf(page, '近 1 月').click();
      await page.waitForTimeout(150);
      s = await foldState(page);
      check(`W ${vw} 宽：展开着切时间段（近 1 月）→ 恢复折叠（10 行、"展开其余 35 只"、aria-expanded=false）`, opened === 45 && s.codes.length === 10 && !!s.btn && /^展开其余 ?35 ?只$/.test(s.btn.text) && s.btn.expanded === 'false', { opened, n: s.codes.length, btn: s.btn });
      // 子菜单点"可能区间"仍定位到板块（折叠着、展开着各点一次）
      const sub = await findSub(page);
      const k = SUBS.findIndex(([n]) => n === '可能区间');
      if (!sub) check(`W ${vw} 宽：子菜单在`, false, null);
      else for (const how of ['折叠着', '展开着']) {
        if (how === '展开着') await expandBands(page);
        const tg = await markTarget(page, sub.idx[k]);
        await page.evaluate(() => scrollTo(0, 0));
        await page.waitForTimeout(150);
        await page.locator(`[data-qa-subnav] [data-qa-i="${sub.idx[k]}"]`).click();
        await page.waitForTimeout(900);
        const p = await targetPos(page);
        const head = await page.evaluate(() => { const h = document.querySelector('[data-qa-target]'); return !!h && /未来 ?1 ?个月的可能区间/.test(h.textContent || ''); });
        check(`W ${vw} 宽：${how}时子菜单点"可能区间"仍滚到可能区间板块（板块顶在视口上部 40% 内）`, !!tg?.found && head && !!p && p.top >= -4 && p.top <= p.vh * 0.4, { tg, p, head });
      }
      await ctx.close();
    });
  }

  await section('W 行数 ≤ 10 没有按钮', async () => {
    // 替身数据：新加坡只留 10 只（正好 10 行，边界）；全部 = 41 行
    const sg = SNAP2.items.filter((x) => x.market === '新加坡').slice(0, 10).map((x) => x.code);
    const snap = { ...SNAP2, items: SNAP2.items.filter((x) => x.market !== '新加坡' || sg.includes(x.code)) };
    const { page, ctx } = await open({ snap, width: 1200 });
    await enter(page);
    await page.locator(`${R} [data-band-code]`).first().waitFor({ state: 'attached', timeout: WAIT }).catch(() => {});
    let s = await foldState(page);
    check('W 41 只时：显示 10 行、按钮"展开其余 31 只"', s.codes.length === 10 && !!s.btn && /^展开其余 ?31 ?只$/.test(s.btn.text), { n: s.codes.length, btn: s.btn });
    await tabOf(page, '新加坡').click();
    await page.waitForTimeout(150);
    s = await foldState(page);
    check('W 切到"新加坡"（正好 10 行）：10 行全显示、没有"展开其余 / 收起"按钮', s.codes.length === 10 && sg.every((c) => s.codes.includes(c)) && !s.btn, s);
    await ctx.close();
  });

  // ---------------------------------------------------------------- X 收益率提示按每只的状态分三种
  /** 债券那块的提示：看得见、不在 [data-yield-code] / [data-code] / [data-detail] 行里、文字里同时有 codes 每只（代码或名字）的最小元素 */
  const yNote = (page, codes) => page.evaluate(({ R, keys }) => {
    const root = document.querySelector(R);
    if (!root) return null;
    const hit = [...root.querySelectorAll('*')].filter((e) => e.getClientRects().length && !e.closest('[data-yield-code]') && !e.closest('[data-code]') && !e.closest('[data-detail]') && !e.closest('svg'))
      .map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter((t) => t.length <= 600 && keys.every((ks) => ks.some((k) => t.includes(k))));
    return hit.length ? hit.sort((a, b) => a.length - b.length)[0] : null;
  }, { R, keys: codes.map((c) => [c, BY2[c].name]) });
  const yRow = async (page, c) => (await page.locator(`${R} [data-yield-code="${c}"]`).first().innerText({ timeout: 1500 }).catch(() => '')).replace(/\s+/g, ' ');

  await section('X 收益率提示分三种', async () => {
    // AGG：有过值、这次美国国债曲线没取到 → stale=true（页面标"过期"）
    // BSV：第一次刷新时 Vanguard 页网络失败、服务端用美国国债给了近似值 → approx=true、stale=false（页面标"近似"，没有"过期"）——它照样在 yields.failed 里
    //   （原来用 TLT / iShares；第三版 TLT 本来就是近似、不再抓 iShares，换成仍是 auto 的 BSV，守的事不变）
    // BND：从没取到过 → value=null（页面写"还没有收益率数据"）
    const nul = (c) => ({ ...BY2[c].yield, value: null, asOf: null, source: '', stale: false });
    const before = { ...SNAP2, items: SNAP2.items.map((x) => (x.code === 'BSV' || x.code === 'BND' ? { ...x, yield: nul(x.code) } : x)) };
    const after = { ...SNAP2, fetched_at: '2026-11-10T10:30:00Z', items: SNAP2.items.map((x) =>
      x.code === 'AGG' ? { ...x, yield: { ...x.yield, stale: true, error: '美国国债也没取到：Treasury 回 503' } }
      : x.code === 'BSV' ? { ...x, yield: { ...x.yield, value: 4.41, kind: 'auto', approx: true, label: '近似：美国国债 + 利差', asOf: '2026-11-10', source: '美国财政部', stale: false } }
      : x.code === 'BND' ? { ...x, yield: { ...nul('BND'), stale: true, error: 'Vanguard 回 503；美国国债也没取到：Treasury 回 503' } }
      : x) };
    const CODES = SNAP2.items.map((x) => x.code);
    const { page, api, ctx } = await open({
      snap: before,
      onRefresh: () => { api.snap = after; return { next: null, done: 45, total: 45, updated: CODES, failed: [], requests: 45,
        yields: { updated: BONDS.filter((c) => !['AGG', 'BSV', 'BND'].includes(c)), failed: [{ code: 'AGG', reason: '美国国债也没取到：Treasury 回 503' }, { code: 'BSV', reason: 'Vanguard 8 秒没回应（试了 2 次）' }, { code: 'BND', reason: 'Vanguard 回 503；美国国债也没取到：Treasury 回 503' }], requests: 12, curves: { ust: 'ok', sgs: 'ok', cgb: 'ok' } } }; },
    });
    await enter(page);
    await refreshOnce(page, api);
    // 先确认到了要检查的状态（C29）：刷新发了、行里的标签已经是新的
    const rAGG = await yRow(page, 'AGG'), rBSV = await yRow(page, 'BSV'), rBND = await yRow(page, 'BND');
    check('X 前提：刷了一次；AGG 行标"过期"、BSV 行标"近似"不标"过期"、BND 行写"还没有收益率数据"',
      api.posts.length === 1 && /过期/.test(rAGG) && /近似/.test(rBSV) && !/过期/.test(rBSV) && /没有收益率数据/.test(rBND), { posts: api.posts.length, rAGG, rBSV, rBND });
    const t = (await yNote(page, ['AGG', 'BSV', 'BND'])) ?? '';
    const cl = (c) => t.split(/[；;。\n]/).filter((x) => x.includes(c) || x.includes(BY2[c].name));
    const [cA, cT, cB] = [cl('AGG'), cl('BSV'), cl('BND')];
    check('X 刷新后有一句提示同时说到 AGG、BSV、BND', !!t, t);
    check('X AGG（stale=true）：提示里说它"过期"', cA.length > 0 && cA.every((x) => /过期/.test(x)), cA);
    check('X BSV（approx=true、stale=false）：提示里说它退回"近似"，不说"过期"、不说"显示的是上次的值"', cT.length > 0 && cT.every((x) => /近似/.test(x) && !/过期/.test(x) && !/上次/.test(x)), cT);
    check('X BND（value=null）：提示里说它"没有收益率数据"，不说"过期" / "上次的值"', cB.length > 0 && cB.every((x) => /没有收益率数据/.test(x) && !/过期/.test(x) && !/上次/.test(x)), cB);
    await ctx.close();
  });

  await section('Y 中国场内 ETF 来源', async () => {
    const { page, ctx } = await open({ snap: SNAP2 });
    await enter(page);
    const row = page.locator(`${R} [data-code="510300"][aria-expanded]`).first();
    await row.scrollIntoViewIfNeeded().catch(() => {});
    await row.click();
    const dt = (await page.locator(`${R} [data-detail="510300"]`).first().innerText({ timeout: 2000 }).catch(() => '')).replace(/\s+/g, ' ');
    check('Y 510300 详情的"来源"写东方财富净值、不写 Yahoo', /来源[：:]?\s*东方财富(累计)?净值/.test(dt) && !/Yahoo/i.test(dt), dt.slice(-160));
    await ctx.close();
  });

  // ---------------------------------------------------------------- Z 产品复核（2026-11-11，R1 / Y1 / Y2；测试先写，C154）
  // Z1（R1）：511990 是收益指数（price_kind = 'index'，夹具里 currency 仍留 CNY）→ 逐只对比那一行不写"CNY"、写"收益指数（起点 100）"；"说明"里讲清 511990 是指数不是价格。
  // Z1（Y2）：中国场内 ETF 详情的来源写"不是场内成交价"；"说明"里讲溢价 / 折价。
  // Z2（Y1）：可能区间展开后滚到底点"收起"→ 按钮在吸顶栏（子菜单所在的 sticky / fixed 那一层）下方看得见，子菜单 aria-current 仍是"可能区间"；1200 和 400 都测。
  /** "说明"板块（子菜单"说明"那一项指到的元素）：是 <details> 就先打开，回它的文字 */
  const helpText = async (page) => {
    const sub = await findSub(page);
    if (!sub) return '';
    const tg = await markTarget(page, sub.idx[SUBS.findIndex(([n]) => n === '说明')]);
    if (!tg?.found) return '';
    return page.evaluate(() => { const t = document.querySelector('[data-qa-target]'); t.querySelectorAll('details').forEach((d) => { d.open = true; }); if (t.tagName === 'DETAILS') t.open = true; return (t.innerText || t.textContent || ''); });
  };
  await section('Z1 511990 收益指数、来源说明', async () => {
    const { page, ctx } = await open({ snap: SNAP2 });
    await enter(page);
    const row = (await rowText(page, '511990')).replace(/\s+/g, ' ');
    check('Z1 511990（price_kind=index）那一行不写"CNY"、写"收益指数（起点 100）"', !!row && !/CNY/.test(row) && /收益指数[（(]起点 ?100[)）]/.test(row), row.slice(0, 200));
    const r510 = page.locator(`${R} [data-code="510300"][aria-expanded]`).first();
    await r510.scrollIntoViewIfNeeded().catch(() => {});
    await r510.click();
    const dt = (await page.locator(`${R} [data-detail="510300"]`).first().innerText({ timeout: 2000 }).catch(() => '')).replace(/\s+/g, ' ');
    check('Z1 510300 详情的来源写东方财富净值，并写明"不是场内成交价"', /东方财富/.test(dt) && /不是场内成交价/.test(dt), dt.slice(-200));
    await r510.click().catch(() => {});
    const help = await helpText(page);
    const parts = help.split(/[。；;\n]/);
    const idx = parts.filter((x) => x.includes('511990') && /指数/.test(x) && /不是[^，,。]{0,8}价格/.test(x));
    check('Z1 "说明"里有一句讲 511990 画的是收益指数、不是价格', idx.length > 0, parts.filter((x) => x.includes('511990')).map((x) => x.trim()).slice(0, 4));
    check('Z1 "说明"里讲到溢价 / 折价（东方财富净值和场内成交价的差别）', /溢价/.test(help) && /折价/.test(help), help.replace(/\s+/g, ' ').slice(0, 120));
    await ctx.close();
  });
  for (const [vw, scheme] of [[1200, 'light'], [400, 'dark']]) {
    await section(`Z2 收起后按钮可见 ${vw}`, async () => {
      const { page, ctx } = await open({ snap: SNAP2, width: vw, height: 900, colorScheme: scheme });
      await enter(page);
      const sub = await findSub(page);
      const k = sub ? sub.idx[SUBS.findIndex(([n]) => n === '可能区间')] : -1;
      await expandBands(page);
      const f0 = await foldBtn(page);
      check(`Z2 ${vw} 宽：前提：可能区间已展开（按钮写"收起"、45 行）`, !!f0 && f0.text === '收起' && (await bandRows(page).count()) === 45, f0);
      if (!f0 || f0.text !== '收起') { await ctx.close(); return; }
      // 滚到底：让"收起"按钮落在视口最下面，再点
      await page.evaluate(() => document.querySelector('[data-qa-fold]').scrollIntoView({ block: 'end' }));
      await page.waitForTimeout(300);
      await page.locator('[data-qa-fold]').click();
      await page.waitForTimeout(900);
      const f1 = await foldBtn(page);
      const pos = await page.evaluate(() => {
        const b = document.querySelector('[data-qa-fold]');
        const nav = document.querySelector('[data-qa-subnav]');
        // 吸顶栏：子菜单自己或往上第一层 position 是 sticky / fixed 的元素；找不到就用子菜单本身
        let bar = nav;
        for (let e = nav; e && e !== document.body; e = e.parentElement) { const ps = getComputedStyle(e).position; if (ps === 'sticky' || ps === 'fixed') { bar = e; break; } }
        const r = b && b.getBoundingClientRect(), br = bar && bar.getBoundingClientRect();
        const cur = [...document.querySelectorAll('[data-qa-subnav] [data-qa-i]')].filter((a) => { const c = a.getAttribute('aria-current'); return c && c !== 'false'; }).map((a) => Number(a.getAttribute('data-qa-i')));
        return r && br ? { top: Math.round(r.top), bottom: Math.round(r.bottom), barBottom: Math.round(br.bottom), vh: innerHeight, cur } : { err: !b ? '找不到按钮' : '找不到吸顶栏', cur };
      });
      check(`Z2 ${vw} 宽：滚到底点"收起"→ 收回 10 行、按钮写"展开其余 35 只"`, (await bandRows(page).count()) === 10 && !!f1 && /^展开其余 ?35 ?只$/.test(f1.text), f1);
      check(`Z2 ${vw} 宽：收起后按钮在吸顶栏下方看得见（按钮 top ≥ 吸顶栏底边、bottom ≤ 视口底）`, !pos.err && pos.top >= pos.barBottom - 1 && pos.bottom <= pos.vh, pos);
      check(`Z2 ${vw} 宽：收起后子菜单 aria-current 仍是"可能区间"`, !!sub && pos.cur.length === 1 && pos.cur[0] === k, { cur: pos.cur.map((i) => sub?.texts[i]), want: '可能区间' });
      await ctx.close();
    });
  }

  await section('X 收益率整体失败不写（*）', async () => {
    const { page, api, ctx } = await open({
      snap: SNAP2,
      onRefresh: () => ({ next: null, done: 45, total: 45, updated: SNAP2.items.map((x) => x.code), failed: [], requests: 45,
        yields: { updated: [], failed: [{ code: '*', reason: 'iShares 回 503' }], requests: 0, curves: { ust: 'iShares 回 503', sgs: 'iShares 回 503', cgb: 'iShares 回 503' } } }),
    });
    await enter(page);
    const stars = (txt) => (txt.match(/\*/g) || []).length;
    const t0 = await page.locator(R).innerText().catch(() => '');
    await refreshOnce(page, api);
    const t1 = await page.locator(R).innerText().catch(() => '');
    check('X 前提：刷了一次、按钮恢复可点', api.posts.length === 1 && (await page.locator(R).getByRole('button', { name: /刷新/ }).first().isEnabled().catch(() => false)), api.posts.length);
    const m = t1.match(/[^。\n]*[（(]\s*\*\s*[)）][^。\n]*/);
    check('X refreshYields 整体失败（failed 里 code 为 "*"）：页面上不出现"（*）"，也没有多出 "*"', !m && stars(t1) <= stars(t0), { hit: m && m[0], before: stars(t0), after: stars(t1) });
    await ctx.close();
  });
  // ================================================================ 第四版 ② 估值"现在贵不贵"（Amos 2026-11-11「都按建议」；测试先写，C154）
  // 依据：原型《基金观察原型-v3.html》#valuation（主会话 scratchpad，未进仓库）；数据 test/fixtures/funds/valuation/val-ref.json（调研 2026-11-11 实抓算的标准答案）。
  // 页面约定（研发照加；要改名就在同一个提交里改这里并写明）：
  //   数据：GET /api/funds 顶层 valuation = { items: ValItem[] }，或单独 GET /api/funds/valuation 回 { items }（字段见 test/funds-v4-valuation.test.ts 文件头）；本段两种都给替身。
  //   板块：标题（heading）含"估值：现在贵不贵"；每个指数一张卡，带 data-val-code="<code>"（000300 / 000016 / 000905 / 000015 / 000922 / SPX）。
  //   卡里：名字、当前值（pe_now）、10 年分位（四舍五入到整数 + "%"）、中位 / 最低 / 最高、股息率、两种预期年化（1 位或 2 位小数）；
  //     判词按分位：< 30 写"便宜"（不写"贵"），30～70（含两端）写"中间"（不写"便宜"、不写"比过去贵"），> 70 写"贵"（不写"便宜"）。
  //   板块里写"不是预测"、"不是投资建议"；来源写"中证指数有限公司"、"Robert Shiller"。
  //   子菜单多一项"估值"（data-target / href / aria-controls 指到这个板块）：点了滚到板块；滚到板块时高亮它。
  //   市场切换：全部 6 张；"美国"只有 SPX；"中国"只有 5 张 A 股；"新加坡"只有 SPX 这 1 张、卡上基金列表含 XUS（XUS 在新加坡上市、跟踪标普500）。
  //     （主会话规格更正，依据 Amos 审过的原型 v3：原派工单写的"新加坡显示说明无卡"是主会话写错了）
  //   400 宽不横向溢出；1200 浅色、400 深色对比度 ≥ 4.5；全程无 pageerror。
  // VA. 1200 浅色：以上全部；VB. 判词分界（替身把分位改成 29.2 / 30 / 70 / 70.8）；VC. 400 深色：6 张、不横向溢出、对比度、市场切换。
  const VREF = JSON.parse(readFileSync(path.join(ROOT, 'test/fixtures/funds/valuation/val-ref.json'), 'utf8'));
  const VCN = ['000300', '000016', '000905', '000015', '000922'];
  const VALL = [...VCN, 'SPX'];
  const snapV = (items) => ({ ...SNAP2, valuation: { items, fetched_at: '2026-11-11T03:00:00.000Z' } });
  /** 打开带估值数据的页面：GET /api/funds 带 valuation；GET /api/funds/valuation 回同一份；POST /api/funds/valuation/refresh 回空结果 */
  async function openV(opts, items = VREF.items) {
    const o = await open({ ...opts, snap: snapV(items) });
    await o.ctx.route(/\/api\/funds\/valuation(\/refresh)?(\?.*)?$/, async (r) => {
      if (r.request().method() === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items, fetched_at: '2026-11-11T03:00:00.000Z' }) });
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ next: null, updated: [], failed: [] }) });
    });
    return o;
  }
  /** 估值板块：标题"估值：现在贵不贵"所在的 section（或 [id] 祖先），打上 data-qa-val */
  const markVal = (page) => page.evaluate((R) => {
    document.querySelectorAll('[data-qa-val]').forEach((x) => x.removeAttribute('data-qa-val'));
    const root = document.querySelector(R);
    const h = root && [...root.querySelectorAll('h1,h2,h3,h4,[role="heading"]')].find((e) => /估值[：:]\s*现在贵不贵/.test(e.textContent || ''));
    if (!h) return null;
    const sec = h.closest('section') || h.closest('[id]') || h.parentElement;
    sec.setAttribute('data-qa-val', '');
    return { id: sec.id, visible: !!sec.getClientRects().length && !!h.getClientRects().length };
  }, R);
  const valCards = (page) => page.locator(`${R} [data-val-code]`).filter({ visible: true });
  const valCodes = (page) => valCards(page).evaluateAll((es) => es.map((e) => e.getAttribute('data-val-code')));
  const cardText = async (page, c) => (await page.locator(`${R} [data-val-code="${c}"]`).first().innerText({ timeout: 1500 }).catch(() => '')).replace(/\s+/g, ' ');
  const numIn = (t, v) => [v.toFixed(2), v.toFixed(1), String(v)].some((s) => new RegExp(`(^|[^\\d.])${s.replace('.', '\\.')}(?![\\d])`).test(t));
  const verdictOk = (t, pct) => (pct < 30 ? /便宜/.test(t) && !/贵/.test(t) : pct > 70 ? /贵/.test(t) && !/便宜/.test(t) : /中间/.test(t) && !/便宜/.test(t) && !/比过去贵/.test(t));
  async function pickMarket(page, m) {
    await tabOf(page, m).first().click();
    await page.waitForTimeout(250);
  }
  /** 子菜单里文字是"估值"的那一项的下标 */
  const valSubIdx = (page) => page.evaluate(() => [...document.querySelectorAll('[data-qa-subnav] [data-qa-i]')].findIndex((a) => /估值/.test((a.textContent || '').trim())));

  await section('VA 估值 1200 浅色', async () => {
    const { page, ctx } = await openV({ width: 1200, height: 900 });
    await enter(page);
    await page.locator(`${R} [data-val-code]`).first().waitFor({ state: 'attached', timeout: WAIT }).catch(() => {});
    const mv = await markVal(page);
    check('VA 有"估值：现在贵不贵"板块（标题看得见）', !!mv && mv.visible, mv);
    const codes = await valCodes(page);
    check('VA 全部：6 张卡（[data-val-code]），就是 6 个指数', codes.length === 6 && VALL.every((c) => codes.includes(c)), codes);
    const bad = [];
    for (const v of VREF.items) {
      const t = await cardText(page, v.code);
      const miss = [];
      if (!t.includes(v.name)) miss.push('名字');
      if (!numIn(t, v.pe_now)) miss.push(`当前 ${v.pe_now}`);
      if (!new RegExp(`(^|[^\\d.])${Math.round(v.pe_pct10y)}\\s*%`).test(t)) miss.push(`分位 ${Math.round(v.pe_pct10y)}%`);
      for (const k of ['pe_median10y', 'pe_min10y', 'pe_max10y']) if (!numIn(t, v[k])) miss.push(`${k} ${v[k]}`);
      if (!numIn(t, v.dy_now)) miss.push(`股息率 ${v.dy_now}`);
      for (const k of ['exp_a', 'exp_b']) if (![v[k].toFixed(1), v[k].toFixed(2)].some((s) => t.includes(s + '%'))) miss.push(`${k} ${v[k]}%`);
      if (!verdictOk(t, v.pe_pct10y)) miss.push(`判词（分位 ${v.pe_pct10y}）`);
      if (miss.length) bad.push([v.code, miss, t.slice(0, 220)]);
    }
    check('VA 每张卡写出名字、当前值、10 年分位、中位 / 最低 / 最高、股息率、两种预期年化，判词按分位（< 30 便宜 / 30～70 中间 / > 70 贵）', bad.length === 0, bad);
    const st = (await page.locator('[data-qa-val]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    check('VA 板块写"不是预测"和"不是投资建议"', /不是预测/.test(st) && /不是投资建议/.test(st), st.slice(-240));
    check('VA 来源注明"中证指数有限公司"和"Robert Shiller"', /中证指数有限公司/.test(st) && /Robert Shiller/.test(st), st.slice(-240));
    // 子菜单
    await page.evaluate(() => scrollTo(0, 0));
    const sub = await findSub(page);
    const vi = sub ? await valSubIdx(page) : -1;
    check('VA 子菜单多一项"估值"', vi >= 0, sub?.texts);
    if (vi >= 0) {
      const tg = await markTarget(page, vi);
      const same = await page.evaluate(() => { const t = document.querySelector('[data-qa-target]'); const v = document.querySelector('[data-qa-val]'); return !!t && !!v && (t === v || t.contains(v) || v.contains(t)); });
      check('VA 子菜单"估值"指到估值板块', !!tg?.found && same, tg);
      await page.locator(`[data-qa-subnav] [data-qa-i="${vi}"]`).click();
      await page.waitForTimeout(900);
      const p = await targetPos(page);
      check('VA 点子菜单"估值"→ 板块滚到视口上部 40% 内（或已到页底），地址仍是 #/funds', !!p && /^#\/(tools\/)?funds/.test(p.hash) && p.top < p.vh && p.bottom > 0 && ((p.top >= -4 && p.top <= p.vh * 0.4) || p.atBottom), p);
      await page.evaluate(() => scrollTo(0, 0));
      await page.waitForTimeout(300);
      await page.evaluate(() => { const t = document.querySelector('[data-qa-target]'); scrollTo(0, scrollY + t.getBoundingClientRect().top - 140); });
      await page.waitForTimeout(600);
      const act = await activeIdx(page);
      check('VA 滚动（不点）到估值板块 → 子菜单高亮"估值"（只有它）', act.length === 1 && act[0] === vi, act.map((a) => sub.texts[a]));
    }
    const lc = await lowContrast(page, ['[data-qa-val]']);
    check('VA 浅色：估值板块文字对比度 ≥ 4.5', lc.bad.length === 0, lc.bad);
    // 市场切换
    await pickMarket(page, '美国');
    check('VA 切到"美国"：只显示标普500（SPX）', JSON.stringify(await valCodes(page)) === JSON.stringify(['SPX']), await valCodes(page));
    await pickMarket(page, '中国');
    const cn = await valCodes(page);
    check('VA 切到"中国"：只显示 5 张（000300、000016、000905、000015、000922）', cn.length === 5 && VCN.every((c) => cn.includes(c)), cn);
    await pickMarket(page, '新加坡');
    const sgc = await valCodes(page);
    const sgt = await cardText(page, 'SPX');
    check('VA 切到"新加坡"：只显示标普500（SPX）这 1 张，卡上基金列表含 XUS（主会话规格更正，依据原型 v3）', JSON.stringify(sgc) === JSON.stringify(['SPX']) && /XUS/.test(sgt), { sgc, sgt: sgt.slice(0, 160) });
    await pickMarket(page, '');
    check('VA 切回"全部"：6 张', (await valCards(page).count()) === 6, await valCodes(page));
    await ctx.close();
  });

  await section('VB 估值判词分界', async () => {
    const pcts = { '000300': 29.2, '000016': 30, '000905': 70, '000015': 70.8, '000922': 49.2, SPX: 99.2 };
    const items = VREF.items.map((x) => ({ ...x, pe_pct10y: pcts[x.code] }));
    const { page, ctx } = await openV({ width: 1200, height: 900 }, items);
    await enter(page);
    await page.locator(`${R} [data-val-code]`).first().waitFor({ state: 'attached', timeout: WAIT }).catch(() => {});
    const bad = [];
    for (const [c, p] of Object.entries(pcts)) { const t = await cardText(page, c); if (!verdictOk(t, p)) bad.push([c, p, t.slice(0, 120)]); }
    check('VB 分位 29.2 → 便宜；30、70 → 中间；70.8、99.2 → 贵；49.2 → 中间', bad.length === 0, bad);
    await ctx.close();
  });

  await section('VC 估值 400 深色', async () => {
    const { page, ctx } = await openV({ width: 400, height: 860, colorScheme: 'dark' });
    await enter(page);
    await page.locator(`${R} [data-val-code]`).first().waitFor({ state: 'attached', timeout: WAIT }).catch(() => {});
    const mv = await markVal(page);
    check('VC 400 宽：估值板块在、6 张卡', !!mv?.visible && (await valCards(page).count()) === 6, { mv, n: await valCards(page).count() });
    await page.locator('[data-qa-val]').scrollIntoViewIfNeeded().catch(() => {});
    check('VC 400 宽：页面不横向溢出', await noHScroll(page), await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]));
    const wide = await page.evaluate(() => [...document.querySelectorAll('[data-qa-val] [data-val-code]')].map((e) => [e.getAttribute('data-val-code'), Math.round(e.getBoundingClientRect().right)]).filter(([, r]) => r > innerWidth + 1));
    check('VC 400 宽：每张卡都在屏幕宽度里', wide.length === 0, wide);
    const lc = await lowContrast(page, ['[data-qa-val]']);
    check('VC 深色：估值板块文字对比度 ≥ 4.5', lc.bad.length === 0, lc.bad);
    await pickMarket(page, '美国');
    check('VC 400 宽切到"美国"：只有 SPX', JSON.stringify(await valCodes(page)) === JSON.stringify(['SPX']), await valCodes(page));
    await pickMarket(page, '新加坡');
    check('VC 400 宽切到"新加坡"：只有 SPX（卡上含 XUS）、不横向溢出', JSON.stringify(await valCodes(page)) === JSON.stringify(['SPX']) && /XUS/.test(await cardText(page, 'SPX')) && (await noHScroll(page)), await valCodes(page));
    await ctx.close();
  });


  // ================================================================ 估值取数修复（2026-11-11，Amos 选直接上生产；测试先写，C154）规格 5：文案
  // 从没取到过数据的指数显示"还没有数据"（"还没有估值数据"也认），整页不出现"显示的是上次的数据"；有上次数据的才出现这句，并且这句只说有旧数据的那几个。
  // 做法：GET /api/funds、POST /api/funds/refresh、POST /api/funds/valuation/refresh 都用替身；估值第 1 步回 failed，之后 GET 回刷新后的状态。
  // VD1 只有从没取到过的（上证50）失败；VD2 只有有旧数据的（沪深300）失败；VD3 两个都失败。
  const vMissing = (codes, err) => VREF.items.filter((x) => codes.includes(x.code)).map((x) => ({ code: x.code, name: x.name, market: x.market, ...(err ? { error: err } : {}) }));
  /** pre / post：{ items, missing }；fails：这一轮失败的 [code, name] */
  async function vdRun(name, pre, post, fails) {
    const { page, ctx, api } = await open({ width: 1200, height: 900, snap: { ...SNAP2, valuation: { ...pre, due: true } }, onRefresh: () => ({ next: null, done: 45, total: 45, updated: SNAP2.items.map((x) => x.code), failed: [], requests: 45 }) });
    const vposts = [];
    await ctx.route(/\/api\/funds\/valuation\/refresh(\?.*)?$/, async (r) => {
      const body = (() => { try { return JSON.parse(r.request().postData() || '{}'); } catch { return {}; } })();
      vposts.push(body);
      const i = Number(body.cursor ?? 0);
      api.snap = { ...SNAP2, valuation: { ...post, due: false } };
      const f = fails[i];
      const res = f
        ? { next: i + 1 < fails.length ? i + 1 : null, done: i + 1, total: fails.length, code: f[0], name: f[1], part: '市盈率', status: 'failed', reason: '市盈率：中证回 403', requests: 1 }
        : { next: null, done: i + 1, total: i + 1, code: '', name: '', part: '', status: 'done', requests: 0 };
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(res) });
    });
    await enter(page);
    await page.locator(`${R} [data-val-code]`).first().waitFor({ state: 'attached', timeout: WAIT }).catch(() => {});
    const t0 = (await page.locator(R).innerText().catch(() => '')).replace(/\s+/g, ' ');
    check(`${name} 前提：刷新前页面没有"上次的数据"`, !/上次的数据/.test(t0), t0.match(/[^。；]*上次的数据[^。；]*/)?.[0]);
    await page.locator(R).getByRole('button', { name: /刷新/ }).first().click();
    await page.waitForFunction((R) => { const t = document.querySelector(R)?.innerText || ''; const b = [...document.querySelectorAll(R + ' button')].find((x) => /刷新/.test(x.textContent || '')); return !!b && !b.disabled && /估值/.test(t) && !/正在取/.test(t); }, R, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(300);
    const raw = await page.locator(R).innerText().catch(() => '');
    const t = raw.replace(/\s+/g, ' ');
    const clauses = raw.split(/[；;。\n]/).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const card = async (c) => (await page.locator(`${R} [data-val-code="${c}"]`).first().innerText({ timeout: 1500 }).catch(() => '')).replace(/\s+/g, ' ');
    const out = { page, ctx, t, clauses, card, vposts, old: clauses.filter((x) => /上次的数据/.test(x)) };
    check(`${name} 前提：页面调了估值刷新`, vposts.length >= 1, vposts);
    return out;
  }
  await section('VD1 估值文案：从没取到过的失败', async () => {
    const pre = { items: VREF.items.filter((x) => x.code !== '000016'), missing: vMissing(['000016']) };
    const post = { items: pre.items, missing: vMissing(['000016'], '市盈率：中证回 403') };
    const o = await vdRun('VD1', pre, post, [['000016', '上证50']]);
    const c = await o.card('000016');
    check('VD1 从没取到过的上证50：卡上写"还没有数据"（或"还没有估值数据"），不写"上次"', /还没有(估值)?数据/.test(c) && !/上次/.test(c), c.slice(0, 200));
    check('VD1 整页不出现"显示的是上次的数据"（上证50 从来没有数据）', !/显示的是上次的数据/.test(o.t) && o.old.length === 0, o.old);
    await o.ctx.close();
  });
  await section('VD2 估值文案：有旧数据的失败', async () => {
    const pre = { items: VREF.items, missing: [] };
    const post = { items: VREF.items.map((x) => (x.code === '000300' ? { ...x, ok_at: '2026-11-10T03:00:00.000Z', error: '市盈率：中证回 403', error_at: '2026-11-11T03:00:00.000Z' } : x)), missing: [] };
    const o = await vdRun('VD2', pre, post, [['000300', '沪深300']]);
    check('VD2 有旧数据的沪深300 没取到：出现"显示的是上次的数据"，这句说的是沪深300', /显示的是上次的数据/.test(o.t) && o.old.some((x) => /沪深300/.test(x)), o.old);
    await o.ctx.close();
  });
  await section('VD3 估值文案：两种都失败', async () => {
    const items = VREF.items.filter((x) => x.code !== '000016');
    const pre = { items, missing: vMissing(['000016']) };
    const post = { items: items.map((x) => (x.code === '000300' ? { ...x, ok_at: '2026-11-10T03:00:00.000Z', error: '市盈率：中证回 403', error_at: '2026-11-11T03:00:00.000Z' } : x)), missing: vMissing(['000016'], '市盈率：中证回 403') };
    const o = await vdRun('VD3', pre, post, [['000300', '沪深300'], ['000016', '上证50']]);
    check('VD3 "显示的是上次的数据"那句说沪深300、不把上证50 算进去', /显示的是上次的数据/.test(o.t) && o.old.length > 0 && o.old.every((x) => !/上证50/.test(x)) && o.old.some((x) => /沪深300/.test(x)), o.old);
    const c = await o.card('000016');
    check('VD3 上证50 卡上写"还没有数据"（或"还没有估值数据"），不写"上次"', /还没有(估值)?数据/.test(c) && !/上次/.test(c), c.slice(0, 200));
    await o.ctx.close();
  });

  // ================================================================ 估值"导入的历史"（2026-11-12，Amos 11/12 都按建议；测试先写，C154）
  // 规格（主会话派工单）：估值板块里有"参考：导入的历史"网格和"导入估值历史"按钮；上传后显示"已导入 X 只…"；
  //   卡片判词"比过去 10 年 / 上市以来 X% 的时间都贵"，< 30 / 30～70 / > 70 三档；只有一个点的写"攒够历史前不比贵贱"；"代理"标签；市场切换过滤；
  //   顶部总结句不受导入数据影响（I2 未定，默认不进：导入前后总结句文字相同）；400 宽不横向溢出；深浅色对比度 ≥ 4.5；免责在。
  // 数据：自造夹具 test/fixtures/funds/val-import-qa.json（5 只、公式生成，不是真实数据）；接口在浏览器这一侧用替身，val_import 的字段见 test/funds-v7-import.test.ts 文件头。
  // 页面约定（研发照加；要改名就在同一个提交里改这里并写明）：
  //   - "参考：导入的历史"在估值板块（标题"估值：现在贵不贵"那个 section）里；每只导入的一张卡带 data-imp-code="<基金代码>"，**不用 data-val-code**（那是 6 个指数的卡，VA 段数它）。
  //   - 按钮可见文字含"导入估值历史"，点了弹出选文件（input[type=file]，可以藏起来）；选好后页面把文件内容原样作 JSON 请求体 POST /api/funds/valuation/import，
  //     成功后重新 GET /api/funds，页面写"已导入 X 只"（X = 回包 imported）。
  //   - 判词所在元素（或它到卡片之间的祖先）带 data-tier="lo|mid|hi"，或 class 里有 lo / mid / hi（现有估值卡 .fu-verdict 的做法）：dear < 30 → lo，30～70（含两端）→ mid，> 70 → hi。
  //     判词文字：short=false 写"比过去 10 年 X% 的时间都贵"，short=true 写"比上市以来 X% 的时间都贵"（X = dear 四舍五入到整数）；
  //     metric 为 null 写"等下次导入更长的历史再比贵贱"（产品复核 11/12 改，原"攒够历史前不比贵贱"作废）、不写"% 的时间都贵"。
  //   - "代理"标签（卡里一个文字正好是"代理"的元素）：按选用指标那一段口径判断（主会话 11/12 采纳研发口径）——basis 里 "<指标>=…" 那一段写着"代理"才有；
  //     夹具里 QQQ 用 pe、只有 dy 那段写代理 → 没有；SCHD 用 dy、只有 pe 那段写代理 → 没有；ES3 用 dy、dy 那段写代理 → 有。
  //   - "12 个月内"按导入文件 asOf 算（主会话 11/12 采纳）；百分位和现有估值卡同一算法。
  //   - 小卡按导入文件 indexes 的顺序排（产品复核 11/12）：全部时 QQQ、ES3、588000、SCHD、UPD。
  //   - 市场切换：按 val_import 每只的 market（全部 5；美国 QQQ、SCHD；新加坡 ES3、UPD；中国 588000）。
  //   - 部分失败（IM3，产品复核 11/12）：导入真走本地服务器（不用替身），有跳过的时提示里不出现 dy / pe / pb 这种英文缩写（写成中文），
  //     并写明"跳过的几只保留原来的数据"（"跳过的…保留原来的数据"）。
  const IMPFX = JSON.parse(readFileSync(path.join(ROOT, 'test/fixtures/funds/val-import-qa.json'), 'utf8'));
  const MK2 = Object.fromEntries(SNAP2.items.map((x) => [x.code, x.market]));
  /** 参考算法（和 test/funds-v7-import.test.ts 同一份规格）：fixture → GET /api/funds 的 val_import.items */
  const impItems = (() => {
    const ymOf = (s) => Number(s.slice(0, 4)) * 12 + Number(s.slice(5, 7)) - 1;
    const ymN = ymOf(IMPFX.asOf); // 按导入文件 asOf 算
    return IMPFX.indexes.map((x) => {
      const pe = x.series.pe, dy = x.series.dy;
      const metric = pe.length >= 36 && ymN - ymOf(pe[pe.length - 1][0]) <= 12 ? 'pe' : dy.length >= 24 ? 'dy' : null;
      const s = metric === 'pe' ? pe : metric === 'dy' ? dy : pe.length ? pe : dy;
      const last = s[s.length - 1];
      const seg = (k) => (String(x.basis).split(/[；;]/).find((t) => t.trim().startsWith(k + '=')) || '');
      const proxy = /代理/.test(seg(metric || (pe.length ? 'pe' : 'dy')));
      const base = { code: x.code, name: x.name, funds: x.funds, market: MK2[x.code], source: x.source, basis: x.basis, metric, now: last[1], now_date: last[0], proxy };
      if (!metric) return { ...base, pct: null, dear: null, n: 1, short: true };
      const w = s.slice(-120).map((p) => p[1]);
      const pct = Math.round((w.filter((v) => v <= last[1]).length / w.length) * 1000) / 10;
      return { ...base, pct, dear: metric === 'pe' ? pct : Math.round((100 - pct) * 10) / 10, n: w.length, short: w.length < 120 };
    });
  })();
  const IMP = Object.fromEntries(impItems.map((x) => [x.code, x]));
  const tierOf = (d) => (d == null ? null : d < 30 ? 'lo' : d > 70 ? 'hi' : 'mid');
  const snapI = (withImp) => ({ ...snapV(VREF.items), ...(withImp ? { val_import: { items: impItems } } : {}) });
  /** 打开页面：GET /api/funds 先不带（或带）val_import；POST /api/funds/valuation/import 记下请求体、回 {imported, replaced, skipped}，之后 GET 带上 val_import */
  async function openI(opts, withImp = false) {
    const o = await openV(opts);
    o.api.snap = snapI(withImp);
    o.imports = [];
    await o.ctx.route(/\/api\/funds\/valuation\/import(\?.*)?$/, async (r) => {
      let body = null;
      try { body = JSON.parse(r.request().postData() || ''); } catch { body = { bad: (r.request().postData() || '').slice(0, 80) }; }
      o.imports.push(body);
      o.api.snap = snapI(true);
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ imported: impItems.length, replaced: 0, skipped: [] }) });
    });
    return o;
  }
  const impCards = (page) => page.locator(`${R} [data-imp-code]`).filter({ visible: true });
  const impCodes = async (page) => (await impCards(page).evaluateAll((es) => es.map((e) => e.getAttribute('data-imp-code')))).sort();
  const impText = async (page, c) => (await page.locator(`${R} [data-imp-code="${c}"]`).first().innerText({ timeout: 1500 }).catch(() => '')).replace(/\s+/g, ' ');
  /** 卡里判词那一档：含"的时间都贵"的最小元素往上到卡片，第一个 data-tier 或 class lo / mid / hi */
  const impTier = (page, c) => page.evaluate(({ R, c }) => {
    const card = document.querySelector(`${R} [data-imp-code="${c}"]`);
    if (!card) return 'no-card';
    const els = [...card.querySelectorAll('*')].filter((e) => /的时间都贵/.test(e.textContent || '') && ![...e.children].some((k) => /的时间都贵/.test(k.textContent || '')));
    for (let e = els[0]; e; e = e === card ? null : e.parentElement) {
      if (e.dataset?.tier) return e.dataset.tier;
      const t = [...e.classList].find((k) => ['lo', 'mid', 'hi'].includes(k));
      if (t) return t;
    }
    return els.length ? 'no-tier' : 'no-verdict';
  }, { R, c });
  const ledeText = async (page) => (await page.locator(`${R} [aria-label="总结"], ${R} #fu-lede`).first().innerText({ timeout: 1500 }).catch(() => '')).replace(/\s+/g, ' ').trim();
  /** 卡上判词应该是什么 */
  const verdictRe = (x) => new RegExp(`比(过去\\s*)?${x.short ? '上市以来' : '10\\s*年'}\\s*${Math.round(x.dear)}\\s*%\\s*的时间都贵`);
  async function impCheck(page, tag) {
    const bad = [];
    for (const x of impItems) {
      const t = await impText(page, x.code), miss = [];
      if (!t) { bad.push([x.code, '没有卡']); continue; }
      if (!t.includes(x.name)) miss.push('名字');
      if (x.metric) {
        if (!verdictRe(x).test(t)) miss.push(`判词 ${verdictRe(x).source}`);
        if (x.short ? !/上市以来/.test(t) : /上市以来/.test(t)) miss.push(x.short ? '不足 120 点要写"上市以来"' : '够 120 点不该写"上市以来"');
        const tr = await impTier(page, x.code);
        if (tr !== tierOf(x.dear)) miss.push(`档位 ${tr}，应为 ${tierOf(x.dear)}（贵的程度 ${x.dear}）`);
      } else {
        if (!/等下次导入更长的历史再比贵贱/.test(t)) miss.push('只有一个点要写"等下次导入更长的历史再比贵贱"');
        if (/%\s*的时间都贵/.test(t)) miss.push('只有一个点不该写"% 的时间都贵"');
      }
      const tag = await page.evaluate(({ R, c }) => [...(document.querySelector(`${R} [data-imp-code="${c}"]`)?.querySelectorAll('*') ?? [])].some((e) => (e.textContent || '').trim() === '代理'), { R, c: x.code });
      if (x.proxy !== tag) miss.push(x.proxy ? '缺"代理"标签（选用指标那段口径写着代理）' : '不该有"代理"标签（选用指标那段口径没写代理）');
      if (miss.length) bad.push([x.code, miss, t.slice(0, 200)]);
    }
    check(`${tag} 每张导入卡：名字、判词"比过去 10 年 / 上市以来 X% 的时间都贵"、三档（< 30 / 30～70 / > 70）、单点写"等下次导入更长的历史再比贵贱"、"代理"标签按选用指标那段口径`, bad.length === 0, bad);
  }

  await section('IM1 导入的历史 1200 浅色', async () => {
    check('IM 前提：夹具 5 只的预期覆盖三档 + 单点 + short / 不 short + pe / dy + 代理有 / 没有',
      JSON.stringify(impItems.map((x) => [x.code, x.metric, tierOf(x.dear), x.short, x.proxy])) === JSON.stringify([['QQQ', 'pe', 'hi', false, false], ['ES3', 'dy', 'lo', true, true], ['588000', 'pe', 'mid', true, false], ['SCHD', 'dy', 'mid', true, false], ['UPD', null, null, true, false]]),
      impItems.map((x) => [x.code, x.metric, x.dear, x.n, x.proxy]));
    const o = await openI({ width: 1200, height: 900 });
    const { page } = o;
    await enter(page);
    await page.locator(`${R} [data-val-code]`).first().waitFor({ state: 'attached', timeout: WAIT }).catch(() => {});
    const mv = await markVal(page);
    const st0 = (await page.locator('[data-qa-val]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    check('IM1 估值板块里有"参考：导入的历史"', !!mv && /参考[：:]\s*导入的历史/.test(st0), st0.slice(0, 200));
    const btn = page.locator('[data-qa-val]').getByRole('button', { name: /导入估值历史/ }).first();
    check('IM1 估值板块里有按钮"导入估值历史"（看得见）', await btn.isVisible().catch(() => false));
    const lede0 = await ledeText(page);
    check('IM1 前提：读到顶部总结句', lede0.length > 0, lede0);
    let chosen = false;
    try {
      const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 3000 }), btn.click({ timeout: 2000 })]);
      await fc.setFiles({ name: 'val-import-qa.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(IMPFX)) });
      chosen = true;
    } catch { /* 下面报红 */ }
    check('IM1 点"导入估值历史"弹出选文件', chosen);
    await page.waitForFunction((R) => /已导入\s*\d+\s*只/.test(document.querySelector(R)?.innerText || ''), R, { timeout: WAIT }).catch(() => {});
    await page.waitForTimeout(300);
    check('IM1 上传后 POST /api/funds/valuation/import 一次，请求体就是文件里的 JSON（asOf + 5 只）', o.imports.length === 1 && o.imports[0]?.asOf === IMPFX.asOf && o.imports[0]?.indexes?.length === 5 && o.imports[0].indexes[0]?.code === 'QQQ', o.imports.map((b) => ({ asOf: b?.asOf, n: b?.indexes?.length, bad: b?.bad })));
    const t1 = (await page.locator(R).innerText().catch(() => '')).replace(/\s+/g, ' ');
    check('IM1 上传后页面写"已导入 5 只"', /已导入\s*5\s*只/.test(t1), t1.match(/[^。]{0,20}导入[^。]{0,40}/g));
    const codes = await impCodes(page);
    check('IM1 导入后：5 张导入卡（[data-imp-code]）', JSON.stringify(codes) === JSON.stringify(['588000', 'ES3', 'QQQ', 'SCHD', 'UPD']), codes);
    await impCheck(page, 'IM1');
    const order = await impCards(page).evaluateAll((es) => es.map((e) => e.getAttribute('data-imp-code')));
    check('IM1 小卡按导入文件 indexes 的顺序（QQQ、ES3、588000、SCHD、UPD）', JSON.stringify(order) === JSON.stringify(IMPFX.indexes.map((x) => x.code)), order);
    check('IM1 原来 6 张估值卡（[data-val-code]）不变', (await valCards(page).count()) === 6, await valCodes(page));
    const lede1 = await ledeText(page);
    check('IM1 顶部总结句导入前后文字相同（I2 未定，导入的数据不进总结句）', lede1 === lede0, { before: lede0.slice(0, 200), after: lede1.slice(0, 200) });
    await markVal(page);
    const st1 = (await page.locator('[data-qa-val]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    check('IM1 导入后估值板块仍写"不是预测"和"不是投资建议"', /不是预测/.test(st1) && /不是投资建议/.test(st1), st1.slice(-200));
    const imGrid = await page.evaluate(() => { const v = document.querySelector('[data-qa-val]'); const c = document.querySelector('[data-imp-code]'); return !!v && !!c && v.contains(c); });
    check('IM1 导入卡在估值板块里', imGrid);
    const lc = await lowContrast(page, ['[data-qa-val]']);
    check('IM1 浅色：估值板块（含导入卡）文字对比度 ≥ 4.5', lc.bad.length === 0, lc.bad);
    for (const [m, want] of [['美国', ['QQQ', 'SCHD']], ['新加坡', ['ES3', 'UPD']], ['中国', ['588000']], ['', ['588000', 'ES3', 'QQQ', 'SCHD', 'UPD']]]) {
      await pickMarket(page, m);
      const got = await impCodes(page);
      check(`IM1 切到"${m || '全部'}"：导入卡只剩 ${want.join('、')}`, JSON.stringify(got) === JSON.stringify(want), got);
    }
    await pickMarket(page, '美国');
    const ledeUS = await ledeText(page);
    await o.ctx.close();
    // 同一份数据不带 val_import 打开，切到"美国"：总结句和带 val_import 时一样
    const o2 = await openI({ width: 1200, height: 900 }, false);
    await enter(o2.page);
    await o2.page.locator(`${R} [data-val-code]`).first().waitFor({ state: 'attached', timeout: WAIT }).catch(() => {});
    await pickMarket(o2.page, '美国');
    const ledeUS0 = await ledeText(o2.page);
    check('IM1 切到"美国"时总结句也和没有导入数据时一样', ledeUS === ledeUS0 && ledeUS0.length > 0, { with: ledeUS.slice(0, 160), without: ledeUS0.slice(0, 160) });
    await o2.ctx.close();
  });

  await section('IM2 导入的历史 400 深色', async () => {
    const { page, ctx } = await openI({ width: 400, height: 860, colorScheme: 'dark' }, true);
    await enter(page);
    await page.locator(`${R} [data-imp-code]`).first().waitFor({ state: 'attached', timeout: WAIT }).catch(() => {});
    const mv = await markVal(page);
    check('IM2 400 宽：估值板块在、5 张导入卡', !!mv?.visible && (await impCards(page).count()) === 5, { mv, n: await impCards(page).count() });
    await page.locator('[data-imp-code]').first().scrollIntoViewIfNeeded().catch(() => {});
    check('IM2 400 宽：页面不横向溢出', await noHScroll(page), await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]));
    const wide = await page.evaluate(() => [...document.querySelectorAll('[data-imp-code]')].map((e) => [e.getAttribute('data-imp-code'), Math.round(e.getBoundingClientRect().right)]).filter(([, r]) => r > innerWidth + 1));
    check('IM2 400 宽：每张导入卡都在屏幕宽度里', wide.length === 0, wide);
    const btn = page.locator('[data-qa-val]').getByRole('button', { name: /导入估值历史/ }).first();
    const bb = await btn.boundingBox().catch(() => null);
    check('IM2 400 宽："导入估值历史"按钮看得见、在屏幕宽度里', !!bb && bb.x >= 0 && bb.x + bb.width <= 401, bb);
    await impCheck(page, 'IM2');
    const lc = await lowContrast(page, ['[data-qa-val]']);
    check('IM2 深色：估值板块（含导入卡）文字对比度 ≥ 4.5', lc.bad.length === 0, lc.bad);
    await pickMarket(page, '新加坡');
    check('IM2 400 宽切到"新加坡"：导入卡只剩 ES3、UPD，不横向溢出', JSON.stringify(await impCodes(page)) === JSON.stringify(['ES3', 'UPD']) && (await noHScroll(page)), await impCodes(page));
    await ctx.close();
  });

  await section('IM3 部分失败提示（真走本地服务器）', async () => {
    const { page, ctx, api } = await openV({ width: 1200, height: 900 });
    const res = [];
    // 导入请求原样转给本地服务器（真校验、真写 D1），之后 GET /api/funds 也转给它，看服务器给的 val_import
    await ctx.route(/\/api\/funds\/valuation\/import(\?.*)?$/, async (r) => {
      const f = await r.fetch();
      const body = await f.text();
      let j = null; try { j = JSON.parse(body); } catch { j = null; }
      res.push({ status: f.status(), j });
      try { const ckh = (await r.request().allHeaders()).cookie || ''; const g = await page.context().request.get(BASE + '/api/funds', { headers: { cookie: ckh } }); const gj = await g.json(); api.snap = { ...api.snap, val_import: gj.val_import }; res.push({ get: g.status(), n: (gj.val_import?.items ?? gj.val_import ?? []).length }); } catch (e) { res.push({ getErr: String(e) }); }
      await r.fulfill({ status: f.status(), contentType: 'application/json', body });
    });
    await enter(page);
    await page.locator(`${R} [data-val-code]`).first().waitFor({ state: 'attached', timeout: WAIT }).catch(() => {});
    const bad = JSON.parse(JSON.stringify(IMPFX));
    bad.indexes.push(
      { code: 'NOPE', name: '不在清单（QA）', funds: ['NOPE'], source: 'QA', basis: 'dy=QA', series: { pe: [], pb: [], dy: [['2026-10', 1.1], ['2026-11', 1.2]] } },
      { code: 'CLR', name: '股息率有 0（QA）', funds: ['CLR'], source: 'QA', basis: 'dy=QA', series: { pe: [], pb: [], dy: [['2026-10', 5.1], ['2026-11', 0]] } },
      { code: 'SRT', name: '市盈率日期坏（QA）', funds: ['SRT'], source: 'QA', basis: 'pe=QA', series: { pe: [['2026/10', 9.1]], pb: [], dy: [] } },
      { code: 'BYJ', name: '市净率负数（QA）', funds: ['BYJ'], source: 'QA', basis: 'pb=QA', series: { pe: [], pb: [['2026-10', -1]], dy: [['2026-10', 3.3]] } },
    );
    const btn = page.locator(R).getByRole('button', { name: /导入估值历史/ }).first();
    try {
      const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 3000 }), btn.click({ timeout: 2000 })]);
      await fc.setFiles({ name: 'val-import-bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
    } catch { /* 下面报红 */ }
    await page.waitForFunction((R) => /已导入/.test(document.querySelector(R)?.innerText || ''), R, { timeout: WAIT }).catch(() => {});
    await page.waitForTimeout(400);
    const sk = res[0]?.j?.skipped ?? [];
    check('IM3 前提：服务器真收了、回 200，跳过 4 只（NOPE、CLR、SRT、BYJ）', res.filter((x) => 'status' in x).length === 1 && res[0].status === 200 && JSON.stringify(sk.map((x) => x.code).sort()) === JSON.stringify(['BYJ', 'CLR', 'NOPE', 'SRT']), res);
    check('IM3 前提：导入后从本地服务器读到 val_import 5 只', res.some((x) => x.get === 200 && x.n === 5), res.filter((x) => !('status' in x)));
    // 提示：含"已导入"的最小元素
    const msg = await page.evaluate((R) => {
      const els = [...document.querySelectorAll(R + ' *')].filter((e) => /已导入/.test(e.textContent || '') && e.getClientRects().length && ![...e.children].some((k) => /已导入/.test(k.textContent || '')));
      return els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()).join(' | ');
    }, R);
    check('IM3 部分失败提示写了"已导入 5 只"和跳过的', /已导入\s*5\s*只/.test(msg) && /跳过/.test(msg), msg);
    check('IM3 部分失败提示不出现 dy / pe / pb 这种英文缩写（写成中文）', !/(^|[^A-Za-z])(dy|pe|pb)([^A-Za-z]|$)/i.test(msg), msg);
    check('IM3 部分失败提示写明"跳过的几只保留原来的数据"', /跳过的[^。]{0,8}保留原来的数据/.test(msg), msg);
    const codes = await impCodes(page);
    check('IM3 页面上是服务器给的 5 只（跳过的不出现）', JSON.stringify(codes) === JSON.stringify(['588000', 'ES3', 'QQQ', 'SCHD', 'UPD']), codes);
    await ctx.close();
  });

}

check('全程没有页面脚本报错', errors.length === 0, errors.slice(0, 5));
await browser.close();
srv?.stop();
if (fails.length) { console.error(`\n✗ 基金观察有 ${fails.length} 项不通过`); process.exit(1); }
console.log('\n✓ 基金观察全部通过');
process.exit(0);
