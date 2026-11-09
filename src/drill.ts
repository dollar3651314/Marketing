/**
 * 工作台「带练」（#/work/drill，页面在 src/drill-page.ts，表在 migrations/0013_drill.sql）。
 *
 * **为什么有这一块**（Amos 2026-11-07 原话）：「不好用，体验很差。不是这个方式不行，而是使用 Gemini 和我对话，
 * 这个引导我的方式很差。」四段结构（单词 → 词组 → 例句 → 对话）他认可，**错的是"全部交给 Gemini Live"这个载体**：
 * 语音里看不到字、不能回看、没有进度、它会自由发挥跳步、纠错留不住、不能暂停。
 *
 * **前三段根本不需要 AI**：内容是写死的，就是"卡片 + 按钮 + 进度"。所以这里：
 *   - **不调任何 AI**（不接 Gemini、不接 Workers AI，也不走插件那套打分 / 写稿的接口），没有延迟、不听话、额度、解析失败这些问题；
 *     这是整个项目里最便宜最可靠的一块——只做 D1 读写和几个纯函数（底线 8 / C117：不新增一分钱费用）。
 *   - **第四段（对话）本次不做**。已实测排除的路：自建语音链路端到端 9.1 秒（src/voice.ts 的实测台），
 *     whisper 一步就 6.4 秒且与说话长度成正比——对话必须留给 Gemini Live，但那是下一版的事。
 *     页面在三段走完后**明说"第四段对话还没做，下一版加"**，不假装有（底线 3、9）。
 *
 * **内容一个字都不许改写**：场景 0 的三段、每段 6 项，照抄 agents《项目/Practical/语块库-第一批50条.md》
 * （Amos 已逐条审过说"都有用"）。测试 `test/drill.test.ts` 第 1 组把 18 项**逐字写死**，改一个字就红。
 *
 * **三步交互**（成败所在，别改成别的）：先回想 → 揭晓 → 自己判。
 *   卡片上**只显示中文**（第一段显示中文词义，第三段显示中文情境）→ 一个大按钮「看答案」（他先在嘴上说一遍）
 *   → 显示英文（第一段还显示关键点）→ 两个大按钮「会了」「不会」。
 *   **「不会」的排到这一段末尾再考一遍，这一段全部「会了」才能进下一段**（下面 `queueOf()` / `currentStage()`，
 *   服务端也拦：不是当前这一段的项目一律 409，前端坏了也跳不了段）。
 *
 * **全程不让他打字**（agents #92 把用户当小白）：整块里**一个 `<input>` 都没有**（测试守着），
 * 页面上不出现命令行；进度一眼看得到（第几段 / 这一段第几个 / 还剩几个）。
 *
 * 入口只有 `/api/drill/*`（state、answer），走后台登录（queue.ts 的 sessionOk）；后台密码没填时整个后台 404。
 * **不碰密钥**（底线 1）：这里读写的只有场景号、项目编号和三个数字。
 */
import type { Env } from './env';

// ======================================================================
// 一、内容：场景 0 的前三段，三段各 6 项（**写死，不从接口来、不从 AI 来**）
// ======================================================================

/** 一项：zh = 卡片上先显示的中文，en = 揭晓的英文，key = 关键点（只有第一段有） */
export interface DrillItem { id: string; zh: string; en: string; key?: string }
/** 一段 */
export interface DrillStage { n: number; name: string; ask: string; items: DrillItem[] }

/** 这一版只有场景 0（"听不懂、想让对方再说一遍"那一组） */
export const SCENE = 0;
export const SCENE_NAME = '听不懂的时候怎么说';

/**
 * 三段的全部内容。来源：agents《项目/Practical/语块库-第一批50条.md》，**原文照抄，一个字没改**。
 * （第一段第 6 项的关键点"他 11/5 卡过这个词"也是原文，没有改写成第二人称——改写就不是照抄了。）
 */
