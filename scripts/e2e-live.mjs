#!/usr/bin/env node
/**
 * 公司平台批 3（PR 4 Webhook 实时进度）的浏览器级验收测试。
 * 依据：agents 公司平台/技术方案-公司平台-Webhook.md 第三、四节，测试与风险页第二节 PR 4 一行（浏览器一栏）；原型 公司平台/原型-公司平台-v2.html 的"团队在做什么"。
 * 测试会话先写（agents C145 第 3 条）：写的时候功能还没做，所以现在是红的；研发写代码到全绿，不改这里的断言（底线 6）。
 *   node scripts/e2e-live.mjs                 # CI 里跑这个
 *   node scripts/e2e-live.mjs --shots <目录>   # 另外存工作台、forecast 页截图（375、1440 宽）
 *
 * 样例事件照 GitHub 文档的结构，用 scripts/e2e-server.mjs 的测试假令牌（就是本地服务的 COMPANY_INGEST_TOKEN）在本地签名，
 * 只发给本地 wrangler dev；不发到 GitHub、Cloudflare 或线上。
 *
 * 覆盖：
 *   A. 从没收到事件："团队在做什么：还没接上"（工作台、forecast 页）；公共工具页有 Webhook 开关，默认开。
 *   B. 收到事件后（工作台 #w-live、forecast 页 #f-live）：岗位中文名、项目、上一步、PR 号；【交付】→"交了，等主会话"；
 *      不合约定 →"未标"+"分支名没按约定"；2 小时没动静变灰（.old，"可能停了"）；24 小时 / 合并 / 删分支进"最近结束"（#recent-body）；
 *      CI 红的进工作台顶部提醒（#ci-alert）；forecast 页只有 forecast 的；代码仓库的提交说明、PR 正文不显示（C147）；外部人的标"外部"；
 *      375、1440 宽不横向滚动；全程没有脚本错误。
 *   C. 签名不对：页面提示"签名不对"，写明检查 Secret 和 COMPANY_INGEST_TOKEN 是不是一样、前后有没有空格。
 *   D. 被限流（同一仓库一分钟第 121 次）："有延迟"。
 *   E. 开关：公共工具页点开关 → 关；刷新后还是关；关着时新事件不出现；再点打开后新事件出现。
 *   批 3 审查"改完再审"（测试先写）：
 *   R3 外部的红 CI（fork 来的、外部人同仓库分支的）不触发工作台顶部 #ci-alert，也不算进"团队正在做"的数字（#w-live-n、工作台概览"件事团队正在做"）。
 *   R6 "最近结束"只显示 7 天内的（原型 v2 第 274 行"保留 7 天"）：8 天前合并的不显示，标题旁写 7 天。
 *   R8 开关：打开后等按钮变回开，等不到就红（不再吞掉超时）；点开关的同时切页面触发一次 GET /api/active，
 *      这个 GET 比 POST 先发但后返回，按钮最终必须显示服务端的最新状态。
 *
 * 页面约定（照原型 v2；研发要改名就同一个 PR 改这里并在 PR 描述写明）：
 *   每一条 .act-item[data-branch="<分支名>"]（带 data-repo）；进行中的在 #w-live 里、#recent 之外；最近结束在 #recent-body（#recent 是 details，测试会先展开）；
 *   变灰的条目加 class old；CI 没过的顶部提醒 #ci-alert（不 hidden）；开关 #hook-toggle（button，aria-pressed = "true" / "false"），放在公共工具页（#v-tools）。
 * 接口约定见 test/platform-batch3.test.ts 文件头（/hooks/github、/api/active、/api/hook）。
 * 每段单独 try：一段没做出来不影响别的段报结果；等待都有短超时，等不到就照实报"实际值"。任何一条不符就以非 0 退出。
 */
