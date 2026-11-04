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
 *   一级菜单 nav.nav1 a[data-p="work" | "project" | "tools"]（项目链接另带 data-proj="<项目名>"，有几个项目出几个）；
 *   二级菜单 #sub-work、#sub-project、#sub-tools 里的 a[data-s="<模块 id>"]，地址 #/work/todo、#/<项目>/guide 这类锚点
 *   页面 #v-work、#v-project（一套 DOM 轮流显示每个项目）、#v-tools；工作台模块 #w-now（#hero）、#w-todo（#w-todos li.todo、#w-donelist）、#w-live、#w-proj、#w-num、#w-meet、#w-english（英语练习：8 条提示词 + 每条一个复制按钮）
 *   待办 li.todo 带颜色类 over（红，超时）/ soon（橙，24 小时内）/ later / none（没定截止时间）；打勾按钮 .tick；撤销 [data-undo]
 *   全部待办按时间段分组（改版批 A，2026-11-04；取代 2026-11-02 的按项目分组 .over-grp / details.tgrp[data-proj] / #w-todo-all）：
 *     #w-todos 下按页面顺序是 [data-bucket="over" | "soon" | "later" | "none"]（已超时 / 24 小时内到期 / 之后到期 / 没定截止时间，空的组不出），
 *     组标题（details 的 summary，或组里第一个 .bucket-h / h3 / p）写组名和"N 件"；只有 none 是 <details>、默认没有 open；
 *     上面按项目筛选的按钮 #w-todo [data-pf]（data-pf="" 是"全部"，其余是项目名，按钮文字里带件数，选中的 aria-pressed="true"）；
 *     每条 li.todo 里的项目标签是 .ptag（中性灰，文字就是项目名，经营会和 agents 的 PR 写"公司"）
 *   改版批 A 的模块结构（原型 prototype-work.html）：工作台每个卡片模块有 .lead（一句话结论，里面一个 .dot.red / .amber / .ok / .gray），
 *     #w-now 的结论就是 #hero；说明放在模块最后一个 details.more 里、默认收起；做完的仍是 details#w-done（默认收起）、#w-donelist
 *   填数字：待办里的表单 .form，输入框用 <label> 包住（标签文字 X 关注、Threads 关注、名单人数），按钮"保存"
 *   项目模块 #f-next（#f-todos）、#f-guide（#g-steps .step、勾选框）、#f-live、#f-card、#f-pack、#f-match（#copy-match、#copy-msg）、#f-tools、#f-handoff
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
/**
 * 改版批 B（公共工具页）开关：批 A 时是 false——"公共工具子菜单顺序 == 页面顺序"照跑、照实打印，但不计失败（输出里标"批 B 修"）；
 * 批 B 的 PR 里改成 true（同一个 PR 写明），从此不符就红。只管这一条，别的断言不看它。
 */
const REDESIGN_B = false;

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
  prac: 'Practical：审《阶段计划》并过关卡 A',
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
  // 项目版图"产品"表 = 项目页的名单（2026-11-02 起不写死）：两个在跑的项目 + 一个没有状态卡的（报价）
  { kind: 'projects', key: '', source_at: now - H, payload: { version: 'v1.5', items: [{ name: 'forecast', stage: '试水阶段' }, { name: 'Practical', stage: '开局沟通' }, { name: '报价', stage: '未开始' }] } },
  { kind: 'todo', key: 'Practical', source_at: now - H, payload: { product: 'Practical', items: [{ id: 'P1', type: 'confirm', text: T.prac, due: now + 40 * H }] } },
  { kind: 'status', key: 'Practical', source_at: now - H, payload: { product: 'Practical', state: '开局沟通', level: 'mute', week: '等 Amos 审《阶段计划》', metrics: [{ name: '月收入', now: '0', target: '5 万 / 月' }] } },
  { kind: 'status', key: 'forecast', source_at: now - H, payload: { product: 'forecast', state: 'B + C', level: 'warn', week: '第一周的 6 条帖子和 10 场焦点战已备好',
    metrics: [{ name: 'X + Threads 关注合计', now: '见工作平台', target: '50' }, { name: '等候名单确认订阅', now: '见工作平台', target: '100' }, { name: '第一笔真实抽成', now: '没有', target: '2026-12-31 前' }] } },
  { kind: 'status', key: '工作平台', source_at: now - H, payload: { product: '工作平台', state: 'E 上线运营', level: 'mute', week: '工作平台批 1', metrics: [{ name: '副驾驶插件版本', now: '0.3.5' }] } },
  { kind: 'handoff', key: 'forecast/市场', source_at: now - H, payload: { role: '市场', date: '2026-11-01', done: 'forecast 周包写好了（样例）', next: '周二窗口' } },
  { kind: 'handoff', key: '工作平台/研发', source_at: now - H, payload: { role: '研发', date: '2026-11-01', done: '工作平台技术方案（样例）', next: '批 1' } },
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
/**
 * 待办按时间段分组（改版批 A，2026-11-04 起；原来是按项目的 details.tgrp + #w-todo-all"全部展开"）：
 * 只有最后一组"没定截止时间"是默认收起的 <details>：点它的标题展开（用户也是这样点），之后才能点里面的按钮
 */
async function openGroups(page) {
  // 点每个收起的组的标题（新结构只有 none 一组；改版前的按项目分组也是 details，同样点得开，所以前面各段不因结构过渡而连带变红）
  const closed = page.locator('#w-todos details:not([open]) > summary');
  for (let i = await closed.count(); i > 0; i--) await closed.first().click({ timeout: WAIT });
  await page.waitForFunction(() => ![...document.querySelectorAll('#w-todos details')].some((d) => !d.open), null, { timeout: WAIT });
}
/** 分组一览（按页面顺序）：时间段、条数、是不是收起的 details、标题文字 */
const groupsOf = (page) => page.evaluate(() => [...document.querySelectorAll('#w-todos [data-bucket]')].map((d) => ({
  b: d.dataset.bucket, n: d.querySelectorAll('li.todo').length, fold: d.tagName === 'DETAILS', open: d.tagName !== 'DETAILS' || d.open,
  head: (d.querySelector(':scope > summary, :scope > .bucket-h, :scope > h3, :scope > p')?.innerText ?? '').trim(),
  shown: !!(d.offsetWidth || d.offsetHeight),
})));
const BUCKETS = ['over', 'soon', 'later', 'none'];
const BUCKET_NAME = { over: '已超时', soon: '24 小时内到期', later: '之后到期', none: '没定截止时间' };
/** "做完的"是折叠的 <details>：点开它（用户也是这样点） */
async function openDone(page) { if (await page.locator('#w-done:not([open]) > summary').count()) await page.click('#w-done > summary'); }
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
/**
 * 子菜单跟着滚动选中（2026-11-04，Amos："点子菜单能跳，自己滑的时候子菜单的选中不跟着变"）：
 * 不点菜单，直接 window.scrollTo 滑页面，看二级菜单里 aria-current="true" 的是不是滑到的那个模块。
 * 模块按页面上的位置排（不按菜单顺序），只算不在 [hidden] 里的。
 */
