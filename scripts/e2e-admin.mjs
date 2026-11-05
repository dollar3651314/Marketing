#!/usr/bin/env node
/**
 * 网页后台的浏览器级自动测试（agents C141）：本地用 wrangler dev 起真正的服务（本地 D1，跑全部迁移），在真浏览器里走一遍。
 *   node scripts/e2e-admin.mjs                 # CI 里跑这个
 *   node scripts/e2e-admin.mjs --shots <目录>   # 另外存公司页截图（深色 1920、1280、390 宽，浅色 1280 宽；样例数据是原型和 2026-11-01 Amos 截图里的真实文字）
 * 覆盖：登录 → 公司页"还没收到数据" → 用推送接口塞一份样例 → 各块渲染、更新于几小时前 →
 * 超过 7 天变灰 → "还没开通"、读不到 → 切回清单、用量、插件下载三页正常；手机不横向滚动；全程没有脚本错误。
 * 改版批 C（2026-11-05，Amos"第三批选 a，开始吧"；测试会话按已批准口径改，研发不改断言）：公司总览只留工作台没有的三块——
 *   #co-people（各岗位这周）→ #co-learn（这周学到了什么）→ #co-health（做得怎么样）；去掉"需要我的事"（#co-need、摘要格子 .tile、"我做了"）、
 *   项目表 #co-projects、下周 #co-next（工作台有项目概况、经营会；待办只看工作台）。顶栏按钮和页面标题叫"公司总览"。
 *   原来这里测的"我做了"处理中 / 成功 / 失败 / 取消 / 迟到的读、项目表版面（2026-11-01 截图变形）、解析失败、要你决定的 PR、切换周报，随模块一起去掉；
 *   /api/company/done 接口本身仍由 test/company.test.ts 守。新样式（卡片、一句话结论、折叠说明、子菜单、字号、对比度……）的断言在 scripts/e2e-platform.mjs 第 12 段。
 * 任何一条不符就以非 0 退出。密码和令牌是只给这个测试用的假值，不是线上的。
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { waitForServer } from './e2e-server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK = path.join(ROOT, '.wrangler/e2e-admin');
const PASS = 'e2e_only_password_0123';
const TOKEN = 'e2e_only_company_token_0123456789abcdef';
const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > 0 ? path.resolve(process.argv[shotsAt + 1]) : '';
const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : '：实际 ' + JSON.stringify(got)}`); if (!ok) fails.push(name); };

// ---- 本地服务：wrangler dev + 本地 D1（每次从空库开始） ----
if (!existsSync(path.join(ROOT, 'src/generated/extension.ts'))) execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-ext-zip.mjs')], { cwd: ROOT, stdio: 'inherit' });
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
writeFileSync(path.join(WORK, 'wrangler.toml'), [
  'name = "marketing-e2e"', 'main = "../../src/index.ts"', 'compatibility_date = "2026-10-01"',
  '[[d1_databases]]', 'binding = "DB"', 'database_name = "marketing-e2e"', 'database_id = "local-only"', 'migrations_dir = "../../migrations"', '',
].join('\n'));
const WRANGLER = path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js');
const wenv = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' };
const cfg = ['--config', path.join(WORK, 'wrangler.toml'), '--persist-to', path.join(WORK, 'state')];
execFileSync(process.execPath, [WRANGLER, 'd1', 'migrations', 'apply', 'DB', '--local', ...cfg], { cwd: ROOT, env: wenv, stdio: 'pipe' });
// 端口交给 workerd 自己要（--port 0）、按条件等就绪：原因和 CI 实例见 scripts/e2e-server.mjs 的 waitForServer
const dev = spawn(process.execPath, [WRANGLER, 'dev', ...cfg, '--port', '0', '--ip', '127.0.0.1', '--var', `COPILOT_PASSWORD:${PASS}`, '--var', `COMPANY_INGEST_TOKEN:${TOKEN}`], { cwd: ROOT, env: wenv, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const stopDev = () => { try { process.kill(-dev.pid, 'SIGTERM'); } catch { /* 已经停了 */ } };
process.on('exit', stopDev);
const BASE = await waitForServer(dev, { name: 'e2e-admin', stop: stopDev });

