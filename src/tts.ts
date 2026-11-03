/**
 * 语音生成（后台"公共工具 → 语音生成"；页面在 src/tts-page.ts）。
 * 做什么：粘一段英文 → 选模型 → 生成一段 MP3 → 当场试听 → 下载。
 *
 * **为什么它是"公共工具"、而不是塞在素材生成器里**（Amos 2026-11-03"生成语音的工具 需要被管理起来…放到公共工具中"）：
 * "公共工具"的定义是**服务所有项目**的东西。素材生成器（src/assets.ts）绑死在 Practical 盲听卡那 30 个场景上
 * （按场景编号 / 格子记台账、图片和音频一起批量跑、断点续传），是**项目专用**的；
 * 而"给一段英文、生成一段地道发音"是**跨项目可复用**的——forecast 以后做语音内容、Practical 平时补一句改一句都用得上，
 * 埋在批量生成器里就单独调不出来。所以拆成独立的一项，两边各记各的账（见第 4 条）。
 *
 * 四条硬约定（改这个文件前先看清楚）：
 * 1. **跟后台登录走**：只有 `/api/tts/*` 一个入口，没登录 401、`COPILOT_PASSWORD` 没填时 404（queue.ts 的 sessionOk）。
 *    **不开没有鉴权的临时口子**——2026-11-03 刚把测试版上那套随机串地址的临时入口整套下线，见 test/retired-routes.test.ts。
 * 2. **不替 Amos 设上限、也不改"用量和限额"里的数**（Amos 2026-11-02"降多少我自己来处理"）：
 *    这里只做两件事——生成前把"这次大概要花多少 neurons、今天还剩多少"摆出来让他自己决定；
 *    真的要超过他设的那个上限时停下来报错（C117）。
 * 3. **贵的模型要先说清代价**：默认 melotts（Amos 11/3 实测判"地道"，单句约 0.8 neurons）；
 *    aura-2-en 只是可选项，页面上和 `plan` 的返回里都把"贵多少倍"算出来摆在他眼前，不能只给个模型名让他猜。
 *    两个数字都是真的，别混：**按价格表算是 131.8 倍**（`贵多少倍` 就是这个，和字数无关）；
 *    Amos 11/3 那句 38 个字符的实测记的是 **103.6 对 0.8 ≈ 129.5 倍**，差在他把 0.787 记成了 0.8。页面上两个都写。
 * 4. **记账走 workers-ai.ts 那一本**（ai_usage + usage_by_project），项目名单独用 TTS_PROJECT = `tts`，
 *    **不混进 practical-assets**——混了就看不出哪一笔是谁花的。
 * 5. **不存字节**：生成的 MP3 只在这次响应里回给浏览器，不落库、不转发第三方。
 * 6. **不显示任何密钥、账号 ID**（底线 1）：返回的 JSON 里只有模型名、毫秒、字节、neurons 估算。
 */
import type { Env } from './env';
import { chargeNeurons, dailyCap, usedToday, type AiLike } from './workers-ai';

/** 默认模型：Amos 2026-11-03 实测判"地道"，而且便宜 */
export const TTS_MELOTTS = '@cf/myshell-ai/melotts';
/** 可选模型：音色更好，但**贵得多**（页面上必须写明倍数） */
export const TTS_AURA = '@cf/deepgram/aura-2-en';
export const AURA_SPEAKER = 'luna';
/** 用量按这个项目名记一份，后台"按项目看用量"里看得见（和素材生成器的 practical-assets 分开） */
export const TTS_PROJECT = 'tts';
/** 用量再按**用途**记一份（usage_by_purpose，后台"用量和限额 → 分别用到了哪里"）：语音生成单独一项 */
export const TTS_PURPOSE = 'tts';

/**
 * 单价（Cloudflare 价格页，2026-11-02）：melotts **18.63 neurons / 音频分钟**；aura-2-en **2727.27 neurons / 1000 字符**。
 * melotts 按音频时长算钱：约 15 个字符 ≈ 1 秒（和素材生成器同一套；Amos 11/3 实测单句 0.8 neurons，和这个公式对得上）。
 */
const MELOTTS_PER_MIN = 18.63;
const AURA_PER_1K = 2727.27;
const SEC_PER_CHAR = 1 / 15;
/** 一次最多多少字（贵的那个模型 500 字就要 1,364 neurons，所以必须先看 plan 再生成） */
export const MAX_TEXT = 500;

/** 给 Practical 用时的输出规格（《素材方案-交给Amos的生产包》）：工具本身不强制，页面上提示 */
export const SPEC = { mime: 'audio/mpeg', 声道: '单声道', 采样率: '≥ 24kHz', 码率: '≥ 64kbps', 时长秒: [1.0, 2.5] as const };

export type ModelKey = 'melotts' | 'aura';
export const modelOf = (k: string): string => (k === 'aura' ? TTS_AURA : TTS_MELOTTS);

/** 这段文字用某个模型大概要花多少 neurons（估算，不是账单） */
export const ttsNeurons = (model: string, text: string): number =>
  model === TTS_AURA ? (text.length / 1000) * AURA_PER_1K : (text.length * SEC_PER_CHAR * MELOTTS_PER_MIN) / 60;
/** 估算音频时长（秒）：给"1.0～2.5 秒"那条规格提示用 */
export const ttsSeconds = (text: string): number => text.length * SEC_PER_CHAR;

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

export interface TtsPlan {
  字数: number;
  预计秒数: number;
  melotts: number;
  aura: number;
  贵多少倍: number | null;
  选中的模型: string;
  这次要花neurons: number;
  今天已用: number;
  今天上限: number;
  今天还剩: number;
  够不够: boolean;
  规格提示: string;
}

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
const unb64 = (s: string): ArrayBuffer => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;