async function scrollSpyCase(page, sub, tag) {
  const mods = await page.evaluate((s) => [...document.querySelectorAll(s + ' a[data-s]')].map((a) => document.getElementById(a.dataset.s))
    .filter((e) => e && !e.closest('[hidden]') && e.getClientRects().length)
    .map((e) => ({ id: e.id, y: Math.round(e.getBoundingClientRect().top + scrollY) })).sort((a, b) => a.y - b.y), sub);
  check(`${tag}：页面上至少有 2 个看得见的模块`, mods.length >= 2, mods);
  if (mods.length < 2) return;
  const cur = () => page.evaluate((s) => [...document.querySelectorAll(s + ' a[data-s]')].map((a) => [a.dataset.s, a.getAttribute('aria-current')]), sub);
  const only = (list, id) => list.length > 0 && list.every(([s, v]) => v === String(s === id));
  const onNow = (list) => list.filter(([, v]) => v === 'true').map(([s]) => s);
  const scroll = async (y) => { const at = await page.evaluate((t) => { window.scrollTo(0, t === 'end' ? document.documentElement.scrollHeight : t); return Math.round(scrollY); }, y); await page.waitForTimeout(150); return at; };
  // ① 滑到第 2 个模块（和点菜单跳过去的位置一样：模块顶端在顶栏下面 8px）
  const barsH = await page.evaluate(() => document.getElementById('bars').getBoundingClientRect().height);
  const want = Math.round(mods[1].y - barsH - 8);
  const at = await scroll(want);
  const c1 = await cur();
  check(`${tag}：滑到第 2 个模块 ${mods[1].id}（没点菜单）→ 子菜单选中 ${mods[1].id}、其余不选`, Math.abs(at - want) <= 2 && only(c1, mods[1].id), { scrollY: at, want, on: onNow(c1) });
  // ② 滑到最底 → 最后一个看得见的模块
  await scroll('end');
  const c2 = await cur();
  const last = mods[mods.length - 1].id;
  check(`${tag}：滑到页面最底 → 子菜单选中最后一个模块 ${last}`, only(c2, last), { on: onNow(c2) });
  // ③ 滑回最上面 → 第一个
  await scroll(0);
  const c3 = await cur();
  check(`${tag}：滑回最上面 → 子菜单选中第一个模块 ${mods[0].id}`, only(c3, mods[0].id), { on: onNow(c3) });
  // ④ 点菜单跳过去的结果和滚动算的不打架：点倒数第 2 个（多半顶不到顶栏下面），选中的还是点的那个
  const pick = mods[mods.length - 2].id;
  await page.click(`${sub} a[data-s="${pick}"]`, { timeout: 4000 });
  await page.waitForTimeout(400);
  const c4 = await cur();
  check(`${tag}：点子菜单 ${pick} 跳过去之后，选中的就是 ${pick}（不被滚动计算改掉）`, only(c4, pick), { on: onNow(c4) });
}
/*
 * 子菜单跟着滚动选中·第 2 轮（2026-11-04，测试会话写，研发不改断言；产品口径）：
 *   A. 选中项变化时，子菜单 .sub .in 横向滚动的，要把选中项滚进可见范围；只改 .sub .in 的 scrollLeft，页面 scrollY 不能变。
 *   B. 并排的几块（顶端高度差 ≤4px）：当前选中的在这一排里就保持不变（点过哪个保持哪个）；从别处滑进这一排时选菜单里靠前的那个。
 *   另：点的模块到不了顶栏下面、又不是最后一个时，点完停在页面最底也要选点的那个（证明 subPin 真起作用）；滑动不改地址 hash。
 */
const spyWait = (page) => page.waitForTimeout(150);
/** 当前子菜单里 aria-current="true" 的模块 id */
const spyOn = (page, sub) => page.evaluate((s) => [...document.querySelectorAll(s + ' a[data-s]')].filter((a) => a.getAttribute('aria-current') === 'true').map((a) => a.dataset.s), sub);
/** 看得见的模块，按页面上的位置排：{id, top(相对文档), h} */
const spyMods = (page, sub) => page.evaluate((s) => [...document.querySelectorAll(s + ' a[data-s]')].map((a) => document.getElementById(a.dataset.s))
  .filter((e) => e && !e.closest('[hidden]') && e.getClientRects().length)
  .map((e) => ({ id: e.id, top: Math.round(e.getBoundingClientRect().top + scrollY), h: Math.round(e.getBoundingClientRect().height) })).sort((a, b) => a.top - b.top), sub);