export const STAGES: DrillStage[] = [
  {
    n: 1,
    name: '单词',
    ask: '看中文，先在嘴上说出那个英文单词',
    items: [
      { id: 'w1', zh: '听清', en: 'catch', key: '没听清用 catch，不要用 understand' },
      { id: 'w2', zh: '跟得上', en: 'follow', key: "I'm not following = 我跟不上你的思路" },
      { id: 'w3', zh: '意思是', en: 'mean', key: 'What do you mean by X —— by 不能丢' },
      { id: 'w4', zh: '换个说法再说', en: 'rephrase', key: 'repeat 是再说一遍，rephrase 是换种说法' },
      { id: 'w5', zh: '听懵了', en: 'lost', key: "I'm lost = 我彻底跟丢了，这么说不丢人" },
      { id: 'w6', zh: '说清楚', en: 'clarify', key: '他 11/5 卡过这个词' },
    ],
  },
  {
    n: 2,
    name: '词组',
    ask: '看中文，先在嘴上说出整句英文',
    items: [
      { id: 'p1', zh: '那个 ___ 是什么意思？', en: 'What do you mean by ___?' },
      { id: 'p2', zh: '抱歉，我没听清。', en: "Sorry, I didn't catch that." },
      { id: 'p3', zh: '能稍微慢一点吗？', en: 'Could you slow down a bit?' },
      { id: 'p4', zh: '能换个说法吗？', en: 'Could you rephrase that?' },
      { id: 'p5', zh: '我确认一下我的理解 ——', en: 'Just to make sure I understand —' },
      { id: 'p6', zh: '所以你的意思是 ___', en: "So what you're saying is ___" },
    ],
  },
  {
    n: 3,
    name: '例句',
    ask: '看情境，先在嘴上说出一整句英文',
    items: [
      { id: 's1', zh: '对方说了个 scope 你不懂', en: 'What do you mean by "scope"?' },
      { id: 's2', zh: '整句没听清，想让他再说一遍', en: "Sorry, I didn't catch that. Could you say it again?" },
      { id: 's3', zh: '他说太快了', en: 'Could you slow down a bit? I want to get this right.' },
      { id: 's4', zh: '他那句话绕，想让他换个说法', en: "Could you rephrase that? I'm not sure I follow." },
      { id: 's5', zh: '确认他是不是要周五之前要', en: 'Just to make sure I understand — you need it by Friday?' },
      { id: 's6', zh: '复述他的结论：先上简单版本', en: "So what you're saying is we should ship the simple version first." },
    ],
  },
];

/** 第四段还没做，页面上照实说（底线 3、9：不假装有） */
export const STAGE4_NOTE = '第四段对话还没做，下一版加';

/** 全部项目编号（校验用） */
export const ALL_IDS: string[] = STAGES.flatMap((s) => s.items.map((i) => i.id));
/** 项目编号 → 它在哪一段（1 / 2 / 3） */
export const STAGE_OF = new Map<string, number>(STAGES.flatMap((s) => s.items.map((i) => [i.id, s.n] as [string, number])));

// ======================================================================
// 二、纯函数：进度、队列、门禁（服务端和测试共用，不碰数据库）
// ======================================================================

/** 库里一行 */
export interface DrillRow { item: string; tries: number; pass_try: number; at: number }

/** 这一段的成绩：一共几项、会了几项、第一次就会几项 */
export interface StageStat { 段: number; 名字: string; 一共: number; 会了: number; 第一次就会: number; 走完了: boolean }

const rowsMap = (rows: DrillRow[]) => new Map(rows.map((r) => [r.item, r]));
/** 会了 = 点过「会了」（pass_try > 0） */
const passed = (r: DrillRow | undefined) => !!r && r.pass_try > 0;

export function stageStats(rows: DrillRow[]): StageStat[] {
  const by = rowsMap(rows);
  return STAGES.map((s) => {
    const done = s.items.filter((i) => passed(by.get(i.id)));
    return {
      段: s.n,
      名字: s.name,
      一共: s.items.length,
      会了: done.length,
      第一次就会: done.filter((i) => by.get(i.id)!.pass_try === 1).length,
      走完了: done.length === s.items.length,
    };
  });
}

/**
 * 现在该练第几段：**第一段没全会就还在第一段**（门禁）。三段都走完回 0。
 * 这一条就是"不许跳段"：服务端按它判，前端坏了也跳不过去。
 */
export function currentStage(rows: DrillRow[]): number {
  const st = stageStats(rows).find((s) => !s.走完了);
  return st ? st.段 : 0;
}

/**
 * 这一段还要考的队列：还没「会了」的项，按**最后一次答的时间**升序（没答过的算 0，排在最前），时间一样按原顺序。
 * 刚点完「不会」的那一项 at 最大 → **自动排到这一段末尾**，不用在库里存队列。
 */
export function queueOf(stage: number, rows: DrillRow[]): DrillItem[] {
  const by = rowsMap(rows);
  const s = STAGES.find((x) => x.n === stage);
  if (!s) return [];
  return s.items
    .map((item, i) => ({ item, i, at: by.get(item.id)?.at ?? 0, done: passed(by.get(item.id)) }))
    .filter((x) => !x.done)
    .sort((a, b) => a.at - b.at || a.i - b.i)
    .map((x) => x.item);
}

