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
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { startServer, PASS, twDay, twStart, q, checker } from './e2e-server.mjs';

const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > 0 ? path.resolve(process.argv[shotsAt + 1]) : '';
const { fails, check } = checker();
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
async function filterProd(page, v) {
  const resp = page.waitForResponse((r) => r.url().includes('/api/queue?') && r.request().method() === 'GET', { timeout: WAIT }).catch(() => null);
  await page.selectOption('#f-prod', v);
  await resp;
  await page.waitForTimeout(200);
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

  check('A、B、D 段没有脚本错误', errors.length === 0, errors);
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
      page.on('pageerror', (e) => errs2.push(e.message));
      await page.goto(srv2.BASE + '/#/tools/byproj');
      await page.fill('#pw', PASS);
      await page.click('#go');
      await page.waitForSelector('#app:not([hidden])', { timeout: WAIT });
      const ok = await waitFor(page, '#t-byproj tbody tr');
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

await browser.close();
if (fails.length) { console.error(`\n✗ 公司平台批 2 验收有 ${fails.length} 项不通过`); process.exit(1); }
console.log('\n✓ 公司平台批 2 验收测试全部通过');
process.exit(0);