const spyPos = (page) => page.evaluate(() => ({ y: Math.round(scrollY), max: Math.round(document.documentElement.scrollHeight - innerHeight), hash: location.hash, bars: Math.round(document.getElementById('bars').getBoundingClientRect().height) }));
const spyTo = async (page, y) => { await page.evaluate((t) => window.scrollTo(0, t === 'end' ? document.documentElement.scrollHeight : t), y); await spyWait(page); return spyPos(page); };
/** 选中项在横向子菜单 .sub .in 里是否完整看得见（左右各容 1px） */
const spyInView = (page, sub) => page.evaluate((s) => {
  const box = document.querySelector(s + ' .in'), a = document.querySelector(s + ' a[data-s][aria-current="true"]');
  if (!box || !a) return { ok: false, why: '没有选中项' };
  const r = a.getBoundingClientRect(), b = box.getBoundingClientRect();
  return { ok: r.left >= b.left - 1 && r.right <= b.right + 1, s: a.dataset.s, left: Math.round(r.left), right: Math.round(r.right), boxLeft: Math.round(b.left), boxRight: Math.round(b.right), scrollLeft: Math.round(box.scrollLeft) };
}, sub);
/** A：窄屏子菜单横向滚动时，选中项要滚进可见范围、页面 scrollY 不因此改变 */
async function subInViewCase(page, sub, tag, { mustScroll = true } = {}) {
  const mods = await spyMods(page, sub);
  const scrollable = await page.evaluate((s) => { const b = document.querySelector(s + ' .in'); return { sw: b.scrollWidth, cw: b.clientWidth }; }, sub);
  // mustScroll=false：这一页的子菜单现在不用横滑（例如 375 宽公共工具，2026-11-04 实测 scrollWidth = clientWidth = 375），只守住"选中项看得见、页面不动、hash 不变"
  if (mustScroll) check(`${tag}：前提——子菜单比屏幕宽、要横滑（不然这条测不到东西）`, scrollable.sw > scrollable.cw + 1 && mods.length >= 2, scrollable);
  const hash0 = (await spyPos(page)).hash;
  // ① 滑到最底：选中最后一个模块，它在子菜单里看得见；页面停在最底，没被横滚带着动
  const p1 = await spyTo(page, 'end');
  await page.waitForTimeout(300);
  const p1b = await spyPos(page), v1 = await spyInView(page, sub), on1 = await spyOn(page, sub);
  check(`${tag}：滑到最底 → 选中 ${mods.at(-1).id}，且它在横向子菜单里完整看得见`, JSON.stringify(on1) === JSON.stringify([mods.at(-1).id]) && v1.ok, { on: on1, ...v1 });
  check(`${tag}：滑到最底后页面 scrollY 没被横滚改掉（仍是 ${p1.max}）`, p1.y === p1.max && p1b.y === p1.y, { 刚滑完: p1.y, 等300ms后: p1b.y, max: p1.max });
  // ② 先把子菜单横滑到最右，再竖着滑回顶：选中第一个模块，且它被滚回可见范围；scrollY 是 0
  await page.evaluate((s) => { const b = document.querySelector(s + ' .in'); b.scrollLeft = b.scrollWidth; }, sub);
  await spyWait(page);
  const left0 = await page.evaluate((s) => Math.round(document.querySelector(s + ' .in').scrollLeft), sub);
  const p2 = await spyTo(page, 0);
  await page.waitForTimeout(300);
  const p2b = await spyPos(page), v2 = await spyInView(page, sub), on2 = await spyOn(page, sub);
  check(`${tag}：子菜单先横滑到最右（scrollLeft ${left0}）再竖着滑回顶 → 选中 ${mods[0].id}，且它被滚回看得见`, JSON.stringify(on2) === JSON.stringify([mods[0].id]) && v2.ok, { on: on2, ...v2 });
  check(`${tag}：滑回顶后页面 scrollY 仍是 0（横滚不带动页面）`, p2.y === 0 && p2b.y === 0, { 刚滑完: p2.y, 等300ms后: p2b.y });
  check(`${tag}：A 段滑来滑去，地址 hash 没变（仍是 ${hash0}）`, p2b.hash === hash0, p2b.hash);
}
/** 证明 subPin 真起作用：挑一个"到不了顶栏下面、又不是最后一个"的模块，把窗口拉高到它确实到不了，点它 → 停在最底也选它 */
async function subPinCase(page, sub, tag) {
  const w = page.viewportSize().width;
  let mods = await spyMods(page, sub), pos = await spyPos(page);
  const lastTop = mods.at(-1).top;
  const k = [...mods].reverse().find((m) => m.top < lastTop - 4); // 倒数第一个和最后一个不在同一排的
  check(`${tag}：前提——有一个不是最后一个的模块`, !!k, mods);
  if (!k) return;
  const need = k.top - pos.bars - 8; // 点菜单跳过去时 scrollY 应到的位置（模块顶端在顶栏下 8px）
  // 窗口拉高到"最多滑到的位置"比它要的少 120px；拉高后页面高度可能跟着变，最多量 4 次
  let k2 = k, need2 = need;
  for (let i = 0; i < 4; i++) {
    const sh = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: w, height: Math.min(8000, sh - need2 + 120) });
    await spyTo(page, 0);
    mods = await spyMods(page, sub); pos = await spyPos(page);
    k2 = mods.find((m) => m.id === k.id); need2 = k2.top - pos.bars - 8;
    if (pos.max < need2 - 2) break;
  }
  check(`${tag}：前提——窗口拉高后 ${k.id} 到不了顶栏下面（最多滑到 ${pos.max}，它要 ${need2}），且不是最后一个`, pos.max < need2 - 2 && mods.at(-1).id !== k.id, { max: pos.max, need: need2, last: mods.at(-1).id });
  await page.click(`${sub} a[data-s="${k.id}"]`, { timeout: 4000 });
  await page.waitForTimeout(400);
  const p1 = await spyPos(page), on1 = await spyOn(page, sub);
  check(`${tag}：点 ${k.id}（跳过去停在页面最底）→ 选中 ${k.id}，不是按"到底选最后一个"的 ${mods.at(-1).id}`, p1.y === p1.max && JSON.stringify(on1) === JSON.stringify([k.id]), { on: on1, ...p1 });
  await page.evaluate(() => window.scrollBy(0, -1));
  await spyWait(page);
  const on2 = await spyOn(page, sub);
  check(`${tag}：点 ${k.id} 后只动 1px → 仍选 ${k.id}`, JSON.stringify(on2) === JSON.stringify([k.id]), { on: on2, ...(await spyPos(page)) });
}
/** B：并排的两块（1280 宽 forecast 的 f-pack、f-match）。a = 菜单里靠前的，b = 靠后的 */
async function subRowCase(page, sub, a, b, tag) {
  const mods = await spyMods(page, sub);
  const ma = mods.find((m) => m.id === a), mb = mods.find((m) => m.id === b);
  check(`${tag}：前提——${a} 和 ${b} 并排（顶端高度差 ≤4px）`, !!ma && !!mb && Math.abs(ma.top - mb.top) <= 4, { [a]: ma, [b]: mb });
  if (!ma || !mb) return;
  const menu = await page.evaluate((s) => [...document.querySelectorAll(s + ' a[data-s]')].map((x) => x.dataset.s), sub);
  const hash0 = (await spyPos(page)).hash;
  // ① 从顶往下慢滑（一次 20px）：一定会经过 a；从上面滑进这一排时不选 b；选中只往前走
  await spyTo(page, 0);
  const down = [];
  for (let i = 0; i < 400; i++) {
    const p = await page.evaluate(() => { window.scrollBy(0, 20); return { y: Math.round(scrollY), max: Math.round(document.documentElement.scrollHeight - innerHeight) }; });
    await page.waitForTimeout(40);
    const on = (await spyOn(page, sub))[0];
    if (down.at(-1) !== on) down.push(on);
    if (p.y >= p.max) break;
  }
  await spyWait(page);
  const idx = down.map((s) => menu.indexOf(s));
  check(`${tag}：从顶往下慢滑一定会经过 ${a}`, down.includes(a), down);
  check(`${tag}：从上面滑进 ${a}/${b} 这一排时选靠前的 ${a}，不跳到 ${b}`, !down.includes(b), down);
  check(`${tag}：往下慢滑选中只往前走、不来回跳`, idx.every((v, i) => i === 0 || v > idx[i - 1]), down);
  // ② 从最底往上慢滑：从下面滑进这一排时也选 a
  const up = [];
  for (let i = 0; i < 400; i++) {
    const y = await page.evaluate(() => { window.scrollBy(0, -20); return Math.round(scrollY); });
    await page.waitForTimeout(40);
    const on = (await spyOn(page, sub))[0];
    if (up.at(-1) !== on) up.push(on);
    if (y <= 0) break;
  }
  check(`${tag}：从下往上慢滑进 ${a}/${b} 这一排时也选 ${a}`, up.includes(a) && !up.includes(b), up);
  check(`${tag}：B 段慢滑来回，地址 hash 没变（仍是 ${hash0}）`, (await spyPos(page)).hash === hash0, (await spyPos(page)).hash);
  // ③ 点 a 后再往下滑 40px：仍是 a；点 b 后再往下滑 40px：仍是 b（点过哪个保持哪个）
  for (const pick of [a, b]) {
    await spyTo(page, 0);
    await page.click(`${sub} a[data-s="${pick}"]`, { timeout: 4000 });
    await page.waitForTimeout(400);
    const p0 = await spyPos(page);
    await page.evaluate(() => window.scrollBy(0, 40));
    await spyWait(page);
    const p1 = await spyPos(page), on = await spyOn(page, sub);
    check(`${tag}：点 ${pick} 后再往下滑 40px（${p0.y}→${p1.y}）→ 仍选 ${pick}`, p1.y - p0.y >= 38 && JSON.stringify(on) === JSON.stringify([pick]), { on, from: p0.y, to: p1.y });
  }
}

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
    const nav1 = await page.locator('nav.nav1 a[data-p]').evaluateAll((a) => a.map((x) => x.dataset.proj || x.dataset.p)).catch(() => []);
    // 2026-11-02：项目不写死，projects 块里有几个在跑的项目就出几个（样例是 forecast、Practical、报价）
    check('一级菜单：工作台 · 每个在跑的项目一个 · 公共工具', JSON.stringify(nav1) === JSON.stringify(['work', 'forecast', 'Practical', '报价', 'tools']), nav1);
    check('一级菜单没有"Marketing""工作平台"当项目（改名：Amos 2026-11-02"公司平台四个字改为 工作平台"）', !(await page.locator('nav.nav1').innerText().catch(() => '')).match(/Marketing|工作平台|公司平台/), await txt(page, 'nav.nav1'));
    check('清单页、公司旧页不再是默认（#v-list 不显示）', !(await vis(page, '#v-list')), null);
  });

  // ---------- 2. 二级菜单跳转、刷新停在原模块、/queue ----------
  await section('二级菜单', async () => {
    // 页名（#sub-<页>、#v-<页>）和地址段分开：项目页的页名一律是 project，地址段是项目名
    const SUB = [
      { nav: 'work', page: 'work', seg: 'work', mods: ['w-now', 'w-todo', 'w-live', 'w-proj', 'w-num', 'w-meet', 'w-english'] },
      { nav: 'forecast', page: 'project', seg: 'forecast', mods: ['f-next', 'f-guide', 'f-live', 'f-card', 'f-pack', 'f-match', 'f-tools', 'f-handoff'] },
      { nav: 'Practical', page: 'project', seg: 'Practical', mods: ['f-next', 'f-card', 'f-handoff'] },
      { nav: 'tools', page: 'tools', seg: 'tools', mods: ['t-queue'] },
    ];
    for (const { nav, page: pg, seg, mods } of SUB) {
      await page.click(nav === pg ? `nav.nav1 a[data-p="${nav}"]` : `nav.nav1 a[data-proj="${nav}"]`, { timeout: WAIT });
      check(`一级菜单 ${nav}：二级菜单 #sub-${pg} 出现、页面 #v-${pg} 显示`, (await waitFor(page, `#sub-${pg}`)) && (await vis(page, `#v-${pg}`)), null);
      const subs = await page.locator(`#sub-${pg} a[data-s]`).evaluateAll((a) => a.map((x) => x.dataset.s));
      check(`二级菜单 ${nav}：模块齐全`, mods.every((m) => subs.includes(m)), subs);
      for (const m of mods) {
        await page.click(`#sub-${pg} a[data-s="${m}"]`, { timeout: WAIT });
        await page.waitForTimeout(400);
        const st = await page.evaluate((id) => { const e = document.getElementById(id); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, h: innerHeight, hash: location.hash, shown: !!(e.offsetWidth || e.offsetHeight) }; }, m);
        check(`二级菜单 ${nav} → ${m}：模块在屏幕里、地址带上模块`, !!st && st.shown && st.top >= -2 && st.top < st.h && decodeURIComponent(st.hash).startsWith(`#/${seg}/`), st);
      }
      if (pg === 'project') check(`项目页 ${nav}：标题就是这个项目`, (await page.locator('#f-title').innerText()) === nav, await page.locator('#f-title').innerText());
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
    // 分组（2026-11-02 按项目 → 2026-11-04 改版批 A 按时间段，Amos 看完含这一变化的原型："改吧"）：
    // 已超时 / 24 小时内到期 / 之后到期 / 没定截止时间，按这个顺序；前三组常显，最后一组默认收起
    const G0 = await groupsOf(page);
    const overTop = G0[0] ?? null;
    const firstChild = await page.evaluate(() => document.querySelector('#w-todos > *')?.dataset.bucket ?? null);
    check('已超时的一组在最上面、不用展开就看得到（1 条，标题写"已超时"）', !!overTop && overTop.b === 'over' && firstChild === 'over' && overTop.shown && overTop.open && overTop.n === 1 && /已超时/.test(overTop.head), { firstChild, overTop });
    check('按时间段分组，顺序 已超时 → 24 小时内到期 → 之后到期 → 没定截止时间，每组标题写着名字和件数', JSON.stringify(G0.map((g) => g.b)) === JSON.stringify(BUCKETS) && G0.every((g) => g.n > 0 && g.head.includes(BUCKET_NAME[g.b]) && new RegExp(`${g.n}\\s*件`).test(g.head)), G0);
    const pfs = await page.evaluate(() => [...document.querySelectorAll('#w-todo [data-pf]')].map((b) => b.dataset.pf));
    check('没有空分组；按项目筛选的按钮有 全部、forecast、"公司"（经营会、agents 的 PR 算公司），没有空项目（报价）', G0.every((g) => g.n > 0) && pfs[0] === '' && pfs.includes('forecast') && pfs.includes('公司') && !pfs.includes('报价'), { groups: G0.map((g) => [g.b, g.n]), pfs });
    const hiddenBefore = await page.locator('#w-todos details[data-bucket="none"] li.todo').first().isVisible();
    check('"没定截止时间"那组默认收起（details 没有 open），里面的待办看不见；前三组不用展开', hiddenBefore === false && G0.at(-1)?.fold === true && G0.at(-1)?.open === false && G0.slice(0, 3).every((g) => g.open && g.shown), { hiddenBefore, last: G0.at(-1) });
    await openGroups(page);
    const G1 = await groupsOf(page);
    check('点开"没定截止时间"：每组都展开、组数不变', G1.length === BUCKETS.length && G1.length === G0.length && G1.every((g) => g.open), G1);
    const L = await todos(page);
    const idx = [T.over, T.soonPr, T.later, T.none1, T.none2, T.meet, T.prac].map((t) => which(L, t));
    check('全部待办：7 条都在（含【只看】PR、经营会、Practical）', idx.every((i) => i >= 0), L.map((x) => x.text.split('\n')[0]));
    check('逾期的排最前面；每个分组里按截止时间排（forecast：30 小时那条在没定截止的前面）', idx[0] === 0 && idx[2] < idx[3] && idx[2] < idx[4], idx);
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
    await openGroups(page);
    const L2 = await todos(page);
    check('拨时钟 +25 小时：原来"以后"的那条变橙，【只看】PR 变红', L2[which(L2, T.later)]?.cls === 'soon' && L2[which(L2, T.soonPr)]?.cls === 'over', L2.map((x) => [x.text.split('\n')[0].slice(0, 12), x.cls]));
    const overNow = await page.evaluate(() => [...document.querySelectorAll('#w-todos [data-bucket="over"] li.todo')].map((li) => li.innerText.replace(/\s+/g, ' ').trim()));
    check('变红的（【只看】PR）自己跑到最上面的"已超时"组里，不用翻分组', overNow.length === 2 && overNow.join(' ').includes('更正'), overNow);
    await page.clock.setSystemTime(now + 26 * H);
  });

  // ---------- 4. 打勾跨设备同步 ----------
  await section('打勾跨设备', async () => {
    const A = await open(), B = await open();
    await login(A, '/#/work/todo'); await login(B, '/#/work/todo');
    await waitFor(A, '#w-todos li.todo'); await waitFor(B, '#w-todos li.todo');
    await openGroups(A); await openGroups(B);
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
    await openGroups(A);
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
    await waitFor(p, '#w-todos li.todo');
    await openGroups(p);
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
    check('forecast"数字和决定"：见工作平台 → 换成平台里的值（关注合计 17、名单 0），写明是你填的', /17/.test(card) && /你.{0,12}填的/.test(card) && !card.includes('见工作平台') && !card.includes('见公司平台'), card.slice(0, 300));
    const num = (await txt(f, '#w-num')) ?? '';
    await f.goto(BASE + '/#/work/num'); await waitFor(f, '#w-num');
    check('工作台"公司数字"也能看到（新浏览器、没有本地存储：值来自服务器）', /17|12/.test((await txt(f, '#w-num')) ?? num), await txt(f, '#w-num'));
    for (const x of [p, f]) await x.context().close();
  });

  // ---------- 6. forecast 项目页 ----------
  await section('forecast 项目页：还没有周包', async () => {
    const p = await open();
    await login(p, '/#/forecast/guide');
    await waitFor(p, '#v-project');
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
    await waitFor(p, '#v-project');
    const L = await todos(p, '#f-todos');
    check('下一步做什么：只有 forecast 的待办（没有经营会那条）', L.length > 0 && which(L, T.meet) < 0 && which(L, T.over) >= 0, L.map((x) => x.text.split('\n')[0]));
    check('周包那件事（周二窗口）进待办，截止 = 第 1 条帖子的建议发出时间 → 还剩 3 小时（橙）', L.some((x) => x.cls === 'soon' && /还剩\s*(2|3) 小时/.test(x.text)), L.map((x) => [x.text.split('\n')[0].slice(0, 16), x.cls]));
    check('团队在做什么：批 1 先显示"还没接上"', /还没接上/.test((await txt(p, '#f-live')) ?? ''), await txt(p, '#f-live'));
    check('本周帖子：6 条', (await p.locator('#f-pack tbody tr').count()) === 6, await p.locator('#f-pack tbody tr').count());
    check('焦点战：10 场', (await p.locator('#f-match tbody tr').count()) === 10, await p.locator('#f-match tbody tr').count());
    const hand = (await txt(p, '#f-handoff')) ?? '';
    check('交接记录：只有 forecast 的（市场），没有工作平台的', hand.includes('forecast 周包写好了') && !hand.includes('工作平台技术方案'), hand.slice(0, 200));
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
    check('项目概况：只列有状态卡的项目（forecast、Practical），工作平台不当项目、没有状态卡的"报价"不列', proj.includes('forecast') && proj.includes('Practical') && !proj.includes('工作平台') && !proj.includes('公司平台') && !proj.includes('报价'), proj.slice(0, 200));
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
        const w2 = (await waitFor(p, '#v-project')) && (await noHScroll(p));
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


  // ---------- 8.5 英语练习（2026-11-03 晚，Amos 睡前点名要的）----------
  // 守四件事：① 在工作台二级菜单第 7 项（公共工具满 8 项了，T-4 不许加第 9 项）；② 8 条提示词都在；
  // ③ 每条的"复制"按钮**不展开 details 就点得到**，点了剪贴板里真的是那一整条、按钮变"已复制 ✓"；
  // ④ 手机 390 宽菜单不撑破、不横向滚动（和 T-4 同一个口径）。
  await section('英语练习', async () => {
    for (const width of [390, 1280]) {
      const p = await open({ width, height: 900, clip: 'ok' });
      await login(p, '/#/work');
      // ① 菜单第 7 项
      const mods = await p.locator('#sub-work a[data-s]').evaluateAll((a) => a.map((x) => x.dataset.s));
      check(`${width} 宽：工作台二级菜单 7 项、第 7 项是 w-english（不是 9 项以上）`, mods.length === 7 && mods[6] === 'w-english', mods);
      await p.click('#sub-work a[data-s="w-english"]', { timeout: WAIT });
      await p.waitForTimeout(400);
      const seen = await p.evaluate(() => { const e = document.getElementById('w-english'); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, h: innerHeight, hash: location.hash }; });
      check(`${width} 宽：点菜单滚到"英语练习"，地址是 #/work/english`, !!seen && seen.top >= -2 && seen.top < seen.h && seen.hash === '#/work/english', seen);
      // ② 8 条
      const codes = await p.locator('#w-english .en-code').allInnerTexts();
      check(`${width} 宽：8 条提示词都在（C-1～C-6、N-1、N-2）`, JSON.stringify(codes) === JSON.stringify(['C-1', 'C-2', 'C-3', 'C-4', 'C-5', 'C-6', 'N-1', 'N-2']), codes);
      // ③ 不展开就能点到复制；点了剪贴板里是整条
      const btns = p.locator('#w-english .en-copy');
      const n = await btns.count();
      const foldedN = await p.locator('#w-english details.en-fold:not([open])').count();
      const clickable = await btns.first().isVisible();
      check(`${width} 宽：8 个复制按钮，正文默认折叠，按钮不展开就看得见`, n === 8 && foldedN === 8 && clickable, { n, foldedN, clickable });
      await btns.first().click();
      await p.waitForTimeout(300);
      const label = await btns.first().innerText();
      const clip = await p.evaluate(() => navigator.clipboard.readText().catch(() => '')); 
      const want = await p.locator('#en-p1-t').evaluate((e) => e.textContent);
      check(`${width} 宽：点第一条"复制"，按钮变"已复制 ✓"`, label.includes('已复制'), label);
      check(`${width} 宽：剪贴板里是 C-1 一整条原文（${want.length} 字）`, clip === want, { clipLen: clip.length, wantLen: want.length, head: clip.slice(0, 20) });
      await p.waitForTimeout(2000);
      check(`${width} 宽：2 秒后按钮变回"复制"`, (await btns.first().innerText()).trim() === '复制', await btns.first().innerText());
      // ④ 不横向滚动；子菜单一行、可以横滑，选中项完整看得见
      // 口径变化（改版批 A，2026-11-04）：原来是"子菜单自己不横滑、7 项全在屏幕里（不用横滑）"；已批准的原型要求手机上子菜单一行横滑，
      // 390 宽 7 项一行放不下（原型实测 scrollWidth 624px），主会话按 Amos"改吧"同意的口径改成：一行、可以横滑、当前选中项完整在可见范围里
      // 且不在右侧渐隐区（原型 .sub .in 的 mask 是右边 12% 渐隐；已横滑到最右时没有渐隐）。.en-pre 不横滑、两层菜单 ≤25% 照旧。
      await p.waitForTimeout(400); // 等子菜单把选中项平滑横滚进来
      const fit = await p.evaluate(() => {
        const nav = document.querySelector('#sub-work .in');
        const as = [...nav.querySelectorAll('a')].filter((a) => a.getClientRects().length);
        const bars = document.getElementById('bars').getBoundingClientRect().height;
        const sel = nav.querySelector('a[data-s][aria-current="true"]');
        const b = nav.getBoundingClientRect(), r = sel ? sel.getBoundingClientRect() : null;
        const atEnd = nav.scrollLeft + nav.clientWidth >= nav.scrollWidth - 2;
        const fadeAt = atEnd ? b.left + nav.clientWidth : b.left + nav.clientWidth * 0.88; // 渐隐区从这里开始
        return {
          rows: new Set(as.map((a) => Math.round(a.getBoundingClientRect().top))).size,     // 子菜单只有一行
          sel: sel ? sel.dataset.s : null,
          selIn: !!r && r.left >= b.left - 1 && r.right <= fadeAt + 1,                       // 选中项完整看得见、不在右侧渐隐区
          selBox: r && { left: Math.round(r.left), right: Math.round(r.right), boxLeft: Math.round(b.left), fadeAt: Math.round(fadeAt), atEnd },
          pre: [...document.querySelectorAll('#w-english .en-pre')].every((e) => e.scrollWidth <= e.clientWidth + 1),
          barsPct: +(bars / innerHeight * 100).toFixed(1),                                 // 两层菜单 ≤ 屏幕高度 25%（批 2 审查 R9）
        };
      });
      check(`${width} 宽：不横向滚动；子菜单一行（可以横滑）、选中的 w-english 完整看得见且不在右侧渐隐区；两层菜单 ${fit.barsPct}% ≤ 25%（T-4 / R9 同一个口径）`, (await noHScroll(p)) && fit.rows === 1 && fit.sel === 'w-english' && fit.selIn && fit.pre && fit.barsPct <= 25, { h: await noHScroll(p), ...fit });
      // 截图（--shots 时才存）
      if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await p.locator('#w-english details.en-fold').first().evaluate((d) => { d.open = true; }); await p.waitForTimeout(200); await p.screenshot({ path: path.join(SHOTS, `work-english-${width}.png`), fullPage: true }); }
      await p.context().close();
    }
  });

  // ---------- 8.5 子菜单跟着滚动选中（2026-11-04）：工作台、项目页；切换页面后重新算 ----------
  await section('子菜单跟着滚动', async () => {
    for (const width of [1280, 375]) {
      const p = await open({ width, height: width === 375 ? 740 : 900 });
      await login(p, '/#/work');
      await waitFor(p, '#w-todos li.todo');
      await p.waitForTimeout(300);
      await scrollSpyCase(p, '#sub-work', `${width} 宽 工作台`);
      // 切换页面（点一级菜单）：回到页面顶端，子菜单选中第一个模块
      await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await p.waitForTimeout(150);
      await p.click('nav.nav1 a[data-proj="forecast"]', { timeout: WAIT });
      await waitFor(p, '#v-project');
      await p.waitForTimeout(400);
      const first = await p.evaluate(() => [...document.querySelectorAll('#sub-project a[data-s]')].filter((a) => a.getAttribute('aria-current') === 'true').map((a) => a.dataset.s));
      check(`${width} 宽：从工作台底部切到 forecast 项目页 → 子菜单选中第一个模块 f-next`, JSON.stringify(first) === '["f-next"]', first);
      await scrollSpyCase(p, '#sub-project', `${width} 宽 forecast 项目页`);
      await p.context().close();
    }
  });

  // ---------- 8.6 子菜单跟着滚动·第 2 轮（2026-11-04，测试会话写，产品口径 A/B；研发不改这里的断言） ----------
  await section('子菜单跟着滚动·第 2 轮', async () => {
    const openForecast = async (width, height) => {
      const p = await open({ width, height });
      await login(p, '/#/forecast');
      await waitFor(p, '#v-project');
      await p.waitForTimeout(400);
      return p;
    };
    // A：375 宽 forecast，子菜单要横滑
    let p = await openForecast(375, 740);
    await subInViewCase(p, '#sub-project', '375 宽 forecast（A 选中项看得见）');
    await p.context().close();
    // B：1280 宽 forecast，f-pack 和 f-match 并排
    p = await openForecast(1280, 900);
    await subRowCase(p, '#sub-project', 'f-pack', 'f-match', '1280 宽 forecast（B 并排）');
    await p.context().close();
    // subPin：点到不了顶的模块，停在最底也选它
    p = await openForecast(1280, 900);
    await subPinCase(p, '#sub-project', '1280 宽 forecast（点菜单为准）');
    await p.context().close();
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

  // ---------- 改名：公司平台 → 工作平台（Amos 2026-11-02："公司平台四个字改为 工作平台"） ----------
  await section('改名为工作平台', async () => {
    const p = await open();
    await p.goto(BASE + '/');
    await waitFor(p, '#login');
    const shot = async (where) => {
      const r = await p.evaluate(() => ({ title: document.title, text: document.body.innerText }));
      check(`${where}：<title> 有"工作平台"、没有"公司平台"`, r.title.includes('工作平台') && !r.title.includes('公司平台'), r.title);
      check(`${where}：页面文字有"工作平台"、没有"公司平台"`, r.text.includes('工作平台') && !r.text.includes('公司平台'), (r.text.match(/.{0,20}公司平台.{0,20}/) || [r.text.slice(0, 80)])[0]);
    };
    await shot('登录页');
    await p.fill('#pw', PASS);
    await p.click('#go');
    await p.waitForSelector('#app:not([hidden])', { timeout: WAIT });
    for (const at of ['/#/work', '/#/forecast', '/#/tools', '/#/tools/hook']) {
      await p.goto(BASE + at);
      await p.waitForTimeout(600);
      await shot(at);
    }
    const raw = await (await fetch(BASE + '/')).text();
    const t = /<title>([^<]*)<\/title>/.exec(raw)?.[1] ?? '';
    check('服务端返回的 HTML 里 <title> 是"工作平台"', t.includes('工作平台') && !t.includes('公司平台'), t);
    await p.context().close();
  });

  // ---------- 10. 改版批 A：全站变量 + 外框和菜单 + 工作台首页（2026-11-04，测试会话先写，研发不改这里的断言） ----------
  // 依据：原型 prototype-work.html / prototype-tools.html（Amos 11/4"好很多了，改吧，完事儿直接上生产"）和设计规范要点
  //（字号 5 级、模块固定结构"标题 → 一句话结论 → 主内容 → 折叠的说明"、青色只给主动作、项目标签中性灰、深色模式"最该做的事"有自己的底色和描边、
  //  两层菜单固定且手机上各一行、菜单顺序 = 页面顺序、去掉页面底部 60vh 空白）。
  // 放在最后：这里重推 Practical 的待办（5 条、截止时间各不相同），不影响前面各段的期望。
  const PA = [
    { id: 'PA1', text: 'Practical 批A：两小时前就该交的那件', due: now - 2 * H },
    { id: 'PA2', text: 'Practical 批A：五小时后到期的那件', due: now + 5 * H },
    { id: 'PA3', text: 'Practical 批A：四十小时后到期的那件', due: now + 40 * H },
    { id: 'PA4', text: 'Practical 批A：六十小时后到期的那件', due: now + 60 * H },
    { id: 'PA5', text: 'Practical 批A：没定截止时间的那件' },
  ];
  {
    const r = await srv.ingest('agents', [{ kind: 'todo', key: 'Practical', source_at: Date.now(), payload: { product: 'Practical', items: PA.map((x) => ({ type: 'action', ...x })) } }]);
    check('批 A：推送 Practical 的 5 条待办（已超时 1、24 小时内 1、之后 2、没定 1）收得下', r.status === 200, r);
  }
  const W7 = ['w-now', 'w-todo', 'w-live', 'w-proj', 'w-num', 'w-meet', 'w-english'];
  // 字号阶梯（设计规范）：页面标题 24 / 手机 22，模块标题 18 / 手机 17，正文 15，辅助 13，大数字 30 / 手机 26，12 只给角标标签；允许 ±0.5（亚像素取整）
  const FS = [12, 13, 15, 17, 18, 22, 24, 26, 30];
  // 放宽：按钮、输入框、菜单链接（nav 里的 a）、chip、summary 这类"能点、能填"的控件可以是 14——原型里 .btn、.nav1 a、.sub a 都是 14px，
  // 控件文字比正文小一号是原型的既定写法；其余（正文、说明、标签、数字）一律只能落在 FS 里
  const FS_CTL = 14;
  // 只限特定元素的例外（主会话 2026-11-04 定，属原型口径内的细化，汇报 Amos 时写明、他可推翻）：品牌名 .brand 16px（是标志，不是正文层级）；
  // "最该做的事"大标题 #hero h2 28px（手机 22，已在阶梯里）。原型里其余不合阶梯的（"还没报" 20px、.proj .wk / .prompt .t / .hero .when / .checks li / .donelist li 的 14px）不放宽，研发按阶梯改
  const FS_ONLY = [['.brand', 16], ['#hero h2', 28]];
  /** 页面上看得见的文字的字号：返回不在阶梯里的元素（选择器、字号、文字开头），最多 20 个 */
  const fontOutliers = (page, roots) => page.evaluate(({ roots, FS, FS_CTL, FS_ONLY }) => {
    const out = [];
    for (const root of roots.map((s) => document.querySelector(s)).filter(Boolean)) {
      for (const e of [root, ...root.querySelectorAll('*')]) {
        if (!e.getClientRects().length) continue;
        const st = getComputedStyle(e);
        if (st.visibility === 'hidden' || st.display === 'none' || +st.opacity === 0) continue;
        const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
        if (!own) continue;
        const fs = parseFloat(st.fontSize);
        if (FS.some((v) => Math.abs(v - fs) <= 0.5)) continue;
        if (Math.abs(fs - FS_CTL) <= 0.5 && e.closest('button, input, select, textarea, .btn, .chip, nav a, summary')) continue;
        if (FS_ONLY.some(([sel, v]) => Math.abs(fs - v) <= 0.5 && e.closest(sel))) continue;
        const cls = typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).join('.') : '';
        out.push(`${fs}px ${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${cls}「${own.slice(0, 12)}」`);
      }
    }
    return [...new Set(out)].slice(0, 20);
  }, { roots, FS, FS_CTL, FS_ONLY });
  /** WCAG 相对亮度对比度（两种颜色，rgb()/rgba() 字符串；透明的按 body 底色算） */
  const contrastOf = (a, b) => {
    const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return +((x + 0.05) / (y + 0.05)).toFixed(3);
  };
  // 深色模式"最该做的事"和页面底色"明显不同"的阈值：背景对比度 ≥ 1.15、描边和页面底色对比度 ≥ 1.5。
  // 定法：原型深色 #15233F 对 #0B1220 是 1.20、描边 #2B3D63 对 #0B1220 是 1.69（实测）；现状深色 .hero 是 var(--navy)，和 body 几乎同色（Amos 说看不出那块）。
  // 1.15 比原型低一点留余地，但同色、差一两个色阶（≈1.03～1.08）都过不了；描边要能看出一条线，取 1.5。
  const HERO_BG_MIN = 1.15, HERO_LINE_MIN = 1.5;
  // 页面底部空白：最后一个模块底边到页面底 ≤ 160px（原型实测 111～131px：main 底部内边距 48 + 一行页脚；原来的 .page::after 60vh 在 900 高时是 540px）
  const TAIL_MAX = 160;
  /** 菜单顺序和页面顺序：子菜单链接顺序 vs 模块按页面位置排（顶端差 ≤4px 算同一排，同排从左到右） */
  const orderOf = (page, sub) => page.evaluate((s) => {
    const menu = [...document.querySelectorAll(s + ' a[data-s]')].map((a) => a.dataset.s);
    const mods = menu.map((id) => document.getElementById(id)).filter((e) => e && !e.closest('[hidden]') && e.getClientRects().length)
      .map((e) => { const r = e.getBoundingClientRect(); return { id: e.id, top: Math.round(r.top + scrollY), left: Math.round(r.left) }; })
      .sort((a, b) => (Math.abs(a.top - b.top) <= 4 ? a.left - b.left : a.top - b.top));
    const seen = menu.filter((id) => mods.some((m) => m.id === id));
    return { menu: seen, page: mods.map((m) => m.id) };
  }, sub);
  /** 最后一个看得见的模块底边到页面底的距离 */
  const tailOf = (page, pageSel) => page.evaluate((ps) => {
    const v = document.querySelector(ps);
    const mods = [...v.querySelectorAll('.mod')].filter((e) => !e.closest('[hidden]') && e.getClientRects().length);
    const bottom = Math.max(...mods.map((e) => e.getBoundingClientRect().bottom + scrollY));
    const sh = document.documentElement.scrollHeight;
    return { tail: Math.round(sh - bottom), sh, ih: innerHeight, last: mods.at(-1)?.id };
  }, pageSel);

  for (const [width, height] of [[1280, 900], [375, 740]]) {
    for (const colorScheme of ['light', 'dark']) {
      const tag = `批A ${width} 宽 · ${colorScheme === 'dark' ? '深色' : '浅色'}`;
      await section(tag, async () => {
        const p = await open({ width, height, colorScheme });
        await login(p, '/#/work');
        await waitFor(p, '#w-todos li.todo');
        await p.waitForTimeout(400);
        // ① 7 个模块都有看得见的一句话结论（#w-now 的结论是 #hero；其余是 .lead，前面一个状态圆点）
        const leads = await p.evaluate((ids) => ids.map((id) => {
          const m = document.getElementById(id);
          if (!m) return { id, why: '没有这个模块' };
          const el = id === 'w-now' ? m.querySelector('#hero') : m.querySelector('.lead');
          if (!el) return { id, why: id === 'w-now' ? '没有 #hero' : '没有 .lead' };
          const shown = !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
          const text = el.innerText.replace(/\s+/g, ' ').trim();
          const dot = el.querySelector('.dot');
          const dotCls = dot ? ['red', 'amber', 'ok', 'gray'].find((c) => dot.classList.contains(c)) || '' : '';
          return { id, shown, text, dotCls };
        }), W7);
        for (const L of leads) {
          if (L.why) { check(`${tag}：${L.id} 有一句话结论`, false, L.why); continue; }
          // "结论"不是空的说明文字：要带件数 / 数字，或者明说"没事、没有、不用、还没、都…了"；不能是"正在读取"；一句话 = 6～80 字
          const body = L.id === 'w-now' ? L.text.replace('你现在最该做的一件事', '').trim() : L.text;
          const isConcl = /\d|没事|没有|不用|还没|都已|都做完/.test(body) && !/正在读取|读取中/.test(body);
          const lenOk = body.length >= 6 && (L.id === 'w-now' || body.length <= 80);
          const dotOk = L.id === 'w-now' || !!L.dotCls;
          check(`${tag}：${L.id} 的一句话结论看得见、是结论（带件数或"没事"之类）${L.id === 'w-now' ? '' : '、前面有红/橙/绿/灰圆点'}、不超过 80 字`, L.shown && isConcl && lenOk && dotOk, { shown: L.shown, dot: L.dotCls, len: body.length, text: body.slice(0, 90) });
        }
        // ② 说明默认折叠：#v-work 里每个 details.more 都没有 open；有说明的模块（原型：全部待办、团队在做什么、项目概况、英语练习）说明是模块最后一块；"做完的"也收起
        const more = await p.evaluate(() => ({
          open: [...document.querySelectorAll('#v-work details.more[open]')].map((d) => d.closest('.mod')?.id || '?'),
          last: ['w-todo', 'w-live', 'w-proj', 'w-english'].map((id) => { const m = document.getElementById(id); const k = m && [...m.children].filter((c) => c.getClientRects().length).at(-1); return [id, !!k && k.matches('details.more')]; }),
          done: document.getElementById('w-done')?.open ?? null,
        }));
        check(`${tag}：工作台的说明都默认折叠（没有 details.more[open]）`, more.open.length === 0, more.open);
        check(`${tag}：全部待办、团队在做什么、项目概况、英语练习的最后一块是折叠的"说明和更多"（details.more）`, more.last.every(([, ok]) => ok), more.last.filter(([, ok]) => !ok).map(([id]) => id));
        check(`${tag}："做完的"默认收起（#w-done 没有 open）`, more.done === false, more.done);
        // ③ 字号只用阶梯里的几级（控件放宽到 14）
        const fo = await fontOutliers(p, ['#bars', '#v-work']);
        check(`${tag}：顶栏、菜单、工作台里看得见的文字字号只在 {${FS.join(',')}}±0.5 里（按钮、输入框、菜单链接、chip、summary 可以是 ${FS_CTL}；只有 .brand 可以 16、#hero h2 可以 28）`, fo.length === 0, fo);
        // ④ 不横向滚动
        check(`${tag}：页面没有横向滚动`, await noHScroll(p), await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]));
        // ⑤ 最该做的事：和页面底色明显不同；深色模式另要一圈看得见的描边
        const hero = await p.evaluate(() => { const h = document.getElementById('hero'); if (!h) return null; const s = getComputedStyle(h); return { bg: s.backgroundColor, line: s.borderTopColor, lineW: parseFloat(s.borderTopWidth), body: getComputedStyle(document.body).backgroundColor }; });
        if (!hero) check(`${tag}：有 #hero`, false, null);
        else {
          const transparent = /rgba\(.*,\s*0\)$/.test(hero.bg);
          const cBg = transparent ? 1 : contrastOf(hero.bg, hero.body);
          check(`${tag}："最该做的事"底色和页面底色对比度 ${cBg} ≥ ${HERO_BG_MIN}`, cBg >= HERO_BG_MIN, hero);
          if (colorScheme === 'dark') {
            const cLine = /rgba\(.*,\s*0\)$/.test(hero.line) || hero.lineW < 1 ? 1 : contrastOf(hero.line, hero.body);
            check(`${tag}：深色模式"最该做的事"有自己的描边（≥1px，和页面底色对比度 ${cLine} ≥ ${HERO_LINE_MIN}）`, cLine >= HERO_LINE_MIN, hero);
          }
        }
        // ⑥ 每条待办最多一个青色实心主按钮；项目标签是中性灰（不是青色）
        await openGroups(p).catch(() => {});
        const btns = await p.evaluate(() => {
          const probe = (v) => { const d = document.createElement('div'); d.style.background = v; document.getElementById('v-work').appendChild(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; };
          const teal = probe('var(--teal)'), tealSoft = probe('var(--teal-soft)'), gray = probe('var(--gray-soft)');
          return { teal, gray, rows: [...document.querySelectorAll('#w-todos li.todo')].map((li) => {
            const prim = [...li.querySelectorAll('*')].filter((e) => e.matches('.btn.primary') || getComputedStyle(e).backgroundColor === teal);
            const tagEl = li.querySelector('.ptag');
            const tb = tagEl ? getComputedStyle(tagEl).backgroundColor : null;
            return { t: li.innerText.replace(/\s+/g, ' ').trim().slice(0, 16), prim: prim.length, tag: tagEl ? tagEl.textContent.trim() : null, tagGray: !!tagEl && tb !== teal && tb !== tealSoft && tb === gray };
          }) };
        });
        check(`${tag}：每条待办最多一个青色实心主按钮（.btn.primary 或底色是 --teal）`, btns.rows.length > 0 && btns.rows.every((r) => r.prim <= 1), btns.rows.filter((r) => r.prim > 1));
        check(`${tag}：每条待办的项目标签 .ptag 是中性灰（底色 = --gray-soft，不是青色）`, btns.rows.length > 0 && btns.rows.every((r) => r.tagGray), { gray: btns.gray, bad: btns.rows.filter((r) => !r.tagGray).slice(0, 4) });
        // ⑦ 两层菜单：各只有一行；375×740 下合起来 ≤ 15% 屏幕高
        const bars = await p.evaluate(() => {
          const rows = (sel) => new Set([...document.querySelectorAll(sel)].filter((a) => a.getClientRects().length).map((a) => Math.round(a.getBoundingClientRect().top))).size;
          return { nav1: rows('nav.nav1 a[data-p]'), sub: rows('#sub-work a[data-s]'), h: Math.round(document.getElementById('bars').getBoundingClientRect().height), ih: innerHeight, pos: getComputedStyle(document.getElementById('bars')).position };
        });
        check(`${tag}：一级菜单只有一行、子菜单只有一行`, bars.nav1 === 1 && bars.sub === 1, bars);
        if (width === 375) check(`${tag}：375×740 两层菜单 #bars 高 ${bars.h}px ≤ 15% 屏幕高（${Math.floor(bars.ih * 0.15)}px）`, bars.h <= bars.ih * 0.15, bars);
        // ⑧ 页面底部没有 60vh 空白
        await p.evaluate(() => window.scrollTo(0, 0));
        const t = await tailOf(p, '#v-work');
        check(`${tag}：工作台最后一个模块底边到页面底 ${t.tail}px ≤ ${TAIL_MAX}px（去掉 60vh 空白）`, t.tail <= TAIL_MAX, t);
        await p.context().close();
      });
    }
  }

  // 所有页面：子菜单链接顺序 == 页面上模块的纵向顺序；项目页、公共工具也不能有 60vh 空白（外框是批 A 的）
  for (const [width, height] of [[1280, 900], [375, 740]]) {
    await section(`批A ${width} 宽：菜单顺序 = 页面顺序`, async () => {
      const p = await open({ width, height });
      await login(p, '/#/work');
      for (const [at, sub, pageSel, name] of [['/#/work', '#sub-work', '#v-work', '工作台'], ['/#/forecast', '#sub-project', '#v-project', 'forecast 项目页'], ['/#/tools', '#sub-tools', '#v-tools', '公共工具']]) {
        await p.goto(BASE + at);
        await waitFor(p, pageSel);
        await p.waitForTimeout(500);
        const o = await orderOf(p, sub);
        const same = o.menu.length >= 2 && JSON.stringify(o.menu) === JSON.stringify(o.page);
        const label = `批A ${width} 宽 ${name}：子菜单顺序 == 页面上模块从上到下（同排从左到右）的顺序`;
        if (name === '公共工具' && !REDESIGN_B) console.log(`${same ? '✓' : '✗'} ${label}（批 B 修：批 A 不计失败）${same ? '' : '：实际 ' + JSON.stringify(o)}`);
        else check(label, same, o);
        const t = await tailOf(p, pageSel);
        check(`批A ${width} 宽 ${name}：最后一个模块底边到页面底 ${t.tail}px ≤ ${TAIL_MAX}px（去掉 60vh 空白）`, t.sh <= t.ih + 1 || t.tail <= TAIL_MAX, t);
      }
      await p.context().close();
    });
  }

  // 待办按时间段分组、组内按截止时间排、按项目筛选
  for (const width of [1280, 375]) {
    await section(`批A ${width} 宽：待办按时间段、按项目筛选`, async () => {
      const p = await open({ width, height: width === 375 ? 740 : 900 });
      await login(p, '/#/work/todo');
      await waitFor(p, '#w-todos li.todo');
      await p.waitForTimeout(300);
      const tg = `批A ${width} 宽`;
      const G = await groupsOf(p);
      check(`${tg}：分组顺序 已超时 → 24 小时内到期 → 之后到期 → 没定截止时间（这份样例四组都有）`, JSON.stringify(G.map((g) => g.b)) === JSON.stringify(BUCKETS), G.map((g) => g.b));
      const last = G.at(-1);
      check(`${tg}：最后一组"没定截止时间"默认收起（details 没有 open，里面的看不见），前三组常显`, !!last && last.b === 'none' && last.fold && !last.open && G.slice(0, -1).every((g) => g.open && g.shown && !g.fold), G);
      check(`${tg}：每组标题写组名和"N 件"，N = 组里的条数`, G.every((g) => g.head.includes(BUCKET_NAME[g.b]) && new RegExp(`${g.n}\\s*件`).test(g.head)), G.map((g) => [g.b, g.n, g.head]));
      // 每条在哪一组、组里的先后（attached 就算；用 textContent：收起的 details 里 innerText 是空串，读不到 none 组的条目）
      const rows = () => p.evaluate(() => [...document.querySelectorAll('#w-todos [data-bucket]')].flatMap((g) => [...g.querySelectorAll('li.todo')].map((li) => ({
        b: g.dataset.bucket, cls: ['over', 'soon', 'later', 'none'].find((c) => li.classList.contains(c)) || '', proj: li.querySelector('.ptag')?.textContent.trim() ?? null, text: li.textContent.replace(/\s+/g, ' ').trim(),
      }))));
      const R = await rows();
      const at = (t) => R.findIndex((r) => r.text.includes(t));
      const inB = (t, b) => R[at(t)]?.b === b;
      check(`${tg}：每条的颜色和所在的组一致（over 在已超时、soon 在 24 小时内…）`, R.length > 0 && R.every((r) => r.cls === r.b), R.filter((r) => r.cls !== r.b).map((r) => [r.b, r.cls, r.text.slice(0, 16)]));
      const placed = [[T.over, 'over'], [PA[0].text, 'over'], [T.soonPr, 'soon'], [PA[1].text, 'soon'], [PA[2].text, 'later'], [PA[3].text, 'later'], [PA[4].text, 'none'], [T.none2, 'none'], [T.meet, 'none']];
      check(`${tg}：样例各在该在的组（超时 50 小时和 2 小时 → 已超时；1、5 小时 → 24 小时内；40、60 小时 → 之后；没定的 → 没定截止时间）`, placed.every(([t, b]) => inB(t, b)), placed.map(([t, b]) => [t.slice(0, 14), b, R[at(t)]?.b ?? '不在']));
      const before = [[T.over, PA[0].text], [T.soonPr, PA[1].text], [PA[2].text, PA[3].text]];
      check(`${tg}：组内按截止时间排（超时 50 小时在 2 小时前面；1 小时在 5 小时前面；40 小时在 60 小时前面）`, before.every(([a, b]) => at(a) >= 0 && at(b) >= 0 && at(a) < at(b)), before.map(([a, b]) => [a.slice(0, 10), at(a), b.slice(0, 14), at(b)]));
      // 筛选按钮：全部 / 各项目，带件数；件数对；点了只剩那个项目
      const chips = () => p.evaluate(() => [...document.querySelectorAll('#w-todo [data-pf]')].map((b) => ({ pf: b.dataset.pf, n: +((b.innerText.match(/(\d+)\s*$/) || b.innerText.match(/(\d+)/) || [])[1] ?? NaN), on: b.getAttribute('aria-pressed') })));
      const C = await chips();
      const all = C.find((c) => c.pf === '');
      const byProj = {};
      for (const r of R) byProj[r.proj] = (byProj[r.proj] || 0) + 1;
      check(`${tg}：筛选按钮第一个是"全部"、默认选中，件数 = 全部待办条数（${R.length}）`, !!all && C[0] === all && all.on === 'true' && all.n === R.length && C.filter((c) => c.on === 'true').length === 1, C);
      check(`${tg}：每个项目按钮的件数 = 该项目的待办条数，按钮正好覆盖所有项目、合计 = 全部`, C.filter((c) => c.pf !== '').every((c) => byProj[c.pf] === c.n) && Object.keys(byProj).every((k) => C.some((c) => c.pf === k)) && C.filter((c) => c.pf !== '').reduce((s, c) => s + c.n, 0) === R.length, { chips: C, byProj });
      check(`${tg}：Practical 按钮写 5 件（刚推的 5 条）`, C.find((c) => c.pf === 'Practical')?.n === 5, C.find((c) => c.pf === 'Practical'));
      await p.click('#w-todo [data-pf="Practical"]', { timeout: WAIT });
      await p.waitForTimeout(300);
      const R2 = await rows(), C2 = await chips(), G2 = await groupsOf(p);
      check(`${tg}：点 Practical → 只剩 Practical 的 5 条，按钮变成选中`, R2.length === 5 && R2.every((r) => r.proj === 'Practical') && C2.find((c) => c.pf === 'Practical')?.on === 'true' && C2.filter((c) => c.on === 'true').length === 1, { n: R2.length, projs: [...new Set(R2.map((r) => r.proj))], on: C2.filter((c) => c.on === 'true').map((c) => c.pf) });
      check(`${tg}：筛选后仍按时间段分组、顺序不变（Practical 四组各有）、最后一组仍收起`, JSON.stringify(G2.map((g) => g.b)) === JSON.stringify(BUCKETS) && G2.at(-1)?.fold && !G2.at(-1)?.open, G2.map((g) => [g.b, g.n, g.open]));
      await p.click('#w-todo [data-pf=""]', { timeout: WAIT });
      await p.waitForTimeout(300);
      check(`${tg}：再点"全部" → 回到 ${R.length} 条`, (await rows()).length === R.length, (await rows()).length);
      await p.context().close();
    });
  }

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
