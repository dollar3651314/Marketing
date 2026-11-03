/**
 * 素材生成器（后台"公共工具 → 素材生成器"；页面在 src/assets-page.ts）。
 * 做什么：Amos 点一下，按场景批量生成 Practical Level 1 盲听卡的素材——
 * 每个场景 1 段音频（melotts）＋ 4 张图（flux-1-schnell：1 张正确图 + 3 张干扰图），生成完在浏览器里打包成 zip 下载。
 * 规格和提示词模板见 agents `项目/Practical/素材方案-交给Amos的生产包.md`；30 个场景的清单和提示词**不写在本仓库里**（C147），
 * 由页面上粘贴 / 上传 JSON 带进来（格式见 assets-page.ts 的"格式说明"）。
 *
 * 四条硬约定（改这个文件前先看清楚）：
 * 1. **不替 Amos 设上限、也不改 Marketing 的每天上限**（Amos 2026-11-03"额度他自己管"）：
 *    这里只做两件事——生成前把"这次大概要花多少 neurons、今天还剩多少"显示出来让他自己决定；真的要超过后台设的上限时停下来报错（C117）。
 * 2. **只有一个入口**：`/api/assets/*`，跟后台登录走（密码会话，queue.ts 的 sessionOk）。
 *    2026-11-03 Amos 填上 `COPILOT_PASSWORD` 之前，测试版上还临时挂过一个不用登录的受限入口（随机串地址）；
 *    密码填好、后台能登录以后那个口子已经**整个删掉**，登记在 agents `工作平台/工具台账.md`，
 *    `test/retired-routes.test.ts` 守着它现在一律 404。
 * 3. **不存字节**：D1 里只有 asset_gen 这张台账（哪一格生成过几次、留用没有、估算 neurons），图片和音频只在浏览器里，不落库、不转发第三方。
 * 4. **不显示任何密钥、账号 ID**（底线 1）：返回的 JSON 里只有模型名、毫秒、字节、neurons 估算。
 */
import type { Env } from './env';
import { accountLimitedMessage, isAccountLimited, noteAccountLimit } from './usage';
import { chargeNeurons, dailyCap, usedToday, type AiLike } from './workers-ai';

export const IMG_MODEL = '@cf/black-forest-labs/flux-1-schnell';
export const TTS_MODEL = '@cf/myshell-ai/melotts';
/** 用量按这个项目名记一份，后台"按项目看用量"里看得见 */
export const ASSETS_PROJECT = 'practical-assets';
/**
 * 用量再按**用途**记一份（usage_by_purpose，后台"用量和限额 → 分别用到了哪里"）：
 * 图片和音频都算 practical-assets 这个项目，光看项目分不出哪一笔是出图、哪一笔是配音，所以这里拆成两个用途。
 */
export const PURPOSE_IMAGE = 'assets-image';
export const PURPOSE_AUDIO = 'assets-audio';

/**
 * 单价（Cloudflare 价格页，2026-11-02；agents《素材方案》第二节记过原文）：
 * flux-1-schnell **4.80 neurons / 512×512 tile + 9.60 neurons / step**；melotts **18.63 neurons / 音频分钟**。
 * flux-1-schnell 在 Workers AI 上只收 prompt 和 steps（没有宽高参数），出的是 1024×1024 → 4 个 tile。
 */
const TILE = 4.8;
const STEP = 9.6;
const MELOTTS_PER_MIN = 18.63;
/** melotts 按音频时长计费：约 15 个字符 ≈ 1 秒（Amos 11/3 实测单句 0.8 neurons，和这个公式对得上） */
const SEC_PER_CHAR = 1 / 15;
const TILES_1024 = 4;
export const DEFAULT_STEPS = 4;
/** flux-1-schnell 的 steps：官方文档默认 4、最多 8 */
export const MAX_STEPS = 8;
const MAX_PROMPT = 1_500;
const MAX_TEXT = 200;
const SLOTS = ['audio', 'correct', 'd1-phoneme', 'd2-action', 'd3-function'] as const;
export type Slot = (typeof SLOTS)[number];
const SCENE_ID = /^[A-Za-z0-9_-]{1,16}$/;

/** 一张图的 neurons（估算，不是账单） */
export const imageNeurons = (steps: number) => TILES_1024 * TILE + steps * STEP;
/** 一段音频的 neurons（估算，不是账单） */
export const audioNeurons = (text: string) => (text.length * SEC_PER_CHAR * MELOTTS_PER_MIN) / 60;

