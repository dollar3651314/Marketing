/**
 * 工作台「带练」的**发音**（表 `drill_audio` / 迁移 0014；页面 src/drill-page.ts；逻辑和内容在 src/drill.ts、src/drill-content.ts）。
 *
 * **为什么有这一块**（Amos 2026-11-09 原话）：「**不只是加音标 还得有发音 让我可以照着学**」。
 * 音标是给眼睛的，他要的是耳朵——每张卡片两个大按钮：🔊 正常速、🐢 慢速 0.7 倍（同一段音频，
 * 慢速是浏览器把 `playbackRate` 调成 0.7，**不额外生成**）。
 *
 * **谁来念**：Workers AI 的 melotts（`env.AI` 绑定，**不需要任何密钥**，底线 1）。
 * 调用方式和记账方式**照 src/tts.ts 那一套**（同一个模型常量 `TTS_MELOTTS`、同一个估算公式 `ttsNeurons()`、
 * 同一个 `chargeNeurons()`），这里不另发明一套。
 *
 * **生成几次**：一共 24 段固定内容（18 项 + 第三段 6 句「对方说的那句」，编号见 src/drill.ts 的 `AUDIO_IDS`），
 * **第一次需要时生成一次就存进 D1，之后永久复用**（和语音生成工具"不落库"正相反，原因写在迁移 0014 里）。
 * 24 段约 20 neurons（melotts 单句约 0.8），免费额度 10,000/天，**不新增任何付费服务**（底线 8 / C117）；
 * 额度照旧只看 Amos 自己在"用量和限额"里设的那个上限，**不替他另设一层**。
 * 用量按用途记成 `drill-tts`（后台"用量和限额 → 分别用到了哪里"），按项目记成 `drill`。
 *
 * **失败就是失败**（底线 3、9）：额度不够、没绑 AI、模型出错，一律把"出错 / 怎么办"两句话原样回给页面，
 * 页面当面说"发音这次没生成出来，下面只有音标"，**不假装有**；**也不自动重试**（不做重试风暴），
 * 下次他再点再试一次。失败的调用按估算记一笔账（宁可多记不漏记，和 tts.ts 一样）。
 */
import { AUDIO_IDS, audioTextOf } from './drill';
import type { Env } from './env';
import { AURA_SPEAKER, TTS_AURA, toMp3, ttsNeurons } from './tts';
import { accountLimitedMessage, isAccountLimited, noteAccountLimit } from './usage';
import { chargeNeurons, dailyCap, usedToday, type AiLike } from './workers-ai';

/**
 * **发音版本号**：换 TTS 模型时把它加一，`drill_audio` 的键就跟着变，旧模型生成的那些段
 * **再也不会被读到**（旧行留着不删，想对比的时候还查得出来）。
 *
 * `a1` = melotts。`a2` = aura-2-en（**现在用的**）。
 * 为什么换（Amos 2026-11-10 实测）：听辨小测连跑四轮，`seat / sit` 那一组他点了「两个听着一样」，
 * 去剑桥词条页听**真人录音却分得开**——也就是说 melotts 把 /iː/ 和 /ɪ/ 念糊了，
 * **错的是机器不是他的耳朵**。他又用公共工具「语音生成」拿 aura-2-en 念了这两个词，**能分开**，所以换。
 * 这也意味着换之前那四轮的数据有污染：分不出来的到底是他还是机器，分不清楚。
 *
 * **代价**（照 Cloudflare 价格页精算，不是拍脑袋）：aura 按字符算钱（2727.27 neurons / 1000 字符），
 * melotts 按音频时长算。这 40 段一共 1,101 个字符 → aura 约 **3,003** neurons（melotts 约 22）。
 * 其中听辨那 16 个词只有 64 个字符 ≈ **175** neurons，贵的是带练那 24 段长句（约 2,828）。
 * **不是一次性扣掉**：哪一段被点到才生成哪一段，生成完永久存着。免费额度 10,000 / 天，不开通任何付费服务（底线 8 / C117）。
 */
export const AUDIO_REV = 'a2';
/** 存进 drill_audio 的键 = 版本号 + 编号（编号本身和地址都没变） */
export const audioKey = (item: string): string => `${AUDIO_REV}:${item}`;

/** 用量按项目记一行（后台"按项目看用量"），和语音生成工具的 `tts` 分开 */
export const DRILL_PROJECT = 'drill';
/** 用量按用途记一行（usage_by_purpose）：带练的发音单独一项 */
export const DRILL_PURPOSE = 'drill-tts';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
/** 出错一律两句话：出错了什么、怎么办（页面原样显示，**不许静默吞掉**） */
const bad = (出错: string, 怎么办: string, status = 400) => json({ 出错, 怎么办 }, status);

