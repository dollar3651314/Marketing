/**
 * 英语学习这一块的**语音**（表 `en_audio` / 迁移 0022；接口 `/api/en/audio/<键>`）。
 *
 * ## 2026-11-13：换成微软 Edge 的神经网络语音，运行时只读不生成
 *
 * Amos 的做法（他自己已经在用的那一套，这里照搬，不另发明）：
 *  - 用的是微软 Edge 浏览器「大声朗读」背后的**神经网络语音（Neural TTS）**：
 *    英文 `en-GB-SoniaNeural`（Sonia，英国女声），中文 `zh-CN-XiaoxiaoNeural`（晓晓，2026-11-13 他听过试音确认）。
 *    它是用真人录音训练出来的，语气和停顿比手机自带的朗读自然很多 —— **他原话嫌手机朗读太机械**。
 *  - 生成不在这里、也不在运行时：`scripts/build-audio.py` 用开源工具 `edge-tts` 把每句发给微软的语音服务，
 *    拿回 mp3，**语速一律调慢 5%**（`语速`），方便跟读。
 *  - 每条的键 = **内容的哈希**（`audioKey`）。同一句只生成一次；以后加新句子，只补新的那几句。
 *
 * **mp3 不进仓库**（Amos 2026-11-13 定的 A 方案）：两个仓库都是 public，里面念的是第三方课程内容，
 * 所以生成好的字节直接写进 D1 的 `en_audio`，仓库里一个 .mp3 都没有。
 *
 * **运行时只读**（这个文件只有 SELECT，没有 INSERT、没有任何模型调用）：
 *  - 表里有 → 原样回 `audio/mpeg`；
 *  - 表里没有 → **照实说「这一段语音还没生成」**，`不许`回退去调 Workers AI，`不许`静默无声（底线 3、9）。
 *  - 这样每天的 Workers AI 额度**全省下来给 🎤 纠说用**（原来 aura-2-en 那条按需生成的链路整条去掉了）。
 *
 * **不碰密钥**（底线 1）：读库而已，没有任何环境变量；生成那一步用的是免费的开源工具，也不需要密钥，
 * 只有写回 D1 那一步用的是**已经有的那两个 Cloudflare 变量**（令牌和账号编号，Amos 填在 GitHub Secrets 里，
 * 名字写在 .github/workflows/audio.yml）——**没有新增任何密钥**。
 *
 * 要念哪些句子的清单在 `src/en-audio-list.ts`（它去读 pron-content / pron-lesson / s2-lesson，不用手抄）。
 */
import type { Env } from './env';

/** 语音版本号：换声音或语速时加一，键全变，旧行留着不删（想对比还查得出来） */
export const AUDIO_REV = 'e1';
/** 语速一律慢 5%（Amos 的做法：方便跟读） */
export const 语速 = '-5%';
/** 英文：Sonia（英国女声） */
export const 英文声音 = 'en-GB-SoniaNeural';
/** 中文：晓晓（Amos 2026-11-13 听过试音确认可以） */
export const 中文声音 = 'zh-CN-XiaoxiaoNeural';
/** 这一版用到的声音就这两个（脚本和测试都按这份清单核对） */
export const 声音们 = [英文声音, 中文声音] as const;

/**
 * 内容哈希（FNV-1a 64 位，十六进制 16 位）。
 * 为什么不用 sha256：页面上的键是**打包时**算好拼进脚本的，那一步只能同步算，
 * 而 Worker / 浏览器里的 sha256（WebCrypto）是异步的。FNV-1a 纯算术、同步、两行写得完，
 * 几百条内容不会撞（`test/en-audio.test.ts` 守着"全部键互不相同"）。
 */
export function 内容哈希(s: string): string {
  const 位 = new TextEncoder().encode(s);
  const 掩码 = (1n << 64n) - 1n;
  let h = 0xcbf29ce484222325n;
  for (const b of 位) {
    h = (h ^ BigInt(b)) & 掩码;
    h = (h * 0x100000001b3n) & 掩码;
  }
  return h.toString(16).padStart(16, '0');
}

/**
 * 一条语音的键 = 版本号 + 内容哈希。**声音和语速也进哈希**：
 * 同一句话用 Sonia 念和用晓晓念是两条，换语速也是新的一条，不会互相顶掉。
 */
export const audioKey = (text: string, voice: string): string => `${AUDIO_REV}-${内容哈希(`${voice}|${语速}|${text.trim()}`)}`;
/** 接口上只认这个形状的键（别的直接 400，不去查库） */
export const 键的样子 = new RegExp(`^${AUDIO_REV}-[0-9a-f]{16}$`);

/**
 * 「跟我做」一步要念的那段字：**那一句 + 提示**。
 * 提示里才有「塞一根手指」「捏住鼻子」这种能照着做的话，只念前半句等于还是要他低头看屏幕。
 * 页面上手点🔈和翻页自动念**用的是同一个键**，就是这里算出来的。
 */
export const 指令文本 = (s: { 说: string; 提示?: string }): string => s.说 + (s.提示 ? '　' + s.提示 : '');

/** 中日韩文字或全角标点 —— 有一个就算中文 */
const 有中文 = (s: string): boolean => /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/.test(s);
/**
 * 这一行是不是英文：没有中文、而且真的有拉丁字母。
 * S2 的「大」字那一行有的是课件的英文例句（Sonia 念），有的是中文的规则标题（**不念**）——
 * 放在这里是因为页面和清单都要用同一把尺子，而且这个文件谁都能 import（它自己不 import 任何英语模块）。
 */
export const 是英文 = (s: string): boolean => !有中文(s) && /[A-Za-z]/.test(s);

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

/** 库里没有这一条时当面说的那两句话（页面原样显示；测试和页面都从这里取，不各写一套） */
export const 还没生成 = (key: string) => ({
  出错: `这一段语音还没生成（库里没有 ${key} 这一条）。`,
  怎么办: '它是预先用微软的神经网络语音生成好、写进数据库的（scripts/build-audio.py）。还没生成的，照着屏幕上的字做就行 —— 这里不会临时调 AI，也不会假装在念。',
});

/**
 * `GET /api/en/audio/<键>` → `audio/mpeg`。鉴权在 queue.ts 的 adminApi 里已经过了（同一套后台登录）。
 * 不是 GET 回 null（由调用方给 404）。**整个函数只有一条 SELECT**：不写库、不调模型、不花钱。
 */
export async function enAudioApi(env: Env, req: Request, key: string): Promise<Response | null> {
  if (req.method !== 'GET') return null;
  if (!键的样子.test(key)) return bad(`这不是一条语音的编号：${key.slice(0, 40) || '（空）'}`, '刷新一下页面，它会重新给你这一课的编号。', 400);

  const r = await env.DB.prepare('SELECT mp3 FROM en_audio WHERE k = ?1').bind(key).first<{ mp3: unknown }>();
  const bytes = r ? toBytes(r.mp3) : new Uint8Array(0);
  if (!bytes.byteLength) {
    const m = 还没生成(key);
    return bad(m.出错, m.怎么办, 404);
  }
  return new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, {
    headers: {
      'content-type': 'audio/mpeg',
      'content-length': String(bytes.byteLength),
      // 一段固定内容，生成好就不会变：浏览器也可以放心缓存（只给本人，走登录）
      'cache-control': 'private, max-age=86400',
      'x-robots-tag': 'noindex',
      'x-en-audio': key,
    },
  });
}