export interface Plan {
  scenes: number;
  images: number;
  steps: number;
  tries: number;
  perImage: number;
  perAudio: number;
  需要neurons: number;
  今天已用: number;
  今天上限: number;
  今天还剩: number;
  够不够: boolean;
}

/** 这一批大概要花多少 neurons：图片张数 × 每张 × 重做倍数 + 音频段数 × 每段 */
export function planNeurons(scenes: number, images: number, steps: number, tries: number, sampleText: number): number {
  return images * imageNeurons(steps) * tries + scenes * audioNeurons('x'.repeat(Math.max(1, sampleText)));
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  });
const num = (v: string | null, dflt: number, lo: number, hi: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : dflt;
};

/**
 * 额度检查。只看账号那本（ai_usage，和备用 AI 共用，C117）——**不替 Amos 设上限**，
 * 用的就是他自己在"用量和限额"里设的那个数。
 */
async function quota(env: Env, now: number, reserve: number): Promise<{ ok: boolean; used: number; cap: number; why: string }> {
  const [used, cap] = await Promise.all([usedToday(env, now), dailyCap(env)]);
  if (used + reserve > cap) return { ok: false, used: Math.round(used), cap, why: `今天的 Workers AI 额度到上限了（${Math.round(used)} / ${cap}），明天再跑，或者到"用量和限额"里改这个数` };
  return { ok: true, used: Math.round(used), cap, why: '' };
}

const ai = (env: Env): AiLike => env.AI as AiLike;

const b64 = (buf: ArrayBuffer): string => {
  const a = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string): ArrayBuffer => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;

/** melotts 回 {audio:base64}，也可能回二进制流：两种都认 */
async function toBytes(r: unknown, field: 'audio' | 'image'): Promise<ArrayBuffer> {
  if (r instanceof ReadableStream) return await new Response(r).arrayBuffer();
  if (r instanceof ArrayBuffer) return r;
  const o = (r ?? {}) as Record<string, unknown>;
  const v = o[field];
  if (typeof v === 'string') return unb64(v);
  throw new Error(`${field === 'audio' ? '音频' : '图片'}模型返回的格式不认识`);
}

/** 记一次台账：这一格又生成了一次（失败也记，宁可多记不要漏记） */
async function bump(env: Env, now: number, scene: string, slot: string, neurons: number): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO asset_gen (scene, slot, tries, kept, neurons, first_at, at) VALUES (?1, ?2, 1, 0, ?3, ?4, ?4) ' +
      'ON CONFLICT (scene, slot) DO UPDATE SET tries = tries + 1, neurons = neurons + ?3, at = ?4',
  )
    .bind(scene, slot, neurons, now)
    .run();
}

export interface ProgressRow { scene: string; slot: string; tries: number; kept: number; neurons: number; at: number }
export interface Progress {
  rows: ProgressRow[];
  生成次数: number;
  留用张数: number;
  出图成功率: number | null;
  今天已用: number;
  今天上限: number;
}