/** 页面要的一整份状态（中文字段名，和后台别的接口一个风格） */
export function drillState(rows: DrillRow[]): Record<string, unknown> {
  const by = rowsMap(rows);
  const stats = stageStats(rows);
  const cur = currentStage(rows);
  const done = cur === 0;
  // 走完以后「看全部」仍然停在第三段（不让他看空白）
  const show = STAGES.find((s) => s.n === (cur || 3))!;
  const q = cur ? queueOf(cur, rows) : [];
  const now = q[0];
  const st = stats.find((s) => s.段 === show.n)!;
  return {
    场景: SCENE,
    场景名: SCENE_NAME,
    段: stats,
    一共几段: STAGES.length,
    这一段: {
      段: show.n,
      名字: show.name,
      怎么练: show.ask,
      一共: st.一共,
      会了: st.会了,
      第几个: Math.min(st.会了 + 1, st.一共),
      还剩: q.length,
      // 「看全部」：这一段 6 项都列出来；**没练到的不剧透**（英文给 null，页面写"还没练到"）
      六项: show.items.map((i) => {
        const r = by.get(i.id);
        return { id: i.id, 中文: i.zh, 英文: passed(r) ? i.en : null, 关键点: passed(r) ? i.key ?? '' : null, 会了: passed(r), 第一次就会: !!r && r.pass_try === 1 };
      }),
    },
    // 现在考哪一项（英文和关键点一起给，页面先藏着，点「看答案」当场显示，不用再跑一趟接口）
    当前: now ? { id: now.id, 段: show.n, 中文: now.zh, 英文: now.en, 关键点: now.key ?? '' } : null,
    全部走完: done,
    小结: done ? stats.map((s) => ({ 段: s.段, 名字: s.名字, 会了: s.会了, 一共: s.一共, 第一次就会: s.第一次就会 })) : null,
    第四段: STAGE4_NOTE,
  };
}

// ======================================================================
// 三、接口：/api/drill/state（看一眼）、/api/drill/answer（会了 / 不会）
// ======================================================================

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
/** 出错一律两句话：出错了什么、怎么办（页面原样显示，**不许静默吞掉**） */
const bad = (出错: string, 怎么办: string, status = 400) => json({ 出错, 怎么办 }, status);

async function readRows(env: Env): Promise<DrillRow[]> {
  const r = await env.DB.prepare('SELECT item, tries, pass_try, at FROM drill_item WHERE scene = ?1').bind(SCENE).all<DrillRow>();
  return r.results ?? [];
}

export async function drillApi(env: Env, req: Request, now: number, sub: string): Promise<Response | null> {
  if (sub === 'state' && req.method === 'GET') return json(drillState(await readRows(env)));

  if (req.method !== 'POST') return null;

  if (sub === 'answer') {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const item = typeof body.item === 'string' ? body.item.trim() : '';
    if (!ALL_IDS.includes(item)) return bad(`这一项不在带练清单里：${item.slice(0, 40) || '（空）'}`, '刷新一下页面，它会重新给你当前这一项。', 400);
    if (typeof body.known !== 'boolean') return bad('没收到"会了还是不会"。', '点一下下面两个大按钮里的一个。', 400);

    const rows = await readRows(env);
    const cur = currentStage(rows);
    if (cur === 0) return bad('三段已经全部练完了。', '页面最下面有这一轮的小结；第四段（对话）还没做，下一版加。', 409);
    if (STAGE_OF.get(item) !== cur) return bad(`这一项是第 ${STAGE_OF.get(item)} 段的，现在还在第 ${cur} 段。`, '这一段全部点过「会了」才进下一段；刷新一下页面就回到当前这一项。', 409);
    if (rows.some((r) => r.item === item && r.pass_try > 0)) return bad('这一项你已经点过「会了」。', '刷新一下页面，它会给你这一段还没会的那几项。', 409);

    await env.DB.prepare(
      'INSERT INTO drill_item (scene, item, tries, pass_try, at) VALUES (?1, ?2, 1, ?3, ?4) ' +
        'ON CONFLICT (scene, item) DO UPDATE SET tries = tries + 1, at = ?4, pass_try = CASE WHEN ?3 = 1 AND pass_try = 0 THEN tries + 1 ELSE pass_try END',
    ).bind(SCENE, item, body.known ? 1 : 0, now).run();

    return json(drillState(await readRows(env)));
  }

  return null;
}
