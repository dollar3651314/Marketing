/**
 * 实时语音对话链路的**实测台**（后台"公共工具 → 语音对话实测"；页面在 src/voice-page.ts）。
 * 做什么：Amos 点几下，跑完一轮真实的"说一句 → 转文字（ASR）→ LLM 回答 + 指出哪句不地道 → 读出来（TTS）"，
 * 并把**每一步各花了多少毫秒、各估多少 neurons** 摆在他眼前。
 *
 * **为什么要这个东西**（Practical 新方向 N-4，Amos 2026-11-03 批）：盲听卡 11/3 判 no-go 封存，新方向是
 * "跨国科技 / Web3 职场高压场景的 AI 实时语音对话"。Gemini 给的方案是 OpenAI Whisper + GPT-4o-mini + OpenAI TTS，
 * **要花钱**（破底线 8 / C117）。这一页就是去核一件事：**同一条链路能不能跑在 Cloudflare Workers AI 的免费额度里**，
 * 以及**延迟能不能接受**（对话产品超过 2～3 秒人就不想说了）。
 *
 * 六条硬约定（改这个文件前先看清楚）：
 * 1. **跟后台登录走**：只有 `/api/voice/*` 一个入口，没登录 401、`COPILOT_PASSWORD` 没填时 404（queue.ts 的 sessionOk）。
 *    **不开没有鉴权的临时口子**——2026-11-03 刚把上一轮那套随机串地址的临时入口整套下线，理由和回归测试见 test/retired-routes.test.ts。
 *    它**不占"公共工具"的二级菜单位子**（菜单上限 8 项已满，agents 工作平台/工具台账.md 的 T-4：第 9 项会撑破手机菜单）：
 *    模块排在公共工具页最底下，入口是"语音生成"那一块里的一行链接 `#/tools/voice`。
 * 2. **自己限量**：一天最多 MAX_RUNS_PER_DAY 轮（存 settings 表 `voice_runs:<UTC 日>`），避免一次把当天额度烧光。
 *    这是**实测台自己的闸**，和 Amos 在"用量和限额"里设的那个 cap 是两回事，两道闸都要过。
 * 3. **不替 Amos 设上限**：额度那一关照旧用他自己设的 cap（usage.ts），这里只多一道轮数闸。
 * 4. **记账走 workers-ai.ts 那一本**（ai_usage + usage_by_project + usage_by_purpose），
 *    项目名 VOICE_PROJECT = `practical-voice`、用途 VOICE_PURPOSE = `voice`——**不混进 tts / practical-assets**。
 *    一轮调三次模型就记三笔，失败的那一笔也记（宁可多记不要漏记）。
 * 5. **neurons 是"按官方价格表 + 真实用量算出来的估算"，不是 Cloudflare 的账单**（usage.ts 的 waiCaveat 同一口径）。
 *    哪些数是真的：LLM 用模型回的 `usage.prompt_tokens / completion_tokens`（真 token 数）；
 *    ASR 优先用 whisper 回的 `transcription_info.duration`（真音频秒数），回不了才退回浏览器报的录音秒数；
 *    TTS 的 melotts 按音频分钟计价、我们拿不到真时长，只能按 15 字符 ≈ 1 秒估（和 tts.ts 同一套），**页面上标成"估"**。
 * 6. **不显示任何密钥、账号 ID**（底线 1）：返回的 JSON 里只有模型名、毫秒、字符数、neurons 估算和识别出来的文字。
 *
 * 价格全部来自 Cloudflare 官方定价页 https://developers.cloudflare.com/workers-ai/platform/pricing/ ，
 * **2026-11-03 查、逐条抄的原文**（底线 3：不凭印象）。免费额度 10,000 neurons/天，00:00 UTC 清零（= 台湾时间早上 8 点）。
 */
import type { Env } from './env';
import { accountLimitedMessage, isAccountLimited, noteAccountLimit, utcDay } from './usage';
import { chargeNeurons, dailyCap, usedToday, type AiLike } from './workers-ai';

