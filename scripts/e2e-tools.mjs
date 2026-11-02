#!/usr/bin/env node
/**
 * 公司平台批 2（PR 3 公共工具）的浏览器级验收测试，外加批 1 的一个问题修复。
 * 依据：agents 公司平台/技术方案-公司平台-测试与风险.md 第二节 PR 3 一行；PR与数据页第三节；原型 公司平台/原型-公司平台-v2.html 的 #t-reply、#t-byproj。
 * 测试会话先写（agents C145 第 3 条）：写的时候功能还没做，所以现在是红的；研发写代码到全绿，不改这里的断言（底线 6）。
 *   node scripts/e2e-tools.mjs                 # CI 里跑这个
 *   node scripts/e2e-tools.mjs --shots <目录>   # 另外存公共工具页截图（375、1440 宽）
 *
 * 覆盖：
 *   A. 批 1 问题（Amos 2026-11-02："在公共工具页面刷新时，工作台和 forecast 两个菜单上的待办事项数量会消失，只有切过去才能看到"）：
 *      在公共工具页、清单页（#/tools、#/tools/queue、/queue）刷新后，一级菜单"工作台""forecast"上的红色数量马上显示，和切过去以后看到的一样；375、1440 宽。
 *   B. 每天回帖上限按项目（D-2；样例直接在 settings 写 reply_cap:forecast = 2）：清单按项目筛时"今天已回 N / 上限"是这个项目的数、和接口一致；
 *      forecast 到上限后 forecast 的"一键回复"变灰，别的项目不变灰、照样能"我回了"；
 *      公共工具 → 每天回帖上限（#t-reply）显示 forecast 的上限和今天已回；填错不保存、填对保存后刷新还在、清单马上跟着变。
 *   D.（批 2 追加，Amos 2026-11-02："看待办 加载的不就是文字吗"）工作台、forecast 页的待办点"看待办"或主按钮：正文在当前页面展开，不跳 GitHub、不开新窗口；
 *      PR 说明正文 + 问题表（每条带建议）；长正文先折叠、点"展开全文"展开；正文里的 HTML 只当文字（textContent）；被截断的写明"已截断"；
 *      旁边留小链接"在 GitHub 打开"；要到外部平台操作的（去 X 发帖）保留原来的外链。
 *      页面约定：li.todo 里主按钮 .go .btn.primary；展开后 .detail（正文 .detail-text、问题表 .qs li、折叠按钮 [data-more] 带 aria-expanded、小链接 a.gh）
 *   E.（批 2 追加，Amos 2026-11-02："主菜单和子菜单都要固定"）工作台、forecast 页、公共工具页、清单页滚到最底部后，一级菜单（nav.nav1）和二级菜单（#sub-<页>）
 *      还固定在屏幕顶部、看得到、没被挡住；在底部点二级菜单跳到模块、点一级菜单跳到别的页，模块 / 页面顶端不被固定菜单挡住；
 *      手机上两层菜单加起来 ≤ 屏幕高度 25%。375、1440 宽。
 *   F.（批 2 审查"改完再审"）R5 公司总览页的待办有正文的在当前页展开、外部平台照旧外链；R6 不再出现"看完在 PR 里回复"、改成"看完在 Claude 窗口里回复"；
 *      R8 375 宽公共工具二级菜单的"插件下载"不用横滑就看得到，或右边缘有能横滑的提示（[data-scroll-hint]、mask-image、::after 任一种）；
 *      R9 667×375 横屏两层固定菜单 ≤ 屏幕高度 25%；R10 停在公共工具页 30 秒后一级菜单数字会刷新，第一次读取失败后会重试。
 *   G.（批 2 新口径，Amos 2026-11-02："只有agents才是公司"）代码仓库的外部 PR 单独一条"外部提交，给你看一下"，只有标题和"在 GitHub 打开"，不当"要你决定"、不展开；
 *      自己在代码仓库开的 PR 也只显示标题和链接；代码仓库推上来的正文一个字都不显示。
 *   C. 按项目看用量（D-3）：#t-byproj 每个项目一行，Gemini 次数加起来 = 用量总额度里 Gemini 的请求数；写着以前没分项目、"测试 AI"那行是平台自己。
 *
 * 页面约定（照原型 v2；研发要改名就同一个 PR 改这里并在 PR 描述写明）：
 *   一级菜单数量 #c-work、#c-forecast（批 1 已有）；二级菜单 #sub-tools a[data-s="t-reply" | "t-byproj"]，地址 #/tools/reply、#/tools/byproj
 *   #t-reply：输入框 #rc-forecast（每个有项目页的项目一个 #rc-<项目>）、按钮 #rc-save、提示 #rc-msg；"今天已回"一格 td[data-label="今天已回"]
 *   #t-byproj：每个项目一行 tr，第一格写项目名（forecast；_platform 写"平台自己"），Gemini 次数在 td[data-label="Gemini"]（"N 次"）
 *   清单（#list、#f-prod、"今天已回 N / 上限"）照 scripts/e2e-queue.mjs
 * 接口约定见 test/platform-batch2.test.ts 文件头（/api/reply-cap、/api/usage 的 byProject）。
 * 每段单独 try：一段没做出来不影响别的段报结果；等待都有短超时，等不到就照实报"实际值"。任何一条不符就以非 0 退出。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { startServer, PASS, twDay, twStart, q, checker } from './e2e-server.mjs';

const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > 0 ? path.resolve(process.argv[shotsAt + 1]) : '';
const { fails, check: check0 } = checker();
// CI 失败时留证据（批 3 复审）：设了 E2E_ARTIFACTS（CI 里设）就把不通过的那几行写进 <目录>/e2e-tools-fails.txt，并给当时最近打开的页面截一张图
const ART = process.env.E2E_ARTIFACTS ? path.resolve(process.env.E2E_ARTIFACTS, 'e2e-tools') : '';
const failLines = [];
const pendingShots = [];
let curPage = null;
const check = (name, ok, got) => {
  const r = check0(name, ok, got);
  if (!ok) {
    failLines.push(`✗ ${name}：实际 ${JSON.stringify(got)}`);
    if (ART && curPage && !curPage.isClosed()) {
      mkdirSync(ART, { recursive: true });
      const f = path.join(ART, `fail-${failLines.length}.png`);
      pendingShots.push(curPage.screenshot({ path: f, fullPage: true }).catch(() => {}));
    }
  }
  return r;
};
const H = 3600_000, DAY = 24 * H;
const WAIT = 4000;
const now = Date.now();
const today = twDay(now);
const T = twStart(today);
const WIDTHS = [375, 1440];

// ---- 样例数据：forecast 2 条待回 + 今天回了 2 条（清单 1 + 插件 1）；demo2 1 条待回 + 今天回了 1 条 ----
const QUEUE = [
  // author, product, platform, post_id, score, at, status, done_day
  ['@fa', 'forecast', 'x', '1910000000000000001', 90, T + 5000, 'pending', null],
  ['@fb', 'forecast', 'threads', 'DFb0002', 70, T + 4000, 'pending', null],
  ['@fd', 'forecast', 'x', '1910000000000000003', 80, T - DAY, 'done', today],
  ['@da', 'demo2', 'x', '1910000000000000004', 60, T + 3000, 'pending', null],
  ['@dd', 'demo2', 'threads', 'DDd0005', 50, T - DAY, 'done', today],
];
const seedSql = [
  ...QUEUE.map(([author, product, platform, postId, score, at, status, doneDay]) =>
    `INSERT INTO queue (at, updated_at, product, platform, post_id, author, snippet, post_at, score, draft, source, status, done_day, engine, reasons) VALUES (${[at, status === 'pending' ? at : T + 1000, product, platform, postId, author, `${author} 的原帖`, null, score, `${author} 的草稿`, '', status, doneDay, 'gemini', '[]'].map(q).join(', ')});`),
  `INSERT INTO events (at, day, product, platform, post_id, author, snippet, score, action, draft) VALUES (${[T + 2000, today, 'forecast', 'x', '1910000000000000099', '@plugin', '', 70, 'approve', '插件里同意的一条'].map(q).join(', ')});`,
  // forecast 每天上限 2（D-2 定的键 reply_cap:<项目>）；demo2 没设，退回 DAILY_REPLY_CAP = 10
  `INSERT INTO settings (key, value, updated_at) VALUES ('reply_cap:forecast', '2', ${now});`,
].join('\n');
// 待办：工作台 3 条（forecast 2 条 + 经营会 1 条），forecast 页 2 条
const TODOS = [
  { kind: 'todo', key: 'forecast', source_at: now - H, payload: { product: 'forecast', items: [
    { id: 'T1', type: 'action', text: '样例待办一：X 简介加官网链接' },
    { id: 'T2', type: 'action', text: '样例待办二：用真实邮箱走一遍报名', due: now + 30 * H },
  ] } },
  { kind: 'todo', key: '经营会', source_at: now - H, payload: { product: '经营会', items: [{ id: 'M1·11/1', type: 'confirm', text: '样例待办三：挑一天开局沟通' }] } },
  { kind: 'projects', key: '', source_at: now - H, payload: { version: 'v1.4', items: [{ name: 'forecast', stage: '试水阶段' }] } },
  // 有状态卡才算项目（src/admin-page.ts projects()）
  { kind: 'status', key: 'forecast', source_at: now - H, payload: { product: 'forecast', state: 'B + C', level: 'mute', week: '样例', metrics: [] } },
];

const srv = await startServer({ name: 'e2e-tools', vars: { DAILY_REPLY_CAP: '10' }, seedSql });
const BASE = srv.BASE;
const browser = await chromium.launch();
const errors = [];
async function open({ width = 1440, height = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.route(/^https:\/\/(x\.com|www\.threads\.com|github\.com)\//, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>替身外部页面</p>' }));
  const page = await ctx.newPage();
  page.setDefaultTimeout(WAIT);
  page.on('pageerror', (e) => errors.push(e.message));
  curPage = page;
  return page;
}
async function login(page, at = '/') {
  await page.goto(BASE + at);
  await page.fill('#pw', PASS);
  await page.click('#go');
  await page.waitForSelector('#app:not([hidden])', { timeout: WAIT });
}
const vis = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);
const txt = (page, sel) => page.locator(sel).first().innerText({ timeout: 1500 }).catch(() => null);
const waitFor = (page, sel, opt = {}) => page.waitForSelector(sel, { timeout: WAIT, state: 'visible', ...opt }).then(() => true, () => false);
const apiGet = (page, p) => page.evaluate(async (u) => { const r = await fetch(u, { credentials: 'same-origin' }); return { status: r.status, body: await r.json().catch(() => null) }; }, p);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function section(name, fn) {
  try { await fn(); } catch (e) { check(`${name}：没跑完`, false, String(e && e.message || e).split('\n')[0]); }
}
/** 一级菜单上的红色数量：{work, forecast}（没显示的是 null） */
const badges = (page) => page.evaluate(() => {
  const r = (id) => { const e = document.getElementById(id); return e && !e.hidden && e.offsetWidth > 0 && /^\d+$/.test(e.textContent.trim()) ? Number(e.textContent.trim()) : null; };
  return { work: r('c-work'), forecast: r('c-forecast') };
});
const todayOf = (page) => page.evaluate(() => { const m = /今天已回\s*(\d+)\s*\/\s*(\d+)/.exec(document.body.innerText); return m ? [Number(m[1]), Number(m[2])] : null; });
const item = (page, author) => page.locator('#list .item', { has: page.locator('.who a', { hasText: author }) });
/**
 * 清单按项目筛（批 3 复审修正偶发失败）：只认这次筛选的那个返回——请求里 product = v（v 为空串时请求里没有 product）；
 * 不再用固定的 200 毫秒，等到 #f-prod 是 v、并且"今天已回"那一栏（#count）在这次返回之后重新画过。等不到就报错（这一段记"没跑完"）。
 */
