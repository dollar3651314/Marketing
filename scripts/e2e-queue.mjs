#!/usr/bin/env node
/**
 * 跟帖评论清单的浏览器级基线（公司平台技术方案 v0.2 · PR 1 第一步、审查 R4、风险 R-1）：
 * 在"换外框"之前的代码上先全绿，之后公司平台每个 PR 都要它保持全绿——外框怎么换，清单的功能一个不能少。
 *   node scripts/e2e-queue.mjs                 # CI 里跑这个
 *   node scripts/e2e-queue.mjs --shots <目录>   # 另外存清单页截图（1280、390 宽）
 * 覆盖：从 /queue 登录直接进清单 → 一键回复（X、Threads 打开的链接对、提示"发完回来点我回了"）→ 筛选（状态、项目、平台、日期四种、排序）→
 * 跳过 → 我回了（"今天已回 N / 上限"加 1）→ 到上限后"一键回复"变灰、再点"我回了"提示到上限 → 放回待回（计数减 1）→
 * 删除一条（先确认、可以取消）→ 删除筛选出的这些（先确认、可以取消）→ 页面计数和接口一致 → 手机 390 宽不横向滚动 → 全程没有脚本错误。
 * 只认清单自己的元素（#list、#f-prod、#f-plat、#f-sort、[data-f]、[data-rg]、#f-from、#f-to、#bulk、#toast）和登录框（#pw、#go）；
 * 改版批 B（2026-11-04）起项目、平台、排序、日期筛选收进 details#q-filters（默认收起），批量删除可能收进模块的 details.more：
 *   操作这些控件前先用 e2e-look.mjs 的 reveal() 点开它所在的折叠（辅助步骤，和用户的操作一样；不在折叠里时什么都不做），断言一条没改。
 * "今天已回 N / 上限"在页面上任何位置出现都算（PR 1 以后它可能从顶栏移到清单模块里）。
 * 样例数据在服务启动前直接写进本地库（每次空库、每轮新数据，C57）；每天上限设成 3，方便测"到上限"。任何一条不符就以非 0 退出。
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { startServer, PASS, twDay, twStart, q, checker } from './e2e-server.mjs';
import { reveal } from './e2e-look.mjs';

const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > 0 ? path.resolve(process.argv[shotsAt + 1]) : '';
const { fails, check } = checker();
const H = 3600_000, DAY = 24 * H;
const CAP = 3;

// ---- 样例数据：4 条待回（2 个项目、2 个平台、今天 / 3 天前 / 10 天前）、1 条今天回的、1 条今天跳过的、插件里今天"同意"1 次 ----
const now = Date.now();
const today = twDay(now);
const T = twStart(today);
const QUEUE = [
  // author, product, platform, post_id, score, at, updated_at, post_at, status, done_day, draft, reasons
  ['@alpha', 'forecast', 'x', '1900000000000000001', 90, T + 5000, T + 5000, now - H, 'pending', null, '草稿甲：先看两队的伤病名单再下结论', '["主队三名主力伤缺","讨论热度高"]'],
  ['@beta', 'forecast', 'threads', 'DBeta0001', 60, T + 4000, T + 4000, now - 30 * H, 'pending', null, '草稿乙：客场三连败之后这场很关键', '[]'],
  ['@gamma', 'forecast', 'x', '1900000000000000003', 75, T - 3 * DAY + H, T - 3 * DAY + H, null, 'pending', null, '草稿丙：盘口变化值得留意', '[]'],
  ['@delta', 'demo2', 'threads', 'DDelta0004', 50, T - 10 * DAY + H, T - 10 * DAY + H, null, 'pending', null, '草稿丁：第二个项目的一条', '[]'],
  ['@eps', 'forecast', 'x', '1900000000000000005', 80, T - 2 * DAY, T + 1000, null, 'done', today, '草稿戊：今天已经回过的', '[]'],
  ['@zeta', 'forecast', 'threads', 'DZeta0006', 40, T - DAY, T + 2000, null, 'skip', null, '草稿己：今天跳过的', '[]'],
];
const seedSql = [
  ...QUEUE.map(([author, product, platform, postId, score, at, upd, postAt, status, doneDay, draft, reasons]) =>
    `INSERT INTO queue (at, updated_at, product, platform, post_id, author, snippet, post_at, score, draft, source, status, done_day, engine, reasons) VALUES (${[at, upd, product, platform, postId, author, `${author} 的原帖`, postAt, score, draft, '', status, doneDay, 'gemini', reasons].map(q).join(', ')});`),
  `INSERT INTO events (at, day, product, platform, post_id, author, snippet, score, action, draft) VALUES (${[T + 3000, today, 'forecast', 'x', '1900000000000000099', '@plugin', '', 70, 'approve', '插件里同意的一条'].map(q).join(', ')});`,
].join('\n');
const draftOf = (a) => QUEUE.find((x) => x[0] === a)[10];
const postOf = (a) => QUEUE.find((x) => x[0] === a)[3];

const srv = await startServer({ name: 'e2e-queue', vars: { DAILY_REPLY_CAP: String(CAP) }, seedSql });
const BASE = srv.BASE;
const browser = await chromium.launch();
const errors = [];

async function open(viewport) {
  const ctx = await browser.newContext({ viewport });
  // 一键回复会开 X / Threads 的官方回复窗口：测试里拦下来，不连外网
  await ctx.route(/^https:\/\/(x\.com|www\.threads\.com)\//, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>替身回复窗口</p>' }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  return page;
}
async function login(page) {
  await page.goto(BASE + '/queue');
  await page.fill('#pw', PASS);
  await page.click('#go');
  await page.waitForSelector('#list .item, #list .empty', { state: 'visible' });
}
/** 清单现在的样子：作者顺序、"共 N 条"、"今天已回 N / 上限" */
const state = (page) => page.evaluate(() => {
  const m = /今天已回\s*(\d+)\s*\/\s*(\d+)/.exec(document.body.innerText);
  return {
    authors: [...document.querySelectorAll('#list .item .who a')].map((a) => a.textContent),
    total: document.getElementById('total').textContent,
    today: m ? [Number(m[1]), Number(m[2])] : null,
    toast: document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent,
  };
});
/** 做一个会重读清单的动作：等那次 /api/queue 的返回，再等页面变成期望的样子（等不到就照实报，不放宽） */
async function act(page, fn, want) {
  const resp = page.waitForResponse((r) => r.url().includes('/api/queue?') && r.request().method() === 'GET', { timeout: 8000 }).catch(() => null);
  await fn();
  await resp;
  await page.waitForFunction((w) => {
    const a = [...document.querySelectorAll('#list .item .who a')].map((x) => x.textContent);
    return JSON.stringify(a) === JSON.stringify(w);
  }, want, { timeout: 5000 }).catch(() => {});
  return state(page);
}
/** 用页面自己的 fetch 读接口（同一个登录会话；本地是 http，会话 Cookie 带 Secure，Playwright 的 request 不会带上） */
const apiGet = (page, p) => page.evaluate(async (u) => (await fetch(u, { credentials: 'same-origin' })).json(), p);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const item = (page, author) => page.locator('#list .item', { has: page.locator('.who a', { hasText: author }) });