/** 用量按这个项目名记一份（后台"按项目看用量"里看得见，和 tts / practical-assets 分开） */
export const VOICE_PROJECT = 'practical-voice';
/** 用量再按**用途**记一份（后台"用量和限额 → 分别用到了哪里"） */
export const VOICE_PURPOSE = 'voice';
/** 实测台自己的闸：一天最多跑几轮（底线 8 周边：别一次把当天额度烧光） */
export const MAX_RUNS_PER_DAY = 3;
/** 一次录音最多多少秒（再长就先切片，这一版不做） */
export const MAX_AUDIO_SEC = 30;
/** 一次上传的音频最多多少字节（base64 解出来以后）：30 秒 opus 约 60KB，留到 2MB */
export const MAX_AUDIO_BYTES = 2_000_000;

/** 价格表里"每音频分钟多少 neurons"的那几个（Cloudflare 定价页 Audio model pricing，2026-11-03） */
export interface AsrModel { id: string; 每音频分钟: number; 说明: string }
export const ASR: Record<string, AsrModel> = {
  whisper: { id: '@cf/openai/whisper', 每音频分钟: 41.14, 说明: '便宜一点；音频按"0～255 的整数数组"传' },
  turbo: { id: '@cf/openai/whisper-large-v3-turbo', 每音频分钟: 46.63, 说明: '贵 13%；音频按 base64 传，能带 language 和 initial_prompt，还会回真实音频时长' },
};
export const ASR_DEFAULT = 'turbo';

/** 候选 LLM：能角色扮演 + 同时输出"地道改写"的。单价都是 Cloudflare 定价页 Text generation 那张表（2026-11-03） */
export interface LlmModel { id: string; 每百万输入: number; 每百万输出: number; 说明: string }
export const LLM: Record<string, LlmModel> = {
  qwen3: { id: '@cf/qwen/qwen3-30b-a3b-fp8', 每百万输入: 4625, 每百万输出: 30475, 说明: '公司现在的备用 AI 就是它（workers-ai.ts），中文可以；默认会先"思考"，要加 /no_think' },
  llama8b: { id: '@cf/meta/llama-3.1-8b-instruct-fp8-fast', 每百万输入: 4119, 每百万输出: 34868, 说明: '输入最便宜的 8B，英语改写是它的主场' },
  granite: { id: '@cf/ibm-granite/granite-4.0-h-micro', 每百万输入: 1542, 每百万输出: 10158, 说明: '整张表里最便宜的一档（输出只要 qwen3 的三分之一），小模型、质量要实测' },
};
export const LLM_DEFAULT = 'qwen3';

/** TTS：和 tts.ts 同两个模型、同两个单价（定价页 Audio model pricing，2026-11-03） */
export interface TtsModel { id: string; 每音频分钟?: number; 每千字符?: number; 说明: string }
export const TTS: Record<string, TtsModel> = {
  melotts: { id: '@cf/myshell-ai/melotts', 每音频分钟: 18.63, 说明: 'Amos 11/3 实测判"地道"：一句 38 字符约 0.8 neurons' },
  aura: { id: '@cf/deepgram/aura-2-en', 每千字符: 2727.27, 说明: 'Amos 11/3 实测同一句约 103.6 neurons = melotts 的 129.5 倍（实测值；按价格表算是 131.8 倍）' },
};
export const TTS_DEFAULT = 'melotts';

/** melotts 按音频时长计价，我们拿不到真时长：约 15 个字符 ≈ 1 秒（和 tts.ts 同一套估法） */
export const SEC_PER_CHAR = 1 / 15;

/** 四个场景（Practical 新方向：跨国科技 / Web3 职场高压场景） */
export interface Scene { key: string; 名字: string; 开场: string; 角色: string }
export const SCENES: Scene[] = [
  { key: 'spec', 名字: '需求撕逼', 开场: 'We need this feature in the next sprint. Why is your team pushing back?', 角色: 'an aggressive product manager in a cross-border Web3 startup, pushing hard on scope' },
  { key: 'postmortem', 名字: '故障复盘', 开场: 'The bridge was down for forty minutes last night. Walk me through what happened.', 角色: 'a calm but relentless VP of Engineering running a blameless post-mortem' },
  { key: 'architecture', 名字: '架构辩护', 开场: 'Why did you pick an event-driven design here instead of plain RPC?', 角色: 'a skeptical staff engineer challenging an architecture decision in a design review' },
  { key: 'pitch', 名字: 'VC Pitch', 开场: 'You have sixty seconds. What are you building and why now?', 角色: 'a crypto-native VC partner who interrupts and asks sharp follow-up questions' },
];
export const sceneOf = (k: unknown): Scene => SCENES.find((s) => s.key === k) ?? SCENES[0];

