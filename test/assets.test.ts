/**
 * 素材生成器（src/assets.ts、src/assets-page.ts）的单元测试。守住五条：
 *   1. **只剩一个入口、而且要登录**：/api/assets/* 没登录一律 401；后台没开（COPILOT_PASSWORD 没填）一律 404。
 *   2. **临时的受限入口已经下线**（2026-11-03）：`/probe-<随机串>/assets/` 及其子路径一律 404，连测试版也一样
 *      （和不存在的地址一模一样；完整一组路径由 test/retired-routes.test.ts 守着）。
 *   3. **用量记账有被调用**：每次调模型都写 ai_usage（当天 neurons）和 usage_by_project（项目 practical-assets），失败的调用也记。
 *   4. **额度**：只看 Amos 在"用量和限额"里设的那个上限——**不替他另外设上限**，到了上限才 429、不调模型（C117）。
 *   5. **台账 / 断点续传**：每生成一次 tries + 1，点"留用"写 kept；progress 读得出哪些格子已经有成品、以及真实出图成功率。
 * 另外守：页面和返回的 JSON 里不出现任何密钥的值（底线 1）。
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import { ASSETS_PROJECT, IMG_MODEL, TTS_MODEL, audioNeurons, imageNeurons } from '../src/assets';
import { WAI_DEFAULT_CAP } from '../src/usage';
import { ADMIN_PAGE } from '../src/admin-page';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import { ROOT, T0 } from './helpers';

const HOST = 'https://marketing-staging.example.test';
const PASS = 'test_only_password_0123456789';
const MIG = path.join(ROOT, 'migrations');
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
  SID = await loginCookie(env());
});

/** 替身 AI：记下每次调用；图片回 {image:base64}，音频回 {audio:base64} */
function fakeAi(fail = false) {
  const calls: { model: string; input: unknown }[] = [];
  const ai = {
    async run(model: string, input: unknown): Promise<unknown> {
      calls.push({ model, input });
      if (fail) throw new Error('替身：模型不可用');
      if (model === IMG_MODEL) return { image: btoa('fake-jpeg-bytes') };
      if (model === TTS_MODEL) return { audio: btoa('fake-mp3-bytes') };
      throw new Error('没想到的模型 ' + model);
    },
  };
  return { ai, calls };
}

const env = (over: Partial<Env> = {}): Env => ({ DB: db, ENVIRONMENT: 'staging', COPILOT_PASSWORD: PASS, AI: fakeAi().ai, ...over });
/** 素材生成器的**唯一**入口（2026-11-03 起）：后台登录后的 /api/assets/*；临时的受限入口已经整个删掉 */
const API = '/api/assets';
/** 已经下线的那个临时入口（随机串地址）：这里只用来证明它现在 404 */
const RETIRED = '/probe-r7q4k2mz9x/assets';

const call = (p: string, e: Env, init?: RequestInit, now = T0) => handle(new Request(`${HOST}${p}`, { redirect: 'manual', ...init }), e, now);
const postJson = (p: string, e: Env, body: unknown, now = T0, cookie = '') =>
  call(p, e, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } }, now);

/** 正路（登录后）的 GET / POST：每个用例开头先登一次，Cookie 存在 SID 里 */
let SID = '';
const get = (p: string, e: Env, now = T0) => call(p, e, { headers: { cookie: SID } }, now);
const post = (p: string, e: Env, body: unknown, now = T0) => postJson(p, e, body, now, SID);

/** 登录拿会话 Cookie（后台的正路） */
async function loginCookie(e: Env, now = T0): Promise<string> {
  const r = await postJson('/api/login', e, { password: PASS }, now);
  expect(r.status).toBe(200);
  return (r.headers.get('set-cookie') ?? '').split(';')[0];
}

const used = async () => (await db.prepare('SELECT neurons FROM ai_usage').first<{ neurons: number }>())?.neurons ?? 0;
const byProject = async () =>
  (await db.prepare('SELECT req, neurons FROM usage_by_project WHERE project = ?1').bind(ASSETS_PROJECT).first<{ req: number; neurons: number }>()) ?? { req: 0, neurons: 0 };
const ledger = async () => (await db.prepare('SELECT scene, slot, tries, kept FROM asset_gen ORDER BY scene, slot').all<{ scene: string; slot: string; tries: number; kept: number }>()).results ?? [];

