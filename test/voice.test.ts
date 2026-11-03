/**
 * 语音对话实测台（src/voice.ts、src/voice-page.ts）的单元测试。守住七条：
 *   1. **鉴权**：`/api/voice/*` 没登录一律 401；后台没开（`COPILOT_PASSWORD` 没填）一律 404；没有别的入口
 *      （2026-11-03 刚把 `/probe-<随机串>/` 那套没鉴权的临时口子整套下线，不能再开一个，见 test/retired-routes.test.ts）。
 *   2. **价格全部按官方价格表**（Cloudflare 定价页，2026-11-03 查）：whisper 41.14 / whisper-turbo 46.63 每音频分钟、
 *      qwen3-30b 4625/30475、llama-8b-fast 4119/34868、granite-micro 1542/10158 每百万 token、
 *      melotts 18.63 每音频分钟、aura-2-en 2727.27 每千字符。**改这些数要同时改注释里的来源链接和日期**（底线 3）。
 *   3. **算术要对得上手算**：一轮 10 分钟对话按 Gemini 的口径（15 往返、用户说 4 分钟、AI 回 1,500 字符、
 *      12,000 输入 + 3,000 输出 token）的 neurons，和"一天 10,000 够跑几轮"。
 *   4. **自己限量**：一天最多 3 轮，第 4 轮 429、一次模型都不调；计数在跑之前就记上（中途失败也算一轮）。
 *   5. **额度那一关还是 Amos 的那个 cap**：不够时 429、一次模型都不调、`ai_usage` 一点不动。
 *   6. **记账**：每调一次模型记一笔（一轮三笔），项目名 `practical-voice`、用途 `voice`——**不混进 tts**；失败的那一笔也记。
 *   7. **模型参数真的传对了**：whisper-turbo 收 base64 字符串 + language，@cf/openai/whisper 收 0～255 的整数数组
 *      （两张官方 schema-input.json，2026-11-03 查）；melotts 收 {prompt,lang}、aura 收 {text,speaker,encoding}。
 * 另外守：返回的 JSON 和页面里不出现任何密钥的值（底线 1）；出错时把**真实错误原文**带回去，不拿"未知错误"盖掉原因。
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import { ADMIN_PAGE } from '../src/admin-page';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import { PURPOSES } from '../src/usage';
import {
  ASR,
  FREE_NEURONS,
  LLM,
  MAX_RUNS_PER_DAY,
  SCENES,
  TTS,
  TYPICAL,
  VOICE_PROJECT,
  VOICE_PURPOSE,
  asrNeurons,
  combos,
  llmNeurons,
  prompt,
  readAsr,
  readReply,
  roundCost,
  scale,
  ttsNeurons,
} from '../src/voice';
import { ROOT, T0 } from './helpers';

const HOST = 'https://marketing-staging.example.test';
const PASS = 'test_only_password_0123456789';
const MIG = path.join(ROOT, 'migrations');
/** 一段假录音：内容无所谓，长度要像真的（替身 AI 不解码） */
const AUDIO = btoa('fake-opus-bytes-'.repeat(40));

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

/** 替身 AI：记下每次调用的模型和入参；ASR 回文字、LLM 回 JSON、TTS 回音频 */
function fakeAi(opts: { failAt?: string; llmText?: string; duration?: number | null } = {}) {
  const calls: { model: string; input: Record<string, unknown> }[] = [];
  const ai = {
    async run(model: string, input: unknown): Promise<unknown> {
      calls.push({ model, input: input as Record<string, unknown> });
      if (opts.failAt && model.includes(opts.failAt)) throw new Error('替身：模型不可用');
      if (model === ASR.turbo.id || model === ASR.whisper.id) {
        const d = opts.duration === undefined ? 6 : opts.duration;
        return { text: 'I goed to the office yesterday and we fighted about the scope.', word_count: 12, ...(d == null ? {} : { transcription_info: { duration: d } }) };
      }
      if (model === TTS.melotts.id) return { audio: btoa('fake-mp3-bytes') };
      if (model === TTS.aura.id) return new Response(new Uint8Array([1, 2, 3, 4])).body;
      // LLM
      return {
        response: opts.llmText ?? '<think>reasoning</think>{"reply":"Scope is scope. What exactly blocks you?","unnatural":"I goed to the office","native":"I went to the office","why":"goed 不是 go 的过去式，母语者说 went。"}',
        usage: { prompt_tokens: 420, completion_tokens: 60 },
      };
    },
  };
  return { ai, calls };
}