// ======================================================================
// 一、算术：一轮 10 分钟对话要多少 neurons、一天 10,000 够跑几轮
// 纯函数，不碰网络也不碰数据库，测试直接断言（底线 6）
// ======================================================================

/** Gemini 给的"典型一轮 10 分钟对话"的用量口径（N-4 任务书原文，不是实测） */
export interface Typical { 往返轮次: number; 用户说话分钟: number; AI回复字符: number; LLM输入token: number; LLM输出token: number }
export const TYPICAL: Typical = { 往返轮次: 15, 用户说话分钟: 4, AI回复字符: 1500, LLM输入token: 12_000, LLM输出token: 3_000 };

/** Cloudflare 免费额度：每天 10,000 neurons，00:00 UTC 清零（定价页原文） */
export const FREE_NEURONS = 10_000;
/** 超出免费额度以后的单价：$0.011 / 1,000 neurons（定价页原文） */
export const USD_PER_1K = 0.011;

export const round = (n: number, d = 2): number => Math.round(n * 10 ** d) / 10 ** d;

/** 一段音频（分钟）在某个 ASR 上要多少 neurons */
export const asrNeurons = (m: AsrModel, 分钟: number): number => Math.max(0, 分钟) * m.每音频分钟;
/** 一次 LLM 调用（真 token 数）要多少 neurons */
export const llmNeurons = (m: LlmModel, inTok: number, outTok: number): number =>
  (Math.max(0, inTok) * m.每百万输入 + Math.max(0, outTok) * m.每百万输出) / 1e6;
/** 一段文字在某个 TTS 上要多少 neurons（melotts 按估算时长，aura 按字符数——和 tts.ts 一致） */
export const ttsNeurons = (m: TtsModel, 字符数: number): number => {
  const n = Math.max(0, 字符数);
  if (m.每千字符 != null) return (n / 1000) * m.每千字符;
  return (n * SEC_PER_CHAR * (m.每音频分钟 ?? 0)) / 60;
};

export interface RoundCost { asr: number; llm: number; tts: number; 合计: number }
/** 一轮 10 分钟对话的账（按 TYPICAL 口径；**算术，不是实测**） */
export function roundCost(asr: AsrModel, llm: LlmModel, tts: TtsModel, t: Typical = TYPICAL): RoundCost {
  const a = asrNeurons(asr, t.用户说话分钟);
  const l = llmNeurons(llm, t.LLM输入token, t.LLM输出token);
  const s = ttsNeurons(tts, t.AI回复字符);
  return { asr: round(a), llm: round(l), tts: round(s), 合计: round(a + l + s) };
}

export interface Combo { 组合: string; asr: string; llm: string; tts: string; 一轮neurons: number; 明细: RoundCost; 一天能跑几轮: number }
/** 把几种搭配各算一遍，按"一轮多少 neurons"从便宜到贵排 */
export function combos(free = FREE_NEURONS): Combo[] {
  const out: Combo[] = [];
  for (const [ak, a] of Object.entries(ASR))
    for (const [lk, l] of Object.entries(LLM))
      for (const [tk, t] of Object.entries(TTS)) {
        const c = roundCost(a, l, t);
        out.push({ 组合: `${ak} + ${lk} + ${tk}`, asr: ak, llm: lk, tts: tk, 一轮neurons: c.合计, 明细: c, 一天能跑几轮: Math.floor(free / c.合计) });
      }
  return out.sort((x, y) => x.一轮neurons - y.一轮neurons);
}