import { createHmac, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { startServer, PASS, TOKEN, checker } from './e2e-server.mjs';

const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > 0 ? path.resolve(process.argv[shotsAt + 1]) : '';
const { fails, check } = checker();
const M = 60_000, H = 3600_000;
const WAIT = 4000;
const OWNER = 'dollar3651314';
const MARK = 'ZZ正文标记ZZ';

const srv = await startServer({ name: 'e2e-live' });
const BASE = srv.BASE;

// ---------- 样例事件（照 GitHub 文档结构，只留会读的字段） ----------
const iso = (ms) => new Date(ms).toISOString();
const repoObj = (r) => ({ name: r, full_name: `${OWNER}/${r}`, owner: { login: OWNER }, html_url: `https://github.com/${OWNER}/${r}` });
const push = ({ repo = 'agents', branch, msg = '开工', at = Date.now(), files = [], sender = OWNER, created = false }) => {
  const c = { id: 'c'.repeat(40), message: msg, timestamp: iso(at), added: files, removed: [], modified: [], author: { name: 'Claude', username: sender } };
  return { ref: `refs/heads/${branch}`, before: created ? '0'.repeat(40) : 'a'.repeat(40), after: 'b'.repeat(40), created, deleted: false, repository: repoObj(repo), pusher: { name: sender }, sender: { login: sender }, commits: [c], head_commit: c };
};
const pr = ({ repo = 'agents', branch, number, title, action = 'opened', at = Date.now(), merged = false, body = 'PR 说明', assoc = 'OWNER', user = OWNER, forkOwner = '' }) => ({
  action, number, repository: repoObj(repo), sender: { login: user },
  pull_request: { number, title, body, state: action === 'closed' ? 'closed' : 'open', merged, html_url: `https://github.com/${OWNER}/${repo}/pull/${number}`, updated_at: iso(at), created_at: iso(at), closed_at: action === 'closed' ? iso(at) : null, author_association: assoc, user: { login: user, type: 'User' }, head: { ref: branch, label: `${forkOwner || OWNER}:${branch}`, repo: { full_name: `${forkOwner || OWNER}/${repo}`, fork: !!forkOwner, owner: { login: forkOwner || OWNER } } }, base: { ref: 'main' } },
});
const run = ({ repo = 'agents', branch, conclusion = 'success', at = Date.now(), forkOwner = '' }) => ({
  action: 'completed', repository: repoObj(repo), sender: { login: OWNER },
  workflow_run: { name: 'ci', head_branch: branch, status: 'completed', conclusion, html_url: `https://github.com/${OWNER}/${repo}/actions/runs/1`, updated_at: iso(at), pull_requests: [], head_repository: { full_name: `${forkOwner || OWNER}/${repo}`, fork: !!forkOwner, owner: { login: forkOwner || OWNER } } },
});
/** 本地签名后发给本地服务；secret 默认就是本地服务的测试令牌 */
async function send(event, payload, { secret = TOKEN, base = BASE } = {}) {
  const raw = JSON.stringify(payload);
  const sig = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
  const r = await fetch(base + '/hooks/github', { method: 'POST', headers: { 'content-type': 'application/json', 'x-github-event': event, 'x-github-delivery': randomUUID(), 'x-hub-signature-256': sig }, body: raw });
  return r.status;
}

const browser = await chromium.launch();
const errors = [];
async function open({ width = 1440, height = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.route(/^https:\/\/github\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>替身外部页面</p>' }));
  const page = await ctx.newPage();
  page.setDefaultTimeout(WAIT);
  page.on('pageerror', (e) => errors.push(e.message));
  return page;
}
async function login(page, at = '/', base = BASE) {
  await page.goto(base + at);
  await page.fill('#pw', PASS);
  await page.click('#go');
  await page.waitForSelector('#app:not([hidden])', { timeout: WAIT });
}
const txt = (page, sel) => page.locator(sel).first().innerText({ timeout: 1500 }).catch(() => null);
const waitFor = (page, sel, opt = {}) => page.waitForSelector(sel, { timeout: WAIT, state: 'visible', ...opt }).then(() => true, () => false);
async function section(name, fn) {
  try { await fn(); } catch (e) { check(`${name}：没跑完`, false, String(e && e.message || e).split('\n')[0]); }
}
/** 一个模块里的条目：{branch, repo, text, old, ended} */
const items = (page, root) => page.evaluate((root) => {
  const box = document.querySelector(root);
  if (!box) return [];
  box.querySelectorAll('details').forEach((d) => { d.open = true; });
  return [...box.querySelectorAll('.act-item[data-branch]')].map((e) => ({ branch: e.dataset.branch, repo: e.dataset.repo || '', text: e.innerText, old: e.classList.contains('old'), ended: !!e.closest('#recent, #recent-body, details') }));
}, root);
const one = (list, branch) => list.find((x) => x.branch === branch);

try {
  // ---------- A. 还没收到任何事件 ----------
  await section('还没接上', async () => {
    const page = await open();
    await login(page, '/#/work/live');
    await waitFor(page, '#w-live');
    check('工作台"团队在做什么"：从没收到事件时写"还没接上"', /还没接上/.test((await txt(page, '#w-live')) ?? ''), await txt(page, '#w-live'));
    await page.goto(BASE + '/#/forecast/live');
    await waitFor(page, '#f-live');
    check('forecast 页"团队在做什么"：也写"还没接上"', /还没接上/.test((await txt(page, '#f-live')) ?? ''), await txt(page, '#f-live'));
    await page.goto(BASE + '/#/tools');
    const has = await waitFor(page, '#v-tools #hook-toggle');
    check('公共工具页有 Webhook 开关 #hook-toggle，默认开（aria-pressed = true）', has && (await page.getAttribute('#hook-toggle', 'aria-pressed').catch(() => null)) === 'true', await page.getAttribute('#hook-toggle', 'aria-pressed').catch(() => null));
    await page.context().close();
  });

  // ---------- B. 收到一批样例事件 ----------
  const now = Date.now();
  const sent = [
    await send('push', push({ branch: 'claude/pm-forecast-weekly', msg: '周包：写完 6 条帖子', at: now - 5 * M, created: true })),
    await send('pull_request', pr({ branch: 'claude/pm-forecast-weekly', number: 101, title: '【要你决定】【产品·forecast】周包 11/9', at: now - 4 * M })),
    await send('push', push({ branch: 'claude/qa-platform-batch3', msg: '【交付】批 3 验收测试', at: now - 10 * M })),
    await send('push', push({ repo: 'marketing', branch: 'claude/dev-platform-hooks', msg: `提交说明 ${MARK}`, at: now - 8 * M })),
    await send('pull_request', pr({ repo: 'marketing', branch: 'claude/dev-platform-hooks', number: 30, title: '【研发·platform】Webhook 实时进度', body: `PR 正文 ${MARK}`, at: now - 7 * M })),
    await send('workflow_run', run({ repo: 'marketing', branch: 'claude/dev-platform-hooks', conclusion: 'failure', at: now - 6 * M })),
    await send('push', push({ branch: 'claude/weekly-pack-1109', msg: '周包初稿', at: now - 9 * M, files: ['项目/forecast/周包/2026-11-09-周包.md'] })),
    await send('push', push({ branch: 'claude/mkt-forecast-old', msg: '写了一半', at: now - 3 * H })),
    await send('push', push({ branch: 'claude/ops-company-gone', msg: '很久以前', at: now - 25 * H })),
    await send('pull_request', pr({ branch: 'claude/pm-forecast-merged', number: 99, title: '【产品·forecast】已经合并的', action: 'closed', merged: true, at: now - 20 * M })),
    await send('pull_request', pr({ repo: 'marketing', branch: 'feature-x', number: 31, title: '外部人提的改动', assoc: 'CONTRIBUTOR', user: 'stranger', body: MARK, at: now - 2 * M })),
    // 审查 R6：8 天前合并的，不在"最近结束"里显示（只显示 7 天内的）
    await send('pull_request', pr({ branch: 'claude/pm-forecast-oldmerged', number: 98, title: '【产品·forecast】8 天前合并的', action: 'closed', merged: true, at: now - 8 * 24 * H })),
  ];
  check('样例事件都收下了（2xx）', sent.every((s) => s >= 200 && s < 300), sent);

  for (const width of [375, 1440]) {
    await section(`团队在做什么（${width} 宽）`, async () => {
      const page = await open({ width, height: width < 600 ? 812 : 900 });
      await login(page, '/#/work/live');
      await page.waitForSelector('#w-live .act-item[data-branch]', { timeout: WAIT }).catch(() => {});
      const L = await items(page, '#w-live');
      const live = L.filter((x) => !x.ended), ended = L.filter((x) => x.ended);
      const w = one(live, 'claude/pm-forecast-weekly');
      check(`${width} 宽：按约定的分支显示岗位"产品"、项目 forecast、上一步、PR #101`, !!w && /产品/.test(w.text) && /forecast/.test(w.text) && /周包：写完 6 条帖子/.test(w.text) && /#?101/.test(w.text), w);
      const q = one(live, 'claude/qa-platform-batch3');
      check(`${width} 宽：【交付】开头 →"交了，等主会话"，岗位"测试"`, !!q && /交了，等主会话/.test(q.text) && /测试/.test(q.text), q);
      const u = one(live, 'claude/weekly-pack-1109');
      check(`${width} 宽：分支名不合约定 →"未标"+"分支名没按约定"`, !!u && /未标/.test(u.text) && /分支名没按约定/.test(u.text), u);
      const o = one(live, 'claude/mkt-forecast-old');
      check(`${width} 宽：3 小时没动静 → 变灰（.old）、写"可能停了"`, !!o && o.old && /可能停了/.test(o.text), o);
      check(`${width} 宽：5 分钟前的不灰`, !!w && !w.old, w);
      const g = one(ended, 'claude/ops-company-gone'), m = one(ended, 'claude/pm-forecast-merged');
      check(`${width} 宽：25 小时没动静 → 进"最近结束"，不在进行中`, !!g && !one(live, 'claude/ops-company-gone'), { g, inLive: !!one(live, 'claude/ops-company-gone') });
      check(`${width} 宽：合并了的 PR → "最近结束"写"已合并"`, !!m && /已合并/.test(m.text), m);
      check(`${width} 宽（审查 R6）：8 天前合并的不在"最近结束"里（只显示 7 天内的）`, !one(L, 'claude/pm-forecast-oldmerged'), one(L, 'claude/pm-forecast-oldmerged'));
      const rs = (await txt(page, '#recent > summary')) ?? '';
      check(`${width} 宽（审查 R6）："最近结束"标题旁写 7 天（不是 30 天）`, /7 天/.test(rs) && !/30 天/.test(rs), rs);
      const d = one(live, 'claude/dev-platform-hooks');
      check(`${width} 宽：代码仓库（marketing）的一条：有分支名和 PR 标题，提交说明、PR 正文都不显示（C147）`, !!d && /Webhook 实时进度/.test(d.text) && !d.text.includes(MARK), d);
      const ext = one(L, 'feature-x');
      check(`${width} 宽：外部人的 PR 标"外部"`, !!ext && /外部/.test(ext.text) && !ext.text.includes(MARK), ext);
      const body = await page.evaluate(() => document.body.innerText);
      check(`${width} 宽：整页没有代码仓库推来的正文`, !body.includes(MARK), null);
      const alert = await page.locator('#ci-alert').isVisible().catch(() => false);
      check(`${width} 宽：有 CI 没过的 → 工作台顶部提醒 #ci-alert 显示`, alert, await txt(page, '#ci-alert'));
      check(`${width} 宽：不再写"还没接上"`, !/还没接上/.test((await txt(page, '#w-live')) ?? ''), await txt(page, '#w-live'));
      check(`${width} 宽：工作台不横向滚动`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), null);
      if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `live-work-${width}.png`), fullPage: true }); }

      await page.goto(BASE + '/#/forecast/live');
      await page.waitForSelector('#f-live .act-item[data-branch]', { timeout: WAIT }).catch(() => {});
      const F = await items(page, '#f-live');
      const fb = F.map((x) => x.branch);
      check(`${width} 宽：forecast 页只有 forecast 的（周包、按文件夹猜到 forecast 的未标分支），没有 platform、company 的`,
        fb.includes('claude/pm-forecast-weekly') && fb.includes('claude/weekly-pack-1109') && !fb.includes('claude/qa-platform-batch3') && !fb.includes('claude/dev-platform-hooks') && !fb.includes('claude/ops-company-gone'), fb);
      check(`${width} 宽：forecast 页不横向滚动`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), null);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `live-forecast-${width}.png`), fullPage: true });
      await page.context().close();
    });
  }

  // ---------- C. 签名不对 ----------
  await section('签名不对', async () => {
    const s = await send('push', push({ branch: 'claude/pm-forecast-bad', msg: '不该出现' }), { secret: ` ${TOKEN} ` });
    check('Secret 前后多了空格签的：401', s === 401, s);
    const page = await open();
    await login(page, '/#/work/live');
    await waitFor(page, '#w-live');
    const t = (await txt(page, '#w-live')) ?? '';
    check('页面提示"签名不对"，写明检查 Secret 和 COMPANY_INGEST_TOKEN 是否一样、前后有没有空格', /签名不对/.test(t) && /COMPANY_INGEST_TOKEN/.test(t) && /空格/.test(t), t.slice(0, 300));
    check('签名不对的那条没出现', !(await items(page, '#w-live')).some((x) => x.branch === 'claude/pm-forecast-bad'), null);
    await page.context().close();
  });

  // ---------- E. 开关 ----------
  await section('开关', async () => {
    const page = await open();
    await login(page, '/#/tools');
    if (!(await waitFor(page, '#hook-toggle'))) { check('开关：有 #hook-toggle', false, await txt(page, '#v-tools')); return; }
    const resp = page.waitForResponse((r) => r.url().endsWith('/api/hook') && r.request().method() === 'POST', { timeout: WAIT }).catch(() => null);
    await page.click('#hook-toggle');
    const r = await resp;
    check('点开关：POST /api/hook 成功、按钮变成关（aria-pressed = false）', r?.status() === 200 && (await page.getAttribute('#hook-toggle', 'aria-pressed')) === 'false', [r?.status(), await page.getAttribute('#hook-toggle', 'aria-pressed')]);
    await page.reload();
    await waitFor(page, '#hook-toggle');
    check('刷新后还是关', (await page.getAttribute('#hook-toggle', 'aria-pressed').catch(() => null)) === 'false', await page.getAttribute('#hook-toggle', 'aria-pressed').catch(() => null));
    const s1 = await send('push', push({ branch: 'claude/dev-company-off', msg: '关着时推的' }));
    await page.goto(BASE + '/#/work/live');
    await waitFor(page, '#w-live');
    check('关着：事件回 200，但工作台不出现', s1 === 200 && !(await items(page, '#w-live')).some((x) => x.branch === 'claude/dev-company-off'), s1);
    await page.goto(BASE + '/#/tools');
    await waitFor(page, '#hook-toggle');
    await page.click('#hook-toggle');
    // 审查 R8：等不到按钮变回开就红，不吞超时
    const backOn = await page.waitForFunction(() => document.querySelector('#hook-toggle')?.getAttribute('aria-pressed') === 'true', null, { timeout: WAIT }).then(() => true, () => false);
    check('再点开关：按钮变回开（aria-pressed = true）', backOn, await page.getAttribute('#hook-toggle', 'aria-pressed').catch(() => null));
    const s2 = await send('push', push({ branch: 'claude/dev-company-on', msg: '打开后推的' }));
    await page.goto(BASE + '/#/work/live');
    await page.waitForSelector('#w-live .act-item[data-branch="claude/dev-company-on"]', { timeout: WAIT }).catch(() => {});
    check('再打开：新事件出现', s2 === 200 && (await items(page, '#w-live')).some((x) => x.branch === 'claude/dev-company-on'), s2);
    await page.context().close();
  });

  // ---------- 审查 R8：点开关的同时切页面，旧的 GET 比 POST 先发、后返回，按钮最终要是服务端的最新状态 ----------
  await section('开关和切页面同时', async () => {
    const page = await open();
    await login(page, '/#/tools/hook');
    await page.waitForFunction(() => { const b = document.querySelector('#hook-toggle'); return b && !b.hidden && b.getAttribute('aria-pressed') === 'true'; }, null, { timeout: WAIT });
    await page.goto(BASE + '/#/tools/usage');
    await page.waitForTimeout(300);
    // 拦下接下来的第一个 GET /api/active：马上向服务端要（拿到的是点开关之前的状态），等 POST 回来以后才交给页面
    let release, fetched;
    const gate = new Promise((r) => { release = r; });
    const gotOld = new Promise((r) => { fetched = r; });
    let held = false;
    await page.route('**/api/active', async (route) => {
      if (held || route.request().method() !== 'GET') return route.continue();
      held = true;
      const resp = await route.fetch();
      fetched();
      await gate;
      await route.fulfill({ response: resp });
    });
    const getSent = page.waitForRequest((r) => r.url().endsWith('/api/active') && r.method() === 'GET', { timeout: WAIT });
    await page.evaluate(() => { location.hash = '#/tools/hook'; }); // 切页面 → 页面发 GET /api/active
    await getSent;
    await gotOld;
    const post = page.waitForResponse((r) => r.url().endsWith('/api/hook') && r.request().method() === 'POST', { timeout: WAIT });
    await page.click('#hook-toggle');
    const pr8 = await post;
    check('R8：GET 先发，之后点开关 POST 成功', pr8.status() === 200, pr8.status());
    await page.waitForFunction(() => document.querySelector('#hook-toggle')?.getAttribute('aria-pressed') === 'false', null, { timeout: WAIT }).catch(() => {});
    release(); // 旧的 GET 这时才返回（里面是 on: true）
    await page.waitForTimeout(800);
    await page.unroute('**/api/active');
    const server = await page.evaluate(async () => (await (await fetch('/api/active', { credentials: 'same-origin' })).json()).on);
    const shown = await page.getAttribute('#hook-toggle', 'aria-pressed');
    check('R8：晚到的旧 GET 不能把按钮改回去：按钮显示的是服务端最新状态（关）', server === false && shown === 'false', { server, shown });
    // 恢复成开，后面的段要用
    const back = await page.evaluate(async () => (await fetch('/api/hook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: true }), credentials: 'same-origin' })).status);
    check('R8：恢复成开', back === 200, back);
    await page.context().close();
  });

  // ---------- 审查 R3：外部的红 CI 不触发顶部提醒、不算进"团队正在做" ----------
  await section('外部的红 CI', async () => {
    const srv3 = await startServer({ name: 'e2e-live-ext' });
    try {
      const B3 = srv3.BASE;
      const t = Date.now();
      const st = [
        await send('push', push({ branch: 'claude/pm-forecast-inner', msg: '自己人的一条', at: t - 5 * M }), { base: B3 }),
        // fork 来的 PR，同名分支跑 CI 红了
        await send('pull_request', pr({ repo: 'marketing', branch: 'claude/dev-platform-x', number: 51, title: 'fork 来的改动', assoc: 'CONTRIBUTOR', user: 'stranger', forkOwner: 'stranger', at: t - 4 * M }), { base: B3 }),
        await send('workflow_run', run({ repo: 'marketing', branch: 'claude/dev-platform-x', conclusion: 'failure', forkOwner: 'stranger', at: t - 3 * M }), { base: B3 }),
        // 外部人在同一个仓库开的分支（不是 fork），CI 红了
        await send('pull_request', pr({ repo: 'marketing', branch: 'feature-y', number: 52, title: '外部人同仓库的改动', assoc: 'CONTRIBUTOR', user: 'stranger2', at: t - 4 * M }), { base: B3 }),
        await send('workflow_run', run({ repo: 'marketing', branch: 'feature-y', conclusion: 'failure', at: t - 2 * M }), { base: B3 }),
      ];
      check('R3：样例事件都收下了', st.every((x) => x >= 200 && x < 300), st);
      const page = await open();
      await login(page, '/#/work', B3);
      await page.waitForSelector('#w-live .act-item[data-branch]', { timeout: WAIT }).catch(() => {});
      await page.waitForTimeout(300);
      const alert = await page.locator('#ci-alert').isVisible().catch(() => false);
      check('R3：只有外部的红 CI 时，工作台顶部不出红提醒（#ci-alert 隐藏）', !alert, await txt(page, '#ci-alert'));
      const n = ((await txt(page, '#w-live-n')) ?? '').trim();
      check('R3："团队在做什么"的数字只算自己人（1），不算外部的', n === '1', n);
      const g = (await txt(page, '#w-glance')) ?? '';
      const m = /(\d+)\s*件事团队正在做/.exec(g);
      check('R3：工作台概览"件事团队正在做"也是 1', !!m && m[1] === '1', g.slice(0, 200));
      await page.context().close();
    } finally { srv3.stop(); }
  });

  // ---------- D. 被限流（放最后：会占满这一分钟 marketing 的额度） ----------
  await section('有延迟', async () => {
    const st = [];
    for (let i = 0; i < 121; i++) st.push(await send('push', push({ repo: 'marketing', branch: `claude/dev-platform-burst${i % 3}`, msg: '连推' })));
    // 一分钟边界可能把 121 个拆进两分钟：再补到出现 429 为止（最多再 120 个）
    for (let i = 0; !st.includes(429) && i < 120; i++) st.push(await send('push', push({ repo: 'marketing', branch: 'claude/dev-platform-burst0', msg: '连推' })));
    check('同一仓库一分钟第 121 次：429', st.includes(429), st.filter((s) => s !== 200).slice(0, 5));
    const page = await open();
    await login(page, '/#/work/live');
    await waitFor(page, '#w-live');
    const t = (await txt(page, '#w-live')) ?? '';
    check('页面写"有延迟"', /有延迟/.test(t), t.slice(0, 200));
    await page.context().close();
  });

  check('全程没有脚本错误', errors.length === 0, errors);
} finally {
  srv.stop();
}

await browser.close();
if (fails.length) { console.error(`\n✗ 公司平台批 3 验收有 ${fails.length} 项不通过`); process.exit(1); }
console.log('\n✓ 公司平台批 3 验收测试全部通过');
process.exit(0);