// ---- 样例数据：原型（2026-11-01 17:30 agents 的真实文件）里的数字 ----
const H = 3600_000, DAY = 24 * H;
const now = Date.now();
const at = now - 2 * H;
const ingest = async (source, blocks) => {
  const r = await fetch(BASE + '/api/company/ingest', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ source, blocks }) });
  if (!r.ok) throw new Error(`推送失败 ${r.status} ${await r.text()}`);
};
const GH = 'https://github.com/dollar3651314/agents/blob/main/';
const AGENTS = [
  { kind: 'todo', key: 'forecast', source_at: at, payload: { product: 'forecast', items: [
    { id: 'M1', type: 'confirm', level: 'L3', text: '预热什么时候恢复、怎么恢复（A 11/8 起每周一包 / B 明天恢复 / C 继续停）', hint: '经营会 2026-11-01 · 建议 A', link: GH + '经营/经营会/2026-11-01.md', link_text: '看议程' },
    { id: 'M2', type: 'confirm', level: 'L3', text: 'forecast 内测版：5～10 个内测用户人选、开始日期', hint: '建议 12/1 开内测', link: GH + '项目/forecast/状态卡.md', link_text: '看状态卡' },
    { id: 'M3', type: 'confirm', level: 'L3', text: '英语学习网站并行：什么时候做开局沟通', hint: '建议 11/8 重构完成后', link: GH + '经营/经营会/2026-11-01.md', link_text: '看议程' },
    { id: 'M5', type: 'confirm', level: 'L3', text: '第一批学习 8 条：今天过还是 11/7 过', link: GH + 'v0.31-附1-岗位重构方案.md', link_text: '看 8 条' },
    { id: 'M6', type: 'confirm', level: 'L3', text: '周报每周六 17:00 发对话，要不要推送提醒' },
    { id: 'T2', type: 'action', text: '官网：用真实邮箱走一遍（留邮箱 → 确认信 → 名单页看到自己）', hint: 'Amos 待办 · 10/29 起 3 天', link: 'https://www.quickcome.online', link_text: '打开官网' },
    { id: 'T3', type: 'action', text: 'X、Threads 简介加官网链接' },
    { id: 'T4', type: 'action', text: '发置顶帖并置顶（L-1 已确认）', hint: '预热暂停中，恢复时一起做', link: GH + '项目/forecast/BC-可行性预热/运行记录/2026-10-29-置顶帖.md', link_text: '看文案' },
    { type: 'report', text: '两个号的关注数、名单页数字（上次回报 10/29：X 2、Threads 1）' },
  ] } },
  // 项目和状态卡：2026-11-01 晚 agents main 的真实输出（Amos 截图里变形的那份：整句数字、"本周"是全部决定、阶段取的是项目版图）
  { kind: 'projects', key: '', source_at: at, payload: { version: 'v1.3.1', items: [
    { name: '报价', stage: '待开局沟通（C116）' },
    { name: '支付', stage: '未开始' },
    { name: 'forecast', sub: '预测（forecast）', stage: '开局沟通（产品/forecast/）' },
    { name: 'Marketing', sub: 'Marketing（社媒副驾驶）', stage: 'D 完成，准备上正式版（产品/marketing/）' },
    { name: '交易（falconx-lite）', stage: '暂停' },
    { name: '代付（amospayment）', stage: '暂停' },
  ] } },
  { kind: 'status', key: 'forecast', source_at: at, payload: { product: 'forecast', state: 'B + C', level: 'warn',
    week: 'D-1：第一笔收入走"小范围内测版"路线——1.0 先给 5～10 个熟人用（含 Amos），不等 100 人名单；阶段计划要按这个改（还没改）；D-2：合规问题 Amos 已自己处理完，团队不再做合规清单；D-3：数字目标"2026-12-31 前第一笔真实抽成"；预热内容包（A6）、下周日历（A3）、周报（A4）暂停（Amos："咱们先暂停一下"），4 个定时任务已关；改造后改成每周一包、1 个定时任务；D-8（英语学习网站是否并行）Amos 还在考虑，"很大概率想并行"；D-5：经营会周六 20:00（首次 11/1 周日 20:00），周二、四 20:00 操作窗口；全员复盘并入经营会；岗位重构的 R-1～R-5（不是审核规则 R-1/R-2；岗位重构、经验体系、agency-agents 8 条、协作总则一起拆、7 个 PR）、B-1～B-4（仪表盘场景清单；B-4 直接上正式版）都按建议',
    metrics: [
      { name: '第一笔真实抽成', now: '没有', target: '2026-12-31 前（D-3）' },
      { name: '等候名单确认订阅', now: '未取到（Amos 还没回报名单页数字）', target: '原验证指标 ≥ 100' },
      { name: 'X + Threads 关注合计', now: '3（X 2、Threads 1，Amos 2026-10-29 回报）', target: '原验证指标 ≥ 50', pct: 6 },
      { name: '愿意内测', now: '0', target: '≥ 5', pct: 0 },
      { name: '长数字（不换行的整串）', now: 'https://www.quickcome.online/waitlist?ref=x-threads-2026-10-29-confirmed-subscribers-count', target: '≥ 100' },
    ] } },
  { kind: 'status', key: 'Marketing', source_at: at, payload: { product: 'Marketing', state: 'E 上线运营', level: 'mute',
    week: 'M-6 运营仪表盘：场景清单 v0.2（B-1～B-4 按建议，B-4 直接上正式版）、原型确认、技术方案 v0.3（推送模型；B-6 不要定时兜底，只靠合并和开关 PR 触发）；C144：已上线项目的需求先给 Amos 看计划，由他决定走测试环境还是直接上生产',
    metrics: [{ name: '副驾驶插件版本', now: '0.3.5（后台"插件下载"可下载）' }, { name: '跟帖评论清单', now: '22 条（10/30 搬数据时），已回 2 条（10/30 上午 Amos 截图）' }, { name: '正式版健康检查', now: 'copilot ok、admin ok（10/30）' }] } },
  { kind: 'status', key: '公司（agents）', source_at: at, payload: { product: '公司（agents）', state: '重构中', level: 'warn', week: 'v0.31 方案确认；forecast 文件夹试拆；六岗位 + 协作总则重构进行中（7 个分支）',
    metrics: [{ name: '规则', now: 'C144 · 协作总则 v0.30' }, { name: '开工读', now: '13 万字', target: '≤3 万' }] } },
  ...[
    ['产品', '阶段计划、使用场景清单（副驾驶、仪表盘）、项目版图 v1.3.1', '阶段计划按 D-1 改；仪表盘原型', 2],
    ['市场', '10 个时段内容包、R-1/R-2、经验库 E5、公司化方案', '每周一包的模板；第一批学习', 3],
    ['研发', '副驾驶 0.1→0.3.5、Marketing 正式版、插件下载、搬数据脚本', '岗位重构；仪表盘技术方案', 2],
    ['测试', '33 个单元测试、插件浏览器级测试进 CI、CI 系统固定 24.04', '第二个会话核对"没丢"', 1],
    ['运维安全', 'Worker 改名、域名切换、旧环境下线、分支保护', '定时任务 4→1、路径改新', 2],
  ].map(([role, done, next, mistakes]) => ({ kind: 'handoff', key: role, source_at: at, payload: { role, date: '2026-11-01', done, next, mistakes } })),
  ...[
    ['测试', '默认 NEEDS WORK，没截图证据不算通过；标出没测到的范围'],
    ['研发', '只改被要求的，"顺手改"另开任务；评审分 🔴🟡🟢 三级'],
    ['运维安全', '泄露的密钥从提交那刻起就算烧掉，先在提供方轮换'],
    ['市场', '每条结论带 URL、时间戳、样本窗口；观察和解读分开标'],
    ['经营', '纪要四段：决定 / 待办（有主人）/ 未决 / 出席'],
  ].map(([role, title]) => ({ kind: 'learning', key: role, source_at: at, payload: { role, note: '来源 agency-agents · 11/7 过', items: [{ title }] } })),
  { kind: 'weekly', key: '2026-11-01', source_at: at, payload: { title: '第 1 期', range: '11/2～11/8', rules: 'C144 · 协作总则 v0.30', cost: '0 元（Claude 用量待你填）', mistakes: 10,
    highlights: [{ until: '2026-12-31', label: '离 12/31 第一笔抽成' }, { value: '88', label: '本周合并 PR · 3 个仓库' }, { value: '0 元', label: '本周现金成本 · Claude 用量待你填' }],
    next: [
      { what: '规则索引 C1～C144（搬家对账单）', who: '全体', when: '11/2', status: '进行中' },
      { what: '六岗位 + 协作总则重构，7 个 PR', who: '各岗位', when: '11/2～11/6', status: '进行中' },
      { what: '仪表盘技术方案 + 原型', who: '研发、产品', when: '11/5', status: '进行中' },
      { what: 'forecast 阶段计划改内测版路线', who: '产品', when: '11/4', status: '未开始' },
      { what: '第二个会话核对"没丢"', who: '测试', when: '11/6', status: '未开始' },
      { what: '第 2 次经营会', who: 'Amos + 全体', when: '11/7 20:00', status: '—' },
    ] } },
  { kind: 'ci', key: '', source_at: at, payload: { conclusion: 'none', sha: 'b732e9e', at: Date.parse('2026-11-01T09:00:00+08:00'), note: '字典式目录检查待进 CI' } },
  { kind: 'ci', key: '定时任务（预热 ×4）', source_at: at, payload: { conclusion: 'off', note: 'Amos 11/1 暂停；恢复前改路径' } },
];

