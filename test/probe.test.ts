/**
 * Workers AI 探针（src/probe.ts、src/probe-page.ts）的单元测试。守住三条硬要求：
 *   1. **正式版拿不到这个路由**：ENVIRONMENT 不是 staging（含没设、production、空字符串）时，任何 /probe… 都 404；没绑 AI 也 404。
 *   2. **用量记账有被调用**：每次调模型都写 ai_usage（当天 neurons）和 usage_by_project（项目 practical-probe），失败的调用也记。
 *   3. **限流生效**：同一分钟超过 PROBE_PER_MINUTE 次就 429，而且不再调模型；今天的 neurons 到后台设的上限也 429、不调模型；
 *      探针自己那本小额度（PROBE_DAILY_NEURONS）用完也 429，账号那本一点不动（免费额度是整个账号共用的）。
 * 另外守：地址里的随机串猜错是 404；页面里不出现任何密钥的值（底线 1）。
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import { ASR_MODEL, LLM_MODEL, PROBE_DAILY_NEURONS, PROBE_PER_MINUTE, PROBE_PREFIX, PROBE_PROJECT, TTS_A, TTS_B } from '../src/probe';
import { ROOT, T0 } from './helpers';

const HOST = 'https://marketing-staging.example.test';
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
  await db.batch(['ai_usage', 'usage_by_project', 'model_usage', 'company_rate', 'settings'].map((t) => db.prepare(`DELETE FROM ${t}`)));
});

/** 替身 AI：记下每次调用；TTS 回 {audio:base64}（melotts 的格式），ASR 回文字，LLM 回一句话 */
function fakeAi(fail = false) {
  const calls: { model: string; input: unknown }[] = [];
  const ai = {
    async run(model: string, input: unknown): Promise<unknown> {
      calls.push({ model, input });
      if (fail) throw new Error('替身：模型不可用');
      if (model === TTS_A || model === TTS_B) return { audio: btoa('fake-mp3-bytes') };
      if (model === ASR_MODEL) return { text: ' I goed to the office yesterday. ', transcription_info: { duration: 3 }, segments: [{ words: [{ word: 'I', start: 0, end: 0.2 }] }] };
      if (model === LLM_MODEL) return { response: 'Oh nice, so you went to the office yesterday. How was it?', usage: { prompt_tokens: 80, completion_tokens: 16 } };
      throw new Error('没想到的模型 ' + model);
    },
  };
  return { ai, calls };
}

const env = (over: Partial<Env> = {}): Env => ({ DB: db, ENVIRONMENT: 'staging', AI: fakeAi().ai, ...over });
const get = (p: string, e: Env = env(), now = T0) => handle(new Request(`${HOST}${p}`, { redirect: 'manual' }), e, now);
const post = (p: string, e: Env = env(), bytes = 32_000, now = T0) =>
  handle(new Request(`${HOST}${p}`, { method: 'POST', body: new Uint8Array(bytes), headers: { 'content-type': 'audio/wav' } }), e, now);

const usedToday = async () => (await db.prepare('SELECT neurons FROM ai_usage').first<{ neurons: number }>())?.neurons ?? 0;
const byProject = async () => (await db.prepare('SELECT project, model, req, neurons FROM usage_by_project').all<{ project: string; model: string; req: number; neurons: number }>()).results ?? [];

