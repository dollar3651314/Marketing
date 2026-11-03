/**
 * 语音生成（src/tts.ts、src/tts-page.ts）的单元测试。守住六条：
 *   1. **鉴权**：`/api/tts/*` 没登录一律 401；后台没开（`COPILOT_PASSWORD` 没填）一律 404；没有别的入口。
 *   2. **模型参数真的传对了**：默认 melotts（`{prompt, lang:'en'}`），选 aura 才用 aura-2-en（`{text, speaker, encoding:'mp3'}`）；
 *      别的模型名 400、一次都不调。
 *   3. **先把钱摆出来**：`plan` 回这次要花多少、今天已用 / 上限 / 还剩，并把 aura 贵多少倍算出来（实测 103.6 vs 0.8 ≈ 129.5 倍）。
 *   4. **额度不够时不调模型**：429 + 一句人话（说清这次要多少、今天用了多少、上限是谁能改），`ai_usage` 一点不动。
 *      **不替 Amos 设上限**：上限就是他在"用量和限额"里设的那个数（没设时 8,000）。
 *   5. **记账**：每次调模型都写 `ai_usage` 和 `usage_by_project`，项目名是 `tts`——**不混进 practical-assets**；失败的调用也记。
 *   6. **它是公共工具**：后台菜单和模块里有"语音生成"，接口地址写在页面上。
 * 另外守：返回的 JSON 和页面里不出现任何密钥的值（底线 1）。
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import { ADMIN_PAGE } from '../src/admin-page';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import { MAX_TEXT, TTS_AURA, TTS_MELOTTS, TTS_PROJECT, ttsNeurons } from '../src/tts';
import { WAI_DEFAULT_CAP } from '../src/usage';
import { ROOT, T0 } from './helpers';

const HOST = 'https://marketing-staging.example.test';
const PASS = 'test_only_password_0123456789';
const MIG = path.join(ROOT, 'migrations');
/** Amos 2026-11-03 实测用的那句（38 个字符）：melotts 约 0.79 neurons、aura 约 103.6 neurons；按它估的时长 2.53 秒，刚好超出 2.5 秒那条规格 */
const SENTENCE = 'Grab an apple and put it on the table.';
/** 一句真的落在 1.0～2.5 秒区间里的（24 个字符 ≈ 1.6 秒） */
const SHORT = 'Hand me the stapler now.';

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

/** 替身 AI：记下每次调用的模型和入参；melotts 回 {audio:base64}，aura 回二进制流 */
function fakeAi(fail = false) {
  const calls: { model: string; input: Record<string, unknown> }[] = [];
  const ai = {
    async run(model: string, input: unknown): Promise<unknown> {
      calls.push({ model, input: input as Record<string, unknown> });
      if (fail) throw new Error('替身：模型不可用');
      if (model === TTS_MELOTTS) return { audio: btoa('fake-mp3-bytes') };
      if (model === TTS_AURA) return new Response(new Uint8Array([1, 2, 3, 4])).body;
      throw new Error('没想到的模型 ' + model);
    },
  };
  return { ai, calls };
}

const env = (over: Partial<Env> = {}): Env => ({ DB: db, ENVIRONMENT: 'staging', COPILOT_PASSWORD: PASS, AI: fakeAi().ai, ...over });
const call = (p: string, e: Env, init?: RequestInit, now = T0) => handle(new Request(`${HOST}${p}`, { redirect: 'manual', ...init }), e, now);

let SID = '';
beforeEach(async () => {
  await db.batch(['ai_usage', 'usage_by_project', 'model_usage', 'company_rate', 'settings', 'auth_fail', 'auth_lock'].map((t) => db.prepare(`DELETE FROM ${t}`)));
  const r = await call('/api/login', env(), { method: 'POST', body: JSON.stringify({ password: PASS }), headers: { 'content-type': 'application/json' } });
  expect(r.status).toBe(200);
  SID = (r.headers.get('set-cookie') ?? '').split(';')[0];
});

