#!/usr/bin/env node
/**
 * 公司平台批 1（PR 1 导航和工作台、PR 2 forecast 项目页）的浏览器级验收测试。
 * 依据：agents 公司平台/技术方案-公司平台-测试与风险.md 第二节 PR 1、PR 2 两行；技术方案-公司平台-PR与数据.md 第一、二、四、六、七节；
 * 原型 公司平台/原型-公司平台-v2.html（Amos 2026-11-01"原型通过，都按建议"）。
 * 测试会话先写（agents C145 第 3 条）：写的时候功能还没做，所以现在是红的；研发写代码到全绿，不改这里的断言（底线 6）。
 *   node scripts/e2e-platform.mjs                 # CI 里跑这个
 *   node scripts/e2e-platform.mjs --shots <目录>   # 另外存工作台、forecast 页截图（375、1440 宽，深浅色）
 *
 * 页面约定（照原型 v2 的元素；研发要改名就同一个 PR 改这里并在 PR 描述写明）：
 *   一级菜单 nav.nav1 a[data-p="work" | "forecast" | "tools"]；二级菜单 #sub-work、#sub-forecast、#sub-tools 里的 a[data-s="<模块 id>"]，地址 #/work/todo 这类锚点
 *   页面 #v-work、#v-forecast、#v-tools；工作台模块 #w-now（#hero）、#w-todo（#w-todos li.todo、#w-donelist）、#w-live、#w-proj、#w-num、#w-meet
 *   待办 li.todo 带颜色类 over（红，超时）/ soon（橙，24 小时内）/ later / none（没定截止时间）；打勾按钮 .tick；撤销 [data-undo]
 *   填数字：待办里的表单 .form，输入框用 <label> 包住（标签文字 X 关注、Threads 关注、名单人数），按钮"保存"
 *   forecast 模块 #f-next（#f-todos）、#f-guide（#g-steps .step、勾选框）、#f-live、#f-card、#f-pack、#f-match（#copy-match、#copy-msg）、#f-tools、#f-handoff
 *   清单页的元素（#list、#f-prod…）照旧，在 #v-tools 里
 * 时间：页面时钟用 Playwright page.clock 固定在"现在"，拨时钟只拨浏览器（C106）；服务端的"现在"是真实时间，样例的截止时间都按真实时间算。
 * 每段单独 try：一段没做出来不影响别的段报结果；等待都有短超时，等不到就照实报"实际值"。任何一条不符就以非 0 退出。
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { startServer, PASS, checker } from './e2e-server.mjs';

const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > 0 ? path.resolve(process.argv[shotsAt + 1]) : '';
const { fails, check } = checker();
const H = 3600_000, MIN = 60_000;
const WAIT = 4000;

const srv = await startServer({ name: 'e2e-platform' });
const BASE = srv.BASE;
const now = Date.now();
const GH = 'https://github.com/dollar3651314/agents/blob/main/';

// ---- 样例数据（每段的期望都从这里算）----
const T = {
  over: '发置顶帖并置顶（样例：已超时）',
  soonPr: '【只看】内测改成等你发启动命令的更正',
  later: '报一下名单页人数和两个号的关注数',
  none1: 'X、Threads 简介加官网链接',
  none2: '用真实邮箱走一遍报名',
  meet: '英语学习网站：挑一天开始开局沟通',
};
const AGENTS = [
  { kind: 'todo', key: 'forecast', source_at: now - H, payload: { product: 'forecast', items: [
    { id: 'T3', type: 'action', text: T.none1 },
    { id: 'T5', type: 'report', text: T.later, due: now + 30 * H },
    { id: 'T4', type: 'action', text: T.over, due: now - 50 * H },
    { id: 'T2', type: 'action', text: T.none2, link: 'https://www.quickcome.online', link_text: '打开官网' },
  ] } },
  { kind: 'todo', key: '经营会', source_at: now - H, payload: { product: '经营会', items: [{ id: 'M3·11/1', type: 'confirm', text: T.meet }] } },
  // 【只看】PR：截止 = 开 PR 时间 + 48 小时 → 还剩 1 小时（橙）
  { kind: 'prs', key: '', source_at: now, payload: { items: [{ number: 89, title: T.soonPr, url: 'https://github.com/dollar3651314/agents/pull/89', days: 1, tag: 'look', opened_at: now - 47 * H }] } },
  { kind: 'projects', key: '', source_at: now - H, payload: { version: 'v1.4', items: [{ name: 'forecast', stage: '试水阶段' }, { name: '报价', stage: '未开始' }] } },
  { kind: 'status', key: 'forecast', source_at: now - H, payload: { product: 'forecast', state: 'B + C', level: 'warn', week: '第一周的 6 条帖子和 10 场焦点战已备好',
    metrics: [{ name: 'X + Threads 关注合计', now: '见公司平台', target: '50' }, { name: '等候名单确认订阅', now: '见公司平台', target: '100' }, { name: '第一笔真实抽成', now: '没有', target: '2026-12-31 前' }] } },
  { kind: 'status', key: '公司平台', source_at: now - H, payload: { product: '公司平台', state: 'E 上线运营', level: 'mute', week: '公司平台批 1', metrics: [{ name: '副驾驶插件版本', now: '0.3.5' }] } },
  { kind: 'handoff', key: 'forecast/市场', source_at: now - H, payload: { role: '市场', date: '2026-11-01', done: 'forecast 周包写好了（样例）', next: '周二窗口' } },
  { kind: 'handoff', key: '公司平台/研发', source_at: now - H, payload: { role: '研发', date: '2026-11-01', done: '公司平台技术方案（样例）', next: '批 1' } },
  { kind: 'weekly', key: '2026-11-01', source_at: now - H, payload: { title: '第 1 期', range: '10/26～11/1', cost: '0 元', mistakes: 9 } },
];
const PACK = {
  project: 'forecast', date: '2026-11-02', link: GH + '项目/forecast/BC-可行性预热/运行记录/2026-11-02-周包.md', due: now + 3 * H,
  steps: [
    { n: 1, text: '置顶帖如果还没发，先发置顶帖' }, { n: 2, text: '名单页导入下面的焦点战（10 场），再排帖子' }, { n: 3, text: '用 X / Threads 自带排程排下面 6 条' },
    { n: 4, text: '第 2、5、6 条发出当天再核对对阵和开赛时间' }, { n: 5, text: '用 Threads 排好同样的 6 条' },
  ],
  posts: Array.from({ length: 6 }, (_, i) => ({ n: i + 1, title: `第 ${i + 1} 条帖子（样例）`, at: now + (3 + 24 * i) * H, at_text: `样例时间 ${i + 1}`, deadline: i === 2 ? '无' : `开赛前 ${i + 1}` })),
  matches: Array.from({ length: 10 }, (_, i) => ({ league: i < 4 ? '歐冠' : 'NBA', home: `主隊${i + 1}`, away: `客隊${i + 1}`, time: `2026-11-0${4 + (i % 5)} 0${i % 10}:00`, note: `樣例 ${i + 1}` })),
};

// ---- 浏览器 ----
const browser = await chromium.launch();
const errors = [];
async function open({ width = 1280, height = 900, colorScheme = 'light', clock = now, clip } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme });
  if (clip === 'ok') await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  if (clock) await page.clock.install({ time: clock });
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
/** 一段测试：出错（例如元素还不存在）也只算这一段的一条失败，接着跑下一段 */
async function section(name, fn) {
  try { await fn(); } catch (e) { check(`${name}：没跑完`, false, String(e && e.message || e).split('\n')[0]); }
}
/** 待办列表：每条的文字和颜色类 */
const todos = (page, sel = '#w-todos') => page.evaluate((s) => [...document.querySelectorAll(s + ' li.todo')].map((li) => ({ text: li.innerText, cls: ['over', 'soon', 'later', 'none'].find((c) => li.classList.contains(c)) || '' })), sel);
const which = (list, t) => list.findIndex((x) => x.text.includes(t));
/** "做完的"是折叠的 <details>：点开它（用户也是这样点） */
async function openDone(page) { if (await page.locator('#w-done:not([open]) > summary').count()) await page.click('#w-done > summary'); }
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