/** 台账：哪些格子生成过、留用了没有（断点续传靠它），顺带算真实出图成功率（只算图片，音频不算） */
export async function progress(env: Env, now: number): Promise<Progress> {
  const [r, used, cap] = await Promise.all([
    env.DB.prepare('SELECT scene, slot, tries, kept, neurons, at FROM asset_gen ORDER BY scene, slot').all<ProgressRow>(),
    usedToday(env, now),
    dailyCap(env),
  ]);
  const rows = r.results ?? [];
  const img = rows.filter((x) => x.slot !== 'audio');
  const tries = img.reduce((a, x) => a + x.tries, 0);
  const kept = img.reduce((a, x) => a + (x.kept ? 1 : 0), 0);
  return {
    rows,
    生成次数: tries,
    留用张数: kept,
    出图成功率: tries ? Math.round((kept / tries) * 1000) / 1000 : null,
    今天已用: Math.round(used),
    今天上限: cap,
  };
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * 素材生成器的接口。`sub` 是去掉前缀以后的那一段（plan / gen / progress / kept）。
 * 不认识的 sub 返回 null，由调用方给 404。
 */
export async function assetsApi(env: Env, req: Request, now: number, sub: string): Promise<Response | null> {
  const url = new URL(req.url);

  if (sub === 'progress' && req.method === 'GET') return json(await progress(env, now));

  if (sub === 'plan' && req.method === 'GET') {
    const scenes = num(url.searchParams.get('scenes'), 30, 0, 300);
    const images = num(url.searchParams.get('images'), scenes * 4, 0, 1_200);
    const steps = num(url.searchParams.get('steps'), DEFAULT_STEPS, 1, MAX_STEPS);
    const tries = num(url.searchParams.get('tries'), 1, 1, 10);
    const chars = num(url.searchParams.get('chars'), 30, 1, MAX_TEXT);
    const need = planNeurons(scenes, images, steps, tries, chars);
    const [used, cap] = await Promise.all([usedToday(env, now), dailyCap(env)]);
    const left = Math.max(0, cap - used);
    const plan: Plan = {
      scenes,
      images,
      steps,
      tries,
      perImage: Math.round(imageNeurons(steps) * 10) / 10,
      perAudio: Math.round(audioNeurons('x'.repeat(chars)) * 100) / 100,
      需要neurons: Math.round(need),
      今天已用: Math.round(used),
      今天上限: cap,
      今天还剩: Math.round(left),
      够不够: need <= left,
    };
    return json(plan);
  }

  if (sub === 'kept' && req.method === 'POST') {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const scene = str(b.scene, 16);
    const slot = str(b.slot, 24) as Slot;
    if (!SCENE_ID.test(scene) || !SLOTS.includes(slot)) return json({ 出错: '场景编号或格子名不对' }, 400);
    const kept = b.kept === false ? 0 : 1;
    await env.DB.prepare('UPDATE asset_gen SET kept = ?3, at = ?4 WHERE scene = ?1 AND slot = ?2').bind(scene, slot, kept, now).run();
    return json({ ok: true });
  }

  if (sub === 'gen' && req.method === 'POST') {
    if (!env.AI) return json({ 出错: '这个环境没有绑 Workers AI' }, 503);
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const scene = str(b.scene, 16);
    const slot = str(b.slot, 24) as Slot;
    if (!SCENE_ID.test(scene) || !SLOTS.includes(slot)) return json({ 出错: '场景编号或格子名不对' }, 400);
    const steps = Math.max(1, Math.min(MAX_STEPS, Math.round(Number(b.steps) || DEFAULT_STEPS)));
    const audio = slot === 'audio';
    const text = str(b.text, audio ? MAX_TEXT : MAX_PROMPT);
    if (!text) return json({ 出错: audio ? '这个场景没有要读的句子' : '这个场景没有提示词（提示词由产品经理按《生产包》第二节补齐，不写在代码里）' }, 400);

    const purpose = audio ? PURPOSE_AUDIO : PURPOSE_IMAGE;
    const est = audio ? audioNeurons(text) : imageNeurons(steps);
    const q = await quota(env, now, est);
    if (!q.ok) return json({ 出错: q.why, 今天已用: q.used, 今天上限: q.cap }, 429);

    const t0 = Date.now();
    let bytes: ArrayBuffer;
    try {
      bytes = audio
        ? await toBytes(await ai(env).run(TTS_MODEL, { prompt: text, lang: 'en' }), 'audio')
        : await toBytes(await ai(env).run(IMG_MODEL, { prompt: text, steps }), 'image');
    } catch (e) {
      // 失败的调用不一定计费，保守按估算记；台账也记一次，免得成功率算得比实际好看
      await Promise.all([chargeNeurons(env, now, est, ASSETS_PROJECT, 0, purpose), bump(env, now, scene, slot, est)]);
      const detail = String((e as Error)?.message ?? e).replace(/\s+/g, ' ').slice(0, 300);
      console.log(JSON.stringify({ event: 'assets.error', scene, slot, detail }));
      // 整个 Cloudflare 账号今天的免费额度用完了（不是我们设的上限、也不是这个工具坏了）：
      // 记一条"Cloudflare 说额度用完了"（后台"还剩多少"置顶红字），"出错"换成中文、英文原话附在后面（usage.ts）
      if (isAccountLimited(detail)) {
        await noteAccountLimit(env, now, detail);
        return json({ 出错: accountLimitedMessage(detail, now), 今天已用: q.used, 今天上限: q.cap }, 429);
      }
      return json({ 出错: detail }, 502);
    }
    await Promise.all([chargeNeurons(env, now, est, ASSETS_PROJECT, 200, purpose), bump(env, now, scene, slot, est)]);
    const after = await quota(env, now, 0);
    return json({
      场景: scene,
      格子: slot,
      模型: audio ? TTS_MODEL : IMG_MODEL,
      文件名: audio ? `scene-${scene}-audio.mp3` : `scene-${scene}-${slot}.jpg`,
      mime: audio ? 'audio/mpeg' : 'image/jpeg',
      base64: b64(bytes),
      字节: bytes.byteLength,
      毫秒: Date.now() - t0,
      本次估算neurons: Math.round(est * 10) / 10,
      今天已用: after.used,
      今天上限: after.cap,
    });
  }

  return null;
}