const get = (p: string, e: Env, now = T0) => call(p, e, { headers: { cookie: SID } }, now);
const gen = (e: Env, body: unknown, now = T0) =>
  call('/api/tts/gen', e, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', cookie: SID } }, now);

const usedToday = async () => (await db.prepare('SELECT neurons FROM ai_usage').first<{ neurons: number }>())?.neurons ?? 0;
const byProject = async () =>
  (await db.prepare('SELECT project, req, neurons FROM usage_by_project').all<{ project: string; req: number; neurons: number }>()).results ?? [];

describe('鉴权：跟后台登录走，没有别的入口', () => {
  it('没登录：plan 和 gen 都是 401，一次模型都不调', async () => {
    const f = fakeAi();
    const e = env({ AI: f.ai });
    expect((await call(`/api/tts/plan?text=${encodeURIComponent(SENTENCE)}`, e)).status).toBe(401);
    expect((await call('/api/tts/gen', e, { method: 'POST', body: JSON.stringify({ text: SENTENCE }), headers: { 'content-type': 'application/json' } })).status).toBe(401);
    expect(f.calls).toEqual([]);
  });

  it('后台没开（COPILOT_PASSWORD 没填）：/api/tts/* 是 404，和不存在的地址一样', async () => {
    const r = await call('/api/tts/plan?text=hi', env({ COPILOT_PASSWORD: undefined }));
    expect(r.status).toBe(404);
    expect(await r.text()).toBe('Not found');
  });

  it('不认识的子路径：登录以后也是 404', async () => {
    expect((await get('/api/tts/whatever', env())).status).toBe(404);
  });
});

describe('先把钱摆出来（plan）：贵的那个贵多少倍，点之前就看得见', () => {
  it('默认 melotts：这一句约 0.8 neurons，和 Amos 11/3 实测对得上', async () => {
    const j = await (await get(`/api/tts/plan?text=${encodeURIComponent(SENTENCE)}`, env())).json<{
      选中的模型: string; 这次要花neurons: number; melotts: number; aura: number; 贵多少倍: number; 今天上限: number; 今天还剩: number; 够不够: boolean; 字数: number;
    }>();
    expect(j.选中的模型).toBe(TTS_MELOTTS);
    expect(j.字数).toBe(SENTENCE.length);
    expect(j.melotts).toBeCloseTo(0.79, 2);
    expect(j.这次要花neurons).toBe(j.melotts);
    expect(j.今天上限).toBe(WAI_DEFAULT_CAP);
    expect(j.今天还剩).toBe(WAI_DEFAULT_CAP);
    expect(j.够不够).toBe(true);
  });

  it('aura 这一句约 103.6 neurons；倍数按价格表算是 131.8（和字数无关），直接算给界面用', async () => {
    const j = await (await get(`/api/tts/plan?m=aura&text=${encodeURIComponent(SENTENCE)}`, env())).json<{ 选中的模型: string; 这次要花neurons: number; aura: number; 贵多少倍: number }>();
    expect(j.选中的模型).toBe(TTS_AURA);
    expect(j.aura).toBeCloseTo(103.6, 0);
    expect(j.这次要花neurons).toBe(j.aura);
    // Amos 11/3 的实测记的是 103.6 / 0.8 ≈ 129.5 倍；按价格表精算是 103.64 / 0.787 = 131.8。
    // 这里断言**价格表算出来的那个**（代码里就该用没四舍五入过的数），界面上两个都写明白。
    expect(j.贵多少倍).toBeCloseTo(131.8, 1);
    const 短 = await (await get(`/api/tts/plan?m=aura&text=${encodeURIComponent(SHORT)}`, env())).json<{ 贵多少倍: number }>();
    expect(短.贵多少倍).toBe(j.贵多少倍);
  });

  it('上限就是 Amos 在"用量和限额"里设的那个数，不替他另外加一层', async () => {
    await db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('cap:workers-ai', '9000', 0)").run();
    await db.prepare('INSERT INTO ai_usage (day, neurons) VALUES (?1, 120)').bind(new Date(T0).toISOString().slice(0, 10)).run();
    const j = await (await get(`/api/tts/plan?text=${encodeURIComponent(SENTENCE)}`, env())).json<{ 今天上限: number; 今天已用: number; 今天还剩: number }>();
    expect([j.今天上限, j.今天已用, j.今天还剩]).toEqual([9000, 120, 8880]);
  });

  it('规格提示按《生产包》那套口径（MP3、单声道、≥24kHz、1.0～2.5 秒），短句在区间里、长句点出来', async () => {
    const 短 = await (await get(`/api/tts/plan?text=${encodeURIComponent(SHORT)}`, env())).json<{ 规格提示: string; 预计秒数: number }>();
    expect(短.规格提示).toContain('1～2.5 秒');
    expect(短.规格提示).toContain('在区间里');
    expect(短.预计秒数).toBeCloseTo(SHORT.length / 15, 1);
    for (const t of ['x'.repeat(200), 'Shut it.']) {
      const 外 = await (await get(`/api/tts/plan?text=${encodeURIComponent(t)}`, env())).json<{ 规格提示: string }>();
      expect([t.length, 外.规格提示.includes('超出那个区间')]).toEqual([t.length, true]);
    }
  });

  it('空文本：不报错，倍数给 null（倍数和字数无关，但 0/0 没意义）', async () => {
    const j = await (await get('/api/tts/plan?text=', env())).json<{ 字数: number; 贵多少倍: number | null; 这次要花neurons: number }>();
    expect([j.字数, j.贵多少倍, j.这次要花neurons]).toEqual([0, null, 0]);
  });
});

describe('生成：模型参数真的传对了', () => {
  it('默认 melotts：入参是 {prompt, lang:"en"}，回 MP3 的 base64 和这次估算', async () => {
    const f = fakeAi();
    const r = await gen(env({ AI: f.ai }), { text: SENTENCE });
    expect(r.status).toBe(200);
    const j = await r.json<{ 模型: string; mime: string; base64: string; 字节: number; 本次估算neurons: number; 文件名: string }>();
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].model).toBe(TTS_MELOTTS);
    expect(f.calls[0].input).toEqual({ prompt: SENTENCE, lang: 'en' });
    expect(j.模型).toBe(TTS_MELOTTS);
    expect(j.mime).toBe('audio/mpeg');
    expect(atob(j.base64)).toBe('fake-mp3-bytes');
    expect(j.字节).toBe('fake-mp3-bytes'.length);
    expect(j.本次估算neurons).toBeCloseTo(ttsNeurons(TTS_MELOTTS, SENTENCE), 2);
    expect(j.文件名.endsWith('-melotts.mp3')).toBe(true);
  });

  it('选 aura：入参是 {text, speaker, encoding:"mp3"}，而且回的二进制流也认', async () => {
    const f = fakeAi();
    const j = await (await gen(env({ AI: f.ai }), { text: SENTENCE, model: 'aura' })).json<{ 模型: string; 字节: number; 本次估算neurons: number }>();
    expect(f.calls[0].model).toBe(TTS_AURA);
    expect(f.calls[0].input).toEqual({ text: SENTENCE, speaker: 'luna', encoding: 'mp3' });
    expect(j.模型).toBe(TTS_AURA);
    expect(j.字节).toBe(4);
    expect(j.本次估算neurons).toBeCloseTo(ttsNeurons(TTS_AURA, SENTENCE), 1);
  });

  it('模型名不是这两个、或者没写字：400，一次模型都不调', async () => {
    const f = fakeAi();
    const e = env({ AI: f.ai });
    expect((await gen(e, { text: SENTENCE, model: 'elevenlabs' })).status).toBe(400);
    expect((await gen(e, { text: '   ' })).status).toBe(400);
    expect((await gen(e, {})).status).toBe(400);
    expect(f.calls).toEqual([]);
  });

  it(`超过 ${MAX_TEXT} 个字符的部分直接截掉（按截完的长度算钱，不偷偷多花）`, async () => {
    const f = fakeAi();
    const j = await (await gen(env({ AI: f.ai }), { text: 'a'.repeat(MAX_TEXT + 200) })).json<{ 本次估算neurons: number }>();
    expect((f.calls[0].input.prompt as string).length).toBe(MAX_TEXT);
    expect(j.本次估算neurons).toBeCloseTo(ttsNeurons(TTS_MELOTTS, 'a'.repeat(MAX_TEXT)), 2);
  });

  it('这个环境没绑 Workers AI：503，说人话', async () => {
    const r = await gen(env({ AI: undefined }), { text: SENTENCE });
    expect(r.status).toBe(503);
    expect((await r.json<{ 出错: string }>()).出错).toContain('Workers AI');
  });
});