/** N 个用户每人每天 M 轮，一天要多少 neurons、超出免费额度多少倍、按官方单价要多少钱 */
export interface ScaleCost { 用户数: number; 每人每天轮数: number; 一天neurons: number; 是免费额度的几倍: number; 超出部分每天美元: number; 超出部分每月美元: number }
export function scale(oneRound: number, 用户数: number, 每人每天轮数 = 1, free = FREE_NEURONS): ScaleCost {
  const 一天 = oneRound * 用户数 * 每人每天轮数;
  const 超 = Math.max(0, 一天 - free);
  return {
    用户数,
    每人每天轮数,
    一天neurons: round(一天, 0),
    是免费额度的几倍: round(一天 / free),
    超出部分每天美元: round((超 / 1000) * USD_PER_1K, 3),
    超出部分每月美元: round((超 / 1000) * USD_PER_1K * 30, 2),
  };
}

// ======================================================================
// 二、接口
// ======================================================================

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  });

const ai = (env: Env): AiLike => env.AI as AiLike;

const b64 = (buf: ArrayBuffer): string => {
  const a = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** melotts 回 {audio:base64}，aura 回二进制流：两种都认（和 tts.ts 同一套） */
async function toMp3(r: unknown): Promise<ArrayBuffer> {
  if (r instanceof ReadableStream) return await new Response(r).arrayBuffer();
  if (r instanceof ArrayBuffer) return r;
  const o = (r ?? {}) as { audio?: unknown };
  if (typeof o.audio === 'string') return unb64(o.audio).buffer as ArrayBuffer;
  throw new Error('语音模型返回的格式不认识');
}

/** 今天已经跑了几轮（实测台自己的闸，存 settings） */
export async function runsToday(env: Env, now: number): Promise<number> {
  const r = await env.DB.prepare('SELECT value FROM settings WHERE key = ?1').bind('voice_runs:' + utcDay(now)).first<{ value: string }>();
  const n = Number(r?.value ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
async function bumpRuns(env: Env, now: number): Promise<void> {
  const key = 'voice_runs:' + utcDay(now);
  await env.DB.prepare(
    'INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3) ' +
      "ON CONFLICT (key) DO UPDATE SET value = CAST(CAST(settings.value AS INTEGER) + 1 AS TEXT), updated_at = ?3",
  )
    .bind(key, '1', now)
    .run();
}

/** 提示词：角色扮演 + 同时指出哪句不地道、母语者会怎么说（一次调用拿两样东西，省一次 LLM） */
export function prompt(scene: Scene, said: string): { system: string; user: string } {
  return {
    system:
      `You are ${scene.角色}. Stay in character and reply in natural spoken English, at most 3 sentences. ` +
      `The user is a Chinese software engineer practising high-pressure English at work; do NOT correct them inside the conversation — stay in role. ` +
      `Separately, judge the ONE phrase in their line that sounds least like a native speaker and give the native rewrite. ` +
      `Answer with one JSON object only: {"reply":"…","unnatural":"the exact phrase they said, or empty if it already sounds native","native":"how a native speaker would say it, or empty","why":"one short sentence in 简体中文"}.`,
    user: `Scene: ${scene.名字}. The interviewer's opening line was: "${scene.开场}"\nThe user just said: "${said}"\n/no_think`,
  };
}

/** 把 LLM 回的东西读成四个字段（去掉 <think>，容忍前后多余文字） */
export function readReply(text: string): { reply: string; unnatural: string; native: string; why: string } {
  const t = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  let o: Record<string, unknown> = {};
  if (a >= 0 && b > a) {
    try {
      o = JSON.parse(t.slice(a, b + 1)) as Record<string, unknown>;
    } catch {
      /* 解析不了就当没有，下面退回整段文字 */
    }
  }
  const s = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  // 连 JSON 都不是时，把整段文字当回答（照实呈现，不编）
  return { reply: s(o.reply, 600) || t.slice(0, 600), unnatural: s(o.unnatural, 200), native: s(o.native, 300), why: s(o.why, 200) };
}

/** 从 ASR 的返回里取文字和真实音频秒数（whisper-large-v3-turbo 会回 transcription_info.duration） */
export function readAsr(r: unknown): { text: string; 真实秒数: number | null } {
  const o = (r ?? {}) as { text?: unknown; transcription_info?: { duration?: unknown } };
  const d = o.transcription_info?.duration;
  return { text: typeof o.text === 'string' ? o.text.trim() : '', 真实秒数: typeof d === 'number' && Number.isFinite(d) && d > 0 ? d : null };
}

interface StepOut { 这一步: string; 模型: string; 毫秒: number; neurons: number; neurons是估的: string; 产出: string }

/**
 * 语音对话实测台的接口。`sub` 是去掉 `/api/voice/` 以后的那一段（plan / run）。
 * 不认识的 sub 返回 null，由调用方给 404。鉴权在 queue.ts 的 adminApi 里已经过了。
 */
export async function voiceApi(env: Env, req: Request, now: number, sub: string): Promise<Response | null> {
  if (sub === 'plan' && req.method === 'GET') {
    const [used, cap, runs] = await Promise.all([usedToday(env, now), dailyCap(env), runsToday(env, now)]);
    const list = combos();
    return json({
      典型一轮口径: TYPICAL,
      口径来源: 'Gemini 给的典型用量（N-4 任务书），不是实测',
      免费额度: FREE_NEURONS,
      免费额度来源: 'https://developers.cloudflare.com/workers-ai/platform/pricing/（2026-11-03 查）：10,000 Neurons per day，00:00 UTC 清零',
      超出单价美元每千neurons: USD_PER_1K,
      价格表: {
        ASR: Object.fromEntries(Object.entries(ASR).map(([k, v]) => [k, { 模型: v.id, 每音频分钟neurons: v.每音频分钟, 说明: v.说明 }])),
        LLM: Object.fromEntries(Object.entries(LLM).map(([k, v]) => [k, { 模型: v.id, 每百万输入neurons: v.每百万输入, 每百万输出neurons: v.每百万输出, 说明: v.说明 }])),
        TTS: Object.fromEntries(Object.entries(TTS).map(([k, v]) => [k, { 模型: v.id, 每音频分钟neurons: v.每音频分钟 ?? null, 每千字符neurons: v.每千字符 ?? null, 说明: v.说明 }])),
      },
      搭配: list,
      最省的那档: list[0],
      现在选的默认: list.find((c) => c.asr === ASR_DEFAULT && c.llm === LLM_DEFAULT && c.tts === TTS_DEFAULT) ?? null,
      一百个用户: list.length ? [scale(list[0].一轮neurons, 100, 1), scale(list[0].一轮neurons, 100, 2)] : [],
      场景: SCENES.map((s) => ({ key: s.key, 名字: s.名字, 开场: s.开场 })),
      今天已跑轮数: runs,
      实测台一天最多: MAX_RUNS_PER_DAY,
      今天已用: Math.round(used),
      今天上限: cap,
      今天还剩: Math.max(0, Math.round(cap - used)),
      提醒: 'neurons 一律是"按官方价格表 + 真实用量算出来的估算"，不是 Cloudflare 的账单。',
    });
  }

  if (sub === 'run' && req.method === 'POST') {
    if (!env.AI) return json({ 出错: '这个环境没有绑 Workers AI' }, 503);

    const runs = await runsToday(env, now);
    if (runs >= MAX_RUNS_PER_DAY)
      return json({ 出错: `实测台今天已经跑了 ${runs} 轮，一天最多 ${MAX_RUNS_PER_DAY} 轮就停（免得一次把当天额度烧光）。明天台湾时间早上 8 点以后再来。`, 今天已跑轮数: runs }, 429);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const scene = sceneOf(body.scene);
    const asr = ASR[typeof body.asr === 'string' ? body.asr : ''] ?? ASR[ASR_DEFAULT];
    const llm = LLM[typeof body.llm === 'string' ? body.llm : ''] ?? LLM[LLM_DEFAULT];
    const tts = TTS[typeof body.tts === 'string' ? body.tts : ''] ?? TTS[TTS_DEFAULT];

    const audioB64 = typeof body.audio === 'string' ? body.audio : '';
    if (!audioB64) return json({ 出错: '没收到录音。先按"开始录音"说一句，再按一次结束。' }, 400);
    let bytes: Uint8Array;
    try {
      bytes = unb64(audioB64);
    } catch {
      return json({ 出错: '录音数据不是合法的 base64' }, 400);
    }
    if (bytes.byteLength > MAX_AUDIO_BYTES) return json({ 出错: `录音太大了（${bytes.byteLength} 字节，最多 ${MAX_AUDIO_BYTES}）。说短一点再试。` }, 413);
    const 浏览器报的秒数 = typeof body.seconds === 'number' && Number.isFinite(body.seconds) && body.seconds > 0 ? Math.min(body.seconds, MAX_AUDIO_SEC) : 0;
    if (!浏览器报的秒数) return json({ 出错: '浏览器没报出录音秒数，重录一次。' }, 400);
    const mime = typeof body.mime === 'string' ? body.mime.slice(0, 60) : '（浏览器没报）';

    // 够不够：按**最坏估算**先留出来（ASR 按浏览器报的秒数、LLM 按一次最多、TTS 按回复上限 600 字符）
    const 预估 = asrNeurons(asr, 浏览器报的秒数 / 60) + llmNeurons(llm, 2_000, 600) + ttsNeurons(tts, 600);
    const [used0, cap] = await Promise.all([usedToday(env, now), dailyCap(env)]);
    if (used0 + 预估 > cap)
      return json(
        {
          出错: `今天的 Workers AI 额度不够了：这一轮大概要 ${Math.round(预估)} neurons，今天已经用了 ${Math.round(used0)} / ${cap}。等台湾时间早上 8 点清零，或者到"用量和限额"里把上限改大（上限只有你能改）。`,
          今天已用: Math.round(used0),
          今天上限: cap,
        },
        429,
      );

    // 先把轮数记上：跑之前就占位，中途失败也算一轮（宁可多算，闸才守得住）
    await bumpRuns(env, now);

    const steps: StepOut[] = [];
    const t开始 = Date.now();
    /** 每一步的错都走这里：按估算记一笔账，再把真实错误原文回给页面（不编、不盖原因） */
    const fail = async (这一步: string, model: string, est: number, e: unknown) => {
      await chargeNeurons(env, now, est, VOICE_PROJECT, 0, VOICE_PURPOSE);
      const detail = String((e as Error)?.message ?? e).replace(/\s+/g, ' ').slice(0, 300);
      console.log(JSON.stringify({ event: 'voice.error', step: 这一步, model, detail }));
      if (isAccountLimited(detail)) {
        await noteAccountLimit(env, now, detail);
        return json({ 出错: accountLimitedMessage(detail, now), 卡在哪一步: 这一步, 步骤: steps, 今天已跑轮数: runs + 1 }, 429);
      }
      return json({ 出错: `${这一步}这一步出错了：${detail}`, 卡在哪一步: 这一步, 录音格式: mime, 步骤: steps, 今天已跑轮数: runs + 1 }, 502);
    };

    // ---- 第 1 步：说的话转成文字（ASR）----
    const t1 = Date.now();
    let 听到的: string;
    let asrNeu: number;
    let 秒数来源: string;
    const asr预估 = asrNeurons(asr, 浏览器报的秒数 / 60);
    try {
      // whisper-large-v3-turbo 收 base64 字符串；@cf/openai/whisper 收 0～255 的整数数组（两张 schema-input.json，2026-11-03 查）
      const input = asr.id === ASR.turbo.id ? { audio: audioB64, task: 'transcribe', language: 'en' } : { audio: [...bytes] };
      const r = await ai(env).run(asr.id, input);
      const got = readAsr(r);
      听到的 = got.text;
      const 秒 = got.真实秒数 ?? 浏览器报的秒数;
      秒数来源 = got.真实秒数 != null ? '模型回的真实音频时长' : '浏览器报的录音时长（模型没回时长）';
      asrNeu = asrNeurons(asr, 秒 / 60);
    } catch (e) {
      return await fail('转文字', asr.id, asr预估, e);
    }
    await chargeNeurons(env, now, asrNeu, VOICE_PROJECT, 200, VOICE_PURPOSE);
    steps.push({ 这一步: '转文字', 模型: asr.id, 毫秒: Date.now() - t1, neurons: round(asrNeu), neurons是估的: `否：按价格表 ${asr.每音频分钟}/音频分钟 × ${秒数来源}`, 产出: 听到的 || '（一个字都没听出来）' });
    if (!听到的) return json({ 出错: '一个字都没听出来。确认麦克风有声音、说长一点再试。', 卡在哪一步: '转文字', 录音格式: mime, 步骤: steps, 今天已跑轮数: runs + 1 }, 422);

    // ---- 第 2 步：LLM 角色扮演 + 指出哪句不地道 ----
    const t2 = Date.now();
    const p = prompt(scene, 听到的);
    const llm预估 = llmNeurons(llm, 2_000, 600);
    let 回答: ReturnType<typeof readReply>;
    let llmNeu: number;
    let token来源: string;
    try {
      const r = (await ai(env).run(llm.id, {
        messages: [
          { role: 'system', content: p.system },
          { role: 'user', content: p.user },
        ],
        max_tokens: 600,
      })) as { response?: unknown; choices?: { message?: { content?: unknown } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const raw = r?.response ?? r?.choices?.[0]?.message?.content ?? '';
      const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
      回答 = readReply(text);
      const inTok = r?.usage?.prompt_tokens;
      const outTok = r?.usage?.completion_tokens;
      token来源 = inTok != null && outTok != null ? '模型回的真实 token 数' : '模型没回 token 数，按字符数估';
      llmNeu = llmNeurons(llm, inTok ?? [...p.system].length + [...p.user].length, outTok ?? [...text].length);
    } catch (e) {
      return await fail('想回答', llm.id, llm预估, e);
    }
    await chargeNeurons(env, now, llmNeu, VOICE_PROJECT, 200, VOICE_PURPOSE);
    steps.push({ 这一步: '想回答', 模型: llm.id, 毫秒: Date.now() - t2, neurons: round(llmNeu), neurons是估的: `否：按价格表 ${llm.每百万输入}/${llm.每百万输出} 每百万 token × ${token来源}`, 产出: 回答.reply });

    // ---- 第 3 步：把回答读出来（TTS）----
    const t3 = Date.now();
    const 要读的 = 回答.reply.slice(0, 600);
    const ttsNeu = ttsNeurons(tts, 要读的.length);
    let mp3: ArrayBuffer;
    try {
      const input = tts.id === TTS.aura.id ? { text: 要读的, speaker: 'luna', encoding: 'mp3' } : { prompt: 要读的, lang: 'en' };
      mp3 = await toMp3(await ai(env).run(tts.id, input));
    } catch (e) {
      return await fail('读出来', tts.id, ttsNeu, e);
    }
    await chargeNeurons(env, now, ttsNeu, VOICE_PROJECT, 200, VOICE_PURPOSE);
    steps.push({
      这一步: '读出来',
      模型: tts.id,
      毫秒: Date.now() - t3,
      neurons: round(ttsNeu),
      neurons是估的: tts.每千字符 != null ? `否：按价格表 ${tts.每千字符}/千字符 × 真实 ${要读的.length} 字符` : `**是**：melotts 按音频分钟计价，拿不到真时长，按 15 字符≈1 秒估（${要读的.length} 字符）`,
      产出: `${mp3.byteLength} 字节 MP3`,
    });

    const after = await usedToday(env, now);
    const 合计 = steps.reduce((s, x) => s + x.neurons, 0);
    return json({
      场景: scene.名字,
      开场白: scene.开场,
      录音格式: mime,
      录音秒数: round(浏览器报的秒数, 1),
      听到的,
      回答: 回答.reply,
      哪句不地道: 回答.unnatural || '（模型说这句已经够地道了，或者没给）',
      母语者会怎么说: 回答.native || '（没给）',
      为什么: 回答.why || '（没给）',
      回答音频base64: b64(mp3),
      回答音频mime: 'audio/mpeg',
      步骤: steps,
      端到端毫秒: Date.now() - t开始,
      这一轮neurons: round(合计),
      按这一轮推算一天能跑几轮: 合计 > 0 ? Math.floor(FREE_NEURONS / 合计) : null,
      今天已跑轮数: runs + 1,
      实测台一天最多: MAX_RUNS_PER_DAY,
      今天已用: Math.round(after),
      今天上限: cap,
      提醒: '这一轮只说了一句话；10 分钟一轮对话按 Gemini 的口径是 15 个往返，账看 plan 里的"搭配"。',
    });
  }

  return null;
}
