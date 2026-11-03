/**
 * Workers AI 探针（**只在测试版 marketing-staging**；页面在 src/probe-page.ts）。
 * 为什么有这一页：Practical（英语产品）要先听一听 Workers AI 的英文发音地不地道、我们的中式口音能不能被听准，
 * 这些只有 Amos 本人用耳朵和嗓子才能判断。方案和判定门槛见 agents `项目/Practical/技术方案-WorkersAI实测方案.md`，
 * 他要照着点的步骤见 agents `项目/Practical/实测操作手册.md`。
 *
 * 四条硬约定（改这个文件前先看清楚）：
 * 1. **只在测试版生效**：`ENVIRONMENT` 必须正好是 `staging`（白名单，不是"不等于 production"）。正式版连 404 都长得和别的不存在的地址一样。
 * 2. **没有鉴权**（Amos 要能直接打开，不装东西、不输密码），所以靠四层防滥用：
 *    ① 地址里的随机串 PROBE_SLUG——**本仓库是公开的，所以它不是密钥**，只挡住顺手爬到的人；
 *    ② 每分钟最多 PROBE_PER_MINUTE 次（和 /api/company/ingest 共用 company_rate 表，来源写 `probe`）；
 *    ③ **走 workers-ai.ts 同一本账**（ai_usage + usage_by_project，项目名 PROBE_PROJECT），到了后台设的每天上限就停（C117）；
 *    ④ 探针自己再有一个小得多的每天预算 PROBE_DAILY_NEURONS——Workers AI 的免费额度是**整个账号共用**的，
 *       万一有人找到这个地址乱点，最多只能用掉这点额度，正式版的备用 AI 还能照常用。
 *    这层取舍写在 PR 正文里交 Amos 知情。
 * 3. **不显示任何密钥、账号 ID**（底线 1）：页面和返回的 JSON 里只有模型名、毫秒、字节、neurons 估算。
 * 4. 录音只在浏览器和这个 Worker 之间传，**不写库、不转发第三方**；D1 里只多了用量的数字。
 *
 * 5. 这个前缀底下**还挂着素材生成器的受限入口** `/probe-<随机串>/assets/`（src/assets.ts、src/assets-page.ts）：
 *    marketing-staging 没填 COPILOT_PASSWORD，后台登录不了，所以暂时留这一个口子；同样只在 staging、同样限流，
 *    额度再多走一本它自己的小账（ASSETS_OPEN_DAILY_NEURONS）。填上密码以后走后台"公共工具 → 素材生成器"，这个口子就该关掉。
 *
 * 用完怎么下线（探针本身，agents 工作平台/工具台账.md 有登记）：删 probe.ts、probe-page.ts、test/probe.test.ts 和 index.ts 里那两行；
 * 素材生成器要留下来的话，把 /api/assets 那条留在 queue.ts 里即可（它不依赖探针）。
 */
import { assetsApi } from './assets';
import { ASSETS_PAGE } from './assets-page';
import type { Env } from './env';
import { PROBE_PAGE } from './probe-page';
import { WAI_KEY } from './usage';
import { chargeNeurons, dailyCap, usedToday, type AiLike } from './workers-ai';

/** 地址里的随机串：猜不到、也不写进任何对外文档；它不是密钥，只是别被爬到（见上面第 2 条） */
export const PROBE_SLUG = 'r7q4k2mz9x';
export const PROBE_PREFIX = `/probe-${PROBE_SLUG}`;
/** 用量按这个项目名记一份，后台"按项目看用量"里看得见 */
export const PROBE_PROJECT = 'practical-probe';
/** 每分钟最多几次（一个人手点，给足余量也用不到） */
export const PROBE_PER_MINUTE = 20;
/**
 * 探针自己每天最多用多少 neurons（免费额度 10,000 是整个账号共用的）。
 * 一整轮点完约 110 neurons，够 Amos 来回跑十几轮；被人乱点也只能用掉这么多。
 */
export const PROBE_DAILY_NEURONS = 1_500;
const RATE_SOURCE = 'probe';

export const TTS_A = '@cf/myshell-ai/melotts';
export const TTS_B = '@cf/deepgram/aura-2-en';
export const TTS_B_SPEAKER = 'luna';
export const ASR_MODEL = '@cf/openai/whisper-large-v3-turbo';
export const LLM_MODEL = '@cf/meta/llama-3.2-3b-instruct';