async function filterProd(page, v) {
  await page.evaluate(() => {
    window.__countRedrawn = false;
    const c = document.getElementById('count');
    if (window.__countObs) window.__countObs.disconnect();
    window.__countObs = new MutationObserver(() => { window.__countRedrawn = true; });
    if (c) window.__countObs.observe(c, { childList: true, characterData: true, subtree: true });
  });
  const resp = page.waitForResponse((r) => {
    if (r.request().method() !== 'GET' || !r.url().includes('/api/queue?')) return false;
    const u = new URL(r.url());
    return v === '' ? !u.searchParams.has('product') : u.searchParams.get('product') === v;
  }, { timeout: WAIT });
  await page.selectOption('#f-prod', v);
  const r = await resp.catch(() => null);
  if (!r) throw new Error(`筛项目"${v || '全部'}"：等不到 product=${v || '（无）'} 的 /api/queue 返回`);
  // "重新画过"：选了以后 #count 变过，而且显示的正是这次返回里的"今天已回 / 上限"（不是之前别的请求画的）
  const body = await r.json().catch(() => null);
  const want = body && Number.isFinite(body.doneToday) && Number.isFinite(body.cap) ? `今天已回 ${body.doneToday} / ${body.cap}` : null;
  if (!want) throw new Error(`筛项目"${v || '全部'}"：/api/queue 返回里没有 doneToday / cap`);
  const ok = await page.waitForFunction(([pv, text]) => document.getElementById('f-prod')?.value === pv && window.__countRedrawn === true && (document.getElementById('count')?.textContent || '').trim() === text, [v, want], { timeout: WAIT }).then(() => true, () => false);
  if (!ok) throw new Error(`筛项目"${v || '全部'}"：返回以后"今天已回"没有按这次的结果重新画（#f-prod = ${await page.inputValue('#f-prod').catch(() => '?')}，#count = ${await page.textContent('#count').catch(() => '?')}，应为 ${want}）`);
}

