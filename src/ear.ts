/**
 * 工作台「带练」的**第二个模式：听辨小测**（表 `ear_pair` / 迁移 0017；内容在 src/ear-content.ts，
 * 页面在 src/ear-page.ts，发音复用 src/drill-audio.ts 的 `GET /api/drill/audio/<编号>`）。
 *
 * **为什么有这一块**（Amos 2026-11-10 原话）：「自然拼读有很多我都不会，读的不标准，那也就意味着
 * 我听出来的声音也就有问题，**所以可能会听不懂别人在说什么**」。
 * 治耳朵最快的路是**直接练耳朵**，不是背两百条拼读规则：放一段音 → 从只差一个音的两个词里选听到哪个 → 当场给对错。
 *
 * **一个字的内容都不在这里**：8 组最小对立对（词形、音标、音标出处、在分什么音、一行解释）全部在
 * `src/ear-content.ts`，由产品会话写、逐词对过剑桥词条页；这个文件只做判对错和记数（底线 3、9）。
 *
 * **不新开菜单项**：工作台二级菜单已经 8 项满了（T-4，第 9 项会撑破手机菜单），所以听辨小测放进已有的
 * 「带练」模块 `#w-drill` 里，和「复考」并列当第二个模式；**公共工具那 8 项一个都没动**。
 *
 * **不调任何 AI、不记一分钱的账**（底线 8 / C117）：这里只读写 `ear_pair` 的三个计数。
 * 发音走的是带练已有的那一套——melotts 生成一次就存进 D1 `drill_audio` 永久复用（那 16 段只生成一次，之后不再花），
 * 编号挂在 `src/drill.ts` 的 `AUDIO_IDS` / `audioTextOf()` 上，**不另开第二套发音接口**。
 * **不碰密钥**（底线 1）：这里只有组号、a/b、三个计数和一个时间戳。
 *
 * **哪个词随机、顺序随机、左右随机都在页面上做**（src/ear-page.ts）：服务端不知道这一轮会放哪个词，
 * 页面答题时把「放的是哪个」连同「他选了哪个」一起交上来，**对错由服务端算**（页面不自己判、也不自己记分）。
 * 这样做的代价要说清楚（底线 9）：**发音的地址里带着编号**（`/api/drill/audio/p1a`），
 * 浏览器的开发者工具里能看出这一组放的是 a 还是 b——**界面上一个字都没有**，但那不是加密。
 *
 * 入口挂在已有的 `/api/drill/ear/*` 下面（queue.ts 分发），走的也是已有的后台登录。
 */
import type { Env } from './env';
import { PAIRS, type EarPair } from './ear-content';

/** 一轮考几组 */
export const EAR_N = PAIRS.length;
/** 组号 p1..p8 */
export const EAR_PAIR_IDS: string[] = PAIRS.map((p) => p.id);
/** 16 段发音的编号 p1a p1b … p8b（挂进 src/drill.ts 的 AUDIO_IDS） */
export const EAR_WORD_IDS: string[] = PAIRS.flatMap((p) => [p.a.id, p.b.id]);

/** 编号 → 那个词（发音要念的就是这个词本身，不加任何修饰） */
export function earWordOf(wordId: string): string | null {
  for (const p of PAIRS) {
    if (p.a.id === wordId) return p.a.word;
    if (p.b.id === wordId) return p.b.word;
  }
  return null;
}

/** 库里一行 */
export interface EarRow { pair: string; tries: number; ok: number; same: number; at: number }

/** 页面要的一组（两个词都给——两个词本来就并排摆在按钮上，藏不住也不用藏；**藏的是这一轮放了哪个**） */
export function earCardOf(p: EarPair): Record<string, unknown> {
  return {
    组: p.id,
    在分什么音: p.contrast,
    差在哪: p.explain,
    挂在带练: p.tie,
    a: { 编号: p.a.id, 词: p.a.word, 音标: p.a.ipa, 出处: p.a.src },
    b: { 编号: p.b.id, 词: p.b.word, 音标: p.b.ipa, 出处: p.b.src },
  };
}