const env = (over: Partial<Env> = {}): Env => ({ DB: db, ENVIRONMENT: 'staging', COPILOT_PASSWORD: PASS, AI: fakeAi().ai, ...over });
const call = (p: string, e: Env, init?: RequestInit, now = T0) => handle(new Request(`${HOST}${p}`, { redirect: 'manual', ...init }), e, now);

let SID = '';
beforeEach(async () => {
  await db.batch(['ai_usage', 'usage_by_project', 'usage_by_purpose', 'model_usage', 'company_rate', 'settings', 'auth_fail', 'auth_lock'].map((t) => db.prepare(`DELETE FROM ${t}`)));
  const r = await call('/api/login', env(), { method: 'POST', body: JSON.stringify({ password: PASS }), headers: { 'content-type': 'application/json' } });
  expect(r.status).toBe(200);
  SID = (r.headers.get('set-cookie') ?? '').split(';')[0];
});

const get = (p: string, e: Env, now = T0) => call(p, e, { headers: { cookie: SID } }, now);
const run = (e: Env, body: unknown = { audio: AUDIO, mime: 'audio/webm;codecs=opus', seconds: 6, scene: 'spec' }, now = T0) =>
  call('/api/voice/run', e, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', cookie: SID } }, now);

const usedToday = async () => (await db.prepare('SELECT neurons FROM ai_usage').first<{ neurons: number }>())?.neurons ?? 0;
const byProject = async () => (await db.prepare('SELECT project, model, req, neurons FROM usage_by_project').all<{ project: string; model: string; req: number; neurons: number }>()).results ?? [];
const byPurpose = async () => (await db.prepare('SELECT purpose, req, neurons FROM usage_by_purpose').all<{ purpose: string; req: number; neurons: number }>()).results ?? [];

// ======================================================================
describe('1. 鉴权：跟后台登录走，没有别的入口', () => {
  it('没登录：plan 和 run 都是 401，一次模型都不调', async () => {
    const f = fakeAi();
    const e = env({ AI: f.ai });
    expect((await call('/api/voice/plan', e)).status).toBe(401);
    expect((await call('/api/voice/run', e, { method: 'POST', body: JSON.stringify({ audio: AUDIO, seconds: 6 }), headers: { 'content-type': 'application/json' } })).status).toBe(401);
    expect(f.calls).toEqual([]);
  });

  it('后台没开（COPILOT_PASSWORD 没填）：/api/voice/* 是 404，正文和不存在的地址一模一样', async () => {
    const r = await call('/api/voice/plan', env({ COPILOT_PASSWORD: undefined }));
    expect(r.status).toBe(404);
    expect(await r.text()).toBe('Not found');
  });

  it('不认识的子路径：登录以后也是 404；没有任何不带鉴权的 /voice 入口', async () => {
    expect((await get('/api/voice/whatever', env())).status).toBe(404);
    for (const p of ['/voice', '/voice/', '/probe-voice', '/api/voice']) {
      const r = await call(p, env());
      expect([404, 401]).toContain(r.status);
    }
  });
});

// ======================================================================
describe('2. 价格表：逐条对上 Cloudflare 官方定价页（2026-11-03 查）', () => {
  it('ASR / LLM / TTS 的单价一个都不许改掉', () => {
    expect(ASR.whisper).toMatchObject({ id: '@cf/openai/whisper', 每音频分钟: 41.14 });
    expect(ASR.turbo).toMatchObject({ id: '@cf/openai/whisper-large-v3-turbo', 每音频分钟: 46.63 });
    expect(LLM.qwen3).toMatchObject({ id: '@cf/qwen/qwen3-30b-a3b-fp8', 每百万输入: 4625, 每百万输出: 30475 });
    expect(LLM.llama8b).toMatchObject({ id: '@cf/meta/llama-3.1-8b-instruct-fp8-fast', 每百万输入: 4119, 每百万输出: 34868 });
    expect(LLM.granite).toMatchObject({ id: '@cf/ibm-granite/granite-4.0-h-micro', 每百万输入: 1542, 每百万输出: 10158 });
    expect(TTS.melotts).toMatchObject({ id: '@cf/myshell-ai/melotts', 每音频分钟: 18.63 });
    expect(TTS.aura).toMatchObject({ id: '@cf/deepgram/aura-2-en', 每千字符: 2727.27 });
    expect(FREE_NEURONS).toBe(10_000);
  });

  it('和已经在跑的语音生成（src/tts.ts）用的是同一套单价，不会两个页面报两个数', async () => {
    const { ttsNeurons: ttsNeuronsOld, TTS_MELOTTS, TTS_AURA } = await import('../src/tts');
    expect(ttsNeurons(TTS.melotts, 38)).toBeCloseTo(ttsNeuronsOld(TTS_MELOTTS, 'x'.repeat(38)), 6);
    expect(ttsNeurons(TTS.aura, 38)).toBeCloseTo(ttsNeuronsOld(TTS_AURA, 'x'.repeat(38)), 6);
  });

  it('单步换算和手算一致', () => {
    // 4 音频分钟 × 41.14 = 164.56
    expect(asrNeurons(ASR.whisper, 4)).toBeCloseTo(164.56, 2);
    // 12,000 × 4625/1e6 + 3,000 × 30475/1e6 = 55.5 + 91.425 = 146.925
    expect(llmNeurons(LLM.qwen3, 12_000, 3_000)).toBeCloseTo(146.925, 3);
    // 1,500 字符 ÷ 15 = 100 秒 = 5/3 分钟 × 18.63 = 31.05
    expect(ttsNeurons(TTS.melotts, 1_500)).toBeCloseTo(31.05, 2);
    // 1,500 ÷ 1000 × 2727.27 = 4090.905
    expect(ttsNeurons(TTS.aura, 1_500)).toBeCloseTo(4090.905, 2);
  });
});

// ======================================================================
describe('3. 算术：一轮 10 分钟对话要多少、一天 10,000 够跑几轮', () => {
  it('口径就是 Gemini 给的那组数，不许偷偷改小', () => {
    expect(TYPICAL).toEqual({ 往返轮次: 15, 用户说话分钟: 4, AI回复字符: 1500, LLM输入token: 12_000, LLM输出token: 3_000 });
  });

  it('默认搭配（whisper-turbo + qwen3 + melotts）一轮约 364.5 neurons，一天能跑 27 轮', () => {
    const c = roundCost(ASR.turbo, LLM.qwen3, TTS.melotts);
    // 186.52 + 146.93 + 31.05
    expect(c.asr).toBeCloseTo(186.52, 2);
    expect(c.llm).toBeCloseTo(146.93, 1);
    expect(c.tts).toBeCloseTo(31.05, 2);
    expect(c.合计).toBeCloseTo(364.5, 1);
    expect(Math.floor(FREE_NEURONS / c.合计)).toBe(27);
  });

  it('最省的那档是 whisper + granite + melotts，一轮约 244.6 neurons、一天 40 轮', () => {
    const list = combos();
    expect(list[0].组合).toBe('whisper + granite + melotts');
    // 164.56 + (12000×1542 + 3000×10158)/1e6 + 31.05 = 164.56 + 48.978 + 31.05
    expect(list[0].一轮neurons).toBeCloseTo(244.59, 1);
    expect(list[0].一天能跑几轮).toBe(40);
    // 排序是从便宜到贵
    expect(list[0].一轮neurons).toBeLessThan(list[list.length - 1].一轮neurons);
  });

  it('TTS 一换成 aura-2-en，一轮就从几百跳到四千多，一天连 3 轮都跑不到', () => {
    const 省 = roundCost(ASR.turbo, LLM.qwen3, TTS.melotts);
    const 贵 = roundCost(ASR.turbo, LLM.qwen3, TTS.aura);
    expect(贵.合计).toBeCloseTo(4424.36, 0);
    expect(Math.floor(FREE_NEURONS / 贵.合计)).toBe(2);
    expect(贵.合计 / 省.合计).toBeGreaterThan(11);
  });

  it('100 个用户：按最省那档每人每天 1 轮 = 免费额度的 2.4 倍，按官方 $0.011/千 neurons 算出超出部分', () => {
    const one = combos()[0].一轮neurons;
    const s = scale(one, 100, 1);
    expect(s.一天neurons).toBeCloseTo(24_459, -1);
    expect(s.是免费额度的几倍).toBeCloseTo(2.45, 1);
    // (24459 - 10000) / 1000 × 0.011 ≈ $0.159/天 ≈ $4.77/月
    expect(s.超出部分每天美元).toBeCloseTo(0.159, 2);
    expect(s.超出部分每月美元).toBeCloseTo(4.77, 1);
    // 每人每天 2 轮就是两倍用量，超出部分更多
    expect(scale(one, 100, 2).一天neurons).toBeCloseTo(s.一天neurons * 2, -1);
    expect(scale(one, 100, 2).超出部分每月美元).toBeGreaterThan(s.超出部分每月美元);
  });

  it('Amos 一个人自用（每天 1～2 轮）在免费额度里绰绰有余：最贵的那档也只占一小部分', () => {
    const 最贵 = combos()[combos().length - 1];
    expect(scale(最贵.一轮neurons, 1, 2).超出部分每月美元).toBe(0);
    expect(scale(combos()[0].一轮neurons, 1, 2).一天neurons).toBeLessThan(FREE_NEURONS);
  });
});

// ======================================================================
describe('4. 自己限量：一天最多 3 轮', () => {
  it('第 4 轮 429、一次模型都不调', async () => {
    const f = fakeAi();
    const e = env({ AI: f.ai });
    for (let i = 0; i < MAX_RUNS_PER_DAY; i++) expect((await run(e)).status).toBe(200);
    const before = f.calls.length;
    expect(before).toBe(MAX_RUNS_PER_DAY * 3); // 每轮三次：ASR、LLM、TTS
    const r = await run(e);
    expect(r.status).toBe(429);
    const j = await r.json<{ 出错: string; 今天已跑轮数: number }>();
    expect(j.今天已跑轮数).toBe(MAX_RUNS_PER_DAY);
    expect(j.出错).toContain('一天最多');
    expect(f.calls.length).toBe(before);
  });

  it('中途失败也算一轮（计数在跑之前就记上，闸才守得住）', async () => {
    const e = env({ AI: fakeAi({ failAt: 'whisper' }).ai });
    expect((await run(e)).status).toBe(502);
    const j = await (await get('/api/voice/plan', e)).json<{ 今天已跑轮数: number }>();
    expect(j.今天已跑轮数).toBe(1);
  });

  it('换一天（UTC 日）就从零开始，和 Cloudflare 00:00 UTC 清零对齐', async () => {
    const e = env();
    await run(e);
    const 第二天 = T0 + 24 * 3600_000;
    // 会话只有 12 小时，隔天要重新登录（和后台一样）
    const lr = await call('/api/login', e, { method: 'POST', body: JSON.stringify({ password: PASS }), headers: { 'content-type': 'application/json' } }, 第二天);
    const sid2 = (lr.headers.get('set-cookie') ?? '').split(';')[0];
    const j = await (await call('/api/voice/plan', e, { headers: { cookie: sid2 } }, 第二天)).json<{ 今天已跑轮数: number }>();
    expect(j.今天已跑轮数).toBe(0);
    // 前一天那一轮的计数还在，只是不算今天的（按 UTC 日分开存）
    expect(await db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'voice_runs:%'").first<{ n: number }>()).toEqual({ n: 1 });
  });
});

// ======================================================================
describe('5. 额度那一关还是 Amos 设的那个 cap', () => {
  it('额度不够：429、一次模型都不调、ai_usage 一点不动', async () => {
    const day = new Date(T0).toISOString().slice(0, 10);
    await db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('cap:workers-ai', '100', 0)").run();
    await db.prepare('INSERT INTO ai_usage (day, neurons) VALUES (?1, 99)').bind(day).run();
    const f = fakeAi();
    const r = await run(env({ AI: f.ai }));
    expect(r.status).toBe(429);
    const j = await r.json<{ 出错: string; 今天上限: number }>();
    expect(j.今天上限).toBe(100);
    expect(j.出错).toContain('额度不够');
    expect(f.calls).toEqual([]);
    expect(await usedToday()).toBe(99);
  });

  it('plan 报的"今天上限"就是 settings 里那个数，不另外加一层', async () => {
    await db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('cap:workers-ai', '9000', 0)").run();
    await db.prepare('INSERT INTO ai_usage (day, neurons) VALUES (?1, 120)').bind(new Date(T0).toISOString().slice(0, 10)).run();
    const j = await (await get('/api/voice/plan', env())).json<{ 今天上限: number; 今天已用: number; 今天还剩: number }>();
    expect([j.今天上限, j.今天已用, j.今天还剩]).toEqual([9000, 120, 8880]);
  });
});

// ======================================================================
describe('6. 记账：一轮三笔，记在 practical-voice / voice 名下', () => {
  it('成功的一轮：三个模型各一笔，项目和用途都对，不混进 tts', async () => {
    expect((await run(env())).status).toBe(200);
    const proj = await byProject();
    // 记账和公司现在这本一样，按 WAI_KEY（'workers-ai'）汇总成一行、req 累加：一轮三次调用 = req 3
    expect(proj.map((r) => [r.project, r.model, r.req])).toEqual([[VOICE_PROJECT, 'workers-ai', 3]]);
    const purp = await byPurpose();
    expect(purp.map((r) => r.purpose)).toEqual([VOICE_PURPOSE]);
    expect(purp[0].req).toBe(3);
    // ai_usage 的总数 = 三笔之和
    expect(await usedToday()).toBeCloseTo(purp[0].neurons, 6);
  });

  it('"语音对话实测"是用量页上的一个用途，不是挂在"其他"下面', () => {
    expect(PURPOSES).toContain(VOICE_PURPOSE);
  });

  it('失败的那一笔也记（宁可多记不要漏记），并且把真实错误原文带回去、不盖原因', async () => {
    const r = await run(env({ AI: fakeAi({ failAt: 'melotts' }).ai }));
    expect(r.status).toBe(502);
    const j = await r.json<{ 出错: string; 卡在哪一步: string; 步骤: { 这一步: string }[] }>();
    expect(j.卡在哪一步).toBe('读出来');
    expect(j.出错).toContain('替身：模型不可用');
    // 前两步的数照常带回来
    expect(j.步骤.map((s) => s.这一步)).toEqual(['转文字', '想回答']);
    expect((await byPurpose())[0].req).toBe(3);
  });
});

// ======================================================================
describe('7. 模型参数真的传对了（按官方 schema-input.json）', () => {
  it('whisper-turbo：base64 字符串 + task/language；melotts：{prompt,lang}', async () => {
    const f = fakeAi();
    expect((await run(env({ AI: f.ai }))).status).toBe(200);
    const asr = f.calls.find((c) => c.model === ASR.turbo.id)!;
    expect(asr.input.audio).toBe(AUDIO);
    expect(asr.input).toMatchObject({ task: 'transcribe', language: 'en' });
    const tts = f.calls.find((c) => c.model === TTS.melotts.id)!;
    expect(tts.input).toMatchObject({ lang: 'en' });
    expect(typeof tts.input.prompt).toBe('string');
  });

  it('@cf/openai/whisper：0～255 的整数数组（不是 base64）；aura：{text,speaker,encoding}', async () => {
    const f = fakeAi();
    const r = await run(env({ AI: f.ai }), { audio: AUDIO, mime: 'audio/webm', seconds: 6, scene: 'pitch', asr: 'whisper', tts: 'aura' });
    expect(r.status).toBe(200);
    const asr = f.calls.find((c) => c.model === ASR.whisper.id)!;
    expect(Array.isArray(asr.input.audio)).toBe(true);
    expect((asr.input.audio as number[]).every((n) => Number.isInteger(n) && n >= 0 && n <= 255)).toBe(true);
    const tts = f.calls.find((c) => c.model === TTS.aura.id)!;
    expect(tts.input).toMatchObject({ speaker: 'luna', encoding: 'mp3' });
  });

  it('选别的 LLM 就真的换模型', async () => {
    const f = fakeAi();
    await run(env({ AI: f.ai }), { audio: AUDIO, seconds: 6, scene: 'spec', llm: 'granite' });
    expect(f.calls.some((c) => c.model === LLM.granite.id)).toBe(true);
    expect(f.calls.some((c) => c.model === LLM.qwen3.id)).toBe(false);
  });
});

// ======================================================================
describe('8. 一轮的产出：三个问题的证据都在返回里', () => {
  it('每一步的毫秒、neurons、这个数是算的还是估的，外加端到端毫秒', async () => {
    const j = await (await run(env())).json<{
      步骤: { 这一步: string; 模型: string; 毫秒: number; neurons: number; neurons是估的: string }[];
      端到端毫秒: number; 这一轮neurons: number; 按这一轮推算一天能跑几轮: number; 听到的: string; 哪句不地道: string; 母语者会怎么说: string; 回答音频base64: string; 录音格式: string;
    }>();
    expect(j.步骤.map((s) => s.这一步)).toEqual(['转文字', '想回答', '读出来']);
    for (const s of j.步骤) {
      expect(s.毫秒).toBeGreaterThanOrEqual(0);
      expect(s.neurons).toBeGreaterThan(0);
      expect(s.neurons是估的).toBeTruthy();
    }
    // melotts 那一步必须自己承认是估的（按音频分钟计价，拿不到真时长）
    expect(j.步骤[2].neurons是估的).toContain('是');
    // ASR 和 LLM 那两步用的是真数（模型回的时长 / token 数）
    expect(j.步骤[0].neurons是估的).toContain('真实音频时长');
    expect(j.步骤[1].neurons是估的).toContain('真实 token 数');
    expect(j.端到端毫秒).toBeGreaterThanOrEqual(0);
    expect(j.这一轮neurons).toBeCloseTo(j.步骤.reduce((a, s) => a + s.neurons, 0), 1);
    expect(j.按这一轮推算一天能跑几轮).toBe(Math.floor(FREE_NEURONS / j.这一轮neurons));
    expect(j.听到的).toContain('goed');
    expect(j.哪句不地道).toBe('I goed to the office');
    expect(j.母语者会怎么说).toBe('I went to the office');
    expect(j.回答音频base64.length).toBeGreaterThan(0);
    expect(j.录音格式).toBe('audio/webm;codecs=opus');
  });

  it('ASR 的 neurons 优先用模型回的真实音频时长，模型不回时才退回浏览器报的秒数（并写明是哪个）', async () => {
    const 真 = await (await run(env({ AI: fakeAi({ duration: 12 }).ai }))).json<{ 步骤: { neurons: number; neurons是估的: string }[] }>();
    expect(真.步骤[0].neurons).toBeCloseTo(asrNeurons(ASR.turbo, 12 / 60), 2);
    expect(真.步骤[0].neurons是估的).toContain('真实音频时长');
    const 退 = await (await run(env({ AI: fakeAi({ duration: null }).ai }))).json<{ 步骤: { neurons: number; neurons是估的: string }[] }>();
    expect(退.步骤[0].neurons).toBeCloseTo(asrNeurons(ASR.turbo, 6 / 60), 2);
    expect(退.步骤[0].neurons是估的).toContain('浏览器报的');
  });

  it('一个字都没听出来：422、照实说，不编一句回答出来（底线 3）', async () => {
    const ai = { async run(m: string) { return m.includes('whisper') ? { text: '   ' } : {}; } };
    const r = await run(env({ AI: ai }));
    expect(r.status).toBe(422);
    expect((await r.json<{ 出错: string }>()).出错).toContain('一个字都没听出来');
  });

  it('录音缺了、太大了、没秒数：都挡在模型前面', async () => {
    const f = fakeAi();
    const e = env({ AI: f.ai });
    expect((await run(e, { seconds: 6 })).status).toBe(400);
    expect((await run(e, { audio: AUDIO })).status).toBe(400);
    expect((await run(e, { audio: btoa('x'.repeat(2_000_001)), seconds: 6 })).status).toBe(413);
    expect(f.calls).toEqual([]);
  });
});

// ======================================================================
describe('9. 提示词和解析', () => {
  it('提示词要同时要到"角色扮演的回答"和"哪句不地道 + 母语者怎么说"，并且明说不要在对话里纠错', () => {
    const p = prompt(SCENES[0], 'I goed there');
    expect(p.system).toContain('unnatural');
    expect(p.system).toContain('native');
    expect(p.system).toContain('do NOT correct them inside the conversation');
    expect(p.user).toContain('I goed there');
    expect(p.user).toContain('/no_think'); // qwen3 默认会先思考
  });

  it('四个场景就是 Amos 定的那四个高压场景', () => {
    expect(SCENES.map((s) => s.名字)).toEqual(['需求撕逼', '故障复盘', '架构辩护', 'VC Pitch']);
    for (const s of SCENES) expect(s.开场.length).toBeGreaterThan(10);
  });

  it('解析：剥 <think>、容忍前后多余文字；连 JSON 都不是时把整段话当回答，不编空值', () => {
    const ok = readReply('<think>x</think> here you go {"reply":"A","unnatural":"b","native":"c","why":"d"} done');
    expect(ok).toEqual({ reply: 'A', unnatural: 'b', native: 'c', why: 'd' });
    const bad = readReply('Scope is scope.');
    expect(bad.reply).toBe('Scope is scope.');
    expect(bad.unnatural).toBe('');
  });

  it('readAsr：拿得到真实时长就用，拿不到回 null（不拿 0 冒充）', () => {
    expect(readAsr({ text: ' hi ', transcription_info: { duration: 3.5 } })).toEqual({ text: 'hi', 真实秒数: 3.5 });
    expect(readAsr({ text: 'hi' }).真实秒数).toBe(null);
    expect(readAsr({ text: 'hi', transcription_info: { duration: 0 } }).真实秒数).toBe(null);
  });
});

// ======================================================================
describe('10. 页面：操作手册印在页面上，不显示任何密钥', () => {
  it('模块在公共工具页上，接口地址写在页面上', () => {
    expect(ADMIN_PAGE).toContain('id="t-voice"');
    expect(ADMIN_PAGE).toContain('#/tools/voice');
    expect(ADMIN_PAGE).toContain('语音对话实测');
    expect(ADMIN_PAGE).toContain("window.__voiceBase='/api/voice/'");
  });

  it('**不占二级菜单位子**：菜单还是 8 项（T-4），入口是"语音生成"那一块里的一行链接', () => {
    const nav = ADMIN_PAGE.slice(ADMIN_PAGE.indexOf('id="sub-tools"'), ADMIN_PAGE.indexOf('</nav>', ADMIN_PAGE.indexOf('id="sub-tools"')));
    expect(nav.match(/data-s="t-/g) ?? []).toHaveLength(8);
    expect(nav).not.toContain('t-voice');
    // 但从"语音生成"那一块点得到，不靠乱翻
    const tv = ADMIN_PAGE.slice(ADMIN_PAGE.indexOf('id="t-tts"'), ADMIN_PAGE.indexOf('id="t-voice"'));
    expect(tv).toContain('href="#/tools/voice"');
  });

  it('"怎么用"四步、每步写清在哪点和什么算成功；页面上不出现命令行', () => {
    const i = ADMIN_PAGE.indexOf('id="t-voice"');
    const seg = ADMIN_PAGE.slice(i, ADMIN_PAGE.indexOf('</section>', i));
    for (const w of ['开始录音', '跑一轮', '算成功', '允许', '一天最多 3 轮']) expect(seg).toContain(w);
    for (const w of ['npm ', 'curl ', 'wrangler ', 'node scripts/']) expect(seg).not.toContain(w);
  });

  it('路由表里有 voice：少了这一项页面会静悄悄地什么都不读（2026-11-03 真的漏过一次，被 e2e-tools H 段逮到）', () => {
    // TOOLV 把 #/tools/<这一段> 映成 view；没有 voice 时 view 退回 'list'，window.voiceOpen() 永远不会被调用
    expect(ADMIN_PAGE).toMatch(/TOOLV=\{[^}]*voice:'voice'/);
    expect(ADMIN_PAGE).toContain("view==='voice'");
    expect(ADMIN_PAGE).toContain('window.voiceOpen()');
  });

  it('延迟和账都摆在页面上（表头就有"毫秒"和 neurons）', () => {
    const i = ADMIN_PAGE.indexOf('id="t-voice"');
    const seg = ADMIN_PAGE.slice(i, ADMIN_PAGE.indexOf('</section>', i));
    expect(seg).toContain('<th>毫秒</th>');
    expect(seg).toContain('<th>neurons</th>');
    expect(seg).toContain('端到端');
  });

  it('不含任何密钥的值（底线 1）', async () => {
    const j = await (await run(env())).text();
    for (const s of [PASS, SID]) expect(j).not.toContain(s);
    expect(ADMIN_PAGE).not.toContain(PASS);
  });
});