/** 每分钟 / 每 1000 字 的 neurons（Cloudflare 价格页，2026-11-02；用来估算，不是账单） */
const PRICE = { melottsPerMin: 18.63, auraPer1k: 2727.27, asrPerMin: 46.63, llmInPerM: 4625, llmOutPerM: 30475 };
/** melotts 按音频时长算钱：约 15 个字符 ≈ 1 秒 */
const SEC_PER_CHAR = 1 / 15;
/** 浏览器传上来的是 16kHz 单声道 16 位 WAV：每秒 32000 字节 */
const BYTES_PER_SEC = 32_000;
const MAX_TEXT = 200;
const MAX_AUDIO = 2_000_000;
/** LLM 一次最多可能用的 neurons（输入 400 token、输出 MAX_OUT） */
const MAX_OUT = 120;
const LLM_RESERVE = (400 * PRICE.llmInPerM + MAX_OUT * PRICE.llmOutPerM) / 1e6;

const ttsNeurons = (model: string, text: string) =>
  model === TTS_A ? (text.length * SEC_PER_CHAR * PRICE.melottsPerMin) / 60 : (text.length / 1000) * PRICE.auraPer1k;
const asrNeurons = (sec: number) => (sec / 60) * PRICE.asrPerMin;

const notFound = () => new Response('Not found', { status: 404 });
const json = (data: unknown, status = 200, extra: Record<string, number> = {}) =>
  new Response(JSON.stringify({ ...(data as object), ...extra }, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  });

/** 只有测试版、而且账号绑了 AI 才开；正式版任何 /probe… 都是 404（硬要求，test/probe.test.ts 守着） */
export function probeEnabled(env: Env): boolean {
  return (env.ENVIRONMENT ?? '').trim() === 'staging' && !!env.AI;
}

/** 每分钟限流：做法同 src/company.ts，用 company_rate 表的另一个来源，不新增表 */
async function underLimit(env: Env, now: number): Promise<boolean> {
  const minute = Math.floor(now / 60_000);
  const r = await env.DB.prepare('INSERT INTO company_rate (source, minute, n) VALUES (?1, ?2, 1) ON CONFLICT (source, minute) DO UPDATE SET n = n + 1 RETURNING n')
    .bind(RATE_SOURCE, minute)
    .first<{ n: number }>();
  if (minute % 10 === 0) await env.DB.prepare('DELETE FROM company_rate WHERE minute < ?1').bind(minute - 10).run();
  return (r?.n ?? 0) <= PROBE_PER_MINUTE;
}

/** 探针自己今天用掉的 neurons（从按项目记的那张表读，和记账同一本） */
async function probeUsedToday(env: Env, now: number): Promise<number> {
  try {
    const r = await env.DB.prepare('SELECT neurons FROM usage_by_project WHERE day = ?1 AND project = ?2 AND model = ?3')
      .bind(new Date(now).toISOString().slice(0, 10), PROBE_PROJECT, WAI_KEY)
      .first<{ neurons: number }>();
    return r?.neurons ?? 0;
  } catch {
    // 表还没建（老库）：当成已经用满，宁可不调模型
    return PROBE_DAILY_NEURONS;
  }
}

/**
 * 调用前先留出这次最多可能用的量；两道额度都要过：
 * 账号那本（workers-ai.ts 的 ai_usage，和备用 AI 共用，C117）和探针自己这本（PROBE_DAILY_NEURONS）。
 */
async function quotaOk(env: Env, now: number, reserve: number): Promise<{ ok: boolean; used: number; cap: number }> {
  const [used, cap, mine] = await Promise.all([usedToday(env, now), dailyCap(env), probeUsedToday(env, now)]);
  if (mine + reserve > PROBE_DAILY_NEURONS) return { ok: false, used: Math.round(mine), cap: PROBE_DAILY_NEURONS };
  return { ok: used + reserve <= cap, used: Math.round(used), cap };
}

const b64 = (buf: ArrayBuffer): string => {
  const a = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string): ArrayBuffer => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;

/** melotts 回 {audio:base64}，aura 回二进制流：两种都认 */
async function toMp3(r: unknown): Promise<ArrayBuffer> {
  if (r instanceof ReadableStream) return await new Response(r).arrayBuffer();
  if (r instanceof ArrayBuffer) return r;
  const o = r as { audio?: unknown };
  if (typeof o?.audio === 'string') return unb64(o.audio);
  throw new Error('TTS 返回的格式不认识');
}