try {
  const page = await open({ width: 1280, height: 900 });
  await login(page);

  // 1. 打开 /queue 直接是清单
  let s = await state(page);
  check('从 /queue 登录后直接是清单：4 条待回、最新的在前', (await page.locator('#list').isVisible()) && same(s.authors, ['@alpha', '@beta', '@gamma', '@delta']) && s.total.startsWith('共 4 条'), s);
  check(`"今天已回 2 / ${CAP}"：后台"我回了" 1 条 + 插件"同意" 1 次`, same(s.today, [2, CAP]), s.today);
  check('打分依据、"可能已过时"（原帖超过 24 小时）照常显示', (await item(page, '@alpha').locator('.why li').count()) === 2 && (await item(page, '@beta').locator('.stale').innerText()) === '可能已过时', null);

  // 2. 一键回复：打开的链接对（X、Threads），新窗口，提示回来点"我回了"
  {
    const ax = item(page, '@alpha').locator('a.btn.primary');
    const wantX = `https://x.com/intent/tweet?in_reply_to=${postOf('@alpha')}&text=${encodeURIComponent(draftOf('@alpha'))}`;
    const wantT = `https://www.threads.com/intent/post?reply_post_shortcode=${postOf('@beta')}&text=${encodeURIComponent(draftOf('@beta'))}`;
    check('一键回复（X）：链接是官方回复窗口、带原帖编号和草稿、在新窗口打开', (await ax.innerText()) === '一键回复' && (await ax.getAttribute('href')) === wantX && (await ax.getAttribute('target')) === '_blank', await ax.getAttribute('href'));
    check('一键回复（Threads）：链接带帖子短码和草稿', (await item(page, '@beta').locator('a.btn.primary').getAttribute('href')) === wantT, await item(page, '@beta').locator('a.btn.primary').getAttribute('href'));
    const [popup] = await Promise.all([page.context().waitForEvent('page'), ax.click()]);
    await popup.waitForLoadState('domcontentloaded');
    check('一键回复：点了真的打开回复窗口', popup.url().startsWith(`https://x.com/intent/tweet?in_reply_to=${postOf('@alpha')}&text=`), popup.url());
    await popup.close();
    check('一键回复：提示"发完回来点我回了"，清单不变', (await state(page)).toast === '已打开回复窗口。发完回来点"我回了"。' && same((await state(page)).authors, ['@alpha', '@beta', '@gamma', '@delta']), await state(page));
  }

  // 3. 筛选：平台、项目、排序、日期（今天、近 7 天、自选、全部）、状态
  s = await act(page, async () => (await reveal(page, '#f-plat'), page.selectOption('#f-plat', 'threads')), ['@beta', '@delta']);
  check('筛选 平台 = Threads：只剩 Threads 的 2 条', same(s.authors, ['@beta', '@delta']) && s.total.startsWith('共 2 条'), s);
  s = await act(page, async () => (await reveal(page, '#f-plat'), page.selectOption('#f-plat', '')), ['@alpha', '@beta', '@gamma', '@delta']);
  check('平台改回全部：4 条', same(s.authors, ['@alpha', '@beta', '@gamma', '@delta']), s);
  const opts = await page.locator('#f-prod option').evaluateAll((o) => o.map((x) => x.value));
  check('项目下拉：全部 + 清单里出现过的项目', same(opts, ['', 'demo2', 'forecast']), opts);
  s = await act(page, async () => (await reveal(page, '#f-prod'), page.selectOption('#f-prod', 'demo2')), ['@delta']);
  check('筛选 项目 = demo2：只剩 1 条', same(s.authors, ['@delta']) && s.total.startsWith('共 1 条'), s);
  s = await act(page, async () => (await reveal(page, '#f-prod'), page.selectOption('#f-prod', '')), ['@alpha', '@beta', '@gamma', '@delta']);
  s = await act(page, async () => (await reveal(page, '#f-sort'), page.selectOption('#f-sort', 'score')), ['@alpha', '@gamma', '@beta', '@delta']);
  check('排序 = 评分从高到低：90、75、60、50', same(s.authors, ['@alpha', '@gamma', '@beta', '@delta']), s);
  s = await act(page, async () => (await reveal(page, '#f-sort'), page.selectOption('#f-sort', 'time')), ['@alpha', '@beta', '@gamma', '@delta']);
  check('排序改回最新的在前', same(s.authors, ['@alpha', '@beta', '@gamma', '@delta']), s);
  s = await act(page, async () => (await reveal(page, '[data-rg="today"]'), page.click('[data-rg="today"]')), ['@alpha', '@beta']);
  check('日期 = 今天（台湾）：今天存进来的 2 条，按钮按下', same(s.authors, ['@alpha', '@beta']) && (await page.getAttribute('[data-rg="today"]', 'aria-pressed')) === 'true' && (await page.inputValue('#f-from')) === today, s);
  s = await act(page, async () => (await reveal(page, '[data-rg="7"]'), page.click('[data-rg="7"]')), ['@alpha', '@beta', '@gamma']);
  check('日期 = 近 7 天：3 条（10 天前的不在）', same(s.authors, ['@alpha', '@beta', '@gamma']), s);
  const tenAgo = twDay(T - 10 * DAY + H);
  await act(page, async () => (await reveal(page, '#f-from'), page.fill('#f-from', tenAgo)), ['@alpha', '@beta', '@gamma', '@delta']);
  s = await act(page, async () => (await reveal(page, '#f-to'), page.fill('#f-to', tenAgo)), ['@delta']);
  check('日期 = 自己选（10 天前那一天）：只有那天的 1 条，快捷按钮都不按下', same(s.authors, ['@delta']) && (await page.locator('[data-rg][aria-pressed="true"]').count()) === 0, s);
  s = await act(page, async () => (await reveal(page, '[data-rg="all"]'), page.click('[data-rg="all"]')), ['@alpha', '@beta', '@gamma', '@delta']);
  check('日期 = 全部：4 条，日期框清空', same(s.authors, ['@alpha', '@beta', '@gamma', '@delta']) && (await page.inputValue('#f-from')) === '' && (await page.inputValue('#f-to')) === '', s);
  s = await act(page, () => page.click('[data-f="done"]'), ['@eps']);
  check('状态 = 已回：今天回的那条，显示"我回了"时间和"放回待回"', same(s.authors, ['@eps']) && (await item(page, '@eps').innerText()).includes('我回了 ' + today) && (await item(page, '@eps').locator('button', { hasText: '放回待回' }).count()) === 1, s);
  s = await act(page, () => page.click('[data-f="skip"]'), ['@zeta']);
  check('状态 = 跳过：今天跳过的那条', same(s.authors, ['@zeta']) && (await item(page, '@zeta').innerText()).includes('跳过 ' + today), s);
  s = await act(page, () => page.click('[data-f="pending"]'), ['@alpha', '@beta', '@gamma', '@delta']);
  check('状态 = 待回：回到 4 条', same(s.authors, ['@alpha', '@beta', '@gamma', '@delta']), s);

  // 4. 跳过
  s = await act(page, () => item(page, '@gamma').locator('button', { hasText: '跳过' }).click(), ['@alpha', '@beta', '@delta']);
  check('跳过：这条离开待回、提示移到"跳过"、今天已回不变', same(s.authors, ['@alpha', '@beta', '@delta']) && s.toast === '已移到"跳过"' && same(s.today, [2, CAP]), s);
  s = await act(page, () => page.click('[data-f="skip"]'), ['@gamma', '@zeta']);
  check('跳过：在"跳过"里排第一', same(s.authors, ['@gamma', '@zeta']), s);
  await act(page, () => page.click('[data-f="pending"]'), ['@alpha', '@beta', '@delta']);

  // 5. 我回了：今天已回 +1，到上限
  s = await act(page, () => item(page, '@alpha').locator('button', { hasText: '我回了' }).click(), ['@beta', '@delta']);
  check(`我回了：这条离开待回、提示移到"已回"、今天已回 3 / ${CAP}`, same(s.authors, ['@beta', '@delta']) && s.toast === '已移到"已回"' && same(s.today, [3, CAP]), s);
  {
    const r = item(page, '@beta').locator('a.btn.primary');
    check('到上限：一键回复变成"今天已到上限"、不能点', (await r.innerText()) === '今天已到上限' && (await r.getAttribute('aria-disabled')) === 'true', await r.innerText());
    const b = item(page, '@beta').locator('button', { hasText: '我回了' });
    await b.click();
    await page.waitForFunction(() => document.getElementById('toast').classList.contains('err'), null, { timeout: 5000 }).catch(() => {});
    s = await state(page);
    check(`到上限再点"我回了"：提示"今天已经回了 ${CAP} 条，到上限了"，这条还在、按钮恢复`, s.toast === `今天已经回了 ${CAP} 条，到上限了` && same(s.authors, ['@beta', '@delta']) && (await b.innerText()) === '我回了' && !(await b.isDisabled()), s);
  }

  // 6. 放回待回：计数减 1，一键回复恢复
  s = await act(page, () => page.click('[data-f="done"]'), ['@alpha', '@eps']);
  check('已回里有刚回的那条（排第一）', same(s.authors, ['@alpha', '@eps']), s);
  s = await act(page, () => item(page, '@alpha').locator('button', { hasText: '放回待回' }).click(), ['@eps']);
  check(`放回待回：提示、今天已回回到 2 / ${CAP}`, s.toast === '已放回待回' && same(s.today, [2, CAP]), s);
  s = await act(page, () => page.click('[data-f="pending"]'), ['@alpha', '@beta', '@delta']);
  check('回到待回：3 条，一键回复恢复可点', same(s.authors, ['@alpha', '@beta', '@delta']) && (await item(page, '@beta').locator('a.btn.primary').innerText()) === '一键回复' && (await item(page, '@beta').locator('a.btn.primary').getAttribute('aria-disabled')) === null, s);

  // 7. 删除一条：先确认，可以取消
  {
    await item(page, '@beta').locator('button', { hasText: '删除' }).click();
    const c = item(page, '@beta').locator('.confirm');
    check('删除：先出现"删了不能恢复，确定？"', (await c.isVisible()) && (await c.innerText()).includes('删了不能恢复，确定？'), null);
    await c.locator('button', { hasText: '取消' }).click();
    check('删除 → 取消：确认框消失，这条还在', (await item(page, '@beta').locator('.confirm').count()) === 0 && (await item(page, '@beta').count()) === 1, null);
    await item(page, '@beta').locator('button', { hasText: '删除' }).click();
    s = await act(page, () => item(page, '@beta').locator('button', { hasText: '确认删除' }).click(), ['@alpha', '@delta']);
    check('删除 → 确认：提示"已删除 1 条"，这条没了', s.toast === '已删除 1 条' && same(s.authors, ['@alpha', '@delta']), s);
    const all = [];
    for (const st of ['pending', 'done', 'skip']) all.push(...(await apiGet(page, '/api/queue?status=' + st)).items.map((x) => x.author));
    check('删除：接口里三种状态都查不到这条（真删了）', !all.includes('@beta') && all.length === 5, all);
  }

  // 8. 删除筛选出的这些：先确认，可以取消
  s = await act(page, async () => (await reveal(page, '#f-prod'), page.selectOption('#f-prod', 'demo2')), ['@delta']);
  await reveal(page, '#bulk');
  check('批量删除按钮写明条数', (await page.locator('#bulk').innerText()) === '删除筛选出的这 1 条', await page.locator('#bulk').innerText());
  await page.click('#bulk');
  check('批量删除：先确认，写明条数和筛选条件', (await page.locator('#bulk-confirm').isVisible()) && (await page.locator('#bulk-text').innerText()).includes('1 条（待回 · demo2）'), await page.locator('#bulk-text').innerText());
  await page.click('#bulk-no');
  check('批量删除 → 取消：确认框消失、这条还在', !(await page.locator('#bulk-confirm').isVisible()) && same((await state(page)).authors, ['@delta']), null);
  await reveal(page, '#bulk');
  await page.click('#bulk');
  s = await act(page, () => page.click('#bulk-yes'), []);
  check('批量删除 → 确认：提示"已删除 1 条"，列表空了、显示空状态', s.toast === '已删除 1 条' && s.authors.length === 0 && (await page.locator('#list .empty').innerText()).includes('没有待回的帖子'), s);
  s = await act(page, async () => (await reveal(page, '#f-prod'), page.selectOption('#f-prod', '')), ['@alpha']);
  check('项目改回全部：只剩 1 条待回，别的项目没被误删', same(s.authors, ['@alpha']), s);

  // 9. "今天"计数：页面和接口一致；刷新页面后还在
  {
    const api = await apiGet(page, '/api/queue?status=pending');
    s = await state(page);
    check('今天已回：页面上的数 = 接口 doneToday / cap', same(s.today, [api.doneToday, api.cap]) && api.doneToday === 2 && api.cap === CAP, [s.today, api.doneToday, api.cap]);
    await page.reload();
    await page.waitForSelector('#list .item');
    check('刷新页面后计数照旧', same((await state(page)).today, [2, CAP]), (await state(page)).today);
  }
  if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'queue-1280.png'), fullPage: true }); }

  // 10. 手机 390 宽
  {
    const m = await open({ width: 390, height: 844 });
    await login(m);
    const w = await m.evaluate(() => ({ page: document.documentElement.scrollWidth, view: window.innerWidth }));
    check('手机 390 宽：清单不横向滚动', w.page <= w.view && (await m.locator('#list .item').count()) === 1, w);
    if (SHOTS) await m.screenshot({ path: path.join(SHOTS, 'queue-390.png'), fullPage: true });
  }
  check('全程没有脚本错误', errors.length === 0, errors);
} catch (e) {
  check('脚本跑完（没有中途出错）', false, String(e && e.stack || e));
} finally {
  await browser.close();
  srv.stop();
}
if (fails.length) { console.error(`\n✗ 跟帖评论清单基线有 ${fails.length} 项不通过`); process.exit(1); }
console.log('\n✓ 跟帖评论清单基线全部通过');
process.exit(0);