try {
  {
    const r = await srv.ingest('agents', TODOS);
    check('推送样例待办（工作台 3 条、forecast 2 条）', r.status === 200, r);
  }

  // ---------- A. 批 1 问题：公共工具页、清单页刷新后，菜单上的待办数量马上显示 ----------
  for (const width of WIDTHS) {
    await section(`菜单数量（${width} 宽）`, async () => {
      const page = await open({ width, height: width < 600 ? 812 : 900 });
      await login(page, '/#/work');
      await waitFor(page, '#w-todos li.todo');
      const ref = await badges(page);
      await page.click('nav.nav1 a[data-p="forecast"]', { timeout: WAIT });
      await waitFor(page, '#f-todos li.todo');
      ref.forecast = (await badges(page)).forecast;
      check(`${width} 宽：切到工作台、forecast 后看到的数量（工作台 3、forecast 2）`, same(ref, { work: 3, forecast: 2 }), ref);
      for (const at of ['/#/tools', '/#/tools/queue', '/queue']) {
        await page.goto(BASE + at);
        await page.reload();
        await page.waitForSelector('#app:not([hidden])', { timeout: WAIT });
        const onTools = await waitFor(page, '#v-tools');
        // 不切页，只等数量出现（最多 4 秒）
        await page.waitForFunction(() => ['c-work', 'c-forecast'].every((id) => { const e = document.getElementById(id); return e && !e.hidden && /^\d+$/.test(e.textContent.trim()); }), null, { timeout: WAIT }).catch(() => {});
        const b = await badges(page);
        check(`${width} 宽：在 ${at} 刷新后，没切页，"工作台""forecast"菜单上的数量马上显示且和切过去看到的一样`, onTools && same(b, ref), { onTools, got: b, want: ref });
      }
      // 再切过去核对一次：和刚才菜单上的一样
      await page.click('nav.nav1 a[data-p="work"]', { timeout: WAIT });
      await waitFor(page, '#w-todos li.todo');
      const w = (await badges(page)).work;
      const n = await page.locator('#w-todos li.todo').count();
      check(`${width} 宽：从清单页切到工作台，菜单数量 = 工作台待办条数`, w === ref.work && n === ref.work, { badge: w, list: n });
      await page.context().close();
    });
  }

  // ---------- B1. 清单按项目：样例里 forecast 的上限已设成 2（settings 的 reply_cap:forecast，直接写进库），今天已回 2 = 到上限 ----------
  await section('清单按项目', async () => {
    const page = await open();
    await login(page, '/#/tools/queue');
    await page.waitForSelector('#list .item', { timeout: WAIT });
    await filterProd(page, 'forecast');
    const tf = await todayOf(page);
    const api = (await apiGet(page, '/api/queue?status=pending&product=forecast')).body;
    check('清单筛 forecast："今天已回 2 / 2"（清单 1 条 + 插件 1 次，上限 2），和接口一致', same(tf, [2, 2]) && same(tf, [api?.doneToday, api?.cap]), { page: tf, api: [api?.doneToday, api?.cap] });
    const fa = item(page, '@fa').locator('a.btn.primary');
    check('forecast 到上限：forecast 的"一键回复"变成"今天已到上限"、不能点', (await fa.innerText().catch(() => null)) === '今天已到上限' && (await fa.getAttribute('aria-disabled').catch(() => null)) === 'true', await fa.innerText().catch(() => null));
    await filterProd(page, 'demo2');
    const td = await todayOf(page);
    check('清单筛 demo2："今天已回 1 / 10"（demo2 没设，退回 DAILY_REPLY_CAP）', same(td, [1, 10]), td);
    const da = item(page, '@da').locator('a.btn.primary');
    check('demo2 不受 forecast 上限影响："一键回复"照常能点', (await da.innerText().catch(() => null)) === '一键回复' && (await da.getAttribute('aria-disabled').catch(() => 'x')) === null, await da.innerText().catch(() => null));
    await filterProd(page, '');
    const fa2 = item(page, '@fa').locator('a.btn.primary'), da2 = item(page, '@da').locator('a.btn.primary');
    check('不筛项目时：forecast 的变灰、demo2 的不变灰', (await fa2.getAttribute('aria-disabled').catch(() => null)) === 'true' && (await da2.getAttribute('aria-disabled').catch(() => 'x')) === null, [await fa2.innerText().catch(() => null), await da2.innerText().catch(() => null)]);
    const resp = page.waitForResponse((r) => /\/api\/queue\/\d+$/.test(r.url()), { timeout: WAIT }).catch(() => null);
    await item(page, '@da').locator('button', { hasText: '我回了' }).click();
    const r = await resp;
    check('demo2 那条点"我回了"：成功（200），forecast 到上限不挡别的项目', r?.status() === 200, r?.status());
    await page.context().close();
  });

  // ---------- B2. 公共工具 → 每天回帖上限（#t-reply） ----------
  await section('每天回帖上限', async () => {
    const page = await open();
    await login(page, '/#/tools');
    const subs = await page.locator('#sub-tools a[data-s]').evaluateAll((a) => a.map((x) => x.dataset.s)).catch(() => []);
    check('公共工具的二级菜单有"每天回帖上限"（t-reply）和"按项目看用量"（t-byproj）', subs.includes('t-reply') && subs.includes('t-byproj'), subs);
    await page.goto(BASE + '/#/tools/reply');
    const shown = await waitFor(page, '#t-reply #rc-forecast');
    check('#/tools/reply：每天回帖上限模块显示，forecast 一个输入框', shown, await txt(page, '#t-reply'));
    if (!shown) return;
    const val = () => page.inputValue('#rc-forecast').catch(() => null);
    check('forecast 的上限显示库里存的 2', (await val()) === '2', await val());
    const doneCell = await page.locator('#t-reply tr', { hasText: 'forecast' }).locator('td[data-label="今天已回"]').innerText().catch(() => null);
    const api = await apiGet(page, '/api/reply-cap');
    check('forecast 今天已回 2（demo2 回的不算），和 /api/reply-cap 一致', !!doneCell && /^\s*2\b/.test(doneCell) && api.body?.rows?.[0]?.doneToday === 2, { doneCell, api });
    for (const bad of ['0', '51', 'abc', '2.5']) {
      await page.fill('#rc-forecast', bad);
      await page.click('#rc-save');
      await page.waitForFunction(() => (document.getElementById('rc-msg')?.textContent || '').trim().length > 0, null, { timeout: WAIT }).catch(() => {});
      const m = await txt(page, '#rc-msg');
      const a2 = await apiGet(page, '/api/reply-cap');
      check(`填"${bad}"：提示 1～50 之间、不保存`, !!m && /1\s*～\s*50/.test(m) && a2.body?.rows?.[0]?.cap === 2, { msg: m, api: a2 });
    }
    await page.fill('#rc-forecast', '5');
    await page.click('#rc-save');
    await page.waitForFunction(() => /已保存/.test(document.getElementById('rc-msg')?.textContent || ''), null, { timeout: WAIT }).catch(() => {});
    check('填"5"保存：提示已保存', /已保存/.test((await txt(page, '#rc-msg')) || ''), await txt(page, '#rc-msg'));
    await page.reload();
    await waitFor(page, '#t-reply #rc-forecast');
    await page.waitForFunction(() => document.getElementById('rc-forecast')?.value === '5', null, { timeout: WAIT }).catch(() => {});
    check('刷新后 forecast 的上限还是 5（存在服务器）', (await val()) === '5', await val());
    await page.goto(BASE + '/#/tools/queue');
    await page.waitForSelector('#list .item', { timeout: WAIT });
    await filterProd(page, 'forecast');
    check('改成 5 以后清单筛 forecast："今天已回 2 / 5"，"一键回复"恢复', same(await todayOf(page), [2, 5]) && (await item(page, '@fa').locator('a.btn.primary').innerText().catch(() => null)) === '一键回复', await todayOf(page));
    if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.goto(BASE + '/#/tools/reply'); await page.waitForTimeout(500); await page.screenshot({ path: path.join(SHOTS, 'tools-reply-1440.png'), fullPage: true }); }
    await page.context().close();
  });

  // ---------- D.（批 2 追加）待办正文在当前页面展开，不跳 GitHub ----------
  await section('待办正文', async () => {
    const XSS = '<script>window.__xss=1</script><img src=x onerror="window.__xss=2">';
    const LONG = XSS + '这是 PR 的说明正文。'.repeat(150) + '正文最后一句';
    const QS = [{ q: '要不要改首页文案？', advice: '建议改，理由见正文' }, { q: '上线时间？', advice: '建议周三晚上' }];
    const PR_URL = 'https://github.com/dollar3651314/agents/pull/101';
    const W = { pr: '【要你决定】换首页文案（样例）', look: '样例待办四：看待办里的说明', cut: '样例待办五：看周包那一段', ext: '样例待办六：去 X 发置顶帖' };
    const r = await srv.ingest('agents', [
      { kind: 'prs', key: '', source_at: now, payload: { items: [{ number: 101, title: W.pr, url: PR_URL, days: 0, tag: 'decide', body: LONG, questions: QS }] } },
      { kind: 'todo', key: 'forecast', source_at: now, payload: { product: 'forecast', items: [
        { id: 'T4', type: 'action', text: W.look, link: 'https://github.com/dollar3651314/agents/blob/main/项目/forecast/Amos待办.md', link_text: '看待办', body: '待办这一行的说明：先在 X 简介里加官网链接，再截图发群。' },
        { id: 'T5', type: 'action', text: W.cut, link: 'https://github.com/dollar3651314/agents/blob/main/项目/forecast/周包.md', link_text: '看周包', body: '周包里对应的那一段（样例）', body_cut: true },
        { id: 'T6', type: 'action', text: W.ext, link: 'https://x.com/compose/post', link_text: '去 X 发帖' },
      ] } },
    ]);
    check('推送带正文的样例（PR 正文 + 问题表、看待办、被截断的、外部平台的）', r.status === 200, r);
    for (const [at, width, sel] of [['/#/work/todo', 1440, '#w-todos'], ['/#/forecast/next', 375, '#f-todos']]) {
      const page = await open({ width, height: width < 600 ? 812 : 900 });
      let popups = 0, ghReq = 0;
      page.context().on('page', () => { popups += 1; });
      page.on('request', (q2) => { if (/^https:\/\/github\.com\//.test(q2.url())) ghReq += 1; });
      await login(page, at);
      await waitFor(page, `${sel} li.todo`);
      const li = (t) => page.locator(`${sel} li.todo`, { hasText: t });
      const tag = `${at}（${width} 宽）`;
      const openDetail = async (t) => {
        const url0 = page.url();
        await li(t).locator('.go .btn.primary').first().click();
        const shown = await li(t).locator('.detail').first().waitFor({ state: 'visible', timeout: WAIT }).then(() => true, () => false);
        await page.waitForTimeout(300);
        return { shown, sameUrl: page.url() === url0, popups, ghReq };
      };
      // 看待办：正文在当前页面显示，没有跳转、没开新窗口、没去 GitHub
      const o1 = await openDetail(W.look);
      check(`${tag} 点"看待办"：正文在当前页面展开，没有跳转、没开新窗口、没请求 GitHub`, o1.shown && o1.sameUrl && o1.popups === 0 && o1.ghReq === 0 && /先在 X 简介里加官网链接/.test((await li(W.look).locator('.detail').innerText().catch(() => '')) || ''), o1);
      const gh = li(W.look).locator('.detail a.gh');
      check(`${tag} 正文旁边留一个小链接"在 GitHub 打开"（新窗口、原来的地址）`, (await gh.innerText().catch(() => null)) === '在 GitHub 打开' && (await gh.getAttribute('href').catch(() => null)) === 'https://github.com/dollar3651314/agents/blob/main/项目/forecast/Amos待办.md' && (await gh.getAttribute('target').catch(() => null)) === '_blank', await gh.evaluate((a) => a.outerHTML).catch(() => null));
      // 被截断的：看得出来
      const o2 = await openDetail(W.cut);
      check(`${tag} 正文被截断过（body_cut）：展开后写明"已截断"`, o2.shown && o2.sameUrl && /已截断/.test((await li(W.cut).locator('.detail').innerText().catch(() => '')) || ''), await li(W.cut).locator('.detail').innerText().catch(() => null));
      // 外部平台的：保留原来的外链，不展开
      const ext = li(W.ext).locator('.go a.btn.primary');
      check(`${tag} 要到外部平台操作的（去 X 发帖）：还是外链、新窗口打开，没有正文框`, (await ext.getAttribute('href').catch(() => null)) === 'https://x.com/compose/post' && (await ext.getAttribute('target').catch(() => null)) === '_blank' && (await li(W.ext).locator('.detail').count()) === 0, await ext.evaluate((a) => a.outerHTML).catch(() => null));
      // 审查 R7：375 宽的展开截图（1440 宽的在下面 PR 那段之后存）；只在 --shots 时存，不影响判断
      if (SHOTS && width === 375) { mkdirSync(SHOTS, { recursive: true }); await li(W.look).scrollIntoViewIfNeeded().catch(() => {}); await page.screenshot({ path: path.join(SHOTS, `todo-detail-${width}.png`) }); }
      if (sel === '#w-todos') {
        // PR：说明正文 + 问题表（每条带建议）；长正文先折叠，点了展开；HTML 只当文字
        const o3 = await openDetail(W.pr);
        const d = li(W.pr).locator('.detail');
        check(`${tag} 点 PR 的主按钮：说明正文在当前页面展开，没有跳转`, o3.shown && o3.sameUrl && o3.popups === 0 && o3.ghReq === 0, o3);
        const qs = await d.locator('.qs li').allInnerTexts().catch(() => []);
        check(`${tag} 要你决定的问题表：每条都带建议`, qs.length === 2 && qs[0].includes(QS[0].q) && qs[0].includes(QS[0].advice) && qs[1].includes(QS[1].q) && qs[1].includes(QS[1].advice), qs);
        const fold = async () => d.locator('.detail-text').evaluate((e) => ({ h: e.clientHeight, sh: e.scrollHeight })).catch(() => null);
        const more = d.locator('[data-more]');
        const f0 = await fold();
        check(`${tag} 长正文默认折叠（"展开全文"按钮，aria-expanded=false，只露出一部分）`, (await more.getAttribute('aria-expanded').catch(() => null)) === 'false' && !!f0 && f0.sh > f0.h + 20, { f0, btn: await more.innerText().catch(() => null) });
        await more.click().catch(() => {});
        await page.waitForTimeout(200);
        const f1 = await fold();
        check(`${tag} 点"展开全文"：全部显示（aria-expanded=true），能看到最后一句`, (await more.getAttribute('aria-expanded').catch(() => null)) === 'true' && !!f1 && f1.sh <= f1.h + 2 && /正文最后一句/.test((await d.innerText().catch(() => '')) || ''), f1);
        const x = await page.evaluate(() => ({ xss: window.__xss ?? null, script: document.querySelectorAll('.detail script, .detail img').length, text: document.querySelector('.detail .detail-text')?.textContent?.slice(0, 80) ?? null }));
        check(`${tag} 正文里的 <script>、<img onerror> 只当文字显示，不执行、不生成元素`, x.xss === null && x.script === 0 && !!x.text && x.text.startsWith('<script>window.__xss=1</script>'), x);
        const gh2 = d.locator('a.gh');
        check(`${tag} PR 正文旁边的"在 GitHub 打开"指向这个 PR`, (await gh2.getAttribute('href').catch(() => null)) === PR_URL, await gh2.getAttribute('href').catch(() => null));
        if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `todo-detail-${width}.png`), fullPage: true }); }
      }
      check(`${tag} 整段没开新窗口、没请求 GitHub`, popups === 0 && ghReq === 0, { popups, ghReq });
      await page.context().close();
    }
  });

  // ---------- E.（批 2 追加）一级、二级菜单固定在屏幕顶部 ----------
  // Amos 2026-11-02："主菜单和子菜单都要固定，方便我点击跳转，现在我滑到下面后 再想跳转其他菜单挺累的"
  for (const [width, height] of [[375, 667], [1440, 700]]) {
    const PAGES = [
      // 起始地址、二级菜单、要点的二级菜单项（跳到哪个模块）、要点的一级菜单（跳到哪一页）
      { at: '/#/work', sub: '#sub-work', mod: 'w-meet', p1: 'forecast' },
      { at: '/#/forecast', sub: '#sub-forecast', mod: 'f-guide', p1: 'tools' },
      { at: '/#/tools', sub: '#sub-tools', mod: 't-ext', p1: 'work' },
      { at: '/#/tools/queue', sub: '#sub-tools', mod: 't-usage', p1: 'forecast' },
    ];
    for (const P of PAGES) {
      await section(`固定菜单 ${P.at}（${width} 宽）`, async () => {
        const page = await open({ width, height });
        await login(page, P.at);
        await waitFor(page, P.sub);
        await page.waitForTimeout(500);
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(300);
        const tag = `${width} 宽 ${P.at}`;
        const st = await page.evaluate((sub) => {
          const vh = innerHeight;
          const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), w: Math.round(b.width) }; };
          const n1 = document.querySelector('nav.nav1'), s2 = document.querySelector(sub);
          // 每个菜单项的中心点上真的是它自己（没被别的东西盖住）
          const hit = (a) => { const b = a.getBoundingClientRect(); if (b.width === 0 || b.bottom <= 0 || b.top >= vh || b.left >= innerWidth || b.right <= 0) return false; const x = Math.min(Math.max(b.left + b.width / 2, 1), innerWidth - 1), y = b.top + b.height / 2; const e = document.elementFromPoint(x, y); return !!e && (e === a || a.contains(e)); };
          const l1 = [...document.querySelectorAll('nav.nav1 a[data-p]')], l2 = [...document.querySelectorAll(sub + ' a[data-s]')];
          return { vh, scrollY: Math.round(scrollY), max: document.documentElement.scrollHeight - vh, n1: r(n1), s2: r(s2), hit1: l1.filter(hit).length, n1All: l1.length, hit2: l2.filter(hit).length, n2All: l2.length };
        }, P.sub);
        check(`${tag}：已经滚到页面最底部（先确认到了要检查的状态）`, st.scrollY > 50 && st.scrollY >= st.max - 2, { scrollY: st.scrollY, max: st.max });
        check(`${tag}：滚到底后一级菜单还在屏幕顶部`, !!st.n1 && st.n1.top >= 0 && st.n1.top < 80 && st.n1.bottom <= st.vh, st.n1);
        check(`${tag}：滚到底后二级菜单还在屏幕顶部（紧挨一级菜单下面）`, !!st.s2 && st.s2.top >= 0 && st.s2.top < 160 && st.s2.bottom <= st.vh, st.s2);
        check(`${tag}：一级菜单每一项都看得到、没被挡住（能点）`, st.n1All >= 3 && st.hit1 === st.n1All, { hit: st.hit1, all: st.n1All });
        check(`${tag}：二级菜单至少有一项看得到、没被挡住（手机上可以横向滑）`, st.n2All > 0 && st.hit2 > 0, { hit: st.hit2, all: st.n2All });
        if (width === 375) check(`${tag}：手机上两层菜单加起来不超过屏幕高度的 25%（滚到底时两层都在屏幕里）`, !!st.s2 && !!st.n1 && st.n1.top >= 0 && st.s2.top >= 0 && st.s2.bottom > 0 && st.s2.bottom <= st.vh * 0.25, { menusBottom: st.s2?.bottom, limit: st.vh * 0.25 });
        // 在底部点二级菜单：不先滚回去，就在当前屏幕上它的位置点（手机上二级菜单可以横向滑，只横向滑它自己）；跳到模块，模块顶端不被固定的菜单挡住
        const link = page.locator(`${P.sub} a[data-s="${P.mod}"]`);
        await link.evaluate((a) => { const nav = a.closest('nav'); const box = nav && nav.querySelector('.in'); [nav, box].forEach((x) => { if (x && x.scrollWidth > x.clientWidth) x.scrollLeft = a.offsetLeft - 8; }); }).catch(() => {});
        const box = await link.boundingBox();
        const inView = !!box && box.y >= 0 && box.y + box.height <= height && box.x >= 0 && box.x + box.width <= width;
        check(`${tag}：滚到底后要点的二级菜单项"${P.mod}"就在屏幕里`, inView, box);
        if (inView) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(600);
        const m = await page.evaluate(([id, sub]) => { const e = document.getElementById(id), s2 = document.querySelector(sub); if (!e) return null; const b = e.getBoundingClientRect(), sb = s2 ? s2.getBoundingClientRect() : { bottom: 0 }; return { top: Math.round(b.top), menusBottom: Math.round(sb.bottom), vh: innerHeight, hash: location.hash }; }, [P.mod, P.sub]);
        check(`${tag}：在底部点二级菜单"${P.mod}"：跳到这个模块，模块顶端在固定菜单下面、没被挡住`, !!m && m.top >= m.menusBottom - 1 && m.top < m.vh && m.hash.includes('/' + P.mod.split('-')[1]), m);
        // 再滚到底，点一级菜单：跳到另一页
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(200);
        const b1 = await page.locator(`nav.nav1 a[data-p="${P.p1}"]`).boundingBox();
        const in1 = !!b1 && b1.y >= 0 && b1.y + b1.height <= height;
        if (in1) await page.mouse.click(b1.x + b1.width / 2, b1.y + b1.height / 2);
        const ok = in1 && (await waitFor(page, `#v-${P.p1}`));
        const top = await page.evaluate((p) => { const v = document.getElementById('v-' + p); const s = document.querySelector('#sub-' + p); return v && s ? { v: Math.round(v.getBoundingClientRect().top), menus: Math.round(s.getBoundingClientRect().bottom) } : null; }, P.p1);
        check(`${tag}：在底部点一级菜单"${P.p1}"：跳到那一页，页面开头不被菜单挡住`, ok && !!top && top.v >= top.menus - 1, top);
        if (SHOTS && P.at === '/#/work') { mkdirSync(SHOTS, { recursive: true }); await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await page.screenshot({ path: path.join(SHOTS, `sticky-${width}.png`) }); }
        await page.context().close();
      });
    }
  }

  // ---------- F.（批 2 审查"改完再审"，测试先写）R5、R6、R8、R9、R10 ----------
  // R5 公司总览页的待办：有正文的点了在当前页展开（同工作台），去 X 这类外部平台的照旧外链
  await section('R5 公司总览的待办正文', async () => {
    const page = await open();
    let popups = 0;
    page.context().on('page', () => { popups += 1; });
    await login(page, '/#/company');
    await waitFor(page, '#v-company li');
    const li = (t) => page.locator('#v-company li', { hasText: t }).first();
    const PR_T = '【要你决定】换首页文案（样例）', LOOK_T = '样例待办四：看待办里的说明', EXT_T = '样例待办六：去 X 发置顶帖';
    check('R5 先确认：公司总览列出了带正文的 PR 和待办', (await li(PR_T).count()) === 1 && (await li(LOOK_T).count()) === 1, [await li(PR_T).count(), await li(LOOK_T).count()]);
    for (const t of [PR_T, LOOK_T]) {
      const url0 = page.url();
      await li(t).locator('.act .btn').first().click();
      const shown = await li(t).locator('.detail').first().waitFor({ state: 'visible', timeout: WAIT }).then(() => true, () => false);
      await page.waitForTimeout(300);
      check(`R5 公司总览点"${t.slice(0, 12)}…"的按钮：正文在当前页展开，没跳转、没开新窗口`, shown && page.url() === url0 && popups === 0 && ((await li(t).locator('.detail').innerText().catch(() => '')) || '').length > 10, { shown, url: page.url(), popups });
      check(`R5 公司总览"${t.slice(0, 12)}…"：正文旁边留"在 GitHub 打开"`, (await li(t).locator('.detail a.gh').innerText().catch(() => null)) === '在 GitHub 打开', null);
    }
    const x = await page.evaluate(() => ({ xss: window.__xss ?? null, n: document.querySelectorAll('#v-company .detail script, #v-company .detail img').length }));
    check('R5 公司总览：正文里的 HTML 只当文字，不执行', x.xss === null && x.n === 0, x);
    const ext = li(EXT_T).locator('.act a.btn').first();
    check('R5 公司总览：去 X 发帖的照旧是外链（新窗口），没有正文框', (await ext.getAttribute('href').catch(() => null)) === 'https://x.com/compose/post' && (await ext.getAttribute('target').catch(() => null)) === '_blank' && (await li(EXT_T).locator('.detail').count()) === 0, await ext.evaluate((a) => a.outerHTML).catch(() => null));
    await page.context().close();
  });

  // R6 页面上不再出现"看完在 PR 里回复"，改成"看完在 Claude 窗口里回复"
  await section('R6 回复的地方', async () => {
    const page = await open();
    await login(page, '/#/work/todo');
    await waitFor(page, '#w-todos li.todo');
    const prLi = page.locator('#w-todos li.todo', { hasText: '【要你决定】换首页文案（样例）' });
    const t = (await prLi.innerText().catch(() => '')) || '';
    const html = await page.evaluate(async () => (await fetch('/', { credentials: 'same-origin' })).text());
    check('R6 【要你决定】的 PR 写"看完在 Claude 窗口里回复"', t.includes('看完在 Claude 窗口里回复'), t.slice(0, 200));
    check('R6 页面和页面源码里都不再出现"在 PR 里回复"', !(await page.evaluate(() => document.body.innerText.includes('在 PR 里回复'))) && !html.includes('在 PR 里回复'), null);
    await page.context().close();
  });

  // R8 375 宽：公共工具的二级菜单里"插件下载"不用横滑就看得到；或者菜单右边缘有能横滑的提示（两种都算过）
  await section('R8 手机上的插件下载菜单', async () => {
    const page = await open({ width: 375, height: 812 });
    await login(page, '/#/tools');
    await waitFor(page, '#sub-tools a[data-s="t-ext"]', { state: 'attached' });
    const r = await page.evaluate(() => {
      const nav = document.getElementById('sub-tools'), a = nav && nav.querySelector('a[data-s="t-ext"]');
      if (!nav || !a) return null;
      const scrollers = [nav, ...nav.querySelectorAll('*')].filter((e) => e.scrollWidth > e.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(e).overflowX));
      scrollers.forEach((e) => { e.scrollLeft = 0; });
      const b = a.getBoundingClientRect();
      const fits = b.width > 0 && b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight;
      const hit = (() => { const e = document.elementFromPoint(Math.min(b.left + b.width / 2, innerWidth - 1), b.top + b.height / 2); return !!e && (e === a || a.contains(e)); })();
      // 提示：能横滑的容器上有可见的 [data-scroll-hint]，或右边缘有渐隐遮罩（mask-image），或 ::after 画了东西
      const hint = scrollers.length > 0 && scrollers.some((e) => {
        const h = e.querySelector('[data-scroll-hint]') || e.parentElement?.querySelector('[data-scroll-hint]');
        const hv = !!h && h.getBoundingClientRect().width > 0 && getComputedStyle(h).visibility !== 'hidden';
        const cs = getComputedStyle(e), af = getComputedStyle(e, '::after');
        const mask = (cs.maskImage && cs.maskImage !== 'none') || (cs.webkitMaskImage && cs.webkitMaskImage !== 'none');
        const after = af.content && af.content !== 'none' && af.content !== 'normal' && af.display !== 'none';
        return hv || mask || after;
      });
      return { fits: fits && hit, hint, scrollers: scrollers.length, box: [Math.round(b.left), Math.round(b.right)], vw: innerWidth };
    });
    check('R8 375 宽：公共工具二级菜单的"插件下载"不用横滑就看得到，或者菜单右边缘有能横滑的提示', !!r && (r.fits || r.hint), r);
    await page.context().close();
  });

  // R9 667×375 横屏：两层固定菜单加起来不超过屏幕高度的 25%
  for (const at of ['/#/work', '/#/forecast', '/#/tools']) {
    await section(`R9 横屏 ${at}`, async () => {
      const page = await open({ width: 667, height: 375 });
      await login(page, at);
      const p = at.split('/')[2];
      await waitFor(page, `#sub-${p}`);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(300);
      const m = await page.evaluate((sub) => { const n1 = document.querySelector('nav.nav1').getBoundingClientRect(), s2 = document.querySelector(sub).getBoundingClientRect(); return { scrollY: Math.round(scrollY), n1top: Math.round(n1.top), s2top: Math.round(s2.top), bottom: Math.round(Math.max(n1.bottom, s2.bottom)), vh: innerHeight }; }, `#sub-${p}`);
      check(`R9 667×375 横屏 ${at}：滚动后两层菜单都在顶部，加起来 ≤ 屏幕高度 25%（${375 * 0.25}px）`, m.scrollY > 0 && m.n1top >= 0 && m.s2top >= 0 && m.bottom <= m.vh * 0.25, m);
      await page.context().close();
    });
  }

  // R10 停在公共工具页超过 30 秒，一级菜单的数字会刷新；第一次读取失败，下次要重试
  await section('R10 公共工具页上菜单数字的刷新', async () => {
    const t0 = Date.now();
    const page = await open();
    await page.clock.install({ time: t0 });
    await login(page, '/#/tools');
    await page.waitForFunction(() => /^\d+$/.test(document.getElementById('c-work')?.textContent?.trim() || '') && !document.getElementById('c-work').hidden, null, { timeout: WAIT }).catch(() => {});
    const before = (await badges(page)).work;
    check('R10 先确认：停在公共工具页，工作台菜单上有数字', typeof before === 'number' && before > 0, before);
    const r = await srv.ingest('agents', [{ kind: 'todo', key: '经营会', source_at: Date.now(), payload: { product: '经营会', items: [{ id: 'M1·11/1', type: 'confirm', text: '样例待办三：挑一天开局沟通' }, { id: 'M8·11/1', type: 'confirm', text: '样例待办七：R10 新加的一条' }] } }]);
    check('R10 服务器上多了一条待办', r.status === 200, r);
    await page.clock.fastForward(31_000);
    const up = await page.waitForFunction((b) => Number(document.getElementById('c-work')?.textContent) === b + 1, before, { timeout: WAIT }).then(() => true, () => false);
    check('R10 停在公共工具页 30 秒后，工作台菜单的数字自动 +1（没切页、没刷新）', up, { before, now: (await badges(page)).work });
    await page.context().close();

    const p2 = await open();
    await p2.clock.install({ time: Date.now() });
    let fail = 1;
    await p2.route('**/api/company', (rt) => (fail-- > 0 ? rt.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"样例：第一次读失败"}' }) : rt.continue()));
    await login(p2, '/#/tools');
    await p2.waitForTimeout(800);
    await p2.clock.fastForward(31_000);
    const got = await p2.waitForFunction(() => /^\d+$/.test(document.getElementById('c-work')?.textContent?.trim() || '') && !document.getElementById('c-work').hidden, null, { timeout: WAIT }).then(() => true, () => false);
    check('R10 第一次读 /api/company 失败：之后会重试，30 秒内菜单数字出来，不会一直空着', fail < 0 && got, { retried: fail < 0, badge: await badges(p2) });
    await p2.context().close();
  });

  // ---------- G.（批 2 新口径，Amos 2026-11-02："只有agents才是公司……如果真有人提交了，只需要给我看就好"）代码仓库的 PR 只显示标题和链接 ----------
  await section('G 代码仓库的 PR', async () => {
    const EXT = { number: 21, title: '外部样例：改 README', url: 'https://github.com/dollar3651314/Marketing/pull/21' };
    const OWNPR = { number: 22, title: '【要你决定】代码仓库自己的样例', url: 'https://github.com/dollar3651314/Marketing/pull/22' };
    const r = await srv.ingest('marketing', [{ kind: 'prs', key: '', payload: { items: [
      { ...EXT, days: 0, external: true },
      { ...OWNPR, days: 1, tag: 'decide', body: 'marketing 推上来的正文（不该显示）', questions: [{ q: '代码仓库的问题', advice: '不该显示' }] },
    ] } }]);
    check('G 推送 Marketing 仓库的两个 PR（一个外部提交、一个自己开的）', r.status === 200, r);
    const page = await open();
    let popups = 0;
    page.context().on('page', () => { popups += 1; });
    await login(page, '/#/work/todo');
    await waitFor(page, '#w-todos li.todo');
    const ext = page.locator('#w-todos li.todo', { hasText: EXT.title });
    const t = (await ext.innerText().catch(() => '')) || '';
    check('G 外部提交的 PR 在工作台单独一条，写"外部提交，给你看一下"', (await ext.count()) === 1 && t.includes('外部提交，给你看一下'), t.slice(0, 200));
    check('G 外部提交的 PR 不当成"要你决定"的事', !t.includes('要你决定'), t.slice(0, 200));
    const gh = ext.locator('a.gh');
    check('G 外部提交的 PR 只有"在 GitHub 打开"（新窗口、PR 地址），没有展开正文的按钮', (await gh.innerText().catch(() => null)) === '在 GitHub 打开' && (await gh.getAttribute('href').catch(() => null)) === EXT.url && (await gh.getAttribute('target').catch(() => null)) === '_blank' && (await ext.locator('.detail, [data-more], button.btn.primary').count()) === 0, await ext.evaluate((li) => li.outerHTML.slice(0, 400)).catch(() => null));
    const own = page.locator('#w-todos li.todo', { hasText: OWNPR.title });
    const prim = own.locator('.go .btn.primary').first();
    check('G 自己在代码仓库开的 PR：只有标题和链接（主按钮是指向 PR 的外链，不是展开按钮）', (await own.count()) === 1 && (await prim.evaluate((e) => e.tagName).catch(() => null)) === 'A' && (await prim.getAttribute('href').catch(() => null)) === OWNPR.url, await own.evaluate((li) => li.outerHTML.slice(0, 400)).catch(() => null));
    const all = (await page.evaluate(() => document.body.innerText)) || '';
    check('G 代码仓库推上来的正文、问题表一个字都不显示（正文只认 agents）', !all.includes('marketing 推上来的正文') && !all.includes('代码仓库的问题') && (await own.locator('.detail').count()) === 0, null);
    check('G 整段没开新窗口', popups === 0, popups);
    await page.context().close();
  });

  check('A、B、D、E、F、G 段没有脚本错误', errors.length === 0, errors);
} catch (e) {
  check('脚本跑完（没有中途出错）', false, String(e && e.stack || e));
} finally {
  srv.stop();
}