/** D1 的 BLOB 读回来可能是 ArrayBuffer、定型数组或数字数组，三种都认 */
export function toBytes(v: unknown): Uint8Array {
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
  if (Array.isArray(v)) return Uint8Array.from(v as number[]);
  return new Uint8Array(0);
}

const mp3Response = (bytes: Uint8Array, item: string) =>
  new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, {
    headers: {
      'content-type': 'audio/mpeg',
      'content-length': String(bytes.byteLength),
      // 一段固定内容，存下来就不会变：浏览器也可以放心缓存（只给本人，走登录）
      'cache-control': 'private, max-age=86400',
      'x-robots-tag': 'noindex',
      'x-drill-item': item,
    },
  });

/** 库里已经有这一段吗 */
async function readAudio(env: Env, item: string): Promise<Uint8Array | null> {
  const r = await env.DB.prepare('SELECT mp3 FROM drill_audio WHERE item = ?1').bind(audioKey(item)).first<{ mp3: unknown }>();
  if (!r) return null;
  const b = toBytes(r.mp3);
  return b.byteLength ? b : null;
}

/**
 * `GET /api/drill/audio/<编号>` → `audio/mpeg`。鉴权在 queue.ts 的 adminApi 里已经过了（和 /api/drill/* 同一套后台登录）。
 * 不是 GET 回 null（由调用方给 404）。
 */
export async function drillAudioApi(env: Env, req: Request, now: number, item: string): Promise<Response | null> {
  if (req.method !== 'GET') return null;
  if (!AUDIO_IDS.includes(item)) return bad(`这一段发音不在带练清单里：${item.slice(0, 40) || '（空）'}`, '刷新一下页面，它会重新给你当前这一项。', 400);

  const had = await readAudio(env, item);
  if (had) return mp3Response(had, item);

  const text = audioTextOf(item);
  if (!text) return bad('这一段还没有内容，所以没法生成发音。', '内容文件（src/drill-content.ts）里这一条还是空的，等内容补上再点。', 404);

  if (!env.AI) return bad('这个环境没有绑 Workers AI，生成不了发音。', '正式版和测试版都绑了；本地跑的时候没有，先看音标。', 503);

  // 额度：只看 Amos 自己在"用量和限额"里设的那个上限（C117），不另设一层
  const est = ttsNeurons(TTS_AURA, text);
  const [used, cap] = await Promise.all([usedToday(env, now), dailyCap(env)]);
  if (used + est > cap)
    return bad(
      `今天的 Workers AI 额度不够了：这一段发音大概要 ${Math.max(1, Math.round(est))} neurons，今天已经用了 ${Math.round(used)} / ${cap}。`,
      '明天再点一次就会生成（生成过的永久存着，不用再花），或者到"用量和限额"里把上限改大（上限只有你能改）。',
      429,
    );

  let mp3: ArrayBuffer;
  try {
    // aura 的入参和 melotts 不一样（照 src/tts.ts 那一份，别各写一套）
    mp3 = await toMp3(await (env.AI as AiLike).run(TTS_AURA, { text, speaker: AURA_SPEAKER, encoding: 'mp3' }));
  } catch (e) {
    // 失败的调用不一定不计费，保守按估算记一笔（和 tts.ts 一样）
    await chargeNeurons(env, now, est, DRILL_PROJECT, 0, DRILL_PURPOSE);
    // 只带模型名和错误文字，不含任何密钥（底线 1）
    const detail = String((e as Error)?.message ?? e).replace(/\s+/g, ' ').slice(0, 300);
    console.log(JSON.stringify({ event: 'drill.tts_error', item, detail }));
    if (isAccountLimited(detail)) {
      await noteAccountLimit(env, now, detail);
      return bad(accountLimitedMessage(detail, now), '今天先看音标，明天再点🔊。**不会自动重试**，不点就不花钱。', 429);
    }
    return bad(`发音没生成出来：${detail}`, '下面的音标照常看；等一下再点一次🔊（不会自动重试）。', 502);
  }

  const bytes = new Uint8Array(mp3);
  if (!bytes.byteLength) {
    await chargeNeurons(env, now, est, DRILL_PROJECT, 0, DRILL_PURPOSE);
    return bad('发音生成出来是空的。', '等一下再点一次🔊（不会自动重试）；一直这样就先看音标。', 502);
  }
  // 存一次，之后永久复用（同一段并发点两下时后到的那次覆盖，内容一样）
  await env.DB.prepare('INSERT INTO drill_audio (item, mp3, at) VALUES (?1, ?2, ?3) ON CONFLICT (item) DO UPDATE SET mp3 = ?2, at = ?3').bind(audioKey(item), mp3, now).run();
  await chargeNeurons(env, now, est, DRILL_PROJECT, 200, DRILL_PURPOSE);
  return mp3Response(bytes, item);
}
