/**
 * 已下线的临时入口（2026-11-03）。
 *
 * 背景：Practical 的发音实测需要 Amos 本人用耳朵判断，所以 2026-11-02 在测试版上挂过一个**没有鉴权**的探针页
 * `/probe-<随机串>/`（`src/probe.ts`、`src/probe-page.ts`）；因为 `marketing-staging` 当时没填 `COPILOT_PASSWORD`、后台登录不了，
 * 这个前缀底下又临时挂了素材生成器的受限入口 `/probe-<随机串>/assets/`。
 * Amos 2026-11-03 填上了密码（`/health` 的 `admin` 变成 `ok`、`GET /` 200、`POST /api/assets/plan` 401），实测也跑完了，
 * 两个口子的存在理由都没有了 —— **整套（含后台"公共工具 → 发音探针"）已经删掉**，登记在 agents `工作平台/工具台账.md`。
 *
 * 这一页守住的就是"删干净了"，不让以后谁再把它加回来：
 *   1. 这些路径**一律 404**，任何环境（含 staging）、任何方法都一样，而且 404 的正文和不存在的地址**一模一样**
 *      ——不能回"已下线"之类的话，那等于确认这个路径存在过。
 *   2. 走到这些路径时**一次模型都不调**（没有鉴权的 AI 接口是攻击面，底线 1 的周边）。
 *   3. 后台的 `/api/probe/*` 也没了：没登录 401（和别的 /api/* 一样）、登录以后 404。
 *   4. 源码里再没有 `src/probe.ts` / `src/probe-page.ts`，`src/` 里也不剩 `probe` 字样（T-3：文件直接删，不留注释掉的代码）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import { ADMIN_PAGE } from '../src/admin-page';
import { ROOT, T0 } from './helpers';

const HOST = 'https://marketing-staging.example.test';
const PASS = 'test_only_password_0123456789';
const MIG = path.join(ROOT, 'migrations');
/** 下线前那个随机串（写死在这里，就是为了守住"这几个字面地址现在 404"） */
const SLUG = 'r7q4k2mz9x';
const PREFIX = `/probe-${SLUG}`;
/** 下线掉的全部路径：探针页和它的三个接口、素材生成器的受限入口和它的四个接口 */
const GONE = [
  '/probe',
  PREFIX,
  `${PREFIX}/`,
  `${PREFIX}/tts?m=a&text=hi`,
  `${PREFIX}/asr`,
  `${PREFIX}/chain`,
  `${PREFIX}/assets`,
  `${PREFIX}/assets/`,
  `${PREFIX}/assets/plan?scenes=1`,
  `${PREFIX}/assets/gen`,
  `${PREFIX}/assets/progress`,
  `${PREFIX}/assets/kept`,
];

const stmtsOf = (files: string[]) =>
  files
    .map((f) => readFileSync(path.join(MIG, f), 'utf8').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n'))
    .join(';\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

let db: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: path.join(ROOT, 'test/wrangler.test.toml'), persist: false, remoteBindings: false, envFiles: [] });
  db = proxy.env.DB;
  dispose = proxy.dispose;
  await db.batch(stmtsOf(readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort()).map((s) => db.prepare(s)));
});
afterAll(async () => dispose());
beforeEach(async () => {
  await db.batch(['ai_usage', 'usage_by_project', 'model_usage', 'company_rate', 'settings', 'asset_gen', 'auth_fail', 'auth_lock'].map((t) => db.prepare(`DELETE FROM ${t}`)));
});

/** 替身 AI：只负责记下有没有被调到（下线以后应该一次都没有） */
function fakeAi() {
  const calls: string[] = [];
  return { calls, ai: { async run(model: string): Promise<unknown> { calls.push(model); return { audio: btoa('x') }; } } };
}

const env = (over: Partial<Env> = {}): Env => ({ DB: db, ENVIRONMENT: 'staging', COPILOT_PASSWORD: PASS, AI: fakeAi().ai, ...over });
const call = (p: string, e: Env, init?: RequestInit, now = T0) => handle(new Request(`${HOST}${p}`, { redirect: 'manual', ...init }), e, now);