// ---------- C. 按项目看用量（另起一个本地服务：样例直接写进 usage_by_project，迁移 0007 没有时这一段报"建表失败"） ----------
{
  const pacific = (ms) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  };
  const gd = pacific(now);
  const USAGE = [
    `INSERT INTO model_usage (day, model, req, tok_in, tok_out, last_status, last_at) VALUES (${q(gd)}, 'gemini-3.6-flash', 6, 600, 120, 200, ${now});`,
    `INSERT INTO model_usage (day, model, req, tok_in, tok_out, last_status, last_at) VALUES (${q(gd)}, 'gemini-3.8-flash', 2, 200, 40, 200, ${now});`,
    `INSERT INTO usage_by_project (day, project, model, req, tok_in, tok_out, neurons) VALUES (${q(gd)}, 'forecast', 'gemini-3.6-flash', 5, 500, 100, 0);`,
    `INSERT INTO usage_by_project (day, project, model, req, tok_in, tok_out, neurons) VALUES (${q(gd)}, 'forecast', 'gemini-3.8-flash', 2, 200, 40, 0);`,
    `INSERT INTO usage_by_project (day, project, model, req, tok_in, tok_out, neurons) VALUES (${q(gd)}, '_platform', 'gemini-3.6-flash', 1, 100, 20, 0);`,
  ].join('\n');
  let srv2 = null;
  const errs2 = [];
  await section('按项目看用量', async () => {
    try { srv2 = await startServer({ name: 'e2e-tools-usage', seedSql: USAGE }); } catch (e) {
      const m = String(e && e.message || e);
      check('按项目看用量：样例写进 usage_by_project（要有迁移 0007）', false, (/[^\n]*(no such table|usage_by_project)[^\n]*/.exec(m) || [m.split('\n')[0]])[0].slice(0, 300));
      return;
    }
    const b2 = browser;
    for (const width of WIDTHS) {
      const ctx = await b2.newContext({ viewport: { width, height: 900 } });
      const page = await ctx.newPage();
      curPage = page;
      page.on('pageerror', (e) => errs2.push(e.message));
      await page.goto(srv2.BASE + '/#/tools/byproj');
      await page.fill('#pw', PASS);
      await page.click('#go');
      await page.waitForSelector('#app:not([hidden])', { timeout: WAIT });
      // 测试用例修正（批 3 时发现的偶发失败，C29、C57）：tbody 里先有一行"正在读取…"占位，原来等到它就往下查，读得慢时查到的是占位行。
      // 改成等到真的数据行（第一格写 forecast）再查；断言不变。
      const ok = await page.waitForFunction(() => [...document.querySelectorAll('#t-byproj tbody tr')].some((tr) => (tr.querySelector('td')?.innerText || '').includes('forecast')), null, { timeout: WAIT }).then(() => true, () => false);
      const rows = await page.locator('#t-byproj tbody tr').evaluateAll((trs) => trs.map((tr) => ({ name: tr.querySelector('td')?.innerText || '', gemini: tr.querySelector('td[data-label="Gemini"]')?.innerText || '' })));
      const num = (s) => { const m = /([\d,]+)\s*次/.exec(s); return m ? Number(m[1].replace(/,/g, '')) : NaN; };
      const fc = rows.find((r) => r.name.includes('forecast')), pf = rows.find((r) => r.name.includes('平台自己'));
      check(`${width} 宽：#t-byproj 有 forecast 一行（7 次）和"平台自己"一行（1 次，"测试 AI"）`, ok && num(fc?.gemini ?? '') === 7 && num(pf?.gemini ?? '') === 1, rows);
      const total = (await page.evaluate(async () => (await (await fetch('/api/usage', { credentials: 'same-origin' })).json()).rows)).filter((r) => r.model !== 'workers-ai').reduce((n, r) => n + r.req, 0);
      const sum = rows.reduce((n, r) => n + (Number.isFinite(num(r.gemini)) ? num(r.gemini) : 0), 0);
      check(`${width} 宽：按项目的 Gemini 次数加起来（${sum}）= 用量总额度里 Gemini 的请求数（${total}）`, ok && sum === total && total === 8, { sum, total });
      const t = (await txt(page, '#t-byproj')) || '';
      check(`${width} 宽：写明以前没分项目（D-3 不回填）`, /以前没分项目|以前的没分项目/.test(t), t.slice(-80));
      check(`${width} 宽：不横向滚动`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), null);
      if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `tools-byproj-${width}.png`), fullPage: true }); }
      await ctx.close();
    }
    check('C 段没有脚本错误', errs2.length === 0, errs2);
  });
  if (srv2) srv2.stop();
}

await Promise.all(pendingShots);
if (ART && failLines.length) { mkdirSync(ART, { recursive: true }); writeFileSync(path.join(ART, 'e2e-tools-fails.txt'), failLines.join('\n') + '\n'); }
await browser.close();
if (fails.length) { console.error(`\n✗ 公司平台批 2 验收有 ${fails.length} 项不通过`); process.exit(1); }
console.log('\n✓ 公司平台批 2 验收测试全部通过');
process.exit(0);