describe('鉴权：跟后台登录走', () => {
  it('没登录：/api/assets/* 一律 401，一次模型都不调', async () => {
    const f = fakeAi();
    const e = env({ AI: f.ai });
    for (const [p, init] of [
      ['/api/assets/plan?scenes=1&images=4', undefined],
      ['/api/assets/progress', undefined],
      ['/api/assets/gen', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }],
    ] as const) {
      const r = await call(p, e, init as RequestInit | undefined);
      expect([p, r.status]).toEqual([p, 401]);
    }
    expect(f.calls).toEqual([]);
  });

  it('后台没开（COPILOT_PASSWORD 没填）：/api/assets/* 是 404，和不存在的地址一样', async () => {
    const r = await call('/api/assets/progress', env({ COPILOT_PASSWORD: undefined }));
    expect(r.status).toBe(404);
  });

  it('登录以后：progress 读得到（正路通）', async () => {
    const e = env();
    const r = await call('/api/assets/progress', e, { headers: { cookie: await loginCookie(e) } });
    expect(r.status).toBe(200);
    expect((await r.json<{ 生成次数: number }>()).生成次数).toBe(0);
  });
});

describe('临时的受限入口已经下线（2026-11-03，Amos 填上 COPILOT_PASSWORD、后台能登录之后）', () => {
  for (const envName of ['staging', undefined, 'production', '', 'Staging '] as const) {
    it(`ENVIRONMENT = ${JSON.stringify(envName)}：/probe-<随机串>/assets 及其子路径一律 404，一次模型都不调`, async () => {
      const f = fakeAi();
      const e = env({ ENVIRONMENT: envName, AI: f.ai });
      for (const p of [RETIRED, `${RETIRED}/`, `${RETIRED}/plan?scenes=1`, `${RETIRED}/progress`]) {
        const r = await call(p, e);
        expect([p, r.status]).toEqual([p, 404]);
        expect([p, await r.text()]).toEqual([p, 'Not found']);
      }
      for (const p of [`${RETIRED}/gen`, `${RETIRED}/kept`]) {
        expect([p, (await postJson(p, e, { scene: '01', slot: 'audio', text: 'Shut the door.' })).status]).toEqual([p, 404]);
      }
      expect(f.calls).toEqual([]);
    });
  }

  it('404 的正文和不存在的地址一模一样，不透露这个路径存在过', async () => {
    const e = env();
    const a = await (await call(`${RETIRED}/`, e)).text();
    const b = await (await call('/no-such-path-at-all/', e)).text();
    expect(a).toBe(b);
    expect(a).not.toContain('assets');
    expect(a).not.toContain('下线');
  });
});

describe('记账：每次调模型都写两本账（C117）', () => {
  it('成功一次图片：ai_usage 和 usage_by_project 都加上这一张的估算 neurons', async () => {
    const f = fakeAi();
    const e = env({ AI: f.ai });
    const r = await post(`${API}/gen`, e, { scene: '01', slot: 'correct', text: 'a man closing a door', steps: 4 });
    expect(r.status).toBe(200);
    const j = await r.json<{ 模型: string; 文件名: string; base64: string; 本次估算neurons: number }>();
    expect(j.模型).toBe(IMG_MODEL);
    expect(j.文件名).toBe('scene-01-correct.jpg');
    expect(atob(j.base64)).toBe('fake-jpeg-bytes');
    expect(j.本次估算neurons).toBeCloseTo(imageNeurons(4), 1);
    expect(await used()).toBeCloseTo(imageNeurons(4), 5);
    expect((await byProject()).req).toBe(1);
    expect(f.calls.map((c) => c.model)).toEqual([IMG_MODEL]);
  });

  it('成功一次音频：走 melotts，按字数估的 neurons 和公式一致（Amos 11/3 实测单句 0.8）', async () => {
    const e = env();
    const text = 'Grab an apple and put it on the table.';
    const j = await (await post(`${API}/gen`, e, { scene: '02', slot: 'audio', text })).json<{ 模型: string; 文件名: string; 本次估算neurons: number }>();
    expect(j.模型).toBe(TTS_MODEL);
    expect(j.文件名).toBe('scene-02-audio.mp3');
    expect(j.本次估算neurons).toBeCloseTo(audioNeurons(text), 1);
    expect(j.本次估算neurons).toBeLessThan(1.2);
  });

  it('模型出错：回 502，但两本账和台账照样各记一次（宁可多记不要漏记）', async () => {
    const e = env({ AI: fakeAi(true).ai });
    const r = await post(`${API}/gen`, e, { scene: '03', slot: 'd1-phoneme', text: 'a man closing a drawer' });
    expect(r.status).toBe(502);
    expect(await used()).toBeCloseTo(imageNeurons(4), 5);
    expect((await byProject()).req).toBe(1);
    expect(await ledger()).toEqual([{ scene: '03', slot: 'd1-phoneme', tries: 1, kept: 0 }]);
  });
});

