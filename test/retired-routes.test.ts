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
 * （他的历史数据还在，谁都能查回去）——那一条由 test/pron.test.ts 第 7 组守着。
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
    // 接替它们的是发音训练（src/pron.ts）
    // 2026-11-13：发音那条链路从 src/pron-audio.ts（aura-2-en 按需生成）整条换成 src/en-audio.ts
    // （微软的神经网络语音**预先生成**好存 D1，运行时只读）——**文件改名了，守的东西不变**：接替它们的那几个文件得在。
    for (const f of ['pron.ts', 'en-audio.ts', 'pron-page.ts', 'pron-content.ts']) expect([f, existsSync(path.join(ROOT, 'src', f))]).toEqual([f, true]);
    expect(existsSync(path.join(ROOT, 'src', 'pron-audio.ts'))).toBe(false);
  });
});