/** 服务器上记着的累计（他到底在哪几个音上分不出来，这才是这东西的真正产出） */
export function earState(rows: EarRow[]): Record<string, unknown> {
  const by = new Map(rows.map((r) => [r.pair, r]));
  const 记录 = PAIRS.map((p) => {
    const r = by.get(p.id);
    return { 组: p.id, 两个词: `${p.a.word} / ${p.b.word}`, 在分什么音: p.contrast, 考过: r?.tries ?? 0, 对: r?.ok ?? 0, 两个听着一样: r?.same ?? 0 };
  });
  return {
    一共: EAR_N,
    组: PAIRS.map(earCardOf),
    记录,
    累计: {
      考过: 记录.reduce((s, x) => s + x.考过, 0),
      对: 记录.reduce((s, x) => s + x.对, 0),
      两个听着一样: 记录.reduce((s, x) => s + x.两个听着一样, 0),
    },
  };
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
/** 出错一律两句话：出错了什么、怎么办（页面原样显示，**不许静默吞掉**） */
const bad = (出错: string, 怎么办: string, status = 400) => json({ 出错, 怎么办 }, status);

async function readRows(env: Env): Promise<EarRow[]> {
  const r = await env.DB.prepare('SELECT pair, tries, ok, same, at FROM ear_pair').all<EarRow>();
  return r.results ?? [];
}

/**
 * `/api/drill/ear/state`（GET，看一眼）、`/api/drill/ear/answer`（POST，交一组的答案）。
 * 鉴权在 queue.ts 的 adminApi 里已经过了（和 /api/drill/* 同一套后台登录）。
 */
export async function earApi(env: Env, req: Request, now: number, sub: string): Promise<Response | null> {
  if (sub === 'state' && req.method === 'GET') return json(earState(await readRows(env)));

  if (sub === 'answer' && req.method === 'POST') {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const 组 = typeof body.组 === 'string' ? body.组.trim() : '';
    const 放的 = typeof body.放的 === 'string' ? body.放的.trim() : '';
    const 选的 = typeof body.选的 === 'string' ? body.选的.trim() : '';
    const pair = PAIRS.find((p) => p.id === 组);
    if (!pair) return bad(`这一组不在听辨小测里：${组.slice(0, 40) || '（空）'}`, '刷新一下页面，它会重新发一轮。', 400);
    if (放的 !== 'a' && 放的 !== 'b') return bad('没收到"刚才放的是哪个词"。', '刷新一下页面重新开始这一轮。', 400);
    if (选的 !== 'a' && 选的 !== 'b' && 选的 !== 'same') return bad('没收到"你选了哪个"。', '点一下三个大按钮里的一个。', 400);

    const 两个一样 = 选的 === 'same';
    const 对 = !两个一样 && 选的 === 放的;
    await env.DB.prepare(
      'INSERT INTO ear_pair (pair, tries, ok, same, at) VALUES (?1, 1, ?2, ?3, ?4) ' +
        'ON CONFLICT (pair) DO UPDATE SET tries = tries + 1, ok = ok + ?2, same = same + ?3, at = ?4',
    ).bind(pair.id, 对 ? 1 : 0, 两个一样 ? 1 : 0, now).run();

    const 放的词 = 放的 === 'a' ? pair.a : pair.b;
    return json({
      组: pair.id,
      对,
      两个听着一样: 两个一样,
      放的是: { 编号: 放的词.id, 词: 放的词.word, 音标: 放的词.ipa },
      你选的: 两个一样 ? null : (选的 === 'a' ? pair.a.word : pair.b.word),
      差在哪: pair.explain,
      在分什么音: pair.contrast,
      记着了: earState(await readRows(env)),
    });
  }

  return null;
}