/** melotts 回 {audio:base64}，aura 回二进制流：两种都认 */
async function toMp3(r: unknown): Promise<ArrayBuffer> {
  if (r instanceof ReadableStream) return await new Response(r).arrayBuffer();
  if (r instanceof ArrayBuffer) return r;
  const o = (r ?? {}) as { audio?: unknown };
  if (typeof o.audio === 'string') return unb64(o.audio);
  throw new Error('语音模型返回的格式不认识');
}

/**
 * 额度检查。只看账号那本（ai_usage，和备用 AI、素材生成器共用，C117）——**不替 Amos 另设一层**，
 * 用的就是他自己在"用量和限额"里设的那个数。
 */
async function quota(env: Env, now: number, reserve: number): Promise<{ ok: boolean; used: number; cap: number; why: string }> {
  const [used, cap] = await Promise.all([usedToday(env, now), dailyCap(env)]);
  if (used + reserve > cap)
    return {
      ok: false,
      used: Math.round(used),
      cap,
      why: `今天的 Workers AI 额度不够了：这一次大概要 ${Math.round(reserve)} neurons，今天已经用了 ${Math.round(used)} / ${cap}。明天再生成，或者到"用量和限额"里把上限改大（上限只有你能改）。`,
    };
  return { ok: true, used: Math.round(used), cap, why: '' };
}

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim().slice(0, MAX_TEXT) : '');

const specHint = (sec: number) =>
  `给 Practical 盲听卡用时的规格：MP3、${SPEC.声道}、${SPEC.采样率}、${SPEC.码率}、时长 ${SPEC.时长秒[0]}～${SPEC.时长秒[1]} 秒。` +
  `这一段估算约 ${round(sec)} 秒${sec < SPEC.时长秒[0] || sec > SPEC.时长秒[1] ? '，**超出那个区间**，拿去当盲听卡素材前先听一遍、必要时改短或改长' : '，在区间里'}。` +
  `（工具本身不强制，只是提示。）`;

/**
 * 语音生成的接口。`sub` 是去掉 `/api/tts/` 以后的那一段（plan / gen）。
 * 不认识的 sub 返回 null，由调用方给 404。鉴权在 queue.ts 的 adminApi 里已经过了。
 */
export async function ttsApi(env: Env, req: Request, now: number, sub: string): Promise<Response | null> {
  const url = new URL(req.url);

  if (sub === 'plan' && req.method === 'GET') {
    const text = clean(url.searchParams.get('text'));
    const model = modelOf(url.searchParams.get('m') ?? '');
    const a = ttsNeurons(TTS_MELOTTS, text);
    const b = ttsNeurons(TTS_AURA, text);
    const need = ttsNeurons(model, text);
    const [used, cap] = await Promise.all([usedToday(env, now), dailyCap(env)]);
    const left = Math.max(0, cap - used);
    const plan: TtsPlan = {
      字数: text.length,
      预计秒数: round(ttsSeconds(text)),
      melotts: round(a, 2),
      aura: round(b, 2),
      // 倍数和字数无关（两个模型都按字数线性算），所以空文本时给 null 而不是 0
      贵多少倍: a > 0 ? round(b / a) : null,
      选中的模型: model,
      这次要花neurons: round(need, 2),
      今天已用: Math.round(used),
      今天上限: cap,
      今天还剩: Math.round(left),
      够不够: need <= left,
      规格提示: specHint(ttsSeconds(text)),
    };
    return json(plan);
  }

  if (sub === 'gen' && req.method === 'POST') {
    if (!env.AI) return json({ 出错: '这个环境没有绑 Workers AI' }, 503);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const text = clean(body.text);
    if (!text) return json({ 出错: `先粘一段要读的英文进来（一次最多 ${MAX_TEXT} 个字符）` }, 400);
    const key = typeof body.model === 'string' ? body.model : 'melotts';
    if (key !== 'melotts' && key !== 'aura') return json({ 出错: '只能选 melotts 或 aura' }, 400);
    const model = modelOf(key);

    const est = ttsNeurons(model, text);
    const q = await quota(env, now, est);
    if (!q.ok) return json({ 出错: q.why, 今天已用: q.used, 今天上限: q.cap }, 429);

    const t0 = Date.now();
    let mp3: ArrayBuffer;
    try {
      const input = model === TTS_AURA ? { text, speaker: AURA_SPEAKER, encoding: 'mp3' } : { prompt: text, lang: 'en' };
      mp3 = await toMp3(await ai(env).run(model, input));
    } catch (e) {
      // 失败的调用不一定不计费，保守按估算记一次
      await chargeNeurons(env, now, est, TTS_PROJECT, 0, TTS_PURPOSE);
      // 只带模型名和错误文字，不含任何密钥（底线 1）
      const detail = String((e as Error)?.message ?? e).replace(/\s+/g, ' ').slice(0, 300);
      console.log(JSON.stringify({ event: 'tts.error', model, detail }));
      return json({ 出错: detail }, 502);
    }
    await chargeNeurons(env, now, est, TTS_PROJECT, 200, TTS_PURPOSE);
    const after = await quota(env, now, 0);
    const sec = ttsSeconds(text);
    return json({
      模型: model,
      文件名: `tts-${new Date(now).toISOString().slice(0, 10)}-${key}.mp3`,
      mime: SPEC.mime,
      base64: b64(mp3),
      字节: mp3.byteLength,
      毫秒: Date.now() - t0,
      预计秒数: round(sec),
      本次估算neurons: round(est, 2),
      今天已用: after.used,
      今天上限: after.cap,
      规格提示: specHint(sec),
    });
  }

  return null;
}