describe('额度：不够就不调模型，而且上限只有 Amos 能改（C117）', () => {
  it('今天已经用到上限：429 + 一句人话，一次模型都不调，ai_usage 一点不动', async () => {
    const f = fakeAi();
    await db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('cap:workers-ai', '100', 0)").run();
    await db.prepare('INSERT INTO ai_usage (day, neurons) VALUES (?1, 99.9)').bind(new Date(T0).toISOString().slice(0, 10)).run();
    const r = await gen(env({ AI: f.ai }), { text: SENTENCE, model: 'aura' });
    expect(r.status).toBe(429);
    const j = await r.json<{ 出错: string; 今天已用: number; 今天上限: number }>();
    expect(j.出错).toContain('额度不够');
    expect(j.出错).toContain('用量和限额');
    expect([j.今天已用, j.今天上限]).toEqual([100, 100]);
    expect(f.calls).toEqual([]);
    expect(await usedToday()).toBeCloseTo(99.9, 5);
  });

  it('便宜的那个还塞得下时照样能生成（挡的是这一次的估算，不是一刀切）', async () => {
    const f = fakeAi();
    await db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('cap:workers-ai', '100', 0)").run();
    await db.prepare('INSERT INTO ai_usage (day, neurons) VALUES (?1, 99)').bind(new Date(T0).toISOString().slice(0, 10)).run();
    expect((await gen(env({ AI: f.ai }), { text: SENTENCE, model: 'aura' })).status).toBe(429);
    expect((await gen(env({ AI: f.ai }), { text: SENTENCE })).status).toBe(200);
    expect(f.calls.map((c) => c.model)).toEqual([TTS_MELOTTS]);
  });
});