const ai = (env: Env): AiLike => env.AI as AiLike;

async function tts(env: Env, model: string, text: string): Promise<{ ms: number; mp3: ArrayBuffer; neurons: number }> {
  const t0 = Date.now();
  const input = model === TTS_A ? { prompt: text, lang: 'en' } : { text, speaker: TTS_B_SPEAKER, encoding: 'mp3' };
  const mp3 = await toMp3(await ai(env).run(model, input));
  return { ms: Date.now() - t0, mp3, neurons: ttsNeurons(model, text) };
}

interface AsrOut { ms: number; text: string; sec: number; words: unknown; neurons: number }
async function asr(env: Env, audio: ArrayBuffer): Promise<AsrOut> {
  const t0 = Date.now();
  let out: unknown;
  // 先按 base64 传，不行再按 {body,contentType}（官方文档两种写法都出现过），两次的错都带回来
  try {
    out = await ai(env).run(ASR_MODEL, { audio: b64(audio), task: 'transcribe', language: 'en' });
  } catch (e1) {
    try {
      out = await ai(env).run(ASR_MODEL, { audio: { body: audio, contentType: 'audio/wav' } });
    } catch (e2) {
      throw new Error(`转文字失败（base64：${(e1 as Error)?.message}；body：${(e2 as Error)?.message}）`);
    }
  }
  const o = (out ?? {}) as { text?: string; transcription_info?: { duration?: number }; segments?: { words?: unknown[] }[] };
  const sec = o.transcription_info?.duration ?? audio.byteLength / BYTES_PER_SEC;
  return { ms: Date.now() - t0, text: (o.text ?? '').trim(), sec, words: o.segments?.[0]?.words ?? null, neurons: asrNeurons(sec) };
}

const SYSTEM =
  'You are a friendly English conversation partner. NEVER point out mistakes and never explain grammar. ' +
  'If the user makes an error, silently reuse the correct form in your own reply (recast) and keep the conversation going. ' +
  'Reply with ONE short spoken sentence, 8-18 words, no quotes, no emoji.';