describe('只在测试版生效（硬要求）', () => {
  it('ENVIRONMENT 是 production 时，探针页和三个接口全是 404', async () => {
    const e = env({ ENVIRONMENT: 'production' });
    for (const p of [`${PROBE_PREFIX}/`, `${PROBE_PREFIX}/tts?m=a`, PROBE_PREFIX, '/probe', '/probe-xxx/']) {
      expect((await get(p, e)).status, p).toBe(404);
    }
    expect((await post(`${PROBE_PREFIX}/asr`, e)).status).toBe(404);
    expect((await post(`${PROBE_PREFIX}/chain`, e)).status).toBe(404);
  });

  it('没设 ENVIRONMENT、设成空、设成别的值，一律 404（白名单，不是"不等于 production"）', async () => {
    for (const v of [undefined, '', ' ', 'prod', 'dev', 'Staging']) {
      expect((await get(`${PROBE_PREFIX}/`, env({ ENVIRONMENT: v }))).status, String(v)).toBe(404);
    }
  });

  it('正式版的 404 不泄露这个路由存在（和不存在的地址一样是 Not found，没有任何提示）', async () => {
    const r = await get(`${PROBE_PREFIX}/`, env({ ENVIRONMENT: 'production' }));
    const t = await r.text();
    expect(t).toBe('Not found');
    expect(t).not.toContain('probe');
  });

  it('测试版但账号没绑 AI 时也 404', async () => {
    expect((await get(`${PROBE_PREFIX}/`, env({ AI: undefined }))).status).toBe(404);
  });

  it('测试版、随机串对得上才给页面；猜错 404', async () => {
    const r = await get(`${PROBE_PREFIX}/`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
    expect((await get('/probe-wrongslug/')).status).toBe(404);
    expect((await get('/probe/')).status).toBe(404);
  });

  it('不带最后那个斜杠时跳到带斜杠的地址（页面里的相对地址才找得到）', async () => {
    const r = await get(PROBE_PREFIX);
    expect(r.status).toBe(301);
    expect(r.headers.get('location')).toBe(`${HOST}${PROBE_PREFIX}/`);
  });

  it('页面上不出现任何密钥、账号 ID 的值（底线 1）', async () => {
    const secrets = { COPILOT_TOKEN: 'secret_token_value_0123456789', GEMINI_API_KEY: 'secret_gemini_key_0123', COPILOT_PASSWORD: 'secret_password_0123456', COMPANY_INGEST_TOKEN: 'secret_ingest_token_0123456789abcd' };
    const html = await (await get(`${PROBE_PREFIX}/`, env(secrets))).text();
    for (const v of Object.values(secrets)) expect(html).not.toContain(v);
    expect(html).not.toMatch(/account[_-]?id/i);
  });
});

describe('用量记账（不绕过每天的额度）', () => {
  it('听发音：写 ai_usage，并按项目记一行 usage_by_project', async () => {
    const { ai, calls } = fakeAi();
    const r = await get(`${PROBE_PREFIX}/tts?m=a&text=Grab an apple.`, env({ AI: ai }));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('audio/mpeg');
    expect(Number(r.headers.get('x-neurons'))).toBeGreaterThan(0);
    expect(calls[0].model).toBe(TTS_A);
    expect(await usedToday()).toBeGreaterThan(0);
    const rows = await byProject();
    expect(rows).toHaveLength(1);
    expect(rows[0].project).toBe(PROBE_PROJECT);
    expect(rows[0].req).toBe(1);
  });

  it('m=b 用另一个发音模型，花的 neurons 明显更多（贵的那个）', async () => {
    const a = Number((await get(`${PROBE_PREFIX}/tts?m=a&text=Grab an apple.`)).headers.get('x-neurons'));
    const b = Number((await get(`${PROBE_PREFIX}/tts?m=b&text=Grab an apple.`)).headers.get('x-neurons'));
    expect(b).toBeGreaterThan(a * 10);
  });

  it('转文字：回文字和逐词，并记账', async () => {
    const r = await post(`${PROBE_PREFIX}/asr`);
    const j = (await r.json()) as Record<string, unknown>;
    expect(r.status).toBe(200);
    expect(j['转出来的文字']).toBe('I goed to the office yesterday.');
    expect(j['逐词']).not.toBeNull();
    expect(j['本次估算neurons']).toBeGreaterThan(0);
    expect(await usedToday()).toBeGreaterThan(0);
  });

  it('整条链路：三段都调了、每段都有耗时、记一次账', async () => {
    const { ai, calls } = fakeAi();
    const r = await post(`${PROBE_PREFIX}/chain`, env({ AI: ai }));
    const j = (await r.json()) as { 用时毫秒: Record<string, number>; audioBase64: string; AI回答: string };
    expect(r.status).toBe(200);
    expect(calls.map((c) => c.model)).toEqual([ASR_MODEL, LLM_MODEL, TTS_A]);
    for (const k of ['听懂', '想回答', '说出来', '端到端']) expect(typeof j.用时毫秒[k], k).toBe('number');
    expect(j.audioBase64.length).toBeGreaterThan(0);
    expect(j.AI回答).toContain('yesterday');
    // 三段合起来只记一次账（一次请求一行）
    expect((await byProject())[0].req).toBe(1);
  });

  it('模型出错时也记账（失败的调用不一定不计费，宁可多记）', async () => {
    const { ai } = fakeAi(true);
    const r = await get(`${PROBE_PREFIX}/tts?m=a&text=Grab an apple.`, env({ AI: ai }));
    expect(r.status).toBe(502);
    expect(await usedToday()).toBeGreaterThan(0);
    expect((await byProject())[0].project).toBe(PROBE_PROJECT);
  });

  it('探针自己那本每天的小额度用完也 429（账号那本还没满也一样），不调模型', async () => {
    const day = new Date(T0).toISOString().slice(0, 10);
    await db.prepare("INSERT INTO usage_by_project (day, project, model, req, tok_in, tok_out, neurons) VALUES (?1, ?2, 'workers-ai', 50, 0, 0, ?3)")
      .bind(day, PROBE_PROJECT, PROBE_DAILY_NEURONS - 1)
      .run();
    const { ai, calls } = fakeAi();
    const r = await get(`${PROBE_PREFIX}/tts?m=b&text=Grab an apple and put it on the table.`, env({ AI: ai }));
    expect(r.status).toBe(429);
    expect(calls).toHaveLength(0);
    // 账号那本（ai_usage）一点没动，正式版的备用 AI 不受影响
    expect(await usedToday()).toBe(0);
  });

  it('今天用到后台设的上限就 429，而且不再调模型（C117）', async () => {
    await db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('cap:workers-ai', '5', ?1)").bind(T0).run();
    await db.prepare("INSERT INTO ai_usage (day, neurons) VALUES (?1, 4.9)").bind(new Date(T0).toISOString().slice(0, 10)).run();
    const { ai, calls } = fakeAi();
    const r = await get(`${PROBE_PREFIX}/tts?m=b&text=Grab an apple and put it on the table.`, env({ AI: ai }));
    expect(r.status).toBe(429);
    expect(calls).toHaveLength(0);
    expect(await usedToday()).toBeCloseTo(4.9, 5);
  });
});

describe('限流', () => {
  it(`同一分钟第 ${PROBE_PER_MINUTE} 次还行、第 ${PROBE_PER_MINUTE + 1} 次 429，而且不再调模型`, async () => {
    // 这一分钟先记上 PROBE_PER_MINUTE - 1 次（直接写计数表，省得真发 19 次请求把别的测试挤慢）
    await db.prepare('INSERT INTO company_rate (source, minute, n) VALUES (?1, ?2, ?3)').bind('probe', Math.floor(T0 / 60_000), PROBE_PER_MINUTE - 1).run();
    const { ai, calls } = fakeAi();
    const e = env({ AI: ai });
    expect((await get(`${PROBE_PREFIX}/tts?m=a&text=hi`, e)).status, `第 ${PROBE_PER_MINUTE} 次`).toBe(200);
    const over = await get(`${PROBE_PREFIX}/tts?m=a&text=hi`, e);
    expect(over.status).toBe(429);
    expect(calls).toHaveLength(1);
    // 下一分钟又可以
    expect((await handle(new Request(`${HOST}${PROBE_PREFIX}/tts?m=a&text=hi`), e, T0 + 60_000)).status).toBe(200);
  });

  it('页面本身不限流（他来回刷新不该被挡），接口才限流', async () => {
    const e = env();
    // 这一分钟的次数已经满了，页面照样给
    await db.prepare('INSERT INTO company_rate (source, minute, n) VALUES (?1, ?2, ?3)').bind('probe', Math.floor(T0 / 60_000), PROBE_PER_MINUTE + 10).run();
    for (let i = 0; i < 3; i++) expect((await get(`${PROBE_PREFIX}/`, e)).status).toBe(200);
    expect((await get(`${PROBE_PREFIX}/tts?m=a&text=hi`, e)).status).toBe(429);
  });
});