try {
  // ---------- 推送样例 ----------
  {
    const r = await srv.ingest('agents', AGENTS);
    check('推送样例：待办（带 due）、【只看】PR（tag、opened_at）、交接记录（项目/岗位）收得下', r.status === 200, r);
  }

  // ---------- 1. 三层导航、默认工作台 ----------
  const page = await open();
  await section('默认进工作台', async () => {
    await login(page);
    const ok = await waitFor(page, '#v-work');
    check('登录后默认是工作台（#v-work 显示、地址是 #/work…）', ok && /^#\/work/.test(await page.evaluate(() => location.hash)), [ok, await page.evaluate(() => location.hash)]);
    const nav1 = await page.locator('nav.nav1 a[data-p]').evaluateAll((a) => a.map((x) => x.dataset.p)).catch(() => []);
    check('一级菜单：工作台 · forecast（每个在跑的项目一个）· 公共工具', JSON.stringify(nav1) === JSON.stringify(['work', 'forecast', 'tools']), nav1);
    check('一级菜单没有"Marketing""公司平台"当项目', !(await page.locator('nav.nav1').innerText().catch(() => '')).match(/Marketing|公司平台/), await txt(page, 'nav.nav1'));
    check('清单页、公司旧页不再是默认（#v-list 不显示）', !(await vis(page, '#v-list')), null);
  });

  // ---------- 2. 二级菜单跳转、刷新停在原模块、/queue ----------
  await section('二级菜单', async () => {
    const SUB = { work: ['w-now', 'w-todo', 'w-live', 'w-proj', 'w-num', 'w-meet'], forecast: ['f-next', 'f-guide', 'f-live', 'f-card', 'f-pack', 'f-match', 'f-tools', 'f-handoff'], tools: ['t-queue'] };
    for (const [p, mods] of Object.entries(SUB)) {
      await page.click(`nav.nav1 a[data-p="${p}"]`, { timeout: WAIT });
      check(`一级菜单 ${p}：二级菜单 #sub-${p} 出现、页面 #v-${p} 显示`, (await waitFor(page, `#sub-${p}`)) && (await vis(page, `#v-${p}`)), null);
      const subs = await page.locator(`#sub-${p} a[data-s]`).evaluateAll((a) => a.map((x) => x.dataset.s));
      check(`二级菜单 ${p}：模块齐全`, mods.every((m) => subs.includes(m)), subs);
      for (const m of mods) {
        await page.click(`#sub-${p} a[data-s="${m}"]`, { timeout: WAIT });
        await page.waitForTimeout(400);
        const st = await page.evaluate((id) => { const e = document.getElementById(id); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, h: innerHeight, hash: location.hash, shown: !!(e.offsetWidth || e.offsetHeight) }; }, m);
        check(`二级菜单 ${p} → ${m}：模块在屏幕里、地址带上模块`, !!st && st.shown && st.top >= -2 && st.top < st.h && st.hash.startsWith(`#/${p}/`), st);
      }
    }
    // 研发补的一步（不改断言）：二级菜单只在本页显示（原型 v2），从公共工具回工作台要先点一级菜单
    await page.click('nav.nav1 a[data-p="work"]', { timeout: WAIT });
    await page.click('#sub-work a[data-s="w-todo"]', { timeout: WAIT });
    const h0 = await page.evaluate(() => location.hash);
    await page.reload();
    await page.waitForSelector('#app:not([hidden])', { timeout: WAIT });
    check('刷新后停在原模块（地址不变、工作台显示）', (await page.evaluate(() => location.hash)) === h0 && (await vis(page, '#v-work')), [h0, await page.evaluate(() => location.hash)]);
    const q = await open();
    await login(q, '/queue');
    check('/queue 直接进跟帖评论清单（公共工具里，工作台不显示）', (await waitFor(q, '#v-tools #list')) && !(await vis(q, '#v-work')), await q.evaluate(() => location.hash));
    await q.context().close();
  });

  // ---------- 3. 最该做的一件事、待办按截止排、红橙 ----------
  await section('待办', async () => {
    await page.goto(BASE + '/#/work/todo');
    await waitFor(page, '#w-todos li.todo');
    const L = await todos(page);
    const idx = [T.over, T.soonPr, T.later, T.none1, T.none2, T.meet].map((t) => which(L, t));
    check('全部待办：6 条都在（含【只看】PR、经营会）', idx.every((i) => i >= 0), L.map((x) => x.text.split('\n')[0]));
    check('按截止时间排：超时 → 24 小时内 → 以后 → 没定截止时间的在最后', idx[0] < idx[1] && idx[1] < idx[2] && idx[2] < idx[3] && idx[2] < idx[4] && idx[2] < idx[5], idx);
    check('颜色：超时的红（over）、【只看】PR 开了 47 小时 → 还剩 1 小时橙（soon）、30 小时后的不标色（later）、没定的 none', L[idx[0]]?.cls === 'over' && L[idx[1]]?.cls === 'soon' && L[idx[2]]?.cls === 'later' && L[idx[3]]?.cls === 'none', idx.map((i) => L[i]?.cls));
    check('超时那条写"已超时"，没定的写"没定截止时间"', /已超时/.test(L[idx[0]]?.text ?? '') && /没定截止时间/.test(L[idx[3]]?.text ?? ''), [L[idx[0]]?.text, L[idx[3]]?.text]);
    const hero = await txt(page, '#hero');
    check('最该做的一件事：就是排第一的那条（超时的置顶帖），只有一件', !!hero && hero.includes('你现在最该做的一件事') && hero.includes(T.over) && !hero.includes(T.later), hero);
    const red = await page.evaluate(() => { const o = document.querySelector('#w-todos li.todo.over .badge'), s = document.querySelector('#w-todos li.todo.soon .badge'); return o && s ? [getComputedStyle(o).color, getComputedStyle(s).color] : null; });
    check('红、橙看得出来（两种颜色不同）', !!red && red[0] !== red[1], red);
    // 拨时钟 25 小时：30 小时后的那条进 24 小时内（橙）；只拨浏览器
    await page.clock.setSystemTime(now + 25 * H);
    await page.clock.fastForward(31_000);
    await page.waitForTimeout(300);
    const L2 = await todos(page);
    check('拨时钟 +25 小时：原来"以后"的那条变橙，【只看】PR 变红', L2[which(L2, T.later)]?.cls === 'soon' && L2[which(L2, T.soonPr)]?.cls === 'over', L2.map((x) => [x.text.split('\n')[0].slice(0, 12), x.cls]));
    await page.clock.setSystemTime(now + 26 * H);
  });

  // ---------- 4. 打勾跨设备同步 ----------
  await section('打勾跨设备', async () => {
    const A = await open(), B = await open();
    await login(A, '/#/work/todo'); await login(B, '/#/work/todo');
    await waitFor(A, '#w-todos li.todo'); await waitFor(B, '#w-todos li.todo');
    const liA = A.locator('#w-todos li.todo', { hasText: T.none1 });
    await liA.locator('.tick').click({ timeout: WAIT });
    const gone = await A.waitForFunction((t) => ![...document.querySelectorAll('#w-todos li.todo')].some((l) => l.innerText.includes(t)) && document.getElementById('w-donelist').textContent.includes(t), T.none1, { timeout: WAIT }).then(() => true, () => false);
    check('A 打勾：这条收进"做完的"', gone, await txt(A, '#w-donelist'));
    check('B 没刷新之前还是没勾（30 秒才刷新一次）', (await B.locator('#w-todos li.todo', { hasText: T.none1 }).count()) === 1, null);
    await B.clock.fastForward(31_000);
    const synced = await B.waitForFunction((t) => document.getElementById('w-donelist')?.textContent.includes(t), T.none1, { timeout: WAIT }).then(() => true, () => false);
    check('B 停在工作台 30 秒内自动变成已勾（存 D1、两台设备共用）', synced, await txt(B, '#w-donelist'));
    // 冲突：B 看到"做完"；A 撤销后又打勾（库里时间变了）；B 拿旧状态去撤销 → "已被另一处改过"，刷新成库里的样子
    await openDone(A);
    await A.locator('#w-donelist [data-undo]').first().click({ timeout: WAIT });
    await A.waitForFunction((t) => [...document.querySelectorAll('#w-todos li.todo')].some((l) => l.innerText.includes(t)), T.none1, { timeout: WAIT });
    await A.locator('#w-todos li.todo', { hasText: T.none1 }).locator('.tick').click({ timeout: WAIT });
    await A.waitForFunction((t) => document.getElementById('w-donelist').textContent.includes(t), T.none1, { timeout: WAIT });
    await openDone(B);
    await B.locator('#w-donelist [data-undo]').first().click({ timeout: WAIT });
    const msg = await B.waitForFunction(() => /已被另一处改过/.test(document.body.innerText), null, { timeout: WAIT }).then(() => true, () => false);
    check('B 用旧状态再点：提示"已被另一处改过，已刷新"，仍显示做完（和库里一致）', msg && (await B.locator('#w-donelist', { hasText: T.none1 }).count()) === 1, await B.evaluate(() => document.body.innerText.match(/.{0,20}另一处.{0,20}/)?.[0] ?? null));
    const fresh = await open();
    await login(fresh, '/#/work/todo');
    check('新开一个浏览器（没有本地存储）也看到做完：勾存在服务器上', await waitFor(fresh, '#w-donelist li', { state: 'attached' }) && (await fresh.locator('#w-donelist').textContent()).includes(T.none1), await txt(fresh, '#w-donelist'));
    for (const p of [A, B, fresh]) await p.context().close();
  });

  // ---------- 5. 填数字（只存 D1）----------
  await section('填数字', async () => {
    const p = await open();
    await login(p, '/#/work/todo');
    const li = p.locator('#w-todos li.todo', { hasText: T.later });
    await li.locator('[data-act], .go .btn').first().click({ timeout: WAIT });
    const form = li.locator('.form');
    check('点"去填数字"：这条里出现表单（X 关注、Threads 关注、名单人数）', await form.isVisible().catch(() => false) && (await form.locator('input').count()) === 3, null);
    const inp = (label) => form.getByLabel(label);
    await inp('X 关注').fill('abc'); await inp('Threads 关注').fill('-1'); await inp('名单人数').fill('');
    await form.locator('button', { hasText: '保存' }).click();
    await p.waitForTimeout(500);
    const bad = await form.locator('input[aria-invalid="true"]').count();
    check('填错：三格都标红（一次标出全部错的格），没保存、没打勾', bad === 3 && (await p.locator('#w-todos li.todo', { hasText: T.later }).count()) === 1, bad);
    await inp('X 关注').fill('１２'); await inp('Threads 关注').fill(' 5 '); await inp('名单人数').fill('0');
    await form.locator('button', { hasText: '保存' }).click();
    const saved = await p.waitForFunction((t) => document.getElementById('w-donelist')?.textContent.includes(t), T.later, { timeout: WAIT }).then(() => true, () => false);
    check('填对（全角、空格自动规范化）：保存成功，这件待办自动打勾', saved, await txt(p, '#w-donelist'));
    const api = await p.evaluate(async () => (await fetch('/api/company', { credentials: 'same-origin' })).json());
    const vals = Object.fromEntries((api.reports ?? []).map((x) => [x.name, x.value]));
    check('存进 D1：接口读回 X 关注 12、Threads 关注 5、名单人数 0', vals['X 关注'] === '12' && vals['Threads 关注'] === '5' && vals['名单人数'] === '0', api.reports ?? null);
    // 状态卡那一格写"见公司平台"：显示平台里的值（X + Threads = 17、名单 0），旁边写"你 … 填的"
    const f = await open();
    await login(f, '/#/forecast/card');
    await waitFor(f, '#f-card');
    const card = (await txt(f, '#f-card')) ?? '';
    check('forecast"数字和决定"：见公司平台 → 换成平台里的值（关注合计 17、名单 0），写明是你填的', /17/.test(card) && /你.{0,12}填的/.test(card) && !card.includes('见公司平台'), card.slice(0, 300));
    const num = (await txt(f, '#w-num')) ?? '';
    await f.goto(BASE + '/#/work/num'); await waitFor(f, '#w-num');
    check('工作台"公司数字"也能看到（新浏览器、没有本地存储：值来自服务器）', /17|12/.test((await txt(f, '#w-num')) ?? num), await txt(f, '#w-num'));
    for (const x of [p, f]) await x.context().close();
  });

  // ---------- 6. forecast 项目页 ----------
  await section('forecast 项目页：还没有周包', async () => {
    const p = await open();
    await login(p, '/#/forecast/guide');
    await waitFor(p, '#v-forecast');
    check('没有周包时：操作指引、本周帖子、焦点战写"本周还没有周包"', /本周还没有周包/.test((await txt(p, '#f-guide')) ?? '') && /本周还没有周包/.test((await txt(p, '#f-pack')) ?? '') && /本周还没有周包/.test((await txt(p, '#f-match')) ?? ''), [await txt(p, '#f-guide'), await txt(p, '#f-pack')]);
    await p.context().close();
  });
  {
    const r = await srv.ingest('agents', [{ kind: 'pack', key: 'forecast', source_at: now, payload: PACK }]);
    check('推送周包（kind = pack）收得下', r.status === 200, r);
  }
  await section('forecast 项目页', async () => {
    const p = await open();
    await login(p, '/#/forecast/next');
    await waitFor(p, '#v-forecast');
    const L = await todos(p, '#f-todos');
    check('下一步做什么：只有 forecast 的待办（没有经营会那条）', L.length > 0 && which(L, T.meet) < 0 && which(L, T.over) >= 0, L.map((x) => x.text.split('\n')[0]));
    check('周包那件事（周二窗口）进待办，截止 = 第 1 条帖子的建议发出时间 → 还剩 3 小时（橙）', L.some((x) => x.cls === 'soon' && /还剩\s*(2|3) 小时/.test(x.text)), L.map((x) => [x.text.split('\n')[0].slice(0, 16), x.cls]));
    check('团队在做什么：批 1 先显示"还没接上"', /还没接上/.test((await txt(p, '#f-live')) ?? ''), await txt(p, '#f-live'));
    check('本周帖子：6 条', (await p.locator('#f-pack tbody tr').count()) === 6, await p.locator('#f-pack tbody tr').count());
    check('焦点战：10 场', (await p.locator('#f-match tbody tr').count()) === 10, await p.locator('#f-match tbody tr').count());
    const hand = (await txt(p, '#f-handoff')) ?? '';
    check('交接记录：只有 forecast 的（市场），没有公司平台的', hand.includes('forecast 周包写好了') && !hand.includes('公司平台技术方案'), hand.slice(0, 200));
    check('用到的工具：有跟帖评论清单的入口', (await p.locator('#f-tools a, #f-tools button', { hasText: '清单' }).count()) >= 1, await txt(p, '#f-tools'));
    // 操作指引：逐步打勾 → 5 步做完，待办里那件自动打勾；另一台设备也看到
    const steps = p.locator('#g-steps .step');
    check('操作指引：5 步', (await steps.count()) === PACK.steps.length, await steps.count());
    for (let i = 0; i < PACK.steps.length; i++) {
      await steps.nth(i).locator('input[type="checkbox"]').check({ timeout: WAIT });
      await p.waitForTimeout(300);
    }
    const allDone = await p.waitForFunction(() => /5 \/ 5/.test(document.getElementById('f-guide').innerText), null, { timeout: WAIT }).then(() => true, () => false);
    const L2 = await todos(p, '#f-todos');
    check('5 步都打勾：进度 5 / 5，周包那件待办自动打勾（不在待办里了）', allDone && !L2.some((x) => /还剩\s*(2|3) 小时/.test(x.text)), [await txt(p, '#g-prog'), L2.map((x) => x.text.split('\n')[0])]);
    const o = await open();
    await login(o, '/#/forecast/guide');
    await waitFor(o, '#g-steps .step');
    check('操作指引的勾跨设备：新浏览器打开也是 5 步都勾了', (await o.locator('#g-steps .step input:checked').count()) === 5, await o.locator('#g-steps .step input:checked').count());
    await o.context().close();
    await p.context().close();
  });
  await section('复制焦点战', async () => {
    const ok = await open({ clip: 'ok' });
    await login(ok, '/#/forecast/guide');
    await ok.click('#copy-match', { timeout: WAIT });
    await ok.waitForFunction(() => document.getElementById('copy-msg')?.textContent, null, { timeout: WAIT });
    const clip = await ok.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    check('复制 10 场焦点战：成功提示，剪贴板里有 10 行、第一行是第 1 场', /已复制/.test(await txt(ok, '#copy-msg')) && clip.trim().split('\n').length === 10 && clip.includes('主隊1') && clip.includes('客隊1'), [await txt(ok, '#copy-msg'), clip.slice(0, 80)]);
    await ok.context().close();
    const bad = await open();
    await bad.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('不让')) }, configurable: true }); });
    await login(bad, '/#/forecast/guide');
    await bad.click('#copy-match', { timeout: WAIT });
    await bad.waitForFunction(() => document.getElementById('copy-msg')?.textContent, null, { timeout: WAIT });
    check('复制失败：提示手动复制，并显示整段文字可以选中', /没复制成功|手动/.test(await txt(bad, '#copy-msg')) && /主隊1/.test(await bad.evaluate(() => document.getElementById('f-guide').innerText + (document.querySelector('#f-guide textarea')?.value ?? ''))), await txt(bad, '#copy-msg'));
    await bad.context().close();
  });

  // ---------- 7. 工作台其他模块 ----------
  await section('工作台其他模块', async () => {
    await page.goto(BASE + '/#/work/proj');
    await waitFor(page, '#w-proj');
    const proj = (await txt(page, '#w-proj')) ?? '';
    check('项目概况：只列有状态卡的项目（forecast），公司平台不当项目、没有状态卡的"报价"不列', proj.includes('forecast') && !proj.includes('公司平台') && !proj.includes('报价'), proj.slice(0, 200));
    check('团队在做什么：批 1 先显示"还没接上"', /还没接上/.test((await txt(page, '#w-live')) ?? ''), await txt(page, '#w-live'));
    check('工作台顶部有跟帖评论清单入口（插件按钮落在工作台时少点一下，风险 R-2）', (await page.locator('#v-work a, #v-work button', { hasText: '跟帖评论清单' }).count()) >= 1, null);
  });

  // ---------- 8. 手机、电脑两种宽度；深浅色 ----------
  await section('宽度和深浅色', async () => {
    for (const [width, height] of [[375, 812], [1440, 900]]) {
      for (const colorScheme of ['light', 'dark']) {
        const p = await open({ width, height, colorScheme });
        await login(p, '/#/work');
        const w1 = (await waitFor(p, '#v-work')) && (await noHScroll(p));
        const shown = await p.locator('#w-todos li.todo').count();
        if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, `work-${width}-${colorScheme}.png`), fullPage: true }); }
        await p.goto(BASE + '/#/forecast'); await p.waitForTimeout(300);
        const w2 = (await waitFor(p, '#v-forecast')) && (await noHScroll(p));
        if (SHOTS) await p.screenshot({ path: path.join(SHOTS, `forecast-${width}-${colorScheme}.png`), fullPage: true });
        const bg = await p.evaluate(() => { const m = getComputedStyle(document.body).backgroundColor.match(/\d+/g).map(Number); return (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) / 255; });
        check(`${width} 宽 · ${colorScheme === 'dark' ? '深色' : '浅色'}：工作台、forecast 页都不横向滚动，待办有内容，底色对（深色暗、浅色亮）`, w1 && w2 && shown > 0 && (colorScheme === 'dark' ? bg < 0.3 : bg > 0.7), { w1, w2, shown, bg });
        if (width === 375) {
          const tap = await p.evaluate(() => { const a = document.querySelector('nav.nav1'); return a ? a.getBoundingClientRect().right <= innerWidth + 0.5 : false; });
          check('375 宽：一级菜单不超出屏幕', tap, null);
        }
        await p.context().close();
      }
    }
  });

  // ---------- 9. 自动检查变红：排第一 ----------
  await section('自动检查变红', async () => {
    const r = await srv.ingest('marketing', [{ kind: 'ci', source_at: now, payload: { conclusion: 'failure', sha: 'abc1234', at: now - 10 * MIN, note: 'ci（push）' } }]);
    const p = await open();
    await login(p, '/#/work/todo');
    await waitFor(p, '#w-todos li.todo');
    const L = await todos(p);
    check('有一项改动没通过自动检查：这件事排第一、标红', r.status === 200 && /自动检查/.test(L[0]?.text ?? '') && L[0]?.cls === 'over', L.slice(0, 2));
    await p.context().close();
  });

  check('全程没有脚本错误', errors.length === 0, errors.slice(0, 5));
} catch (e) {
  check('脚本跑完（没有中途出错）', false, String(e && e.stack || e));
} finally {
  await browser.close();
  srv.stop();
}
if (fails.length) { console.error(`\n✗ 公司平台批 1 验收测试有 ${fails.length} 项不通过`); process.exit(1); }
console.log('\n✓ 公司平台批 1 验收测试全部通过');
process.exit(0);