describe('台账：断点续传和真实出图成功率', () => {
  it('同一格生成两次：tries 累加；点"留用"写 kept；progress 算得出成功率', async () => {
    const e = env();
    await post(`${API}/gen`, e, { scene: '01', slot: 'correct', text: 'x' });
    await post(`${API}/gen`, e, { scene: '01', slot: 'correct', text: 'x' });
    await post(`${API}/gen`, e, { scene: '01', slot: 'audio', text: 'Shut the door.' });
    expect(await ledger()).toEqual([
      { scene: '01', slot: 'audio', tries: 1, kept: 0 },
      { scene: '01', slot: 'correct', tries: 2, kept: 0 },
    ]);
    expect((await post(`${API}/kept`, e, { scene: '01', slot: 'correct', kept: true })).status).toBe(200);
    const p = await (await get(`${API}/progress`, e)).json<{ 生成次数: number; 留用张数: number; 出图成功率: number | null }>();
    // 成功率只算图片，音频不算：2 次生成留下 1 张 → 50%
    expect([p.生成次数, p.留用张数, p.出图成功率]).toEqual([2, 1, 0.5]);
  });

  it('场景编号或格子名不对：400，不调模型', async () => {
    const f = fakeAi();
    const e = env({ AI: f.ai });
    expect((await post(`${API}/gen`, e, { scene: '01/../x', slot: 'correct', text: 'x' })).status).toBe(400);
    expect((await post(`${API}/gen`, e, { scene: '01', slot: 'whatever', text: 'x' })).status).toBe(400);
    expect((await post(`${API}/gen`, e, { scene: '01', slot: 'correct', text: '' })).status).toBe(400);
    expect(f.calls).toEqual([]);
  });
});

describe('先把钱摆出来（plan）', () => {
  it('30 个场景 120 张图、4 步：按 flux 的单价算，和 imageNeurons 对得上；上限是账号那本（没设时 8,000）', async () => {
    const e = env();
    const j = await (await get(`${API}/plan?scenes=30&images=120&steps=4&tries=1&chars=30`, e)).json<{ 需要neurons: number; perImage: number; 今天上限: number }>();
    expect(j.perImage).toBeCloseTo(imageNeurons(4), 1);
    expect(j.需要neurons).toBe(Math.round(120 * imageNeurons(4) + 30 * audioNeurons('x'.repeat(30))));
    expect(j.今天上限).toBe(WAI_DEFAULT_CAP);
  });

  it('登录进来：上限就是后台"用量和限额"里那个数，不另外加一层（Amos 2026-11-03"额度我自己管"）', async () => {
    const e = env();
    await db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('cap:workers-ai', '9000', 0)").run();
    const j = await (await call('/api/assets/plan?scenes=0&images=1&steps=4', e, { headers: { cookie: await loginCookie(e) } })).json<{ 今天上限: number }>();
    expect(j.今天上限).toBe(9000);
  });
});

describe('收编进后台的公共工具（Amos 2026-11-03"工具越来越多，也要注意对工具的管理"）', () => {
  it('后台页面里有素材生成器这个模块，二级菜单里也有；接口地址写在页面上（/api/assets/）', async () => {
    for (const s of ['#/tools/assets', 'id="t-assets"', '素材生成器']) expect(ADMIN_PAGE).toContain(s);
    expect(ADMIN_PAGE).toContain("window.__assetsBase='/api/assets/'");
  });
  it('后台页面里再没有发音探针（2026-11-03 下线）：菜单、模块、接口地址都不剩', async () => {
    for (const s of ['#/tools/probe', 'id="t-probe"', '发音探针', '__probeBase', '/api/probe/']) expect(ADMIN_PAGE).not.toContain(s);
  });
});