describe('发音探针和素材生成器受限入口：两个随机串入口都已下线', () => {
  for (const envName of ['staging', 'production', undefined, '', 'Staging'] as const) {
    it(`ENVIRONMENT = ${JSON.stringify(envName)}：GET 这些路径全是 404，一次模型都不调`, async () => {
      const f = fakeAi();
      const e = env({ ENVIRONMENT: envName, AI: f.ai });
      for (const p of GONE) {
        const r = await call(p, e);
        expect([p, r.status]).toEqual([p, 404]);
      }
      expect(f.calls).toEqual([]);
    });
  }

  it('POST 也是 404（连 301 跳转都不剩）：不会因为方法不同漏出一个口子', async () => {
    const f = fakeAi();
    const e = env({ AI: f.ai });
    for (const p of GONE) {
      const r = await call(p, e, { method: 'POST', body: new Uint8Array(32), headers: { 'content-type': 'application/octet-stream' } });
      expect([p, r.status]).toEqual([p, 404]);
    }
    expect(f.calls).toEqual([]);
  });

  it('404 的正文和不存在的地址一模一样，不透露这些路径存在过（不能回"已下线"）', async () => {
    const e = env();
    const 基准 = await (await call('/no-such-path-at-all/', e)).text();
    expect(基准).toBe('Not found');
    for (const p of GONE) {
      const t = await (await call(p, e)).text();
      expect([p, t]).toEqual([p, 基准]);
      for (const 词 of ['probe', '探针', '下线', 'assets', SLUG]) expect([p, 词, t.includes(词)]).toEqual([p, 词, false]);
    }
  });

  it('不带斜杠的 /probe-<随机串> 不再 301 跳转（以前会跳到带斜杠的那一页）', async () => {
    const r = await call(PREFIX, env());
    expect(r.status).toBe(404);
    expect(r.headers.get('location')).toBeNull();
  });
});

describe('后台里的"公共工具 → 发音探针"也一并下线', () => {
  it('没登录：/api/probe/* 是 401（和别的 /api/* 一样，不单独露馅）', async () => {
    const r = await call('/api/probe/tts?m=a', env());
    expect(r.status).toBe(401);
  });

  it('登录以后：/api/probe/* 是 404，一次模型都不调', async () => {
    const f = fakeAi();
    const e = env({ AI: f.ai });
    const login = await call('/api/login', e, { method: 'POST', body: JSON.stringify({ password: PASS }), headers: { 'content-type': 'application/json' } });
    expect(login.status).toBe(200);
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    for (const p of ['/api/probe/tts?m=a&text=hi', '/api/probe/asr', '/api/probe/chain', '/api/probe/']) {
      const r = await call(p, e, { headers: { cookie } });
      expect([p, r.status]).toEqual([p, 404]);
    }
    expect(f.calls).toEqual([]);
  });

  it('后台没开（COPILOT_PASSWORD 没填）：/api/probe/* 还是 404', async () => {
    expect((await call('/api/probe/tts', env({ COPILOT_PASSWORD: undefined }))).status).toBe(404);
  });
});

describe('源码里删干净了（T-3：文件直接删，不留注释掉的代码）', () => {
  it('src/probe.ts、src/probe-page.ts 都不在了', () => {
    for (const f of ['src/probe.ts', 'src/probe-page.ts']) expect([f, existsSync(path.join(ROOT, f))]).toEqual([f, false]);
  });

  it('src/ 下再没有任何 probe 字样（连注释里的随机串也没有）', () => {
    const dir = path.join(ROOT, 'src');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      const t = readFileSync(path.join(dir, f), 'utf8');
      expect([f, /probe/i.test(t)]).toEqual([f, false]);
      expect([f, t.includes(SLUG)]).toEqual([f, false]);
    }
  });
});

// ======================================================================
/**
 * 第二批下线（2026-11-11，Amos：「工作台 英语练习和代练（带练）都没用了，用你新做的东西彻底替换掉它们吧」）：
 * 「英语练习」（8 条提示词）、「它记得住你」（跨轮记忆 /api/english/*）、「带练」（/api/drill/*，含发音、复考、听辨小测）
 * 整套删掉，换成「发音训练」（#w-pron、/api/pron/*，src/pron.ts）。
 *
 * **只删代码，不删数据**：`en_*`、`drill_item`、`drill_audio`、`drill_review`、`ear_pair` 这些表一张都没 DROP
 * （他的历史数据还在，谁都能查回去）——那一条原来由 test/pron.test.ts 第 7 组守着，
 * 2026-11-13 发音训练也下线、那个文件跟着删了，这一条**搬到了本文件最后一组**（连同 pron_* 三张表一起守）。
 * 这里守的是"接口和文件删干净了"。
 */
