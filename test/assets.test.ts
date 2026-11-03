/**
 * 素材生成器（src/assets.ts、src/assets-page.ts）的单元测试。守住五条：
 *   1. **鉴权**：/api/assets/* 没登录一律 401；后台没开（COPILOT_PASSWORD 没填）一律 404。
 *   2. **受限入口只在测试版**：ENVIRONMENT 不是 staging 时 /probe-<随机串>/assets… 一律 404（和探针同一条白名单）。
 *   3. **用量记账有被调用**：每次调模型都写 ai_usage（当天 neurons）和 usage_by_project（项目 practical-assets），失败的调用也记。
 *   4. **额度**：受限入口自己那本小额度（ASSETS_OPEN_DAILY_NEURONS）用完就 429、不调模型；
 *      登录进来时只看 Amos 在"用量和限额"里设的那个上限——**不替他另外设上限**，到了上限才停（C117）。
 *   5. **台账 / 断点续传**：每生成一次 tries + 1，点"留用"写 kept；progress 读得出哪些格子已经有成品、以及真实出图成功率。
 * 另外守：页面和返回的 JSON 里不出现任何密钥的值（底线 1）。
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import { ASSETS_OPEN_DAILY_NEURONS, ASSETS_PROJECT, IMG_MODEL, TTS_MODEL, audioNeurons, imageNeurons } from '../src/assets';
import { ADMIN_PAGE } from '../src/admin-page';
import { ASSETS_PAGE } from '../src/assets-page';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import { PROBE_PREFIX } from '../src/probe';
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
const OPEN = `${PROBE_PREFIX}/assets`;

const call = (p: string, e: Env, init?: RequestInit, now = T0) => handle(new Request(`${HOST}${p}`, { redirect: 'manual', ...init }), e, now);
const postJson = (p: string, e: Env, body: unknown, now = T0, cookie = '') =>
  call(p, e, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } }, now);

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

describe('受限入口：只在测试版，没登录也能点，但自己有一本小额度', () => {
  for (const envName of [undefined, 'production', '', 'Staging '] as const) {
    it(`ENVIRONMENT = ${JSON.stringify(envName)}：受限入口 404（页面和接口都是）`, async () => {
      const f = fakeAi();
      const e = env({ ENVIRONMENT: envName, AI: f.ai });
      expect((await call(`${OPEN}/`, e)).status).toBe(404);
      expect((await postJson(`${OPEN}/gen`, e, { scene: '01', slot: 'audio', text: 'Shut the door.' })).status).toBe(404);
      expect(f.calls).toEqual([]);
    });
  }

  it('测试版：页面打得开，而且不含任何密钥的值（底线 1）', async () => {
    const e = env({ COPILOT_TOKEN: 'tok_secret_value_0123456789abcd', GEMINI_API_KEY: 'gem_secret_value_0123456789' });
    const r = await call(`${OPEN}/`, e);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('素材生成器');
    for (const secret of [PASS, 'tok_secret_value_0123456789abcd', 'gem_secret_value_0123456789']) expect(html).not.toContain(secret);
  });

  it('自己那本小额度用完：429，而且不调模型；账号那本一点不动', async () => {
    const f = fakeAi();
    const e = env({ AI: f.ai });
    await db.prepare('INSERT INTO usage_by_project (day, project, model, req, neurons) VALUES (?1, ?2, ?3, 1, ?4)')
      .bind(new Date(T0).toISOString().slice(0, 10), ASSETS_PROJECT, 'workers-ai', ASSETS_OPEN_DAILY_NEURONS)
      .run();
    const r = await postJson(`${OPEN}/gen`, e, { scene: '01', slot: 'correct', text: 'a man closing a door' });
    expect(r.status).toBe(429);
    expect(await used()).toBe(0);
    expect(f.calls).toEqual([]);
  });
});

describe('记账：每次调模型都写两本账（C117）', () => {
  it('成功一次图片：ai_usage 和 usage_by_project 都加上这一张的估算 neurons', async () => {
    const f = fakeAi();
    const e = env({ AI: f.ai });
    const r = await postJson(`${OPEN}/gen`, e, { scene: '01', slot: 'correct', text: 'a man closing a door', steps: 4 });
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
    const j = await (await postJson(`${OPEN}/gen`, e, { scene: '02', slot: 'audio', text })).json<{ 模型: string; 文件名: string; 本次估算neurons: number }>();
    expect(j.模型).toBe(TTS_MODEL);
    expect(j.文件名).toBe('scene-02-audio.mp3');
    expect(j.本次估算neurons).toBeCloseTo(audioNeurons(text), 1);
    expect(j.本次估算neurons).toBeLessThan(1.2);
  });

  it('模型出错：回 502，但两本账和台账照样各记一次（宁可多记不要漏记）', async () => {
    const e = env({ AI: fakeAi(true).ai });
    const r = await postJson(`${OPEN}/gen`, e, { scene: '03', slot: 'd1-phoneme', text: 'a man closing a drawer' });
    expect(r.status).toBe(502);
    expect(await used()).toBeCloseTo(imageNeurons(4), 5);
    expect((await byProject()).req).toBe(1);
    expect(await ledger()).toEqual([{ scene: '03', slot: 'd1-phoneme', tries: 1, kept: 0 }]);
  });
});

describe('台账：断点续传和真实出图成功率', () => {
  it('同一格生成两次：tries 累加；点"留用"写 kept；progress 算得出成功率', async () => {
    const e = env();
    await postJson(`${OPEN}/gen`, e, { scene: '01', slot: 'correct', text: 'x' });
    await postJson(`${OPEN}/gen`, e, { scene: '01', slot: 'correct', text: 'x' });
    await postJson(`${OPEN}/gen`, e, { scene: '01', slot: 'audio', text: 'Shut the door.' });
    expect(await ledger()).toEqual([
      { scene: '01', slot: 'audio', tries: 1, kept: 0 },
      { scene: '01', slot: 'correct', tries: 2, kept: 0 },
    ]);
    expect((await postJson(`${OPEN}/kept`, e, { scene: '01', slot: 'correct', kept: true })).status).toBe(200);
    const p = await (await call(`${OPEN}/progress`, e)).json<{ 生成次数: number; 留用张数: number; 出图成功率: number | null }>();
    // 成功率只算图片，音频不算：2 次生成留下 1 张 → 50%
    expect([p.生成次数, p.留用张数, p.出图成功率]).toEqual([2, 1, 0.5]);
  });

  it('场景编号或格子名不对：400，不调模型', async () => {
    const f = fakeAi();
    const e = env({ AI: f.ai });
    expect((await postJson(`${OPEN}/gen`, e, { scene: '01/../x', slot: 'correct', text: 'x' })).status).toBe(400);
    expect((await postJson(`${OPEN}/gen`, e, { scene: '01', slot: 'whatever', text: 'x' })).status).toBe(400);
    expect((await postJson(`${OPEN}/gen`, e, { scene: '01', slot: 'correct', text: '' })).status).toBe(400);
    expect(f.calls).toEqual([]);
  });
});

describe('先把钱摆出来（plan）', () => {
  it('30 个场景 120 张图、4 步：按 flux 的单价算，和 imageNeurons 对得上；受限入口显示的是它自己那本的额度', async () => {
    const e = env();
    const j = await (await call(`${OPEN}/plan?scenes=30&images=120&steps=4&tries=1&chars=30`, e)).json<{ 需要neurons: number; perImage: number; 今天上限: number }>();
    expect(j.perImage).toBeCloseTo(imageNeurons(4), 1);
    expect(j.需要neurons).toBe(Math.round(120 * imageNeurons(4) + 30 * audioNeurons('x'.repeat(30))));
    expect(j.今天上限).toBe(ASSETS_OPEN_DAILY_NEURONS);
  });

  it('登录进来：上限就是后台"用量和限额"里那个数，不另外加一层（Amos 2026-11-03"额度我自己管"）', async () => {
    const e = env();
    await db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('cap:workers-ai', '9000', 0)").run();
    const j = await (await call('/api/assets/plan?scenes=0&images=1&steps=4', e, { headers: { cookie: await loginCookie(e) } })).json<{ 今天上限: number }>();
    expect(j.今天上限).toBe(9000);
  });
});

describe('收编进后台的公共工具（Amos 2026-11-03"工具越来越多，也要注意对工具的管理"）', () => {
  it('后台页面里有素材生成器和发音探针两个模块，二级菜单里也有', async () => {
    for (const s of ['#/tools/assets', '#/tools/probe', 'id="t-assets"', 'id="t-probe"', '素材生成器', '发音探针']) expect(ADMIN_PAGE).toContain(s);
  });
  it('后台页面里不含任何密钥，两个工具的接口地址写在页面上（/api/assets/、/api/probe/）', async () => {
    expect(ADMIN_PAGE).toContain("window.__assetsBase='/api/assets/'");
    expect(ADMIN_PAGE).toContain("window.__probeBase='/api/probe/'");
  });
  it('受限入口那一页用的是同一份模块和脚本（只写一遍）', () => {
    expect(ASSETS_PAGE).toContain('id="t-assets"');
    expect(ASSETS_PAGE).toContain("window.__assetsBase=''");
  });
});