async function llm(env: Env, said: string): Promise<{ ms: number; text: string; neurons: number }> {
  const t0 = Date.now();
  const r = (await ai(env).run(LLM_MODEL, {
    max_tokens: MAX_OUT,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: said },
    ],
  })) as { response?: string; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const u = r.usage ?? {};
  const text = (r.response ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const inT = u.prompt_tokens ?? [...SYSTEM].length / 4 + [...said].length / 4;
  const outT = u.completion_tokens ?? [...text].length / 4;
  return { ms: Date.now() - t0, text, neurons: (inT * PRICE.llmInPerM + outT * PRICE.llmOutPerM) / 1e6 };
}

/** 记一次账（成功、失败都记：失败的调用不一定计费，保守按估算记） */
const charge = (env: Env, now: number, neurons: number, status: number) => chargeNeurons(env, now, neurons, PROBE_PROJECT, status);

/**
 * 探针路由。不是 /probe… 的地址返回 null（交给 index.ts 的别的路由）。
 * 正式版（或没绑 AI）一律 404，和不存在的地址长得一样。
 */
export async function probeApi(env: Env, req: Request, now: number): Promise<Response | null> {
  const url = new URL(req.url);
  const p = url.pathname;
  if (!p.startsWith('/probe')) return null;
  if (!probeEnabled(env)) return notFound();
  if (p === PROBE_PREFIX) return Response.redirect(url.origin + PROBE_PREFIX + '/', 301);
  if (!p.startsWith(PROBE_PREFIX + '/')) return notFound();
  const sub = p.slice(PROBE_PREFIX.length + 1);

  const html = (body: string) =>
    new Response(body, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' },
    });
  if (sub === '' && req.method === 'GET') return html(PROBE_PAGE);
  if (sub === 'assets' && req.method === 'GET') return Response.redirect(url.origin + PROBE_PREFIX + '/assets/', 301);
  if (sub === 'assets/' && req.method === 'GET') return html(ASSETS_PAGE);
  if (!(await underLimit(env, now))) return json({ 出错: '点得太快了，等一分钟再点' }, 429);
  // 素材生成器的受限入口（没有登录）：限流过了以后交给 assets.ts，额度多走一本自己的小账（open = true）
  if (sub.startsWith('assets/')) {
    try {
      const r = await assetsApi(env, req, now, sub.slice('assets/'.length), true);
      return r ?? notFound();
    } catch (e) {
      const detail = String((e as Error)?.message ?? e).replace(/\s+/g, ' ').slice(0, 300);
      console.log(JSON.stringify({ event: 'assets.error', detail }));
      return json({ 出错: detail }, 502);
    }
  }

  try {
    if (sub === 'tts' && req.method === 'GET') {
      const model = url.searchParams.get('m') === 'b' ? TTS_B : TTS_A;
      const text = (url.searchParams.get('text') ?? '').trim().slice(0, MAX_TEXT) || 'Grab an apple and put it on the table.';
      const est = ttsNeurons(model, text);
      const q = await quotaOk(env, now, est);
      if (!q.ok) return json({ 出错: `今天的 AI 额度用到上限了（${q.used} / ${q.cap}），明天再试` }, 429);
      try {
        const r = await tts(env, model, text);
        await charge(env, now, r.neurons, 200);
        return new Response(r.mp3, {
          headers: {
            'content-type': 'audio/mpeg',
            'cache-control': 'no-store',
            'x-ms': String(r.ms),
            'x-bytes': String(r.mp3.byteLength),
            'x-neurons': String(Math.round(r.neurons * 10) / 10),
            'x-model': model,
          },
        });
      } catch (e) {
        await charge(env, now, est, 0);
        throw e;
      }
    }

    if (sub === 'asr' && req.method === 'POST') {
      const audio = await req.arrayBuffer();
      if (audio.byteLength > MAX_AUDIO) return json({ 出错: '录得太长了，一次最多约 60 秒' }, 413);
      const est = asrNeurons(audio.byteLength / BYTES_PER_SEC);
      const q = await quotaOk(env, now, est);
      if (!q.ok) return json({ 出错: `今天的 AI 额度用到上限了（${q.used} / ${q.cap}），明天再试` }, 429);
      try {
        const r = await asr(env, audio);
        await charge(env, now, r.neurons, 200);
        return json({ 模型: ASR_MODEL, 转出来的文字: r.text, 毫秒: r.ms, 音频秒数: Math.round(r.sec * 10) / 10, 逐词: r.words, 本次估算neurons: Math.round(r.neurons * 10) / 10 });
      } catch (e) {
        await charge(env, now, est, 0);
        throw e;
      }
    }

    if (sub === 'chain' && req.method === 'POST') {
      const t0 = Date.now();
      const audio = await req.arrayBuffer();
      if (audio.byteLength > MAX_AUDIO) return json({ 出错: '录得太长了，一次最多约 60 秒' }, 413);
      const est = asrNeurons(audio.byteLength / BYTES_PER_SEC) + LLM_RESERVE + ttsNeurons(TTS_A, 'x'.repeat(MAX_TEXT));
      const q = await quotaOk(env, now, est);
      if (!q.ok) return json({ 出错: `今天的 AI 额度用到上限了（${q.used} / ${q.cap}），明天再试` }, 429);
      let spent = 0;
      try {
        const a = await asr(env, audio);
        spent += a.neurons;
        const b = await llm(env, a.text || '(unintelligible)');
        spent += b.neurons;
        const say = (b.text || 'Sorry, could you say that again?').slice(0, MAX_TEXT);
        const c = await tts(env, TTS_A, say);
        spent += c.neurons;
        await charge(env, now, spent, 200);
        return json({
          听到: a.text,
          AI回答: b.text,
          模型: { 听懂: ASR_MODEL, 想回答: LLM_MODEL, 说出来: TTS_A },
          用时毫秒: { 听懂: a.ms, 想回答: b.ms, 说出来: c.ms, 端到端: Date.now() - t0 },
          audioBase64: b64(c.mp3),
          本次估算neurons: Math.round(spent * 10) / 10,
        });
      } catch (e) {
        await charge(env, now, Math.max(spent, est), 0);
        throw e;
      }
    }
    return notFound();
  } catch (e) {
    // 只带模型名和错误文字，不含任何密钥（底线 1）
    const detail = String((e as Error)?.message ?? e).replace(/\s+/g, ' ').slice(0, 300);
    console.log(JSON.stringify({ event: 'probe.error', detail }));
    return json({ 出错: detail }, 502);
  }
}
