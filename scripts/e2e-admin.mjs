#!/usr/bin/env node
/**
 * 网页后台的浏览器级自动测试（agents C141）：本地用 wrangler dev 起真正的服务（本地 D1，跑全部迁移），在真浏览器里走一遍。
 *   node scripts/e2e-admin.mjs                 # CI 里跑这个
 *   node scripts/e2e-admin.mjs --shots <目录>   # 另外存公司页截图（电脑 1280 宽、手机 390 宽；样例数据是原型里的真实数字）
 * 覆盖：登录 → 公司页"还没收到数据" → 用推送接口塞一份样例 → 各块渲染、更新于几小时前 → "我做了"的处理中 / 成功 / 失败 / 取消 →
 * 超过 7 天变灰、解析失败显示原因、要你决定的 PR、切换周报 → "还没开通"、读不到 → 切回清单、用量、插件下载三页正常；手机不横向滚动；全程没有脚本错误。
 * 任何一条不符就以非 0 退出。密码和令牌是只给这个测试用的假值，不是线上的。
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

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
const port = await new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const BASE = `http://127.0.0.1:${port}`;
const dev = spawn(process.execPath, [WRANGLER, 'dev', ...cfg, '--port', String(port), '--ip', '127.0.0.1', '--var', `COPILOT_PASSWORD:${PASS}`, '--var', `COMPANY_INGEST_TOKEN:${TOKEN}`], { cwd: ROOT, env: wenv, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let devLog = '';
dev.stdout.on('data', (d) => { devLog += d; });
dev.stderr.on('data', (d) => { devLog += d; });
const stopDev = () => { try { process.kill(-dev.pid, 'SIGTERM'); } catch { /* 已经停了 */ } };
process.on('exit', stopDev);
for (let i = 0; ; i++) {
  try { if ((await fetch(BASE + '/health')).ok) break; } catch { /* 还没起来 */ }
  if (i > 120) { console.error(devLog.slice(-3000)); throw new Error('本地服务 60 秒没起来'); }
  await new Promise((r) => setTimeout(r, 500));
}

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
    { id: 'M2', type: 'confirm', level: 'L3', text: 'forecast 内测版：5～10 个内测用户人选、开始日期', hint: '建议 12/1 开内测', link: GH + '产品/forecast/状态卡.md', link_text: '看状态卡' },
    { id: 'M3', type: 'confirm', level: 'L3', text: '英语学习网站并行：什么时候做开局沟通', hint: '建议 11/8 重构完成后', link: GH + '经营/经营会/2026-11-01.md', link_text: '看议程' },
    { id: 'M5', type: 'confirm', level: 'L3', text: '第一批学习 8 条：今天过还是 11/7 过', link: GH + 'v0.31-附1-岗位重构方案.md', link_text: '看 8 条' },
    { id: 'M6', type: 'confirm', level: 'L3', text: '周报每周六 17:00 发对话，要不要推送提醒' },
    { id: 'T2', type: 'action', text: '官网：用真实邮箱走一遍（留邮箱 → 确认信 → 名单页看到自己）', hint: 'Amos 待办 · 10/29 起 3 天', link: 'https://www.quickcome.online', link_text: '打开官网' },
    { id: 'T3', type: 'action', text: 'X、Threads 简介加官网链接' },
    { id: 'T4', type: 'action', text: '发置顶帖并置顶（L-1 已确认）', hint: '预热暂停中，恢复时一起做', link: GH + '产品/forecast/BC-可行性预热/运行记录/2026-10-29-置顶帖.md', link_text: '看文案' },
    { type: 'report', text: '两个号的关注数、名单页数字（上次回报 10/29：X 2、Threads 1）' },
  ] } },
  { kind: 'projects', key: '', source_at: at, payload: { version: 'v1.3.1', items: [
    { name: 'forecast', sub: 'Quick Come · quickcome.online', stage: 'B+C 可行性 · 预热', note: 'D-1：改走内测版路线' },
    { name: 'Marketing', sub: 'marketing.quickcome.online', stage: 'E 上线运营' },
    { name: '公司（agents）', stage: '公司化改造 第 1 周' },
  ] } },
  { kind: 'status', key: 'forecast', source_at: at, payload: { product: 'forecast', state: '预热暂停', level: 'warn', week: '官网 v1.1 10/29 上线；预热 10 个时段发出 2 条帖；11/1 暂停',
    metrics: [{ name: '抽成', now: '0', target: '1 笔（12/31）' }, { name: '关注', now: '3', target: '50', pct: 6 }, { name: '名单', now: '？', target: '100' }, { name: '内测', now: '0', target: '5' }] } },
  { kind: 'status', key: 'Marketing', source_at: at, payload: { product: 'Marketing', state: '正常', level: 'ok', week: '10/30 独立项目、正式版、插件下载；仪表盘场景清单 v0.2',
    metrics: [{ name: '副驾驶', now: '0.3.5' }, { name: '清单', now: '22 条 · 已回 2' }] } },
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
async function open(viewport) {
  const page = await (await browser.newContext({ viewport })).newPage();
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
async function refresh(page) { await page.click('#co-refresh'); await page.waitForFunction(() => document.getElementById('co-refresh').textContent === '刷新'); }

try {
  const page = await open({ width: 1280, height: 900 });
  await login(page);
  check('登录后在清单页，顶栏有"公司"', (await visible(page, '#v-list')) && (await visible(page, '#conav')), null);

  // 1. 还没有数据
  await page.click('#conav');
  await page.waitForSelector('#co-need');
  check('公司页：标题、其他三页隐藏', (await text(page, '#title')) === '公司' && !(await visible(page, '#v-list')) && !(await visible(page, '#v-usage')) && !(await visible(page, '#v-ext')), await text(page, '#title'));
  check('没数据：各块显示"还没收到数据"', (await page.locator('#v-company .co-empty', { hasText: '还没收到数据' }).count()) === 6, await page.locator('#v-company .co-empty').allInnerTexts());

  // 2. 塞样例 → 刷新 → 各块
  await ingest('agents', AGENTS);
  await ingest('marketing', [{ kind: 'ci', source_at: at, payload: { conclusion: 'success', sha: 'e161069', at: Date.parse('2026-10-30T20:00:00+08:00'), note: '正式版 /health ok' } }]);
  await ingest('new-forecast', [{ kind: 'ci', source_at: at, payload: { conclusion: 'success', sha: 'f534f23', at: Date.parse('2026-10-30T18:00:00+08:00'), note: '官网 v1.1' } }]);
  await refresh(page);
  const tiles = await page.locator('#v-company .tile').allInnerTexts();
  check('摘要：需要我的事 9（红）、项目 3、倒计时、本周合并、成本', tiles.length === 5 && tiles[0].startsWith('9') && (await page.locator('.tile.need').count()) === 1 && tiles[1].startsWith('3') && /天/.test(tiles[2]) && tiles[3].startsWith('88') && tiles[4].startsWith('0 元'), tiles);
  check('需要我的事：9 条，决定在前', (await page.locator('#co-need li').count()) === 9 && (await text(page, '#co-need li .who')) === '决定 · L3', await page.locator('#co-need li .who').allInnerTexts());
  check('更新于 2 小时前', (await text(page, '#co-need .stamp')).includes('更新于 2 小时前'), await text(page, '#co-need .stamp'));
  check('项目：3 行、阶段、数字 → 目标、状态', (await page.locator('#co-projects tbody tr').count()) === 3 && (await text(page, '#co-projects tbody tr')).includes('关注 3 → 50') && (await text(page, '#co-projects .stamp')).includes('项目版图 v1.3.1'), await text(page, '#co-projects'));
  check('每个岗位这周：5 个岗位；学到了什么：5 条', (await page.locator('#co-people tbody tr').count()) === 5 && (await page.locator('#co-learn li').count()) === 5, null);
  check('下周：6 件事，标题带日期范围', (await page.locator('#co-next tbody tr').count()) === 6 && (await text(page, '#co-next h2')).includes('11/2～11/8'), await text(page, '#co-next h2'));
  check('做得怎么样：4 行（Marketing 在前），没有灰块', (await page.locator('#co-health tbody tr').count()) === 4 && (await text(page, '#co-health tbody tr')).startsWith('Marketing') && (await page.locator('#v-company .old').count()) === 0, await page.locator('#co-health tbody tr').allInnerTexts());
  const fixedText = await page.locator('#v-company').innerText();
  check('页面不出现技术词（C128）', !/JSON|payload|token|undefined|null|NaN/i.test(fixedText), fixedText.match(/JSON|payload|token|undefined|null|NaN/i));

  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, 'company-1280.png'), fullPage: true });
    const m = await open({ width: 390, height: 844 });
    await login(m);
    await m.click('#conav');
    await m.waitForSelector('#co-projects tbody tr');
    await m.screenshot({ path: path.join(SHOTS, 'company-390.png'), fullPage: true });
    console.log('  截图：' + SHOTS);
  }

  // 3. "我做了"：处理中 → 成功；失败；取消
  let release;
  await page.route('**/api/company/done', async (route) => { await new Promise((r) => { release = r; }); await route.continue(); });
  const t3 = page.locator('#co-need li', { hasText: 'T3' });
  await t3.locator('button').click();
  check('我做了：处理中…（按钮不能再点）', (await t3.locator('button').innerText()) === '处理中…' && (await t3.locator('button').isDisabled()), await t3.locator('button').innerText());
  release();
  await page.waitForSelector('#co-msg.ok');
  const t3done = page.locator('#co-need li.done', { hasText: 'T3' });
  check('我做了：成功提示、这条变灰、显示完成时间到秒、红数字减 1', (await text(page, '#co-msg')).startsWith('✓ 已记下：T3') && /已做 \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(await t3done.innerText()) && (await text(page, '.tile.need .n')) === '8', [await text(page, '#co-msg'), await t3done.innerText()]);
  await page.unroute('**/api/company/done');
  await page.route('**/api/company/done', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '测试用的失败' }) }));
  const t4 = page.locator('#co-need li', { hasText: 'T4' });
  await t4.locator('button').click();
  await page.waitForFunction(() => document.getElementById('co-msg').textContent.startsWith('没记上'));
  check('我做了：失败提示原因，按钮恢复', (await text(page, '#co-msg')) === '没记上：测试用的失败，请再点一次' && (await t4.locator('button').innerText()) === '我做了' && (await page.locator('#co-need li.done').count()) === 1, await text(page, '#co-msg'));
  await page.unroute('**/api/company/done');
  await page.reload();
  await page.click('#conav');
  await page.waitForSelector('#co-need li.done');
  check('刷新页面后"我做了"还在', (await page.locator('#co-need li.done').count()) === 1, null);
  await page.locator('#co-need li.done button').click();
  await page.waitForSelector('#co-msg.ok');
  check('取消：变回未做，红数字回到 9', (await page.locator('#co-need li.done').count()) === 0 && (await text(page, '.tile.need .n')) === '9', await text(page, '#co-msg'));

  // 4. 超过 7 天变灰、解析失败、要你决定的 PR、切换周报
  await ingest('agents', [
    ...['测试', '研发', '运维安全', '市场', '经营'].map((role) => ({ kind: 'learning', key: role, source_at: now - 8 * DAY, payload: { role, items: [{ title: '旧的一条' }] } })),
    { kind: 'handoff', key: '研发', source_at: now - 8 * DAY, payload: { role: '研发', done: '旧的交接', next: '—', mistakes: 2 } },
    { kind: 'status', key: 'forecast', status: 'error', error: "状态卡：找不到'## 数字'表" },
    { kind: 'weekly', key: '2026-10-25', source_at: now - 7 * DAY - H, payload: { title: '第 0 期', range: '10/26～11/1', next: [{ what: '上一期的事', who: '研发', when: '10/30', status: '完成' }] } },
  ]);
  await ingest('marketing', [{ kind: 'prs', source_at: now, payload: { items: [{ number: 9, title: '【要你决定】公司运营仪表盘', url: 'https://github.com/dollar3651314/Marketing/pull/9', days: 1 }] } }]);
  await refresh(page);
  check('学到了什么全部超过 7 天：整块变灰，写明超过 7 天', (await page.locator('#co-learn.old').count()) === 1 && (await text(page, '#co-learn .stamp')).includes('超过 7 天没更新'), await text(page, '#co-learn .stamp'));
  check('只有研发的交接超过 7 天：那一行变灰，整块不灰', (await page.locator('#co-people tr.old').count()) === 1 && (await page.locator('#co-people.old').count()) === 0, null);
  check('解析失败：显示原因，保留上次的内容', (await text(page, '#co-projects .co-err')).startsWith("解析失败：状态卡：找不到'## 数字'表") && (await text(page, '#co-projects tbody tr')).includes('关注 3 → 50'), await text(page, '#co-projects'));
  check('要你决定的 PR 算进需要我的事（10）', (await page.locator('#co-need li', { hasText: '#9' }).count()) === 1 && (await text(page, '.tile.need .n')) === '10', await text(page, '.tile.need .n'));
  await page.selectOption('#co-week', '2026-10-25');
  await page.waitForFunction(() => document.querySelector('#co-next h2').textContent.includes('10/26～11/1'));
  check('切换到上一期周报：下周的事换成那一期，不因为是旧的一期变灰', (await page.locator('#co-next tbody tr').count()) === 1 && (await page.locator('#co-next.old').count()) === 0 && (await text(page, '.tile.need .n')) === '10', await text(page, '#co-next'));

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
  await page.waitForSelector('#co-need li');
  check('再回公司页正常', (await visible(page, '#v-company')) && !(await visible(page, '#v-ext')), null);

  // 7. 手机 390 宽：一列、不横向滚动
  {
    const m = await open({ width: 390, height: 844 });
    await login(m);
    await m.click('#conav');
    await m.waitForSelector('#co-projects tbody tr');
    const w = await m.evaluate(() => ({ page: document.documentElement.scrollWidth, people: document.getElementById('co-people').getBoundingClientRect().width, learn: document.getElementById('co-learn').getBoundingClientRect().left, people0: document.getElementById('co-people').getBoundingClientRect().left }));
    check('手机：不横向滚动，岗位和学习上下排一列', w.page <= 390 && w.learn === w.people0, w);
  }
  check('全程没有脚本错误', errors.length === 0, errors);
} finally {
  await browser.close();
  stopDev();
}
if (fails.length) { console.error(`\n✗ 网页后台测试有 ${fails.length} 项不通过`); process.exit(1); }
console.log('\n✓ 网页后台测试全部通过');
process.exit(0);