describe('记账：单独一本，看得出是谁花的', () => {
  it('成功一次：ai_usage 和 usage_by_project 都加上，项目名是 tts（不混进 practical-assets）', async () => {
    await gen(env(), { text: SENTENCE });
    expect(await usedToday()).toBeCloseTo(ttsNeurons(TTS_MELOTTS, SENTENCE), 5);
    const rows = await byProject();
    expect(rows).toHaveLength(1);
    expect(rows[0].project).toBe(TTS_PROJECT);
    expect(rows[0].project).not.toBe('practical-assets');
    expect(rows[0].req).toBe(1);
  });

  it('模型出错：回 502，但还是按估算记一次账（失败的调用不一定不计费）', async () => {
    const r = await gen(env({ AI: fakeAi(true).ai }), { text: SENTENCE, model: 'aura' });
    expect(r.status).toBe(502);
    expect(await usedToday()).toBeCloseTo(ttsNeurons(TTS_AURA, SENTENCE), 5);
    expect((await byProject())[0].project).toBe(TTS_PROJECT);
  });
});

describe('它是公共工具：后台菜单和模块里有，页面上不含密钥', () => {
  it('二级菜单有"语音生成"，模块 t-tts 在，接口地址写在页面上', () => {
    for (const s of ['#/tools/tts', 'data-s="t-tts"', 'id="t-tts"', '语音生成', "window.__ttsBase='/api/tts/'"]) expect(ADMIN_PAGE).toContain(s);
  });

  it('界面上把"贵约 129.5 倍"和默认模型写明白了（不只给模型名）', () => {
    expect(ADMIN_PAGE).toContain('129.5 倍');
    expect(ADMIN_PAGE).toContain('melotts');
    expect(ADMIN_PAGE).toContain('aura-2-en');
    // 默认选中的是便宜的那个
    expect(ADMIN_PAGE).toContain('value="melotts" checked');
  });

  it('公共工具的二级菜单正好 8 项（第 9 项会撑破手机菜单，见 agents 工作平台/工具台账.md 的 T-4）', () => {
    const nav = ADMIN_PAGE.slice(ADMIN_PAGE.indexOf('id="sub-tools"'), ADMIN_PAGE.indexOf('</nav>', ADMIN_PAGE.indexOf('id="sub-tools"')));
    expect(nav.match(/data-s="t-/g) ?? []).toHaveLength(8);
  });

  it('生成出来的 JSON 里不含任何密钥的值（底线 1）', async () => {
    const secrets = { COPILOT_TOKEN: 'tok_secret_value_0123456789abcd', GEMINI_API_KEY: 'gem_secret_value_0123456789', COMPANY_INGEST_TOKEN: 'ing_secret_value_0123456789abcd' };
    const t = await (await gen(env(secrets), { text: SENTENCE })).text();
    for (const v of [...Object.values(secrets), PASS]) expect(t).not.toContain(v);
  });
});