const browser = await chromium.launch();
const errors = [];
async function open(viewport, colorScheme = 'light') {
  const page = await (await browser.newContext({ viewport, colorScheme })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  return page;
}
const visible = (page, sel) => page.locator(sel).isVisible();
const text = (page, sel) => page.locator(sel).first().innerText();
async function login(page) {
  await page.goto(BASE + '/');
  await page.fill('#pw', PASS);
  await page.click('#go');
  await page.waitForSelector('#app:not([hidden])');
}
/**
 * 点顶栏的"公司总览"（#conav）/"登出"（#logout）。改版批 A（2026-11-04，照原型）：≤640px 时这两项收进顶栏的"···"（details#more-menu），
 * 先点开 #more-menu > summary（用户也是这样点）再点；>640px 照旧直接点。
 * 窄屏还没有 #more-menu 时（改版前的代码）照旧直接点，让后面的断言接着跑；这种情况由第 7 段"≤640px 时 #conav 在 #more-menu 里"那条断言报红。
 */
async function clickTop(page, sel) {
  const narrow = page.viewportSize().width <= 640;
  if (narrow && (await page.locator('#more-menu > summary').count()) && !(await page.evaluate(() => document.getElementById('more-menu').open))) await page.click('#more-menu > summary');
  await page.click(sel);
}
// 批 C 去掉：项目表的版面量法 projLayout / MIN_COLS / checkProjects（#co-projects 随口径去掉）
/** 一行：表格的 tbody tr，或列表的 li（批 C：手机上可以改成列表，条数口径不变） */
const ROWS = ':is(tbody tr, li)';
async function refresh(page) { await page.click('#co-refresh'); await page.waitForFunction(() => document.getElementById('co-refresh').textContent === '刷新'); }

try {
  const page = await open({ width: 1280, height: 900 });
  await login(page);
  // 公司平台批 1（P-9）起登录后默认是工作台（原来是清单页）；公司总览入口还是顶栏的 #conav（批 C 起按钮文字是"公司总览"，文字的断言在 e2e-platform 第 12 段）
  check('登录后在工作台，顶栏有"公司总览"入口 #conav', (await visible(page, '#v-work')) && !(await visible(page, '#v-list')) && (await visible(page, '#conav')), null);

  // 1. 还没有数据
  // 批 C 改：改前 waitForSelector('#co-need')、标题 === '公司'；改后等 #co-people（"需要我的事"去掉了）、标题 === '公司总览'（和按钮同名）
  await page.click('#conav');
  await page.waitForSelector('#co-people');
  check('公司页：标题"公司总览"、其他三页隐藏', (await text(page, '#title')) === '公司总览' && !(await visible(page, '#v-list')) && !(await visible(page, '#v-usage')) && !(await visible(page, '#v-ext')), await text(page, '#title'));
  // 批 C 改：改前 6 块（需要我的事、项目、岗位、学习、下周、做得怎么样）；改后只留 3 块（岗位、学习、做得怎么样）
  check('没数据：3 块（岗位、学习、做得怎么样）都显示"还没收到数据"', (await page.locator('#v-company .co-empty', { hasText: '还没收到数据' }).count()) === 3, await page.locator('#v-company .co-empty').allInnerTexts());

  // 2. 塞样例 → 刷新 → 各块
  await ingest('agents', AGENTS);
  await ingest('marketing', [{ kind: 'ci', source_at: at, payload: { conclusion: 'success', sha: 'e161069', at: Date.parse('2026-10-30T20:00:00+08:00'), note: '正式版 /health ok' } }]);
  await ingest('new-forecast', [{ kind: 'ci', source_at: at, payload: { conclusion: 'success', sha: 'f534f23', at: Date.parse('2026-10-30T18:00:00+08:00'), note: '官网 v1.1' } }]);
  await refresh(page);
  // 批 C 改：改前这里测摘要格子（需要我的事 9 红、项目 6、倒计时、本周合并、成本）、"需要我的事"9 条决定在前、#co-need 的"更新于 2 小时前"、
  //   项目表 7 行 / 排序 / 列宽 / "本周"展开收起（1280、1920 宽）。改后：这些模块按口径去掉，守"去掉了"；"更新于 2 小时前"改看 #co-people。
  {
    const gone = await page.evaluate(() => ({ need: !!document.getElementById('co-need'), tiles: document.querySelectorAll('#v-company .tile').length, proj: !!document.getElementById('co-projects'), next: !!document.getElementById('co-next'),
      text: /需要我的事/.test(document.getElementById('v-company').innerText), did: [...document.querySelectorAll('#v-company button, #v-company a')].filter((b) => /我做了/.test(b.textContent)).length }));
    check('批 C：公司总览没有"需要我的事"（#co-need、摘要格子 .tile、"我做了"按钮都没有）、没有项目表 #co-projects、没有下周 #co-next', !gone.need && gone.tiles === 0 && !gone.text && gone.did === 0 && !gone.proj && !gone.next, gone);
  }
  check('更新于 2 小时前（岗位那一块）', ((await text(page, '#co-people')) || '').includes('更新于 2 小时前'), await text(page, '#co-people'));
  {
    const big = await open({ width: 1920, height: 1080 }, 'dark');
    await login(big);
    await big.click('#conav');
    await big.waitForSelector('#co-people');
    check('1920 宽深色：公司总览不横向滚动', await big.evaluate(() => document.documentElement.scrollWidth <= innerWidth), await big.evaluate(() => [document.documentElement.scrollWidth, innerWidth]));
    if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await big.screenshot({ path: path.join(SHOTS, 'company-1920-dark.png'), fullPage: true }); }
  }
  // 批 C 改：每一行改成"表格的 tbody tr 或列表的 li 都算一行"（ROWS），条数和顺序不变；手机上可以改成列表。"下周"那条随 #co-next 去掉
  check('每个岗位这周：5 个岗位；学到了什么：5 条', (await page.locator(`#co-people ${ROWS}`).count()) === 5 && (await page.locator('#co-learn li').count()) === 5, [await page.locator(`#co-people ${ROWS}`).count(), await page.locator('#co-learn li').count()]);
  check('做得怎么样：4 行（Marketing 在前），没有灰块', (await page.locator(`#co-health ${ROWS}`).count()) === 4 && (await text(page, `#co-health ${ROWS}`)).startsWith('Marketing') && (await page.locator('#v-company .old').count()) === 0, await page.locator(`#co-health ${ROWS}`).allInnerTexts());
  const fixedText = await page.locator('#v-company').innerText();
  check('页面不出现技术词（C128）', !/JSON|payload|token|undefined|null|NaN/i.test(fixedText), fixedText.match(/JSON|payload|token|undefined|null|NaN/i));

  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, 'company-1280-light.png'), fullPage: true });
    for (const [width, height] of [[1280, 900], [390, 844]]) {
      const m = await open({ width, height }, 'dark');
      await login(m);
      await clickTop(m, '#conav');
      await m.waitForSelector('#co-people');
      await m.screenshot({ path: path.join(SHOTS, `company-${width}-dark.png`), fullPage: true });
    }
    console.log('  截图：' + SHOTS);
  }

  // 3.（批 C 去掉）"我做了"的处理中 / 成功 / 失败 / 取消 / 刷新后还在 / 迟到的读不能盖掉：随"需要我的事"一起去掉（待办只看工作台，工作台的打勾、撤销在 e2e-platform 第 3、4 段）。
  //   改前 9 条断言（L227～277），改后守一条：公司总览上没有"我做了"按钮（见上面"批 C：公司总览没有'需要我的事'"那条）。

  // 4. 超过 7 天变灰（批 C 改：解析失败那条看的是项目表、要你决定的 PR 看的是需要我的事、切换周报看的是下周，三个模块都去掉了，这三条随之去掉；
  //    改后补一条：要你决定的 PR 不出现在公司总览）
  await ingest('agents', [
    ...['测试', '研发', '运维安全', '市场', '经营'].map((role) => ({ kind: 'learning', key: role, source_at: now - 8 * DAY, payload: { role, items: [{ title: '旧的一条' }] } })),
    { kind: 'handoff', key: '研发', source_at: now - 8 * DAY, payload: { role: '研发', done: '旧的交接', next: '—', mistakes: 2 } },
    { kind: 'status', key: 'forecast', status: 'error', error: "状态卡：找不到'## 数字'表" },
    { kind: 'weekly', key: '2026-10-25', source_at: now - 7 * DAY - H, payload: { title: '第 0 期', range: '10/26～11/1', next: [{ what: '上一期的事', who: '研发', when: '10/30', status: '完成' }] } },
  ]);
  await ingest('marketing', [{ kind: 'prs', source_at: now, payload: { items: [{ number: 9, title: '【要你决定】公司运营仪表盘', url: 'https://github.com/dollar3651314/Marketing/pull/9', days: 1 }] } }]);
  await refresh(page);
  check('学到了什么全部超过 7 天：整块变灰，写明超过 7 天', (await page.locator('#co-learn.old').count()) === 1 && (await text(page, '#co-learn .stamp')).includes('超过 7 天没更新'), await text(page, '#co-learn .stamp'));
  check('只有研发的交接超过 7 天：那一行变灰，整块不灰', (await page.locator(`#co-people :is(tr, li).old`).count()) === 1 && (await page.locator('#co-people.old').count()) === 0, null);
  check('批 C：要你决定的 PR（#9）不出现在公司总览（只在工作台的待办里）', !((await text(page, '#v-company')) || '').includes('公司运营仪表盘'), await text(page, '#v-company'));

  // 5. "还没开通"、读不到（替身回答）
  {
    const p2 = await open({ width: 1280, height: 900 });
    await login(p2);
    await p2.route('**/api/company', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: false, now: Date.now(), blocks: [], weeks: [], weekly: null, done: [] }) }));
    await p2.click('#conav');
    await p2.waitForSelector('#co-off');
    check('没开通：显示"还没开通"', (await text(p2, '#co-off h2')) === '还没开通', await text(p2, '#v-company'));
    const p3 = await open({ width: 1280, height: 900 });
    await login(p3);
    await p3.route('**/api/company', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '服务暂时出错' }) }));
    await p3.click('#conav');
    await p3.waitForSelector('#co-fail');
    check('读不到：显示原因和"重试"', (await text(p3, '#co-fail')).includes('暂时读不到：服务暂时出错') && (await p3.locator('#co-fail button').innerText()) === '重试', await text(p3, '#co-fail'));
  }

  // 6. 切回旧三页
  await page.click('#nav');
  await page.waitForSelector('#v-list:not([hidden]) .empty');
  check('切回清单：清单页正常（空清单的提示）', (await text(page, '#title')) === '跟帖评论清单' && !(await visible(page, '#v-company')) && (await text(page, '#list')).includes('没有待回的帖子'), await text(page, '#list'));
  await page.click('#nav');
  await page.waitForFunction(() => document.getElementById('u-at').textContent.startsWith('更新于'));
  check('用量和限额页正常（有模型行）', (await page.locator('#u-rows tr').count()) > 0 && !(await visible(page, '#v-company')), await text(page, '#u-at'));
  await page.click('#extnav');
  check('插件下载页正常', (await visible(page, '#v-ext')) && (await text(page, '#dl')).startsWith('下载插件') && (await visible(page, '#conav')), null);
  await page.click('#conav');
  await page.waitForSelector('#co-people');   // 批 C 改：改前等 #co-need li
  check('再回公司页正常', (await visible(page, '#v-company')) && !(await visible(page, '#v-ext')), null);

  // 7. 手机 390 宽：一列、不横向滚动
  {
    const m = await open({ width: 390, height: 844 });
    await login(m);
    // 改版批 A（2026-11-04）：≤640px 时"公司总览""登出"收进"···"。改前：直接 m.click('#conav')（顶栏上露着）；改后：先点开 #more-menu 再点
    const mm0 = await m.evaluate(() => { const mm = document.getElementById('more-menu'); const c = document.getElementById('conav'), l = document.getElementById('logout');
      return { menu: !!mm && mm.tagName === 'DETAILS', open: mm ? mm.open : null, conavIn: !!c && !!c.closest('#more-menu'), logoutIn: !!l && !!l.closest('#more-menu'), conavShown: !!c && !!c.getClientRects().length }; });
    let mm1 = null;
    if (mm0.menu) {
      await m.click('#more-menu > summary');
      mm1 = await m.evaluate(() => { const c = document.getElementById('conav'); const b = c.getBoundingClientRect(); const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return { shown: !!c.getClientRects().length && b.width > 0, inScreen: b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight, hit: !!e && (e === c || c.contains(e)) }; });
    }
    check('手机 390 宽（≤640px）："公司总览" #conav 和"登出" #logout 在顶栏的"···"（details#more-menu）里，默认收起时看不见，点开后 #conav 可见可点', mm0.menu && mm0.open === false && mm0.conavIn && mm0.logoutIn && !mm0.conavShown && !!mm1 && mm1.shown && mm1.inScreen && mm1.hit, { before: mm0, after: mm1 });
    // 批 C 改：改前等 #co-projects tbody tr、并量项目表不超出卡片；改后项目表去掉，等 #co-people，另量三块都不超出屏幕
    await clickTop(m, '#conav');
    await m.waitForSelector('#co-people');
    const w = await m.evaluate(() => ({ page: document.documentElement.scrollWidth, people: document.getElementById('co-people').getBoundingClientRect().width, learn: document.getElementById('co-learn').getBoundingClientRect().left, people0: document.getElementById('co-people').getBoundingClientRect().left,
      right: Math.max(...['co-people', 'co-learn', 'co-health'].map((id) => document.getElementById(id).getBoundingClientRect().right)) }));
    check('手机：不横向滚动，岗位和学习上下排一列，三块都不超出屏幕', w.page <= 390 && w.learn === w.people0 && w.right <= 390 + 0.5, w);
  }
  check('全程没有脚本错误', errors.length === 0, errors);
} finally {
  await browser.close();
  stopDev();
}
if (fails.length) { console.error(`\n✗ 网页后台测试有 ${fails.length} 项不通过`); process.exit(1); }
console.log('\n✓ 网页后台测试全部通过');
process.exit(0);
