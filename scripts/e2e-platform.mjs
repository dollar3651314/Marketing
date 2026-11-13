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
 *   页面 #v-work、#v-project（一套 DOM 轮流显示每个项目）、#v-tools；工作台模块 #w-now（#hero）、#w-todo（#w-todos li.todo、#w-donelist）、#w-live、#w-proj、#w-num、#w-meet（**6 个**）
 *   英语学习两块 2026-11-13 从工作台挪进 **Practical 项目页**（Amos「工作台 practical 用来存储和展示所有与我英语学习有关的内容」）：
 *     #f-pron（发音训练：跟我做（一次一句）→ 对照听 → 连考 10 题 → 过关，第 15 段）、#f-s2（句子训练：13 课，一屏一步，每句标出处）；
 *     地址 #/Practical/pron、#/Practical/s2，**别的项目上这两块和它们的菜单项整块 hidden**（第 8.5 段）；接口前缀 /api/en/pron/*
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
 *   改版批 B（2026-11-04，第 11 段；测试会话先写，研发不改断言）项目页 #v-project 的 8 个模块：每个是 .card.mod，看得见的子元素依次是 .mh（h2）→ .lead（.dot.red/.amber/.ok/.gray，结论由数据算）
 *     → 主内容 → （有说明的）details.more 默认收起；f-next 的说明必须进 details.more；折叠外没有 >60 字的 p / .hint；
 *     #f-todos 每条：有链接 / 要填数字的正好一个主按钮（.btn.primary，地址 = 链接），没有链接的不给主按钮、给正好一个次动作（.btn，不是打勾 .tick）；
 *     第一次就读取失败：#f-next 和它的 .lead 写"暂时读不到"，整页不出现"没事要做"；#f-pack / #f-match 并排时等高且底部空白 ≤48px，否则上下排。量法在 scripts/e2e-look.mjs。
 *   改版批 C（2026-11-05，第 12 段；Amos"第三批选 a，开始吧"；测试会话先写，研发不改断言）：
 *     公司总览 #v-company（地址 #/company、#/company/people|learn|health）只留三块，按这个顺序：#co-people（各岗位这周在做什么）→ #co-learn（这周学到了什么）→ #co-health（做得怎么样，CI 等）；
 *       没有"需要我的事"（#co-need、摘要格子 .tile、"我做了"）、没有项目表 #co-projects、没有下周 #co-next；
 *       每块和批 A/B 同一套结构：.card.mod → .mh（h2）→ .lead（.dot.red/.amber/.ok/.gray，结论由数据算）→ 主内容 → details.more（默认收起）；
 *       固定子菜单 nav.sub#sub-company（和 #sub-work 同一套 .in / a[data-s] / aria-current / subSpy），a[data-s] 依次 co-people、co-learn、co-health，href #/company/people 这类；
 *       顶栏按钮 #conav 文字"公司总览"，页面标题 #title、<title> 开头也是"公司总览"；"刷新"#co-refresh、"还没开通"#co-off、"暂时读不到"#co-fail 照旧（e2e-admin 测）。
 *       一行 = 表格的 tbody tr 或列表的 li（手机上可以改成列表）。
 *     forecast 本周帖子 #f-pack-body、焦点战 #f-match-body：每条是一个 tbody tr 或 li；375 宽每条一行（高 ≤ 64px，不再有"第几条：/写的什么：/几点发：/最晚：""联赛：/对阵：/开赛："的前缀）。
 *     深色模式：一级菜单 .nav1 .cnt 角标、工作台"已超时"红标签 .b-over、"24 小时内"橙标签 .b-soon（含"最该做的事"#hero .when 里实心底的），文字色和它的底色对比度 ≥ 4.5。
 * 时间：页面时钟用 Playwright page.clock 固定在"现在"，拨时钟只拨浏览器（C106）；服务端的"现在"是真实时间，样例的截止时间都按真实时间算。
 * 每段单独 try：一段没做出来不影响别的段报结果；等待都有短超时，等不到就照实报"实际值"。任何一条不符就以非 0 退出。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { startServer, PASS, checker, ROOT } from './e2e-server.mjs';
import * as LOOK from './e2e-look.mjs';

const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > 0 ? path.resolve(process.argv[shotsAt + 1]) : '';
const { fails, check } = checker();
const H = 3600_000, MIN = 60_000;
const WAIT = 4000;
/**
 * 改版批 B（公共工具页）开关：批 A 时是 false——"公共工具子菜单顺序 == 页面顺序"照跑、照实打印，但不计失败（输出里标"批 B 修"）；
 * 批 B 的 PR 里改成 true（同一个 PR 写明），从此不符就红。只管这一条，别的断言不看它。
 * 2026-11-04 批 B 测试会话（分支 claude/qa-platform-redesign-b）改成 true：公共工具顺序那条从此计失败。
 */
const REDESIGN_B = true;

/**
 * 英语学习的那些语音（2026-11-13 起全部**预先生成**：微软 Edge 的神经网络语音，英文 Sonia、中文 晓晓）：
 * 本地当然没有生成好的字节，所以**先把整份清单当成"已经生成过"放进库**（这就是线上的常态）：
 * 元数据一行进 en_audio，字节进分块表 en_audio_part（迁移 0023 起字节都存在那里，一条音频可以拆成多行；
 * 这段静音很小，一块就装下了）。
 * 放的是 test/fixtures/pron/silent.mp3 —— 一段 0.26 秒的**静音** mp3（本地用 ffmpeg 生成，不是任何人的声音）。
 * 所以这一段测的是**界面和流程**，不是"两个词念得像不像"；像不像只有人能判断，那正是「两个听着一样」那个按钮的事。
 * **纠说那条路一个替身都不放**：本地没绑 Workers AI，它走的就是"当面说用不了、其余照常能用"那条真路。
 *
 * 清单**不在这里手抄**：问 scripts/audio-manifest.ts 要（它读 src/en-audio-list.ts）。
 * 哈希只有一处实现（src/en-audio.ts 的 audioKey），这边不自己算，免得两边算出不一样的键 ——
 * 2026-11-10 从 melotts 换成 aura-2-en 那次，就是因为两边各写一份键，这条 e2e 先红的。
 */