describe('英语练习、它记得住你、带练（含听辨小测）：整套下线（2026-11-11）', () => {
  const GONE2 = ['/api/english/state', '/api/english/history', '/api/drill/state', '/api/drill/answer', '/api/drill/audio/w1', '/api/drill/review', '/api/drill/ear/state'];

  it('没登录：一律 401（和别的 /api/* 一样，不单独露馅）', async () => {
    for (const p of GONE2) {
      const r = await call(p, env());
      expect([p, r.status]).toEqual([p, 401]);
    }
  });

  it('登录以后：一律 404，一次模型都不调', async () => {
    const f = fakeAi();
    const e = env({ AI: f.ai });
    const login = await call('/api/login', e, { method: 'POST', body: JSON.stringify({ password: PASS }), headers: { 'content-type': 'application/json' } });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    for (const p of GONE2) {
      const r = await call(p, e, { headers: { cookie } });
      expect([p, r.status]).toEqual([p, 404]);
      const post = await call(p, e, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
      expect([p, 'POST', post.status]).toEqual([p, 'POST', 404]);
    }
    expect(f.calls).toEqual([]);
  });

  it('源码里删干净了：src/ 下不剩 english / drill / ear 这三套的任何一个文件', () => {
    for (const f of ['english-page.ts', 'english-memory.ts', 'english-memory-page.ts', 'drill.ts', 'drill-content.ts', 'drill-page.ts',
      'drill-review.ts', 'drill-audio.ts', 'ear.ts', 'ear-content.ts', 'ear-page.ts'])
      expect([f, existsSync(path.join(ROOT, 'src', f))]).toEqual([f, false]);
    // 2026-11-11 接替它们的是工作台的「发音训练」（src/pron.ts）；那一块 2026-11-13 也整块下线了（搬去 Practical），
    // 所以这里不再要求 pron*.ts 存在 —— 它们"不许存在"由本文件最后一组守着。
  });
});

// ======================================================================
/**
 * 第三批下线（2026-11-13）：**工作台的「发音训练」整块搬去 Practical 仓库**。
 *
 * Amos 的原话，三句：
 *   2026-11-12「把后续的所有内容包括发音训练整体挪到 practical 项目中吧，以后就在 practical 项目中更新」
 *   2026-11-13「**工作台 发音训练 这个模块不需要再出现在 工作台 发音训练这个位置了**」
 *   2026-11-13「**工作台 practical 用来存储和展示所有与我英语学习有关的内容**」
 * 这一块已经整套搬进 dollar3651314/Practical 并上了生产（practical.jeff-zhaifei.workers.dev/pron，2026-11-13 验过能用），
 * 工作台这一份是多余的。**这是功能下线，不是为了让测试变绿删东西（底线 6）**：
 * 它守的页面（#w-pron）和接口（/api/pron/*）在这个仓库里整段不存在了，守它们的 test/pron.test.ts、test/pron-lesson.test.ts
 * 跟着一起下线；别的测试一条没删、一条没放宽。
 *
 * **只删代码，绝对不删数据**：`migrations/0019_pron.sql` 和 `pron_round` / `pron_say` / `pron_audio` 三张表一个字都没动。
 * 他在工作台练过好几轮，**历史成绩在 marketing 这个库里**，而 Practical 用的是另一个全新的空库（practical），成绩没跟过去；
 * 删表 = 把他的记录销毁，不可恢复。要不要迁移是另一件事，由他决定。
 *
 * 这一组守五件事：
 *   ① 接口没了：/api/pron/* 和 /api/pron/audio/* 没登录 401、登录以后一律 404，一次模型都不调；
 *   ② 源文件删干净（T-3：文件直接删，不留注释掉的代码），而且 src/ 里**再也不许出现这一块的模块引用**
 *      （`pron-page`、`PRON_MOD`、`w-pron`、`#/work/pron`）—— 这是防止以后谁把它加回来的那道门；
 *   ③ 后台页面上找不到它了：二级菜单从 **7 项变 6 项**（6 项是什么逐个钉死），模块本体、脚本、接口前缀都没了；
 *   ④ **数据留着**：迁移 0019 还在、还是只有三条 CREATE，任何一个迁移文件里都没有 DROP；三张表在库里建得出来；
 *      迁移文件一个没删、编号连续（下线模块 ≠ 删迁移）。
 *   ⑤（从 test/pron.test.ts 第 16 组搬过来，和发音训练无关、不能跟着丢）后台页面那几段 <script> 必须是能跑的纯 JS。
 */
describe('工作台「发音训练」：整块搬去 Practical，工作台这一份下线（2026-11-13）', () => {
  const GONE3 = ['/api/pron/state', '/api/pron/answer', '/api/pron/round', '/api/pron/say', '/api/pron/audio/g1-1a'];

  it('没登录：一律 401（和别的 /api/* 一样，不单独露馅）', async () => {
    for (const p of GONE3) {
      const r = await call(p, env());
      expect([p, r.status]).toEqual([p, 401]);
    }
  });

  it('登录以后：一律 404，一次模型都不调', async () => {
    const f = fakeAi();
    const e = env({ AI: f.ai });
    const login = await call('/api/login', e, { method: 'POST', body: JSON.stringify({ password: PASS }), headers: { 'content-type': 'application/json' } });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    for (const p of GONE3) {
      const r = await call(p, e, { headers: { cookie } });
      expect([p, r.status]).toEqual([p, 404]);
      const post = await call(p, e, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
      expect([p, 'POST', post.status]).toEqual([p, 'POST', 404]);
    }
    expect(f.calls).toEqual([]);
  });

  it('源文件删干净了：src/ 下五个 pron*.ts 一个都不剩', () => {
    for (const f of ['pron.ts', 'pron-audio.ts', 'pron-content.ts', 'pron-lesson.ts', 'pron-page.ts'])
      expect([f, existsSync(path.join(ROOT, 'src', f))]).toEqual([f, false]);
    // 守它们的两个测试文件也跟着功能一起下线了（它们守的代码整段不存在）
    for (const f of ['pron.test.ts', 'pron-lesson.test.ts'])
      expect([f, existsSync(path.join(ROOT, 'test', f))]).toEqual([f, false]);
  });

  it('守门：src/ 里不许再出现这一块的模块引用（以后谁想加回来，这条先红）', () => {
    // 只钉**模块引用**这四个记号，不钉 "pron" 两个字本身：
    //   src/usage.ts 的 'pron-tts' / 'pron-asr' 两个用途要留着（库里还有当时记的账，去掉就只剩看不懂的代号，底线 3）；
    //   src/projects.ts 里指向 Practical 生产站的 https://…workers.dev/pron 是**搬过去以后的新家**，更不能动。
    const dir = path.join(ROOT, 'src');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      const t = readFileSync(path.join(dir, f), 'utf8');
      for (const 记号 of ['pron-page', 'PRON_MOD', 'PRON_CSS', 'PRON_JS', 'w-pron', '#/work/pron', 'pronOpen', 'pronStop', '__pronBase'])
        expect([f, 记号, t.includes(记号)]).toEqual([f, 记号, false]);
    }
  });

  it('后台页面上找不到它了：二级菜单 7 项变 6 项，模块本体、脚本、接口前缀都没了', () => {
    const SUB_WORK = ADMIN_PAGE.slice(ADMIN_PAGE.indexOf('id="sub-work"'), ADMIN_PAGE.indexOf('</nav>', ADMIN_PAGE.indexOf('id="sub-work"')));
    const mods = [...SUB_WORK.matchAll(/data-s="(w-[a-z]+)"/g)].map((m) => m[1]);
    // 2026-11-11～11-13 是 7 项（最后一项 w-pron = 发音训练）；发音训练下线后回到 6 项。
    // **这不是放宽**：条数照样钉死，6 项是哪 6 项逐个写死，多一项少一项都红。
    expect(mods).toEqual(['w-now', 'w-todo', 'w-live', 'w-proj', 'w-num', 'w-meet']);
    // 上限还是 8（T-4：第 9 项会撑破手机菜单）
    expect(mods.length).toBeLessThanOrEqual(8);
    expect(SUB_WORK).not.toContain('发音训练');
    // 公共工具那 8 项一个位子都没动（T-4）——另有 test/tts.test.ts 守着条数，这里守"发音训练没挪过去"
    const SUB_TOOLS = ADMIN_PAGE.slice(ADMIN_PAGE.indexOf('id="sub-tools"'), ADMIN_PAGE.indexOf('</nav>', ADMIN_PAGE.indexOf('id="sub-tools"')));
    expect(SUB_TOOLS.match(/data-s="t-/g) ?? []).toHaveLength(8);
    expect(SUB_TOOLS).not.toContain('发音训练');
    // 模块本体、三段插进来的东西、接口前缀、进出工作台时调的那两个函数，一个都不剩
    for (const 记号 of ['id="w-pron"', '#/work/pron', '__pronBase', 'pronOpen', 'pronStop', '趁空练 10 分钟发音'])
      expect([记号, ADMIN_PAGE.includes(记号)]).toEqual([记号, false]);
    // 别的模块一个都没动：六项各自的模块本体还在页面上
    const vwork = ADMIN_PAGE.slice(ADMIN_PAGE.indexOf('id="v-work"'), ADMIN_PAGE.indexOf('id="v-project"'));
    for (const id of ['w-now', 'w-todo', 'w-live', 'w-proj', 'w-num', 'w-meet'])
      expect([id, vwork.includes('id="' + id + '"')]).toEqual([id, true]);
  });

  it('**数据留着**：迁移 0019_pron.sql 还在、只有三条 CREATE，任何迁移里都没有 DROP', () => {
    const all = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
    expect(all.includes('0019_pron.sql')).toBe(true);
    const code = readFileSync(path.join(MIG, '0019_pron.sql'), 'utf8').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
    expect((code.match(/CREATE TABLE/g) ?? []).length).toBe(3);
    for (const t of ['pron_round', 'pron_say', 'pron_audio']) expect([t, code.includes('CREATE TABLE ' + t + ' (')]).toEqual([t, true]);
    // 下线的是代码，不是数据：整个 migrations/ 里一句 DROP 都不许有
    for (const f of all) {
      const c = readFileSync(path.join(MIG, f), 'utf8').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').toUpperCase();
      expect([f, c.includes('DROP ')]).toEqual([f, false]);
    }
    // 迁移文件一个都没删、编号连续（下线模块 ≠ 删迁移）
    expect(all.map((f) => Number(f.slice(0, 4)))).toEqual(all.map((_, i) => i + 1));
    expect(all[18]).toBe('0019_pron.sql');
  });

  it('**数据留着**：三张 pron_* 表在库里，下线的那几块的旧表也一张没少', async () => {
    const want = ['events', 'queue', 'en_word', 'en_sentence', 'en_round', 'drill_item', 'drill_audio', 'drill_review', 'ear_pair',
      'fund_snapshot', 'pron_round', 'pron_say', 'pron_audio'];
    const r = await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${want.map((_, i) => '?' + (i + 1)).join(',')})`).bind(...want).all<{ name: string }>();
    expect((r.results ?? []).map((x) => x.name).sort()).toEqual([...want].sort());
  });

  // 从 test/pron.test.ts 第 16 组搬过来的：这一条**和发音训练没关系**，守的是后台页面本身，不能跟着那个文件一起丢。
  // 2026-11-11 真踩过：往 admin-page.ts 的 route() 里加了一行 `(window as any).pronStop()`。
  // 那一段是**模板字符串装的纯 JS**，tsc 不看字符串里面，于是 `as any` 原样进了浏览器，
  // **整个后台脚本当场崩**——登录框都填不进去，e2e 跑了十分钟才暴露。这条测试 10 毫秒就逮住。
  it('后台页面里每一段 <script> 都是能跑的纯 JS（TypeScript 语法不许漏进模板字符串）', () => {
    const m = [...ADMIN_PAGE.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    expect(m.length).toBeGreaterThan(0);
    m.forEach((x, i) => {
      expect([i, (() => { try { new Function(x[1]); return ''; } catch (e) { return (e as Error).message; } })()]).toEqual([i, '']);
    });
  });
});