const SILENT_MP3 = readFileSync(path.join(ROOT, 'test/fixtures/pron/silent.mp3')).toString('hex');
const 语音清单 = JSON.parse(
  execFileSync(path.join(ROOT, 'node_modules/.bin/vite-node'), ['scripts/audio-manifest.ts'], { cwd: ROOT, encoding: 'utf8' }).replace(/^[^{]*/, ''),
).清单;
const srv = await startServer({
  name: 'e2e-platform',
  seedSql: 语音清单.flatMap((x) => [
    `INSERT INTO en_audio (k, voice, txt, mp3, bytes, at) VALUES ('${x['键']}', '${x['声音']}', '', X'', ${SILENT_MP3.length / 2}, 0);`,
    `INSERT INTO en_audio_part (k, part, mp3) VALUES ('${x['键']}', 0, X'${SILENT_MP3}');`,
  ]).join('\n'),
});
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
  LOOK.trackApi(page);
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
  // 2026-11-04 修偶发失败（C57）：原来在 #w-todos 还会被切页那次读取重画时就点，重画落在点击中间会丢这一下；根因和新写法见 scripts/e2e-look.mjs openGroups()
  await LOOK.openGroups(page, WAIT);
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
      { nav: 'work', page: 'work', seg: 'work', mods: ['w-now', 'w-todo', 'w-live', 'w-proj', 'w-num', 'w-meet'] },
      { nav: 'forecast', page: 'project', seg: 'forecast', mods: ['f-next', 'f-guide', 'f-live', 'f-card', 'f-pack', 'f-match', 'f-tools', 'f-handoff'] },
      // 英语学习那两块 2026-11-13 挪到这里（别的项目上不出现，由第 8.5 段守）
      { nav: 'Practical', page: 'project', seg: 'Practical', mods: ['f-next', 'f-card', 'f-handoff', 'f-pron', 'f-s2'] },
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
    // 批 C 改：改前数 #f-pack / #f-match 的 tbody tr；改后"每条一个 tbody tr 或 li"（手机上改列表，电脑上可以还是表格），条数口径不变
    const nRows = (sel) => p.locator(`${sel} :is(tbody tr, li)`).count();
    check('本周帖子：6 条', (await nRows('#f-pack-body')) === 6, await nRows('#f-pack-body'));
    check('焦点战：10 场', (await nRows('#f-match-body')) === 10, await nRows('#f-match-body'));
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


  // ---------- 8.5 英语学习两块的位置和手机排版（2026-11-13 从工作台挪进 Practical 项目页）----------
  // Amos 2026-11-13 原话：「工作台 发音训练 这个模块不需要再出现在 工作台 发音训练这个位置了」
  // 「工作台 practical 用来存储和展示所有与我英语学习有关的内容」。
  // 守六件事：① 工作台二级菜单回到 **6 项**，里面**再也没有** w-pron（上限还是 8、公共工具那 8 项一个没动，T-4）；
  // ② Practical 项目页的子菜单里有 f-pron、f-s2，点一下滚得到，地址是 #/Practical/pron、#/Practical/s2；
  // ③ **别的项目（forecast）上这两块整块不出现**，子菜单上那两项也不出现；
  // ④ 两块里**一个输入框都没有**、看得见的按钮 ≥52px（句子训练的"上一步"是次动作，≥44px）；
  // ⑤ 两块都能**真的走一步**（发音训练点「做好了，下一步」换一句；句子训练点主按钮进下一步）；
  // ⑥ 手机 390 宽不横向滚动、子菜单一行（可以横滑）、选中项完整看得见且不在右侧渐隐区、两层菜单 ≤25%。
  await section('英语学习两块·位置', async () => {
    for (const width of [390, 1280]) {
      const p = await open({ width, height: 900 });
      await login(p, '/#/work');
      // ① 工作台二级菜单 6 项，没有发音训练
      const mods = await p.locator('#sub-work a[data-s]').evaluateAll((a) => a.map((x) => x.dataset.s));
      const tools = await p.locator('#sub-tools a[data-s]').evaluateAll((a) => a.map((x) => x.dataset.s));
      check(`${width} 宽：工作台二级菜单正好 6 项（上限还是 8；公共工具还是 8 项，T-4）`,
        mods.length === 6 && mods.length <= 8 && tools.length === 8, { mods, tools });
      check(`${width} 宽：工作台二级菜单里**再也没有**「发音训练」；下线的「英语练习」「带练」也不在`,
        !mods.includes('w-pron') && !mods.includes('w-english') && !mods.includes('w-drill')
        && !(await p.locator('#sub-work').innerText()).includes('发音训练'), mods);
      check(`${width} 宽：工作台页上也没有 #w-pron 这个模块了（不是两份并存）`, (await p.locator('#w-pron').count()) === 0, await p.locator('#w-pron').count());

      // ③ 别的项目（forecast）上这两块不出现
      await p.goto(BASE + '/#/forecast');
      await waitFor(p, '#v-project');
      await p.waitForTimeout(400);
      const 别的项目 = await p.evaluate(() => ({
        模块: ['f-pron', 'f-s2'].map((id) => { const e = document.getElementById(id); return [id, !!e, !!e && !!e.getClientRects().length]; }),
        菜单: [...document.querySelectorAll('#sub-project a[data-s]')].filter((a) => a.getClientRects().length).map((a) => a.dataset.s),
      }));
      check(`${width} 宽：forecast 项目页上「发音训练」「句子训练」整块都不出现（DOM 在、但 hidden）`,
        别的项目.模块.every(([, 有, 看得见]) => 有 && !看得见), 别的项目.模块);
      check(`${width} 宽：forecast 的子菜单里也没有这两项（菜单顺序 = 页面顺序，不留空项）`,
        !别的项目.菜单.includes('f-pron') && !别的项目.菜单.includes('f-s2'), 别的项目.菜单);

      // ② Practical 项目页上两块都在，点菜单滚得到
      for (const [m, id, 名] of [['pron', 'f-pron', '发音训练'], ['s2', 'f-s2', '句子训练']]) {
        await p.goto(BASE + '/#/Practical');
        await waitFor(p, `#${id}`);
        await p.click(`#sub-project a[data-s="${id}"]`, { timeout: WAIT });
        await p.waitForTimeout(400);
        const seen = await p.evaluate((i) => { const e = document.getElementById(i); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, h: innerHeight, hash: decodeURIComponent(location.hash) }; }, id);
        check(`${width} 宽：Practical 项目页点菜单滚到「${名}」，地址是 #/Practical/${m}`,
          !!seen && seen.top >= -2 && seen.top < seen.h && seen.hash === `#/Practical/${m}`, seen);
        // ④ 一个输入框都没有
        const inputs = await p.locator(`#${id} input, #${id} textarea, #${id} [contenteditable]`).count();
        check(`${width} 宽：「${名}」整块里一个输入框都没有（不让他打字；录音按钮是 button）`, inputs === 0, inputs);
      }

      // ④ 发音训练的按钮 ≥52px（句子训练的主按钮也量，次动作"上一步"允许 44）
      await p.goto(BASE + '/#/Practical/pron');
      await waitFor(p, '#f-pron');
      await p.waitForFunction(() => document.querySelectorAll('#f-pron #pn-cbtns .btn').length > 0, null, { timeout: WAIT }).catch(() => {});
      const small = await p.evaluate(() => [...document.querySelectorAll('#f-pron button')].filter((b) => b.getClientRects().length && !b.closest('summary') && b.tagName !== 'SUMMARY')
        .map((b) => ({ t: b.textContent.slice(0, 10), h: Math.round(b.getBoundingClientRect().height) })).filter((x) => x.h < 52));
      check(`${width} 宽：发音训练看得见的按钮都 ≥52px 高（手机单手够得着）`, small.length === 0, small);
      const s2b = await p.evaluate(() => [...document.querySelectorAll('#f-s2 .s2-b')].filter((b) => b.getClientRects().length)
        .map((b) => ({ t: b.textContent.slice(0, 10), g: b.classList.contains('g'), h: Math.round(b.getBoundingClientRect().height) })));
      check(`${width} 宽：句子训练的主按钮 ≥52px、次动作「上一步」≥44px`,
        s2b.length > 0 && s2b.every((x) => x.h >= (x.g ? 44 : 52)), s2b);

      // ⑤ 两块都能真的走一步
      const 第一句 = await txt(p, '#pn-csay');
      await p.click('#f-pron #pn-cbtns .btn.go', { timeout: WAIT });
      await p.waitForTimeout(300);
      const 第二句 = await txt(p, '#pn-csay');
      check(`${width} 宽：发音训练点「做好了，下一步」真的换了一句（一屏只有一步）`, !!第一句 && !!第二句 && 第一句 !== 第二句, { 第一句, 第二句 });
      await p.goto(BASE + '/#/Practical/s2');
      await waitFor(p, '#f-s2');
      await p.waitForFunction(() => document.querySelectorAll('#f-s2 .s2-b').length > 0, null, { timeout: WAIT });
      const 这一步 = await txt(p, '#s2-num');
      await p.click('#f-s2 .s2-b.p', { timeout: WAIT });
      await p.waitForTimeout(300);
      const 下一步 = await txt(p, '#s2-num');
      check(`${width} 宽：句子训练点主按钮真的进了下一步（第 n / 共 m 步变了）`, !!这一步 && !!下一步 && 这一步 !== 下一步, { 这一步, 下一步 });
      check(`${width} 宽：句子训练每一步都标着出处（.s2-src 那一行在）`, (await p.locator('#f-s2 .s2-src').count()) >= 1, await p.locator('#f-s2 .s2-src').count());

      // ⑥ 不横向滚动；子菜单一行、可以横滑，选中项完整看得见（和 T-4 / R9 同一个口径）
      await p.goto(BASE + '/#/Practical/pron');
      await waitFor(p, '#f-pron');
      await p.waitForTimeout(500);
      const fit = await p.evaluate(() => {
        const nav = document.querySelector('#sub-project .in');
        const as = [...nav.querySelectorAll('a')].filter((a) => a.getClientRects().length);
        const bars = document.getElementById('bars').getBoundingClientRect().height;
        const sel = nav.querySelector('a[data-s][aria-current="true"]');
        const b = nav.getBoundingClientRect(), r = sel ? sel.getBoundingClientRect() : null;
        const atEnd = nav.scrollLeft + nav.clientWidth >= nav.scrollWidth - 2;
        const fadeAt = atEnd ? b.left + nav.clientWidth : b.left + nav.clientWidth * 0.88; // 渐隐区从这里开始
        return {
          rows: new Set(as.map((a) => Math.round(a.getBoundingClientRect().top))).size,
          sel: sel ? sel.dataset.s : null,
          selIn: !!r && r.left >= b.left - 1 && r.right <= fadeAt + 1,
          barsPct: +(bars / innerHeight * 100).toFixed(1),
        };
      });
      check(`${width} 宽：不横向滚动；子菜单一行（可以横滑）、选中的 f-pron 完整看得见且不在右侧渐隐区；两层菜单 ${fit.barsPct}% ≤ 25%（T-4 / R9 同一个口径）`,
        (await noHScroll(p)) && fit.rows === 1 && fit.sel === 'f-pron' && fit.selIn && fit.barsPct <= 25, { h: await noHScroll(p), ...fit });
      // 两块自己也不许横着溢出
      const 溢 = await p.evaluate(() => ['f-pron', 'f-s2', 's2-step'].map((id) => { const e = document.getElementById(id); return [id, e ? e.scrollWidth - e.clientWidth : -1]; }));
      check(`${width} 宽：这两块里没有任何一行横着溢出`, 溢.every(([, d]) => d <= 1), 溢);
      if (SHOTS && width === 390) {
        mkdirSync(SHOTS, { recursive: true });
        await p.locator('#f-pron').screenshot({ path: path.join(SHOTS, 'Practical项目页-发音训练-390.png') });
        await p.goto(BASE + '/#/Practical/s2');
        await waitFor(p, '#f-s2');
        await p.waitForTimeout(500);
        await p.locator('#f-s2').screenshot({ path: path.join(SHOTS, 'Practical项目页-句子训练-390.png') });
        await p.goto(BASE + '/#/Practical');
        await waitFor(p, '#v-project');
        await p.waitForTimeout(500);
        await p.screenshot({ path: path.join(SHOTS, 'Practical项目页-整页-390.png'), fullPage: true });
        // 别的项目（forecast）上这两块不出现 —— 截一张当证据
        await p.goto(BASE + '/#/forecast');
        await waitFor(p, '#v-project');
        await p.waitForTimeout(500);
        await p.screenshot({ path: path.join(SHOTS, 'forecast项目页-没有英语两块-390.png'), fullPage: true });
      }
      await p.context().close();
    }
  });

  // ---------- 8.6 换走 / 换项目时摄像头必须灭（2026-11-13 挪位置以后多出来的一条出口）----------
  // 原来只有"离开工作台"一条路；现在还多了"在项目页上换到别的项目"。
  // 两条路都要关：藏起来的 DOM 里摄像头照亮，手机上的指示灯不灭，页面上那句「关掉镜子，指示灯就灭」就是假的。
  await section('英语学习两块·换项目时摄像头灭', async () => {
    const cam = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
    try {
      const ctx = await cam.newContext({ viewport: { width: 390, height: 844 } });
      await ctx.grantPermissions(['camera', 'microphone'], { origin: BASE });
      const q = await ctx.newPage();
      q.on('pageerror', (e) => errors.push(e.message));
      const net = [];
      q.on('request', (r) => net.push(r.method() + ' ' + new URL(r.url()).pathname));
      await q.addInitScript(() => {
        window.__tracks = [];
        const md = navigator.mediaDevices;
        const o = md.getUserMedia.bind(md);
        md.getUserMedia = (c) => o(c).then((s) => { s.getTracks().forEach((t) => window.__tracks.push(t)); return s; });
      });
      await login(q, '/#/Practical/pron');
      await waitFor(q, '#f-pron');
      await q.waitForFunction(() => document.querySelectorAll('#pn-cbtns .btn').length > 0, null, { timeout: WAIT });
      const n0 = net.length;
      await q.click('#pn-mir');
      await q.waitForFunction(() => { const v = document.getElementById('pn-cam'); return !!v && v.videoWidth > 0; }, null, { timeout: 8000 });
      check('390 宽·假媒体流：镜子开着时轨道是 live', await q.evaluate(() => (window.__tracks || []).every((t) => t.readyState === 'live')), null);
      check('390 宽·假媒体流：**开镜子到这里一个请求都没往外发**（画面不上传、不保存、不录）', net.slice(n0).length === 0, net.slice(n0));
      // 换到别的项目（forecast）：setProject() 里要叫 pronStop()
      const n1 = net.length;
      await q.goto(BASE + '/#/forecast');
      await waitFor(q, '#v-project');
      await q.waitForTimeout(500);
      const off = await q.evaluate(() => ({ 没流: document.getElementById('pn-cam').srcObject === null,
        轨道: (window.__tracks || []).map((t) => t.readyState), 藏了: document.getElementById('f-pron').hidden }));
      check('390 宽·假媒体流：**换到别的项目**摄像头真的关了（轨道 ended，手机上的指示灯才会灭）',
        off.没流 && off.轨道.length > 0 && off.轨道.every((x) => x === 'ended') && off.藏了, off);
      check('390 宽·假媒体流：换项目这一步也没往外发任何画面', net.slice(n1).filter((x) => /pron/.test(x)).length === 0, net.slice(n1));
      await ctx.close();
    } finally { await cam.close(); }
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
  const W6 = ['w-now', 'w-todo', 'w-live', 'w-proj', 'w-num', 'w-meet'];
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
        // ① 6 个模块都有看得见的一句话结论（#w-now 的结论是 #hero；其余是 .lead，前面一个状态圆点）
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
        }), W6);
        for (const L of leads) {
          if (L.why) { check(`${tag}：${L.id} 有一句话结论`, false, L.why); continue; }
          // "结论"不是空的说明文字：要带件数 / 数字，或者明说"没事、没有、不用、还没、都…了"；不能是"正在读取"；一句话 = 6～80 字
          const body = L.id === 'w-now' ? L.text.replace('你现在最该做的一件事', '').trim() : L.text;
          const isConcl = /\d|没事|没有|不用|还没|都已|都做完/.test(body) && !/正在读取|读取中/.test(body);
          const lenOk = body.length >= 6 && (L.id === 'w-now' || body.length <= 80);
          const dotOk = L.id === 'w-now' || !!L.dotCls;
          check(`${tag}：${L.id} 的一句话结论看得见、是结论（带件数或"没事"之类）${L.id === 'w-now' ? '' : '、前面有红/橙/绿/灰圆点'}、不超过 80 字`, L.shown && isConcl && lenOk && dotOk, { shown: L.shown, dot: L.dotCls, len: body.length, text: body.slice(0, 90) });
        }
        // ② 说明默认折叠：#v-work 里每个 details.more 都没有 open；有说明的模块（原型：全部待办、团队在做什么、项目概况）说明是模块最后一块；"做完的"也收起
        //   发音训练 2026-11-13 挪去 Practical 项目页了，它的 details.more 由第 8.5 段在项目页上量
        const more = await p.evaluate(() => ({
          open: [...document.querySelectorAll('#v-work details.more[open]')].map((d) => d.closest('.mod')?.id || '?'),
          last: ['w-todo', 'w-live', 'w-proj'].map((id) => { const m = document.getElementById(id); const k = m && [...m.children].filter((c) => c.getClientRects().length).at(-1); return [id, !!k && k.matches('details.more')]; }),
          done: document.getElementById('w-done')?.open ?? null,
        }));
        check(`${tag}：工作台的说明都默认折叠（没有 details.more[open]）`, more.open.length === 0, more.open);
        check(`${tag}：全部待办、团队在做什么、项目概况的最后一块是折叠的"说明和更多"（details.more）`, more.last.every(([, ok]) => ok), more.last.filter(([, ok]) => !ok).map(([id]) => id));
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

  // ---------- 11. 改版批 B：项目页（2026-11-04，测试会话先写，研发不改这里的断言） ----------
  // 依据：批 A 工作台的写法（项目页没有单独原型，按同一套模块固定结构：标题行 → 一句话结论 → 主内容 → 底部折叠说明）；主会话给的批 B 口径：
  //   每个模块一句话结论（由数据算），说明默认折叠；每条待办一个主按钮（Amos 的界面原则 3）——有链接就给主按钮，没有链接就给一个明确的次动作；
  //   第一次就读取失败时项目页不能写"现在没事要做"，要写"暂时读不到"（和工作台一致）；并排的"本周帖子 / 焦点战"要么等高（不留白），要么改成上下排。
  //   外加：字号阶梯、不横向滚动、底部空白 ≤ 160px、深色对比度 ≥ 4.5。公共工具页的批 B 断言在 scripts/e2e-tools.mjs 的 J 段。
  // 批 A 走查发现"审《阶段计划》并过关卡 A"没有主按钮：查下来是样例数据（上面的 T.prac）没有 link、没有正文，而 todoLi() 对"没有 link / form / 正文"的待办不出任何按钮。
  //   真实数据由 agents 工具/company-report.mjs parseTodo() 生成，每条都带 link（"在哪里"有网址就是"打开"，否则是待办文件本身"看待办"+ 正文），
  //   所以线上那条应当有主按钮；渲染层仍要兜底——这里重推一条"没有链接"的和一条"有链接"的。
  const PB = [
    { id: 'PB1', type: 'confirm', text: T.prac, due: now + 40 * H },
    { id: 'PB2', type: 'confirm', text: 'Practical 批B：带链接的那件', link: GH + '项目/Practical/阶段计划.md', link_text: '看阶段计划' },
  ];
  {
    const r = await srv.ingest('agents', [{ kind: 'todo', key: 'Practical', source_at: Date.now(), payload: { product: 'Practical', items: PB } }]);
    check('批 B：重推 Practical 的 2 条待办（一条没链接、一条有链接）收得下', r.status === 200, r);
  }
  const F8 = ['f-next', 'f-guide', 'f-live', 'f-card', 'f-pack', 'f-match', 'f-tools', 'f-handoff'];
  /** 每条待办的按钮：主按钮（.btn.primary 或底色 = --teal）几个、次动作（.go 里不是主按钮的 a.btn / button.btn，不算打勾）几个、主按钮的地址 */
  const todoBtns = (p, sel) => p.evaluate((s) => {
    const probe = document.createElement('div'); probe.style.background = 'var(--teal)'; document.body.appendChild(probe);
    const teal = getComputedStyle(probe).backgroundColor; probe.remove();
    return [...document.querySelectorAll(s + ' li.todo')].map((li) => {
      const ctl = [...li.querySelectorAll('a, button')].filter((e) => e.getClientRects().length && !e.matches('.tick') && !e.closest('.detail, .form'));
      const prim = ctl.filter((e) => e.matches('.btn.primary') || getComputedStyle(e).backgroundColor === teal);
      const sec = ctl.filter((e) => !prim.includes(e) && e.matches('.btn') && !e.disabled && e.getAttribute('aria-disabled') !== 'true' && e.textContent.trim().length >= 2);
      return { t: (li.querySelector('.ttl')?.textContent ?? li.innerText).trim().slice(0, 24), prim: prim.length, href: prim[0]?.getAttribute('href') ?? null, sec: sec.map((e) => e.textContent.trim()) };
    });
  }, sel);
  for (const [width, height] of [[1280, 900], [375, 740]]) {
    for (const colorScheme of ['light', 'dark']) {
      const tag = `批B 项目页 ${width} 宽 · ${colorScheme === 'dark' ? '深色' : '浅色'}`;
      await section(tag, async () => {
        const p = await open({ width, height, colorScheme });
        await login(p, '/#/forecast');
        await waitFor(p, '#f-todos li.todo');
        await p.waitForTimeout(500);
        // ① 模块固定结构 + 说明默认折叠
        const S = await LOOK.modShape(p, F8);
        for (const m of S) {
          if (m.why) { check(`${tag}：${m.id} 模块在`, false, m.why); continue; }
          check(`${tag}：${m.id} 是卡片（.card.mod），第一块是标题行 .mh（有 h2），第二块是一句话结论 .lead（前面一个红/橙/绿/灰圆点），后面至少一块主内容`, m.card && m.headOk && m.leadOk && !!m.dotCls && m.mains >= 1, { card: m.card, headOk: m.headOk, leadOk: m.leadOk, dot: m.dotCls, mains: m.mains, lead: m.lead.slice(0, 40) });
          check(`${tag}：${m.id} 的一句话结论是结论（带数字或"没有 / 还没"之类、不是"正在读取"、6～80 字）`, m.leadOk && LOOK.isConclusion(m.lead), m.lead.slice(0, 90));
          if (m.id === 'f-next') check(`${tag}：f-next 的说明（颜色、按钮、打勾是什么意思）收进最后一块 details.more`, m.lastIsMore, m);
          else check(`${tag}：${m.id} 如果有 details.more，它在最后一块`, m.mores === 0 || m.lastIsMore, m);
          check(`${tag}：${m.id} 的说明默认收起（details.more 没有 open）`, m.moreOpen === 0, m.moreOpen);
          check(`${tag}：${m.id} 折叠外面没有超过 60 字的说明文字（p / .hint；长说明进 details.more）`, m.long.length === 0, m.long);
        }
        // ② 结论由数据算
        const lead = (id) => p.evaluate((i) => document.querySelector(`#${i} .lead`)?.innerText.replace(/\s+/g, ' ').trim() ?? '', id);
        const L = await todos(p, '#f-todos');
        const nOver = L.filter((x) => x.cls === 'over').length;
        const ln = await lead('f-next');
        check(`${tag}：下一步做什么的结论按待办算：${nOver} 件已超时 → 写出 ${nOver}、圆点是红的`, nOver > 0 && new RegExp(`(^|\\D)${nOver}\\s*件`).test(ln) && (await p.locator('#f-next .lead .dot.red').count()) === 1, { nOver, lead: ln });
        const lg = await lead('f-guide');
        check(`${tag}：操作指引的结论按进度算（5 步都勾了 → "都做完"或"5 / 5"）`, /都做完|5\s*\/\s*5/.test(lg), lg);
        const lp = await lead('f-pack'), lm = await lead('f-match');
        check(`${tag}：本周帖子的结论写 ${PACK.posts.length} 条、焦点战的结论写 ${PACK.matches.length} 场`, new RegExp(`(^|\\D)${PACK.posts.length}\\s*条`).test(lp) && new RegExp(`(^|\\D)${PACK.matches.length}\\s*场`).test(lm), [lp, lm]);
        // ③ 每条待办一个主按钮：有链接 / 要填数字的正好一个主按钮（要填数字的那条第 5 段已经填过、不在了，由通用那条管）；没有链接的不给主按钮、给一个明确的次动作
        const B = await todoBtns(p, '#f-todos');
        check(`${tag}：forecast 每条待办最多一个主按钮；没有主按钮的正好一个次动作（不算打勾）`, B.length > 0 && B.every((b) => b.prim === 1 || (b.prim === 0 && b.sec.length === 1)), B);
        const withLink = B.find((b) => b.t.startsWith(T.none2.slice(0, 8)));
        check(`${tag}：有链接的那条（${T.none2}）主按钮就是它的链接`, !!withLink && withLink.prim === 1 && withLink.href === 'https://www.quickcome.online', withLink);
        const noLink = B.find((b) => b.t.startsWith(T.over.slice(0, 8)));
        check(`${tag}：没有链接的那条（${T.over}）：不给主按钮，给正好一个明确的次动作`, !!noLink && noLink.prim === 0 && noLink.sec.length === 1, noLink);
        // ④ 并排的"本周帖子 / 焦点战"：要么上下排，要么等高且两块底部都不留大块空白（≤ 48px）
        const pm = await p.evaluate(() => {
          const g = (id) => { const e = document.getElementById(id); const r = e.getBoundingClientRect(); const kids = [...e.children].filter((c) => c.getClientRects().length);
            const inner = kids.length ? Math.max(...kids.map((c) => c.getBoundingClientRect().bottom)) : r.top; return { top: Math.round(r.top + scrollY), bottom: Math.round(r.bottom + scrollY), h: Math.round(r.height), gap: Math.round(r.bottom - inner) }; };
          return { pack: g('f-pack'), match: g('f-match') };
        });
        const side = Math.abs(pm.pack.top - pm.match.top) <= 4;
        const okPM = side ? Math.abs(pm.pack.h - pm.match.h) <= 4 && pm.pack.gap <= 48 && pm.match.gap <= 48 : pm.match.top >= pm.pack.bottom;
        check(`${tag}："本周帖子 / 焦点战"${side ? '并排：两块等高（差 ≤ 4px）、底部空白都 ≤ 48px' : '上下排：焦点战在本周帖子下面'}`, okPM, { side, ...pm });
        // ⑤ 字号、横向滚动、底部空白、深色对比度
        const fo = await LOOK.fontOutliers(p, ['#v-project']);
        check(`${tag}：项目页看得见的文字字号只在 {${FS.join(',')}}±0.5 里（控件可以 ${FS_CTL}）`, fo.length === 0, fo);
        check(`${tag}：页面没有横向滚动`, await noHScroll(p), await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]));
        const t = await LOOK.tailOf(p, '#v-project');
        check(`${tag}：最后一个模块底边到页面底 ${t.tail}px ≤ ${TAIL_MAX}px`, t.tail <= TAIL_MAX, t);
        if (colorScheme === 'dark') {
          const lc = await LOOK.lowContrast(p, ['#v-project']);
          check(`${tag}：深色模式文字对比度：正文 ≥ ${LOOK.CONTRAST_MIN}:1（大字 ≥ 3:1，禁用的不算）`, lc.bad.length === 0, lc);
        }
        if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, `forecast-B-${width}-${colorScheme}.png`), fullPage: true }); }
        // ⑥ Practical 项目页：没链接的"审《阶段计划》并过关卡 A"给一个明确的次动作；有链接的那条主按钮就是链接
        await p.goto(BASE + '/#/Practical');
        // **项目页只有一套 DOM**（切项目换数据不换结构），所以 `#f-todos li.todo` 在切过去的
        // 那一刻还是 forecast 的待办 —— 等这个选择器等于没等，后面那 300 毫秒纯属赌运气。
        // 2026-11-13：项目页多了发音训练和句子训练两块，渲染多花一点时间，CI 上就读到了
        // forecast 的待办、红了两条。改成**等它真的换成 Practical 的数据**：标题是 Practical，
        // 并且待办里真的出现了 Practical 那一条。
        await p.waitForFunction((want) => document.getElementById('f-title')?.textContent === 'Practical'
          && [...document.querySelectorAll('#f-todos li.todo')].some((li) => (li.textContent || '').includes(want)),
          T.prac.slice(0, 10), { timeout: WAIT });
        const PBb = await todoBtns(p, '#f-todos');
        const prac = PBb.find((b) => b.t.startsWith(T.prac.slice(0, 10)));
        check(`${tag}：Practical "${T.prac}"（没有链接）：不给主按钮，给正好一个明确的次动作`, !!prac && prac.prim === 0 && prac.sec.length === 1, prac ?? PBb);
        const pb2 = PBb.find((b) => b.t.startsWith('Practical 批B'));
        check(`${tag}：Practical 带链接的那条：正好一个主按钮，地址就是它的链接`, !!pb2 && pb2.prim === 1 && pb2.href === PB[1].link, pb2 ?? PBb);
        await p.context().close();
      });
    }
  }
  // ⑦ 第一次就读取失败：项目页写"暂时读不到"、不写"现在没事要做"（工作台已经这样，一起守）
  await section('批B 第一次就读取失败', async () => {
    for (const [at, pageSel, mod] of [['/#/forecast', '#v-project', '#f-next'], ['/#/work', '#v-work', '#w-todo']]) {
      const p = await open();
      await p.route('**/api/company', (rt) => rt.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"样例：服务暂时出错"}' }));
      await login(p, at);
      const shown = await waitFor(p, pageSel);
      await p.waitForTimeout(1200);
      const all = (await txt(p, pageSel)) ?? '';
      const m = (await txt(p, mod)) ?? '';
      const ld = await p.evaluate((s) => document.querySelector(s + ' .lead')?.innerText.trim() ?? '', mod);
      check(`批B 第一次就读取失败 ${at}：页面显示，${mod} 和它的结论写"暂时读不到"，整页没有"没事要做"`, shown && /暂时读不到/.test(m) && /暂时读不到/.test(ld) && !/没事要做/.test(all), { shown, lead: ld, mod: m.slice(0, 120), hit: (all.match(/.{0,12}没事要做.{0,8}/) || [''])[0] });
      await p.context().close();
    }
  });

  // ---------- 12. 改版批 C（2026-11-05，测试会话先写，研发不改这里的断言） ----------
  // 依据：主会话转 Amos 11/5"第三批选 a，开始吧"的口径：
  //   ① 公司总览按新样式重做：卡片 + 每块一句话结论 + 说明默认折叠 + 固定子菜单（顺序 = 页面顺序，滑动跟着选中，同一套 subSpy）；
  //      去掉"需要我的事"（和工作台重复、件数对不上），只留工作台没有的三块：各岗位这周在做什么、这周学到了什么、做得怎么样（CI 等）；顶栏"公司"改名"公司总览"。
  //   ② forecast 帖子表手机上改列表：375 宽"本周帖子 / 焦点战"每条一行。
  //   ④ 深色模式红色角标（一级菜单 .cnt、工作台"已超时"）白字对比度 ≥ 4.5（现在 #E5484D 上 3.91）。
  //   外加公司总览的字号、对比度、横向滚动、底部空白、菜单高度。③ 公共工具首次读取失败、⑤ #/tools/voice 子菜单选中在 scripts/e2e-tools.mjs 的 M 段。
  const CO3 = ['co-people', 'co-learn', 'co-health'];
  {
    // 样例：交接记录前面已经有 2 个岗位（市场、研发）；这里补 3 条学习、3 个仓库 / 任务的 CI（1 个红）
    const r1 = await srv.ingest('agents', [
      ...['产品', '研发', '测试'].map((role) => ({ kind: 'learning', key: role, source_at: Date.now() - H, payload: { role, note: '批 C 样例', items: [{ title: `${role}：批 C 样例学习一条` }] } })),
      { kind: 'ci', key: '', source_at: Date.now() - H, payload: { conclusion: 'none', note: '批 C 样例：agents 没有 CI' } },
    ]);
    const r2 = await srv.ingest('marketing', [{ kind: 'ci', source_at: Date.now() - H, payload: { conclusion: 'success', sha: 'e161069', at: now - 2 * H, note: '批 C 样例：正式版 ok' } }]);
    const r3 = await srv.ingest('new-forecast', [{ kind: 'ci', source_at: Date.now() - H, payload: { conclusion: 'failure', sha: 'f534f23', at: now - 3 * H, note: '批 C 样例：官网 CI 红' } }]);
    check('批 C：推送学习 3 条、CI 3 条（marketing 绿、new-forecast 红、agents 无 CI）收得下', [r1, r2, r3].every((r) => r.status === 200), [r1, r2, r3]);
  }
  /** 子菜单里每一项 [data-s, aria-current]；一级 / 子菜单各几行；#bars 高 */
  const barsOf = (p, sub) => p.evaluate((s) => {
    const rows = (sel) => new Set([...document.querySelectorAll(sel)].filter((a) => a.getClientRects().length).map((a) => Math.round(a.getBoundingClientRect().top))).size;
    return { nav1: rows('nav.nav1 a[data-p]'), sub: rows(s + ' a[data-s]'), h: Math.round(document.getElementById('bars').getBoundingClientRect().height), ih: innerHeight };
  }, sub);
  for (const [width, height] of [[1280, 900], [375, 740]]) {
    for (const colorScheme of ['light', 'dark']) {
      const tag = `批C 公司总览 ${width} 宽 · ${colorScheme === 'dark' ? '深色' : '浅色'}`;
      await section(tag, async () => {
        const p = await open({ width, height, colorScheme });
        await login(p, '/#/company');
        const shown = await waitFor(p, '#v-company');
        await waitFor(p, '#co-health');
        await LOOK.apiSettled(p).catch(() => {});
        await p.waitForTimeout(500);
        // ① 名字：顶栏按钮"公司总览"，页面标题也是
        const nm = await p.evaluate(() => ({ btn: document.getElementById('conav')?.textContent.trim() ?? null, title: document.getElementById('title')?.textContent.trim() ?? null, doc: document.title }));
        check(`${tag}：顶栏按钮 #conav 文字是"公司总览"，页面标题 #title 和 <title> 开头也是"公司总览"`, shown && nm.btn === '公司总览' && nm.title === '公司总览' && nm.doc.startsWith('公司总览'), nm);
        // ② 只留三块，没有"需要我的事"
        const kept = await p.evaluate(() => {
          const v = document.getElementById('v-company');
          const mods = [...v.querySelectorAll('.mod, section.card')].filter((e) => e.getClientRects().length && !e.parentElement.closest('.mod, section.card')).map((e) => e.id || e.className);
          return { mods, need: !!document.getElementById('co-need'), tiles: v.querySelectorAll('.tile').length, proj: !!document.getElementById('co-projects'), next: !!document.getElementById('co-next'),
            text: /需要我的事/.test(v.innerText), did: [...v.querySelectorAll('button, a')].filter((b) => /我做了/.test(b.textContent)).length };
        });
        check(`${tag}：公司总览只留三块 ${CO3.join(' → ')}（看得见的卡片就这三个，按这个顺序）`, JSON.stringify(kept.mods) === JSON.stringify(CO3), kept.mods);
        check(`${tag}：没有"需要我的事"（#co-need、摘要格子 .tile、"我做了"按钮、"需要我的事"几个字都没有），没有项目表 #co-projects、下周 #co-next`, !kept.need && kept.tiles === 0 && !kept.text && kept.did === 0 && !kept.proj && !kept.next, kept);
        // ③ 模块固定结构 + 一句话结论 + 说明默认折叠
        const S = await LOOK.modShape(p, CO3);
        for (const m of S) {
          if (m.why) { check(`${tag}：${m.id} 模块在`, false, m.why); continue; }
          check(`${tag}：${m.id} 是卡片（.card.mod），第一块标题行 .mh（有 h2），第二块一句话结论 .lead（前面一个红/橙/绿/灰圆点），后面至少一块主内容`, m.card && m.headOk && m.leadOk && !!m.dotCls && m.mains >= 1, { card: m.card, headOk: m.headOk, leadOk: m.leadOk, dot: m.dotCls, mains: m.mains, lead: m.lead.slice(0, 40) });
          check(`${tag}：${m.id} 的一句话结论是结论（带数字或"没有 / 还没"之类、不是"正在读取"、6～80 字）`, m.leadOk && LOOK.isConclusion(m.lead), m.lead.slice(0, 90));
          check(`${tag}：${m.id} 有说明的话收在最后一块 details.more、默认收起；折叠外没有超过 60 字的说明`, (m.mores === 0 || m.lastIsMore) && m.moreOpen === 0 && m.long.length === 0, { mores: m.mores, last: m.lastIsMore, open: m.moreOpen, long: m.long });
        }
        // ④ 结论由数据算：岗位 2 个、学习 3 条、CI 有 1 个红（圆点红）
        const ld = Object.fromEntries(S.filter((m) => !m.why).map((m) => [m.id, m]));
        const num = (t, n) => new RegExp(`(^|\\D)${n}(\\D|$)`).test(t || '');
        check(`${tag}：岗位这周的结论按交接记录算（2 个岗位 → 写出 2）`, num(ld['co-people']?.lead, 2), ld['co-people']?.lead);
        check(`${tag}：学到了什么的结论按条数算（3 条 → 写出 3 条）`, /(^|\D)3\s*条/.test(ld['co-learn']?.lead || ''), ld['co-learn']?.lead);
        check(`${tag}：做得怎么样：有 1 个 CI 是红的 → 结论写出 1、圆点是红的`, num(ld['co-health']?.lead, 1) && ld['co-health']?.dotCls === 'red', { lead: ld['co-health']?.lead, dot: ld['co-health']?.dotCls });
        // ⑤ 固定子菜单：#sub-company 在、顺序 = 页面顺序 = 三块
        const sub = await p.evaluate(() => { const n = document.getElementById('sub-company'); return { has: !!n, shown: !!n && !n.closest('[hidden]') && !!n.getClientRects().length, sub: !!n && n.matches('nav.sub'), in: !!n && !!n.querySelector('.in'), links: n ? [...n.querySelectorAll('a[data-s]')].map((a) => [a.dataset.s, a.getAttribute('href')]) : [] }; });
        check(`${tag}：有固定子菜单 nav.sub#sub-company（里面 .in），看得见`, sub.has && sub.shown && sub.sub && sub.in, sub);
        check(`${tag}：子菜单依次是 ${CO3.join('、')}，地址 #/company/people、#/company/learn、#/company/health`, JSON.stringify(sub.links) === JSON.stringify([['co-people', '#/company/people'], ['co-learn', '#/company/learn'], ['co-health', '#/company/health']]), sub.links);
        const o = await LOOK.orderOf(p, '#sub-company');
        check(`${tag}：子菜单顺序 == 页面上模块从上到下（同排从左到右）的顺序`, o.menu.length === 3 && JSON.stringify(o.menu) === JSON.stringify(o.page), o);
        // ⑥ 两层菜单：各一行；375×740 合起来 ≤ 15% 屏幕高；滚到底还固定在顶上
        const bars = await barsOf(p, '#sub-company');
        check(`${tag}：一级菜单只有一行、子菜单只有一行`, bars.nav1 === 1 && bars.sub === 1, bars);
        if (width === 375) check(`${tag}：375×740 两层菜单 #bars 高 ${bars.h}px ≤ 15% 屏幕高（${Math.floor(bars.ih * 0.15)}px）`, bars.h <= bars.ih * 0.15, bars);
        await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await p.waitForTimeout(200);
        const stick = await p.evaluate(() => { const s = document.getElementById('sub-company'); if (!s) return null; const b = s.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), y: Math.round(scrollY) }; });
        check(`${tag}：滚到底后子菜单还固定在屏幕顶部`, !!stick && stick.top >= 0 && stick.bottom <= 200, stick);
        await p.evaluate(() => window.scrollTo(0, 0));
        // ⑦ 字号、横向滚动、底部空白、对比度
        const fo = await LOOK.fontOutliers(p, ['#bars', '#v-company']);
        check(`${tag}：顶栏、菜单、公司总览里看得见的文字字号只在 {${LOOK.FS.join(',')}}±0.5 里（控件可以 ${LOOK.FS_CTL}；.brand 16）`, fo.length === 0, fo);
        check(`${tag}：页面没有横向滚动`, await noHScroll(p), await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]));
        const t = await LOOK.tailOf(p, '#v-company');
        check(`${tag}：最后一个模块底边到页面底 ${t.tail}px ≤ ${LOOK.TAIL_MAX}px（页面比屏幕矮的不算）`, t.sh <= t.ih + 1 || t.tail <= LOOK.TAIL_MAX, t);
        const lc = await LOOK.lowContrast(p, ['#v-company', '#sub-company']);
        check(`${tag}：公司总览文字对比度：正文 ≥ ${LOOK.CONTRAST_MIN}:1（大字 ≥ 3:1，禁用的不算）`, lc.bad.length === 0, lc);
        if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, `company-C-${width}-${colorScheme}.png`), fullPage: true }); }
        await p.context().close();
      });
    }
  }
  // 公司总览子菜单：从链接打开停在那一块、滑动跟着选中（同 forecast / 公共工具的量法）
  for (const [width, height] of [[1280, 600], [375, 740]]) {
    await section(`批C 公司总览 ${width} 宽：子菜单`, async () => {
      const tg = `批C 公司总览 ${width} 宽`;
      for (const m of ['health', 'learn']) {
        const p = await open({ width, height });
        await login(p, `/#/company/${m}`);
        await waitFor(p, `#co-${m}`);
        await p.waitForTimeout(600);
        const st = await p.evaluate((id) => { const e = document.getElementById(id), s = document.getElementById('sub-company'); if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), menus: s ? Math.round(s.getBoundingClientRect().bottom) : null, ih: innerHeight, hash: location.hash }; }, `co-${m}`);
        const on = await spyOn(p, '#sub-company');
        check(`${tg}：从链接打开 #/company/${m} → 停在 co-${m}（顶端在固定菜单下面、在屏幕里），子菜单只选中 co-${m}`, !!st && st.menus != null && st.top >= st.menus - 1 && st.top < st.ih && JSON.stringify(on) === JSON.stringify([`co-${m}`]), { ...st, on });
        await p.context().close();
      }
      const p = await open({ width, height });
      await login(p, '/#/company');
      await waitFor(p, '#co-health');
      await p.waitForTimeout(600);
      const mods = await spyMods(p, '#sub-company');
      const pos = await spyPos(p);
      check(`${tg}：前提——三块都看得见、页面能往下滑`, mods.length === 3 && pos.max > 0, { mods, max: pos.max });
      const pair = mods.findIndex((x, i) => i > 0 && Math.abs(x.top - mods[i - 1].top) <= 4);
      if (pair > 0) await subRowCase(p, '#sub-company', mods[pair - 1].id, mods[pair].id, `${tg}（并排）`);
      else await scrollSpyCase(p, '#sub-company', tg);
      await p.evaluate(() => window.scrollTo(0, 0));
      await p.waitForTimeout(200);
      if (width === 375 && (await p.locator('#sub-company .in').count())) await subInViewCase(p, '#sub-company', `${tg}（选中项看得见）`, { mustScroll: false });
      // 别的页面不显示公司总览的子菜单
      await p.goto(BASE + '/#/work');
      await waitFor(p, '#v-work');
      check(`${tg}：切到工作台后 #sub-company 不显示`, !(await vis(p, '#sub-company')), null);
      await p.context().close();
    });
  }

  // ② forecast 帖子表手机上改列表：375 宽每条一行；1280 宽条数照旧
  const ROW_H_MAX = 64; // 约两行字（15px 字、1.5 行高 ≈ 45px，加上下内边距）；现在 375 宽拆成四行一组约 100px
  const PREFIX = /第几条|写的什么|几点发|最晚|联赛|对阵|开赛/;
  for (const [width, height] of [[375, 740], [1280, 900]]) {
    for (const colorScheme of ['light', 'dark']) {
      const tag = `批C forecast 帖子表 ${width} 宽 · ${colorScheme === 'dark' ? '深色' : '浅色'}`;
      await section(tag, async () => {
        const p = await open({ width, height, colorScheme });
        await login(p, '/#/forecast/pack');
        await waitFor(p, '#f-pack-body');
        await p.waitForTimeout(400);
        for (const [body, n, name] of [['f-pack-body', PACK.posts.length, '本周帖子'], ['f-match-body', PACK.matches.length, '焦点战']]) {
          const R = await p.evaluate(({ b, re }) => {
            const box = document.getElementById(b);
            if (!box) return null;
            const rows = [...box.querySelectorAll('tbody tr, li')].filter((e) => e.getClientRects().length);
            const pseudo = [...box.querySelectorAll('*')].filter((e) => e.getClientRects().length).flatMap((e) => ['::before', '::after'].map((ps) => getComputedStyle(e, ps).content)).filter((c) => c && c !== 'none' && c !== 'normal' && new RegExp(re).test(c));
            const own = /(第几条|写的什么|几点发|最晚|联赛|对阵|开赛)\s*[：:]/.test(box.innerText);
            const tops = rows.map((r) => Math.round(r.getBoundingClientRect().top));
            return { n: rows.length, h: rows.map((r) => Math.round(r.getBoundingClientRect().height)), stacked: tops.every((t, i) => i === 0 || t > tops[i - 1]), pre: [...new Set(pseudo)].slice(0, 6), own };
          }, { b: body, re: PREFIX.source });
          check(`${tag}：${name}有 ${n} 条，每条一个 tbody tr 或 li、一条一排`, !!R && R.n === n && R.stacked, R);
          if (width === 375) {
            check(`${tag}：${name}每条一行：每条高 ≤ ${ROW_H_MAX}px（不再拆成四行一组）`, !!R && R.n > 0 && R.h.every((h) => h <= ROW_H_MAX), R && R.h);
            check(`${tag}：${name}不再有"第几条：/写的什么：/几点发：/最晚："这类每格前缀（::before 或文字都没有）`, !!R && R.pre.length === 0 && !R.own, R && { pre: R.pre, own: R.own });
          }
        }
        check(`${tag}：页面没有横向滚动`, await noHScroll(p), await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]));
        if (SHOTS && width === 375) { mkdirSync(SHOTS, { recursive: true }); await p.locator('#f-pack').screenshot({ path: path.join(SHOTS, `forecast-pack-C-${colorScheme}.png`) }).catch(() => {}); }
        await p.context().close();
      });
    }
  }

  // ④ 红色角标：一级菜单 .cnt、工作台"已超时" .b-over、"24 小时内" .b-soon 的文字和它的底色对比度（深色 ≥ 4.5 计失败；浅色只报不计——口径只说了深色，白字配 #E5484D 两种模式都是 3.91）
  const redContrast = (p) => p.evaluate(() => {
    const parse = (c) => { const m = (c.match(/[\d.]+/g) || []).map(Number); return { r: m[0] ?? 0, g: m[1] ?? 0, b: m[2] ?? 0, a: m.length > 3 ? m[3] : 1 }; };
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p2, q) => q - p2); return (x + 0.05) / (y + 0.05); };
    const over = (t, b) => ({ r: t.r * t.a + b.r * (1 - t.a), g: t.g * t.a + b.g * (1 - t.a), b: t.b * t.a + b.b * (1 - t.a), a: 1 });
    const bgOf = (e) => { const L = []; for (let x = e; x; x = x.parentElement) { const c = parse(getComputedStyle(x).backgroundColor); if (c.a > 0) { L.push(c); if (c.a >= 1) break; } } let bg = L.length && L.at(-1).a >= 1 ? L.pop() : { r: 255, g: 255, b: 255, a: 1 }; for (let i = L.length - 1; i >= 0; i--) bg = over(L[i], bg); return bg; };
    // "最该做的事"里现在只有一个标签（样例里是红的）：照它的样子在 #hero .when 里临时放一个红的、一个橙的（.badge.b-over / .badge.b-soon），量完拿掉，两种颜色都量到
    const when = document.querySelector('#hero .when');
    const probes = when ? [['b-over', '已超时 1 天'], ['b-soon', '还剩 1 小时']].map(([c, t]) => { const e = document.createElement('span'); e.className = 'badge ' + c; e.dataset.e2eProbe = '1'; e.textContent = t; when.append(e); return e; }) : [];
    const out = [...document.querySelectorAll('.nav1 .cnt, #v-work .b-over, #v-work .b-soon')].filter((e) => e.getClientRects().length && !e.hidden && e.textContent.trim()).map((e) => {
      const bg = bgOf(e), fg = over(parse(getComputedStyle(e).color), bg);
      return { el: (e.id ? '#' + e.id : '') + '.' + [...e.classList].join('.') + (e.dataset.e2eProbe ? '（#hero 里临时放的）' : ''), text: e.textContent.trim().slice(0, 10), c: +ratio(fg, bg).toFixed(2), fg: getComputedStyle(e).color, bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`, solid: parse(getComputedStyle(e).backgroundColor).a >= 1 };
    });
    probes.forEach((e) => e.remove());
    return out;
  });
  for (const [width, height] of [[1280, 900], [375, 740]]) {
    for (const colorScheme of ['dark', 'light']) {
      const tag = `批C 红色角标 ${width} 宽 · ${colorScheme === 'dark' ? '深色' : '浅色'}`;
      await section(tag, async () => {
        const p = await open({ width, height, colorScheme });
        await login(p, '/#/work');
        await waitFor(p, '#w-todos li.todo');
        await p.waitForFunction(() => [...document.querySelectorAll('.nav1 .cnt')].some((e) => !e.hidden && e.textContent.trim()), null, { timeout: WAIT }).catch(() => {});
        await p.waitForTimeout(300);
        const R = await redContrast(p);
        const cnt = R.filter((x) => x.el.includes('.cnt')), ov = R.filter((x) => x.el.includes('b-over')), sn = R.filter((x) => x.el.includes('b-soon'));
        // 前提：至少一个角标、"最该做的事"里实心底的红标签（"已超时 / 没通过"）和橙标签（"24 小时内"，主会话 11/5 补：白字压 #D97706 约 3.2，同一口径）各至少一个；
        // 列表里只给文字着色的 .b-over / .b-soon 也一起量
        const ok = cnt.length > 0 && ov.some((x) => x.solid) && sn.some((x) => x.solid) && R.every((x) => x.c >= 4.5);
        const label = `${tag}：一级菜单 .cnt 角标（${cnt.length} 个）、工作台"已超时"红标签 .b-over（${ov.length} 个，实心底 ${ov.filter((x) => x.solid).length}）、"24 小时内"橙标签 .b-soon（${sn.length} 个，实心底 ${sn.filter((x) => x.solid).length}）的文字和底色对比度都 ≥ 4.5`;
        if (colorScheme === 'dark') check(label, ok, R);
        else console.log(`${ok ? '✓' : '·'} ${label}（浅色只报不计）${ok ? '' : '：实际 ' + JSON.stringify(R.filter((x) => x.c < 4.5))}`);
        await p.context().close();
      });
    }
  }

  // ⑥ 工作台打勾：接住公司总览"我做了"那几条保护（批 C 去掉"需要我的事"时从 e2e-admin 第 3 段移过来，底线 6：功能去掉了、它守的保护还要有人守）
  //   e2e-admin 改前守的是：处理中…（按钮不能再点）/ 成功提示、收起 / 失败提示原因、按钮恢复 / 刷新页面后还在 / 取消变回 / 迟到的读不能盖掉刚点的。
  //   工作台已有的（第 4 段）：打勾收进"做完的"、跨设备同步、旧状态撤销提示"已被另一处改过"、新浏览器也看到。这里补其余几条，同一套判定。
  await section('批C 工作台打勾（接住公司总览"我做了"的保护）', async () => {
    const p = await open();
    await login(p, '/#/work/todo');
    await waitFor(p, '#w-todos li.todo');
    await openGroups(p);
    const ITEM = T.meet;
    const li = () => p.locator('#w-todos li.todo', { hasText: ITEM });
    const inDone = () => p.evaluate((t) => !![document.getElementById('w-donelist')].filter(Boolean).find((d) => d.textContent.includes(t)) && ![...document.querySelectorAll('#w-todos li.todo')].some((l) => l.innerText.includes(t)), ITEM);
    const waitDone = (want) => p.waitForFunction(([t, w]) => { const d = !!document.getElementById('w-donelist')?.textContent.includes(t) && ![...document.querySelectorAll('#w-todos li.todo')].some((l) => l.innerText.includes(t)); return d === w; }, [ITEM, want], { timeout: WAIT }).then(() => true, () => false);
    const toast = () => p.evaluate(() => { const e = document.getElementById('p-toast'); return e && !e.hidden && e.getClientRects().length ? e.innerText.replace(/\s+/g, ' ').trim() : ''; });
    check('批C 打勾 先确认：经营会那条在待办里、没勾', (await li().count()) === 1 && !(await inDone()), await li().count());
    // ① 处理中：按钮不能再点，再点也不多发
    let release = null, posts = 0;
    await p.route('**/api/company/done', async (rt) => { posts += 1; await new Promise((r) => { release = r; }); await rt.continue(); });
    await li().locator('.tick').click({ timeout: WAIT });
    for (let i = 0; !release && i < 200; i++) await p.waitForTimeout(20);
    const busy = await li().locator('.tick').evaluate((b) => b.disabled || b.getAttribute('aria-busy') === 'true').catch(() => null);
    await li().locator('.tick').click({ force: true, timeout: 1000 }).catch(() => {});
    await p.waitForTimeout(200);
    check('批C 打勾 处理中：打勾按钮变灰（disabled 或 aria-busy），再点一下也不多发请求', busy === true && posts === 1, { busy, posts });
    if (release) release();
    const ok1 = await waitDone(true);
    check('批C 打勾 成功：收进"做完的"，提示"已打勾"', ok1 && /已打勾/.test(await toast()), { ok1, toast: await toast() });
    await p.unroute('**/api/company/done');
    // ② 提示里的"撤销"：放回待办
    await p.locator('#p-toast button', { hasText: '撤销' }).click({ timeout: WAIT }).catch(() => {});
    const back = await waitDone(false);
    check('批C 打勾 点提示里的"撤销"：放回待办，提示"已放回待办"', back && /已放回待办/.test(await toast()), { back, toast: await toast() });
    // ③ 失败：提示原因、按钮恢复、这条还在待办
    await openGroups(p);
    await p.route('**/api/company/done', (rt) => rt.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '测试用的失败' }) }));
    await li().locator('.tick').click({ timeout: WAIT });
    await p.waitForFunction(() => /没记上/.test(document.getElementById('p-toast')?.innerText || ''), null, { timeout: WAIT }).catch(() => {});
    const t3 = await toast();
    const en = await li().locator('.tick').evaluate((b) => !b.disabled).catch(() => null);
    check('批C 打勾 失败：提示"没记上：测试用的失败，请再点一次"，这条还在待办、打勾按钮能再点', t3.includes('没记上：测试用的失败，请再点一次') && en === true && !(await inDone()), { toast: t3, enabled: en });
    await p.unroute('**/api/company/done');
    // ④ 迟到的读不能盖掉刚点的：扣住一次 GET /api/company（拿到的是"没勾"的旧快照），期间打勾成功，再放它落地
    await openGroups(p);
    let hold = true, rel2 = null;
    await p.route('**/api/company', async (rt) => {
      if (!hold || rt.request().method() !== 'GET') return rt.continue();
      hold = false;
      const r = await rt.fetch();
      await new Promise((x) => { rel2 = x; });
      await rt.fulfill({ response: r }).catch(() => {});
    });
    await p.clock.fastForward(31_000); // 30 秒一次的自动重读
    for (let i = 0; !rel2 && i < 300; i++) await p.waitForTimeout(20);
    if (!rel2) throw new Error('拨了 31 秒没等到 GET /api/company');
    await li().locator('.tick').click({ timeout: WAIT });
    const ok4 = await waitDone(true);
    rel2();
    await p.waitForTimeout(800);
    check('批C 打勾 迟到的读不能盖掉刚点的勾：旧快照落地后这条还在"做完的"、提示还在', ok4 && (await inDone()) && /已打勾/.test(await toast()), { ok4, now: await inDone(), toast: await toast() });
    await p.unroute('**/api/company');
    // ⑤ 刷新页面后还在
    await p.reload();
    await p.waitForSelector('#app:not([hidden])', { timeout: WAIT });
    await waitFor(p, '#w-todos li.todo');
    check('批C 打勾 刷新页面后还是勾着（存在服务器上）', await waitDone(true), await txt(p, '#w-donelist'));
    // 还原：撤销，后面不受影响
    await openDone(p);
    await p.locator('#w-donelist li', { hasText: ITEM }).locator('[data-undo]').first().click({ timeout: WAIT }).catch(() => {});
    check('批C 打勾 还原：从"做完的"撤销回待办', await waitDone(false), await txt(p, '#w-donelist'));
    await p.context().close();
  });

  // ---------- 15. 发音训练：一组的四步循环 + 纠说（2026-11-11；第 1 步 2026-11-12 改成「跟我做」）----------
  // Amos 2026-11-11 原话：「纠"说"也做出来，只不过我使用的慢一点儿罢了。工作台 英语练习和代练（带练）都没用了，
  // 用你新做的东西彻底替换掉它们吧」。旧的听辨小测**只会量不会教**：放音 → 选 → 对错 → 下一题换一个完全不同的音，
  // 他连跑七轮 56 题，正确率 75% → 71%，最后说「越听越乱，到最后纯靠猜」。新的按课程走四步。
  // 守八件事：
  // ① 第 1 步**跟我做**（2026-11-12 改；Amos：「完全不知道该怎么开口」「口型图撤掉，念给我听要，开始做」）：
  //    **一屏上只有一步**，点「做好了，下一步」才前进；顶上是课程自己的四级练法轨；口型示意图整套撤掉了；
  // ② 第 2 步**对照听**：这一组的最小对立对，两个词各一个大按钮，点得响（那些语音已经预置进 en_audio）；
  //    **他自己点「我听出来了，开始考」才进第 3 步**；
  // ③ 第 3 步**考**：一轮 10 题、**只考这一组**；每题揭晓前页面上找不到"放的是哪个词"（HTML 里没有编号）；
  // ④ **答错当场把第 2 步的对照听塞回来**（两个词都能点），点「继续」才出下一题；
  // ⑤ 第 4 步：10 题对 8 题（80%）过关，给**课件那句绕口令** + 三最法；服务器上真的记了一行；
  // ⑥ **第 7 组（/ʒ/ vs /dʒ/）照实说只能跟读和纠说**，连「开始考」那个按钮都不给（不硬凑题）；
  // ⑦ **纠说**：本地没绑 Workers AI，走的就是"当面说用不了"那条真路，而且**整块的其余部分照常能用**；
  //    浏览器不支持录音时也当面说（用 addInitScript 把 mediaDevices 拿掉来量这一条）；
  // ⑧ 手机 390 宽：不横滚、没有输入框。--shots 时另存几张 390 宽截图
  //    （跟我做第 1 级 / 第 3 级带 🔊🎤 / 第 4 级绕口令 / 收尾屏 / 对照听 / 答错回到对照听 / 过关）。
  await section('发音训练', async () => {
    const p = await open({ width: 390, height: 844 });
    const played = [];
    // 2026-11-13 起语音在 /api/en/audio/<内容哈希的键>（S1 S2 共用一条），不再是按词编号取
    p.on('request', (r) => { const m = /\/api\/en\/audio\/(e\d+-[0-9a-f]{16})$/.exec(r.url()); if (m) played.push(m[1]); });
    // 这一轮 10 题要**答成一个确定的分数**（第 1 题故意错、其余对）才量得了"80% 过关"，
    // 所以把页面的 Math.random 钉死：放的永远是这一对的 a、左边那个按钮永远是 a。
    // 随机本身（放哪个词、左右位置）由 test/pron.test.ts 守着（pCoin / pMix），这里钉死只是为了算得出分数。
    await p.addInitScript(() => { Math.random = () => 0; });
    await login(p, '/#/Practical/pron');
    await waitFor(p, '#f-pron');
    const tg = '390 宽';
    // 内容从接口拿一份，后面每一步都和它逐条对（页面不自己造内容）
    const ST = await p.evaluate(async () => await (await fetch('/api/en/pron/state')).json());
    const G1 = (ST['组'] || [])[0];
    const WORD = {}, PAIR = {};
    (ST['组'] || []).forEach((z) => (z['对'] || []).forEach((q) => ['a', 'b'].forEach((k) => { WORD[q[k]['编号']] = q[k]['词']; PAIR[q[k]['编号']] = q; })));
    check(`${tg}：接口给七组（第 7 组没有最小对立对，照实标出来）、56 个词的编号和发音是同一套`,
      ST['一共几组'] === 7 && ST['一轮几题'] === 10 && ST['及格线'] === '10 题对 8 题（80%）'
      && Object.keys(WORD).length === 56 && (ST['组'] || [])[6]['能听辨'] === false, { 组数: (ST['组'] || []).length, 词数: Object.keys(WORD).length });

    // ---- 第 1 步：跟我做（一次只说一句话）----
    // 「做好了，下一步」那个主按钮；走到收尾屏为止
    const 下一步 = async (pg) => { await pg.click('#pn-cbtns .btn.go'); };
    const 走完跟我做 = async (pg) => {
      for (let k = 0; k < 80 && await pg.evaluate(() => document.getElementById('pn-fin').hidden); k++) await 下一步(pg);
    };
    /** 屏幕上现在显示的这一步（页面只会显示一步，所以这就是全部） */
    const 这一步 = (pg) => pg.evaluate(() => ({
      lv: document.getElementById('pn-clv').textContent,
      say: document.getElementById('pn-csay').textContent,
      big: document.getElementById('pn-cbig').hidden ? '' : document.getElementById('pn-cbig').textContent,
      hint: document.getElementById('pn-chint').hidden ? '' : document.getElementById('pn-chint').textContent,
      src: document.getElementById('pn-csrc').textContent,
      num: document.getElementById('pn-cnum').textContent,
      btns: [...document.querySelectorAll('#pn-cbtns .btn')].map((b) => b.textContent),
      rail: [...document.querySelectorAll('#pn-rail .pn-lv')].map((e) => ({ t: e.textContent, c: e.className })),
      finHidden: document.getElementById('pn-fin').hidden,
      coachHidden: document.getElementById('pn-coach').hidden,
    }));
    await p.waitForFunction(() => document.querySelectorAll('#pn-cbtns .btn').length > 0, null, { timeout: WAIT });
    const st1 = await 这一步(p);
    const pick = await p.evaluate(() => [...document.querySelectorAll('#pn-pick .btn')].map((b) => ({ t: b.textContent, on: b.getAttribute('aria-pressed') })));
    check(`${tg}：七组都能选，默认停在第 1 组（${(G1 || {})['名字']}，他实测最弱的那一组）`,
      pick.length === 7 && pick[0].on === 'true' && pick[0].t.includes(G1['名字']), pick.map((x) => x.t.slice(0, 12)));
    check(`${tg}：顶上是**课程自己的四级练法轨**（单音 → 音素拼合 → 单词拼读 → 句子和绕口令），当前停在第 1 级`,
      st1.rail.map((x) => x.t).join('|') === '1. 单音|2. 音素拼合|3. 单词拼读|4. 句子和绕口令' && st1.rail[0].c.includes('on'), st1.rail);
    check(`${tg}：**一屏上只有一步**：第几级 + 一句指令 + 依据 + 第 n / 共 m 步，都不是空的`,
      /^第 1 级 · 单音$/.test(st1.lv) && st1.say.length > 0 && st1.src.length > 0 && /^第 1 \/ 共 \d+ 步$/.test(st1.num), st1);
    check(`${tg}：每一句底下写明依据是「课件原文」还是「课程练法」还是「机械拆分」（底线 3）`,
      /^(课件原文|课程练法|机械拆分)/.test(st1.src), st1.src.slice(0, 40));
    check(`${tg}：**四级轨四颗全看得见**（390 宽换行，不横滑把第 4 级藏到屏幕外）`,
      await p.evaluate(() => { const r = document.getElementById('pn-rail'); const b = r.getBoundingClientRect();
        return r.scrollWidth - r.clientWidth <= 1 && [...r.children].every((e) => e.getBoundingClientRect().right <= b.right + 1); }), null);
    check(`${tg}：第 1 步只有「做好了，下一步」和「🔈 念给我听」，**没有「上一步」**（退无可退就不画灰按钮）`,
      st1.btns.some((t) => t.includes('做好了')) && st1.btns.some((t) => t.includes('念给我听')) && !st1.btns.some((t) => t.includes('上一步')), st1.btns);
    check(`${tg}：**口型示意图整套撤掉了**（Amos 2026-11-12：「口型图撤掉」）`,
      await p.evaluate(() => !document.getElementById('pn-draw') && !document.getElementById('pn-anim') && document.querySelectorAll('#f-pron svg').length === 0), null);
    check(`${tg}：跟我做这一屏没有横向滚动`, await noHScroll(p), await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]));
    if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await p.locator('#f-pron').screenshot({ path: path.join(SHOTS, '发音训练-跟我做-第1级第一步-390.png') }); }

    // 点一下真的前进一步，「上一步」真的退回来（一次一句，不会自己往前跑）
    await 下一步(p);
    const st2 = await 这一步(p);
    check(`${tg}：点「做好了，下一步」真的翻到下一句（第 2 / 共 n 步，而且话换了）`,
      /^第 2 \//.test(st2.num) && st2.say !== st1.say && st2.btns.some((t) => t.includes('上一步')), { num: st2.num, say: st2.say.slice(0, 20) });
    await p.click('#pn-cbtns .btn >> text=上一步');
    const st3 = await 这一步(p);
    check(`${tg}：「上一步」真的退回刚才那一句`, st3.num === st1.num && st3.say === st1.say, { num: st3.num });

    // 镜子左边就是这一步的那句话（口型图撤掉之后它改显示文字）
    const mir = await p.evaluate(() => ({ cap: document.getElementById('pn-mircap').textContent, t: document.getElementById('pn-mirtarget').textContent,
      say: document.getElementById('pn-csay').textContent, svg: document.getElementById('pn-mirtarget').querySelectorAll('svg').length }));
    check(`${tg}：镜子左边显示的就是**这一步要做的那句话**（不是图）`, mir.t === mir.say && mir.t.length > 0 && mir.svg === 0 && mir.cap.includes('这一步要做的'), mir);

    // 走到第 3 级（单词拼读）：这一步才有 🔊 听标准音 和 🎤 我念一遍。
    // 再往后两步，落在**第 2 对**（pet）上：第 1 对（bed / bad）留给下面"第 2 步对照听"那条检查，
    // 不然这里先把它的发音取回来缓存住，那边就量不到请求了。
    for (let k = 0; k < 80 && !/第 3 级/.test((await 这一步(p)).lv); k++) await 下一步(p);
    await 下一步(p); await 下一步(p);
    const lv3 = await 这一步(p);
    check(`${tg}：第 3 级（单词拼读）这一步给 **🔊 听标准音** 和 **🎤 我念一遍**（别的级没有这两个按钮）`,
      /第 3 级 · 单词拼读/.test(lv3.lv) && lv3.btns.some((t) => t.includes('🔊 听标准音')) && lv3.btns.some((t) => t.includes('🎤 我念一遍'))
      && lv3.rail[2].c.includes('on') && lv3.rail[0].c.includes('ok'), { lv: lv3.lv, btns: lv3.btns });
    check(`${tg}：大字就是要拼的那一串（课件给的音标按符号切开，或者照着整串拼）`, lv3.big.length > 0, lv3.big);
    // 翻页时「自动念」也会去取一段语音；先等它落地再数，免得把它算进这一次 🔊
    await p.waitForTimeout(300);
    const 响前 = played.length;
    await p.click('#pn-cbtns .btn >> text=🔊 听标准音');
    await p.waitForTimeout(400);
    check(`${tg}：第 3 级的 🔊 真的点得响（那些语音已经预置进 en_audio）`, played.length > 响前, { 响前, 响后: played.length });
    if (SHOTS) await p.locator('#f-pron').screenshot({ path: path.join(SHOTS, '发音训练-跟我做-第3级带听和念-390.png') });

    // 走到第 4 级（句子和绕口令）：大字就是**课件那句绕口令**（页面不自己造内容）
    for (let k = 0; k < 80 && !/第 4 级/.test((await 这一步(p)).lv); k++) await 下一步(p);
    const lv4 = await 这一步(p);
    check(`${tg}：第 4 级第一步的大字**就是接口给的那句绕口令**，依据写明是三最法（页面不自己造内容）`,
      lv4.big === G1['绕口令'] && lv4.src.includes('三最法') && lv4.src.includes('课程练法'), { big: lv4.big, src: lv4.src.slice(0, 50) });
    check(`${tg}：绕口令这一屏没有横向滚动（整句话很长，必须换行不是横滚）`, await noHScroll(p), await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]));
    if (SHOTS) await p.locator('#f-pron').screenshot({ path: path.join(SHOTS, '发音训练-跟我做-第4级绕口令-390.png') });

    // 走完 → 收尾屏
    await 走完跟我做(p);
    const fin = await p.evaluate(() => ({ t: document.getElementById('pn-fin').innerText, coachHidden: document.getElementById('pn-coach').hidden,
      rail: [...document.querySelectorAll('#pn-rail .pn-lv')].map((e) => e.className), num: document.getElementById('pn-cnum').textContent }));
    check(`${tg}：走完最后一步给一屏收尾：照实写课程的作业标准「直到没有任何发音错误」，并说明课程没给自查方法（这正是 🎤 要补的那一处）`,
      fin.coachHidden && fin.t.includes('直到没有任何发音错误') && fin.t.includes('没有给自查的办法') && fin.t.includes('机器听成了哪个词')
      && fin.rail.every((c) => c.includes('ok')), fin);
    if (SHOTS) await p.locator('#f-pron').screenshot({ path: path.join(SHOTS, '发音训练-跟我做-收尾屏-390.png') });

    // ---- 第 2 步：对照听（+ 纠说）----
    await p.click('#pn-go2');
    await p.waitForFunction(() => !document.getElementById('pn-s2').hidden, null, { timeout: WAIT });
    const s2 = await p.evaluate(() => ({
      rows: [...document.querySelectorAll('#pn-cmp .pn-pair')].map((d) => [...d.querySelectorAll('button')].map((b) => b.textContent)),
      go3: !!document.getElementById('pn-go3').getClientRects().length,
      s3Hidden: document.getElementById('pn-s3').hidden,
      say: [...document.querySelectorAll('#pn-saywords button')].map((b) => b.textContent),
    }));
    const minimal = (G1['对'] || []).filter((q) => q['最小对立对']);
    check(`${tg}：第 2 步把这一组的 ${minimal.length} 对最小对立对都摆出来，两个词各一个 🔊 大按钮`,
      s2.rows.length === minimal.length && JSON.stringify(s2.rows[0]) === JSON.stringify(['🔊 ' + minimal[0].a['词'], '🔊 ' + minimal[0].b['词']]), s2.rows);
    check(`${tg}：**他自己点「我听出来了，开始考」才进第 3 步**（第 2 步不会自己跳过去）`, s2.go3 && s2.s3Hidden, s2);
    check(`${tg}：纠说只给**能纠说的词**（ketch 这种不是现代常用词的不给，拿它判对错是冤枉人）`,
      s2.say.length === G1['能纠说的词'].length && G1['能纠说的词'].every((w, i) => s2.say[i] === '🎤 念 ' + w) && !s2.say.join('|').includes('ketch'), s2.say);
    // 两个词都真的点得响（那些语音已经预置进 en_audio，这是他第二次之后看到的常态）
    // 同上：等前面那些「自动念」的请求落地，这一段才量得准
    await p.waitForTimeout(300);
    const mark0 = played.length;
    await p.click('#pn-cmp .pn-pair:first-child button:first-child');
    await p.click('#pn-cmp .pn-pair:first-child button:last-child');
    await p.waitForTimeout(300);
    const auMsg = await p.evaluate(() => ({ hidden: document.getElementById('pn-msg').hidden, t: document.getElementById('pn-msg').innerText }));
    check(`${tg}：第 2 步两个词都点得响（不报错），请求的就是这一对的两个音键`,
      auMsg.hidden && played.slice(mark0).join(',') === [minimal[0].a['音键'], minimal[0].b['音键']].join(','), { msg: auMsg, played: played.slice(mark0) });
    if (SHOTS) await p.locator('#f-pron').screenshot({ path: path.join(SHOTS, '发音训练-对照听-390.png') });

    // ⑦ 纠说：本地没绑 Workers AI → 走"当面说用不了"那条真路，**其余部分照常能用**
    const sayOff = await p.evaluate(async () => {
      const r = await fetch('/api/en/pron/say', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ 组: 'g1', 词: 'g1-1b', audio: 'AQIDBA==', seconds: 1 }) });
      return { status: r.status, body: await r.json() };
    });
    check(`${tg}：纠说在没绑 Workers AI 的环境里**当面说**（两句话：出错 + 怎么办），并说明其余部分照常能用`,
      sayOff.status === 503 && String(sayOff.body['出错']).includes('没有绑 Workers AI') && String(sayOff.body['怎么办']).includes('照常能用'), sayOff);
    const sayBad = await p.evaluate(async () => {
      const r = await fetch('/api/en/pron/say', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ 组: 'g1', 词: 'g1-3a', audio: 'AQIDBA==', seconds: 1 }) });
      return { status: r.status, body: await r.json() };
    });
    check(`${tg}：ketch 这类词连试都不试（400 + 说清楚为什么），不拿它冤枉人`,
      sayBad.status === 400 && String(sayBad.body['出错']).includes('不能拿来纠说'), sayBad);

    // ---- 第 3 步：考 10 题（只考这一组）----
    await p.click('#pn-go3');
    await p.waitForFunction(() => !document.getElementById('pn-s3').hidden && document.getElementById('pn-l').textContent !== '—', null, { timeout: WAIT });
    const ALL_IDS = Object.keys(WORD);
    const PAIRS1 = (G1['对'] || []).filter((q) => q['最小对立对']);
    let 对 = 0, 第一题答错 = null;
    played.length = 0;
    for (let k = 0; k < 10; k++) {
      if (k > 0) await p.waitForFunction((n) => /^第 /.test(document.getElementById('pn-where').textContent) && document.getElementById('pn-where').textContent.indexOf('第 ' + n + ' 题') === 0, k + 1, { timeout: WAIT });
      await p.waitForFunction(() => document.getElementById('pn-res').hidden && document.getElementById('pn-l').textContent !== '—', null, { timeout: WAIT });
      const st = await p.evaluate(() => ({ where: document.getElementById('pn-where').textContent, l: document.getElementById('pn-l').textContent, r: document.getElementById('pn-r').textContent,
        html: document.getElementById('pn-s3').outerHTML, body: document.getElementById('pn-s3').innerText, say: document.getElementById('pn-again1').textContent }));
      // Math.random 钉死以后：放的永远是这一对的 a，左边那个按钮也永远是 a
      const q = PAIRS1.find((x) => x.a['词'] === st.l && x.b['词'] === st.r);
      const word = st.l;
      const 出现 = (t, w) => (t.match(new RegExp('(^|[^A-Za-z])' + w + '([^A-Za-z]|$)', 'g')) ?? []).length;
      check(`${tg}：第 ${k + 1} 题揭晓前找不到"放的是哪个词"（HTML 里没有编号、🔊 上只有「再听一次」、那个词只作为两个选项之一出现一次）`,
        ALL_IDS.every((x) => !st.html.includes(x)) && st.say === '🔊 再听一次' && 出现(st.body, word) === 1,
        { where: st.where, 有编号: ALL_IDS.filter((x) => st.html.includes(x)), 出现几次: 出现(st.body, word) });
      check(`${tg}：第 ${k + 1} 题**还在这一组里**（10 题只考 ${G1['名字']} 的最小对立对，不换别的音）`, !!q, { l: st.l, r: st.r });
      // 进这一题会自动放一次。**点过的那一段页面存着复用**（不再跑一趟接口、不再花一次钱），
      // 所以这里不数请求数，只要求"没有报错"——取不回来时报错框会当面显示（上面第 2 步那条已经量过真的取得回来）。
      if (k === 0) check(`${tg}：进这一题自动放音，没有报错（取过的那一段直接复用，不重复花钱）`,
        await p.evaluate(() => document.getElementById('pn-msg').hidden), await p.evaluate(() => document.getElementById('pn-msg').innerText));
      // 第 1 题故意答错（要量"答错当场把对照听塞回来"），其余答对
      if (k === 0) 第一题答错 = { word, pair: q }; else 对++;
      await p.click(k === 0 ? '#pn-r' : '#pn-l');
      await p.waitForFunction(() => !document.getElementById('pn-res').hidden, null, { timeout: WAIT });
      const rs = await p.evaluate(() => ({ ver: document.getElementById('pn-ver').textContent, backHidden: document.getElementById('pn-back').hidden, back: document.getElementById('pn-back').textContent,
        wa: document.getElementById('pn-wa').textContent, wb: document.getElementById('pn-wb').textContent, ipa: document.getElementById('pn-ipa').textContent,
        next: document.getElementById('pn-next').textContent, h: Math.round(document.getElementById('pn-wa').getBoundingClientRect().height) }));
      check(`${tg}：第 ${k + 1} 题答完当场给对错，并**点名刚才放的是 ${word}**（${rs.ver.slice(0, 24)}）`,
        rs.ver.includes(word) && (k === 0 ? rs.ver.startsWith('❌ 不对') : rs.ver.startsWith('✅ 对了')), rs.ver);
      check(`${tg}：第 ${k + 1} 题答完，两个词各一个按钮能单独点来听（≥52px）+ 一行两个音标`,
        rs.wa === '🔊 ' + q.a['词'] && rs.wb === '🔊 ' + q.b['词'] && rs.h >= 52 && rs.ipa.includes(q.a['音标']) && rs.ipa.includes(q.b['音标']), rs);
      if (k === 0) {
        // ④ 答错：当场把第 2 步的对照听塞回来，**他听完点「继续」才出下一题**
        check(`${tg}：答错当场把第 2 步的对照听塞回来（一句话写明"先回到对照听"），两个词都能点`,
          !rs.backHidden && rs.back.includes('对照听') && rs.next === '继续', { back: rs.back, next: rs.next });
        const m0 = played.length;
        await p.click('#pn-wa'); await p.click('#pn-wb');
        await p.waitForTimeout(300);
        const m = await p.evaluate(() => ({ hidden: document.getElementById('pn-msg').hidden }));
        // 点过的那一段页面会存下来复用（不再跑一趟接口、不再花一次钱），所以这里只要求"不报错 + 至少有一段是现取的"
        check(`${tg}：答错后那两个词真的点得响（学就发生在这一刻），而且取过的那一段不再重复取`, m.hidden && played.length - m0 <= 2, { msg: m, 新取: played.length - m0 });
        check(`${tg}：答错这一态没有横向滚动`, await noHScroll(p), await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]));
        if (SHOTS) await p.locator('#f-pron').screenshot({ path: path.join(SHOTS, '发音训练-答错回到对照听-390.png') });
      } else {
        check(`${tg}：第 ${k + 1} 题答对时不强塞对照听（只有答错 / 分不出来才塞）`, rs.backHidden, rs.back);
      }
      await p.click('#pn-next');
    }

    // ---- 第 4 步：过关 + 绕口令 ----
    await p.waitForFunction(() => !document.getElementById('pn-s4').hidden, null, { timeout: WAIT });
    const s4 = await p.evaluate(async () => {
      const g = (i) => document.getElementById(i);
      const j = await (await fetch('/api/en/pron/state')).json();
      return { score: g('pn-score').textContent, line: g('pn-line').textContent, tw: g('pn-tw').textContent, how: g('pn-how').textContent,
        twHidden: g('pn-twwrap').hidden, wrong: g('pn-wrong').innerText, wrongHidden: g('pn-wrongwrap').hidden,
        again: g('pn-again2').textContent, h: Math.round(g('pn-again2').getBoundingClientRect().height), 记录: j['记录'] };
    });
    const rec = (s4.记录 || []).find((x) => x['组'] === 'g1') || {};
    check(`${tg}：10 题对 ${对} 题 → **过关**（80% 的及格线），小结第一行写明分数`, s4.score.includes('过关了') && s4.score.includes('对 ' + 对 + ' 题'), s4.score);
    check(`${tg}：过关才给**课件那句绕口令**，并写明用三最法读（最大声、最清晰、最慢速）`,
      !s4.twHidden && s4.tw === G1['绕口令'] && s4.how.includes('最大声') && s4.how.includes('最清晰') && s4.how.includes('最慢速') && s4.how.includes('没有任何发音错误'), { tw: s4.tw, how: s4.how });
    check(`${tg}：答错的那一对单独列出来（${(第一题答错 || {}).word}）`,
      !s4.wrongHidden && s4.wrong.includes(第一题答错.pair.a['词']) && s4.wrong.includes(第一题答错.pair.b['词']), s4.wrong);
    check(`${tg}：服务器上真的记了这一轮（考过 1 轮、对 ${对} 题、过关）`,
      rec['考过几轮'] === 1 && rec['过关几轮'] === 1 && rec['最近一轮'] && rec['最近一轮']['对'] === 对 && rec['最近一轮']['过关'] === true, rec);
    check(`${tg}：过关页有大按钮「再考一轮」（${s4.h}px ≥ 52）`, s4.again === '再考一轮' && s4.h >= 52, s4);
    check(`${tg}：过关这一屏没有横向滚动`, await noHScroll(p), await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]));
    if (SHOTS) { await p.evaluate(() => document.getElementById('f-pron').scrollIntoView({ block: 'start' })); await p.waitForTimeout(150); await p.locator('#f-pron').screenshot({ path: path.join(SHOTS, '发音训练-过关绕口令-390.png') }); }
    // 刷新后记录还在（存在服务器上，不在浏览器里）
    await p.reload();
    await p.waitForSelector('#app:not([hidden])', { timeout: WAIT });
    await waitFor(p, '#f-pron');
    await p.waitForFunction(() => /过关过/.test(document.getElementById('pn-lead-t').textContent), null, { timeout: WAIT }).catch(() => {});
    check(`${tg}：刷新后这一组的记录还在（一句话结论写"七组里过关过 1 组"）`, /过关过 1 组/.test(await txt(p, '#pn-lead')), await txt(p, '#pn-lead'));

    // ⑥ 第 7 组：课件一条口型都没给 → 那一步不许说"保持这个口型"；照实说只能跟读和纠说，连「开始考」都不给
    await p.click('#pn-pick .btn:nth-child(7)');
    await p.waitForFunction(() => /^第 1 \//.test(document.getElementById('pn-cnum').textContent), null, { timeout: WAIT });
    const g7a = await p.evaluate(() => {
      const 话 = [];
      for (let k = 0; k < 80; k++) {
        话.push({ say: document.getElementById('pn-csay').textContent, hint: document.getElementById('pn-chint').hidden ? '' : document.getElementById('pn-chint').textContent });
        if (!document.getElementById('pn-fin').hidden) break;
        document.querySelector('#pn-cbtns .btn.go').click();
      }
      return 话;
    });
    check(`${tg}：第 7 组课件一条口型都没给 → **跟我做里一句"保持这个口型"都不许出现**，而且照实说没法对着镜子做（底线 3）`,
      g7a.every((x) => !x.say.includes('保持这个口型')) && g7a.some((x) => x.hint.includes('没有口型定位') && x.hint.includes('没法对着镜子做')), g7a.slice(0, 3));
    await p.click('#pn-go2');
    await p.waitForFunction(() => !document.getElementById('pn-s2').hidden, null, { timeout: WAIT });
    const g7b = await p.evaluate(() => ({ go3: !!document.getElementById('pn-go3').getClientRects().length, note: document.getElementById('pn-note2').textContent,
      rows: document.querySelectorAll('#pn-cmp .pn-pair').length, say: [...document.querySelectorAll('#pn-saywords button')].map((b) => b.textContent) }));
    check(`${tg}：第 7 组**不给「开始考」这个按钮**（不硬凑题），但跟读和纠说照常有`,
      g7b.go3 === false && g7b.rows === 4 && g7b.say.length > 0, g7b);
    check(`${tg}：第 7 组（/ʒ/ vs /dʒ/）照实说"一对最小对立对都没有、只能走「跟我做」跟读和纠说"`,
      g7b.note.includes('一对最小对立对都没有') && g7b.note.includes('只能走「跟我做」、跟读和纠说'), g7b.note);

    // ⑦ 浏览器不支持录音时也当面说（另开一个把 mediaDevices 拿掉的页面来量）
    const p2 = await open({ width: 390, height: 844 });
    await p2.addInitScript(() => { Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true }); });
    await login(p2, '/#/Practical/pron');
    await waitFor(p2, '#f-pron');
    await p2.waitForFunction(() => document.querySelectorAll('#pn-cbtns .btn').length > 0, null, { timeout: WAIT });
    await 走完跟我做(p2);
    await p2.click('#pn-go2');
    await p2.waitForFunction(() => !document.getElementById('pn-s2').hidden, null, { timeout: WAIT });
    await p2.click('#pn-saywords button');
    await p2.waitForFunction(() => !document.getElementById('pn-saymsg').hidden, null, { timeout: WAIT }).catch(() => {});
    const noMic = await p2.evaluate(() => ({ t: document.getElementById('pn-saymsg').innerText, hidden: document.getElementById('pn-saymsg').hidden,
      cmp: document.querySelectorAll('#pn-cmp .pn-pair button').length, go3: !!document.getElementById('pn-go3').getClientRects().length }));
    check(`${tg}：浏览器录不了音时**当面说**，而且跟我做、对照听、考题照常能用（纠说是加分项，不是前置条件）`,
      !noMic.hidden && noMic.t.includes('不支持录音') && noMic.t.includes('怎么办：') && noMic.cmp === 8 && noMic.go3, noMic);
    await p2.context().close();
    await p.context().close();
  });

  // ---------- 16. 照镜子 + 慢速对照和录音回放（2026-11-11）----------
  // Amos 原话：「有些发音我很难理解　你要给我做成教学视频」。真人视频拍不了、AI 生成的"会动的嘴"是编的不能做，
  // 改提三样，他回「都要，按这个顺序做」：①口型示意图 + 动画（**2026-11-12 整套撤掉**，他说「口型图撤掉」）
  // ②**前置摄像头当镜子**（留着，左边改成显示当前这一步的那句指令）③慢速对照 + 他自己的录音回放。
  // ⚠️ 摄像头和麦克风在无头环境里只能用**假的媒体流**（Chromium 的 --use-fake-device-for-media-stream）：
  //    这一段量的是**界面、流程、画面有没有被送出去、关掉时摄像头有没有真的灭**；
  //    "他自己的脸在屏幕上好不好对着做"只有他本人第一次用才算验过（报告里照实写，底线 9）。
  await section('发音训练·照镜子和录音回放', async () => {
    const cam = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
    try {
      const ctx = await cam.newContext({ viewport: { width: 390, height: 844 } });
      await ctx.grantPermissions(['camera', 'microphone'], { origin: BASE });
      const q = await ctx.newPage();
      q.on('pageerror', (e) => errors.push(e.message));
      const net = [];
      q.on('request', (r) => net.push(r.method() + ' ' + new URL(r.url()).pathname));
      // 把摄像头拿到的轨道记下来：关掉镜子之后它们必须是 ended（= 指示灯灭）
      await q.addInitScript(() => {
        window.__tracks = [];
        const md = navigator.mediaDevices;
        const o = md.getUserMedia.bind(md);
        md.getUserMedia = (c) => o(c).then((s) => { s.getTracks().forEach((t) => window.__tracks.push(t)); return s; });
      });
      await login(q, '/#/Practical/pron');
      await waitFor(q, '#f-pron');
      await q.waitForFunction(() => document.querySelectorAll('#pn-cbtns .btn').length > 0, null, { timeout: WAIT });
      const tg = '390 宽·假媒体流';

      // ---- ② 照镜子 ----
      const n0 = net.length;
      await q.click('#pn-mir');
      await q.waitForFunction(() => !document.getElementById('pn-mirwrap').hidden, null, { timeout: 8000 });
      await q.waitForFunction(() => { const v = document.getElementById('pn-cam'); return !!v && v.videoWidth > 0; }, null, { timeout: 8000 });
      const m = await q.evaluate(() => {
        const v = document.getElementById('pn-cam'), t = document.getElementById('pn-mirtarget');
        // 并排看的是**两个格子**（图和视频下面的说明行数不一样，所以不比图和视频自己的顶端）
        const a = t.closest('.pn-mircell').getBoundingClientRect(), b = v.closest('.pn-mircell').getBoundingClientRect();
        return { 有流: !!v.srcObject, w: v.videoWidth, 轨道: (window.__tracks || []).map((x) => x.readyState),
          这一句: t.textContent, 屏上那句: document.getElementById('pn-csay').textContent, 图: t.querySelectorAll('svg').length,
          cap: document.getElementById('pn-mircap').textContent,
          左: Math.round(a.left), 右: Math.round(b.left), 同一行: Math.abs(Math.round(a.top) - Math.round(b.top)) <= 2,
          隐私: document.querySelector('#pn-mirwrap .pn-privacy').textContent };
      });
      check(`${tg}：照镜子 —— 摄像头画面真的出来了，**左边是这一步要做的那句话、右边是他自己的嘴**（并排）`,
        m.有流 && m.w > 0 && m.图 === 0 && m.这一句.length > 0 && m.这一句 === m.屏上那句 && m.右 > m.左 && m.同一行 && m.轨道.every((x) => x === 'live'), m);
      check(`${tg}：**镜子开着这段时间一个请求都没往外发**（画面不上传、不保存、不录）`, net.slice(n0).length === 0, net.slice(n0));
      check(`${tg}：界面上当面写明"这个画面不会离开你的手机"`,
        m.隐私.includes('不会离开你的手机') && m.隐私.includes('不上传') && m.隐私.includes('不保存'), m.隐私);
      check(`${tg}：镜子左边标着这是第几步要做的`, m.cap.includes('这一步要做的'), m.cap);
      if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await q.locator('#f-pron').screenshot({ path: path.join(SHOTS, '发音训练-镜子开着-390.png') }); }
      const n1 = net.length;
      await q.click('#pn-miroff');
      const off = await q.evaluate(() => ({ 没流: document.getElementById('pn-cam').srcObject === null,
        轨道: (window.__tracks || []).map((x) => x.readyState), hidden: document.getElementById('pn-mirwrap').hidden }));
      check(`${tg}：「关掉镜子」真的把摄像头关了（轨道 ended，手机上的指示灯才会灭）`,
        off.没流 && off.轨道.length > 0 && off.轨道.every((x) => x === 'ended') && off.hidden, off);
      check(`${tg}：关镜子也没往外发任何东西`, net.slice(n1).length === 0, net.slice(n1));

      // ---- ③ 慢速对照 + 他自己的录音回放 ----
      // 「去对照听」现在在跟我做走完那一屏上，先把这一组走完
      for (let k = 0; k < 80 && await q.evaluate(() => document.getElementById('pn-fin').hidden); k++) await q.click('#pn-cbtns .btn.go');
      await q.click('#pn-go2');
      await q.waitForFunction(() => !document.getElementById('pn-s2').hidden, null, { timeout: WAIT });
      check(`${tg}：**没录过就不显示**那几个按钮（不画占位、不画灰按钮）`, await q.evaluate(() => document.getElementById('pn-my').hidden), null);
      const mic = q.locator('#pn-saywords button').first();
      await mic.click();
      await q.waitForFunction(() => /停止/.test(document.querySelector('#pn-saywords button').textContent), null, { timeout: 8000 });
      await q.waitForTimeout(900); // 真的录一段（假麦克风）
      await mic.click();
      await q.waitForFunction(() => !document.getElementById('pn-my').hidden, null, { timeout: 8000 });
      // 回放区出现 ≠ 纠说那一路已经回来：录音是本地就有的，而"没绑 Workers AI"那句是接口回来才写上去的。
      // 不等这一句就读 #pn-saymsg，大多数时候读到的是空字符串 —— 2026-11-13 这条就是这么随机红的。
      // 本地一定没有 AI 绑定，所以这句必然出现，等它是确定的，不是靠 sleep 碰运气。
      await q.waitForFunction(() => (document.getElementById('pn-saymsg').innerText || '').trim().length > 0, null, { timeout: 15000 });
      const my = await q.evaluate(() => ({ std: document.getElementById('pn-std').textContent, mine: document.getElementById('pn-mine').textContent,
        slow: document.getElementById('pn-slow').textContent, chain: document.getElementById('pn-chain').textContent,
        t: document.getElementById('pn-my-t').textContent, note: document.querySelector('#pn-my .pn-saynote').textContent,
        h: Math.round(document.getElementById('pn-chain').getBoundingClientRect().height),
        say: document.getElementById('pn-saymsg').innerText }));
      check(`${tg}：录完之后才出现四个大按钮：标准音 / 我刚才念的 / 慢速 0.7 倍 / 连着放（${my.h}px ≥ 52）`,
        my.std === '🔊 标准音' && my.mine === '🎧 我刚才念的' && my.slow.includes('慢速 0.7 倍') && my.chain === '▶ 连着放' && my.h >= 52, my);
      check(`${tg}：**纠说这一次失败了（本地没绑 Workers AI），录音照样留着能回放**`, my.say.includes('没有绑 Workers AI') && my.t.includes('你刚才念的'), { say: my.say.slice(0, 40), t: my.t });
      check(`${tg}：页面上照实说这段录音不另外上传、刷新就没了`, my.note.includes('不另外上传') && my.note.includes('刷新页面就没了'), my.note.slice(0, 60));
      await q.click('#pn-slow');
      await q.click('#pn-chain');
      await q.waitForTimeout(900);
      const 放 = await q.evaluate(() => ({ 慢: document.getElementById('pn-slow').getAttribute('aria-pressed'),
        字: document.getElementById('pn-slow').textContent, 错: document.getElementById('pn-msg').hidden, t: document.getElementById('pn-msg').innerText }));
      check(`${tg}：慢速按下去是按着的状态，「连着放」点下去不报错（标准音 → 停 0.3 秒 → 他的录音）`,
        放.慢 === 'true' && 放.字.includes('慢速开着') && 放.错, 放);
      check(`${tg}：这一屏没有横向滚动`, await noHScroll(q), await q.evaluate(() => [document.documentElement.scrollWidth, innerWidth]));
      // 整块自己也不许横着溢出（按钮上的字长了会把 1fr 1fr 的格子撑开，页面级的横滚未必量得到）
      const 溢 = await q.evaluate(() => ['f-pron', 'pn-my', 'pn-mirwrap', 'pn-coach', 'pn-rail'].map((id) => { const e = document.getElementById(id); return [id, e.scrollWidth - e.clientWidth]; }));
      check(`${tg}：发音训练这一块里没有任何一行横着溢出（跟我做那张卡、四级轨、镜子、回放都量过）`, 溢.every(([, d]) => d <= 1), 溢);
      if (SHOTS) await q.locator('#pn-say').screenshot({ path: path.join(SHOTS, '发音训练-对照听连着放-390.png') });
      await ctx.close();
    } finally { await cam.close(); }
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
