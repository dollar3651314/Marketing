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
 * **内容从哪来（2026-11-09 主会话逐项核对过，别再写成"照抄原文"）**：底本是 agents
 * 《项目/Practical/语块库-第一批50条.md》"一、听不懂的时候"那 9 条（Amos 已逐条审过说"都有用"），
 * 但这 18 项**不是**那 9 条的原文照抄，实际对应关系如下：
 *   - **来自语块库、句子本身一字未动**：p1/p2/p3/p5/p6（= 语块库 #1/#2/#3/#5/#6）、s1（= #1 原句）、
 *     w1 `catch`（#2）、w3 `mean`（#1）。
 *   - **语块库原句 + 本项目补的后半句**：s2（#2 + "Could you say it again?"）、s3（#3 + "I want to get this right."）、
 *     s5（#5 + "you need it by Friday?"）、s6（#6 + "we should ship the simple version first."）。
 *   - **语块库里没有、本项目新加的 6 项（Amos 还没审过）**：w2 `follow`、w4 `rephrase`、w5 `lost`、
 *     w6 `clarify`、p4 `Could you rephrase that?`、s4 `Could you rephrase that? I'm not sure I follow.`
 * 这 6 项要等 Amos 过一遍；他说换就换。测试 `test/drill.test.ts` 第 1 组把 18 项**逐字写死**，
 * 改一个字就红——**那是防手滑，不等于这些内容都审过**。
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
 * **v2（2026-11-10，Amos 用完 18 项的原话：「没有音标，没有词意解释，做完后不知道该干什么」「不只是加音标 还得有发音 让我可以照着学」）**：
 *   - **内容（音标 / 重音、词义、用法、第三段「对方先说一句」）全部在 `src/drill-content.ts`**，由产品会话写、研发一个字都不编；
 *     这里只管结构和逻辑。**内容是 `null` 就整行不显示**（不显示「暂无」、不显示占位符，底线 3）。
 *   - **第三段改成「对方先说一句，你来接」**：卡片上显示 `STAGE3[id].prompt_en`（对方那句，可点🔊）+ `prompt_zh`（中文情境），
 *     他要说出 `STAGE3[id].en`。为什么改：原来第三段是第二段 6 条词组加个尾巴，他刚背完立刻考同一句，
 *     6/6 全对测的是「刚看过」不是「学会了」。**第三段的英文答案以 `STAGE3` 为准**（盖掉下面 `STAGES` 里 s1～s6 的 `en`；
 *     `STAGES` 留着当底本，`test/drill.test.ts` 第 1 组照旧逐字守着它）。
 *   - **发音**在 `src/drill-audio.ts`（Workers AI melotts，第一次需要时生成一次、存 D1 永久复用，表 `drill_audio` / 迁移 0014）；
 *     **复考**在 `src/drill-review.ts`（表 `drill_review` / 迁移 0015）。**这个文件本身仍然一个 AI 都不调、不记一分钱的账、只读写 `drill_item`**
 *     （测试守着：import 只有 `./env` 和 `./drill-content` 两条，SQL 只出现 `drill_item`）。
 *
 * 入口只有 `/api/drill/*`（state、answer；发音 `audio/*` 和复考 `review*` 由 queue.ts 直接分给上面那两个文件），
 * 走后台登录（queue.ts 的 sessionOk）；后台密码没填时整个后台 404。
 * **不碰密钥**（底线 1）：这里读写的只有场景号、项目编号和三个数字。
 */
import type { Env } from './env';
import { CONTENT, STAGE3, W1_KEY } from './drill-content';

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
 * 三段的全部内容。底本是 agents《项目/Practical/语块库-第一批50条.md》的"一、听不懂的时候"，
 * **但不是原文照抄**——哪 12 项来自语块库、哪 6 项是本项目新加还没审，见本文件顶部的对应关系。
 */
export const STAGES: DrillStage[] = [
  {
    n: 1,
    name: '单词',
    ask: '看中文，先在嘴上说出那个英文单词',
    items: [
      // 关键点从内容文件读（W1_KEY，Amos 2026-11-10 定稿），**两边不各存一份**
      { id: 'w1', zh: '听清', en: 'catch', key: W1_KEY },
      { id: 'w2', zh: '跟得上', en: 'follow', key: "I'm not following = 我跟不上你的思路" },
      { id: 'w3', zh: '意思是', en: 'mean', key: 'What do you mean by X —— by 不能丢' },
      { id: 'w4', zh: '换个说法再说', en: 'rephrase', key: 'repeat 是再说一遍，rephrase 是换种说法' },
      { id: 'w5', zh: '听懵了', en: 'lost', key: "I'm lost = 我彻底跟丢了，这么说不丢人" },
      { id: 'w6', zh: '说清楚', en: 'clarify', key: 'clarify 是请对方讲清楚；catch 是自己没听清，两个别混' },
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
    ask: '先听对方说的那一句，再接出一整句英文',
    // **第三段的内容不在这里**：6 项全部从 `src/drill-content.ts` 的 STAGE3 读（对方那句 prompt_en、
    // 中文情境 prompt_zh、他要说出来的 en），**两边不各存一份**。
    // 为什么改成「对方先说一句，你来接」：旧版 s1～s6 是第二段 6 条词组加个尾巴，他刚背完立刻考同一句，
    // 2026-11-09 第二段 6/6、第三段 6/6——全对测的是「刚看过」不是「学会了」。
    items: ['s1', 's2', 's3', 's4', 's5', 's6'].map((id) => ({ id, zh: STAGE3[id].prompt_zh, en: STAGE3[id].en })),
  },
];

/** 第四段还没做，页面上照实说（底线 3、9：不假装有） */
export const STAGE4_NOTE = '第四段对话还没做，下一版加';

/** 全部项目编号（校验用） */
export const ALL_IDS: string[] = STAGES.flatMap((s) => s.items.map((i) => i.id));
/** 项目编号 → 它在哪一段（1 / 2 / 3） */
export const STAGE_OF = new Map<string, number>(STAGES.flatMap((s) => s.items.map((i) => [i.id, s.n] as [string, number])));

// ======================================================================
// 一·二、内容文件（src/drill-content.ts）贴上来：音标 / 重音、词义、用法、第三段「对方先说一句」
//   **研发不编内容**：下面只做"有就显示、null 就整行不显示"的合并，一个字都不在这里写死。
// ======================================================================

/** 内容里的一项：有字就原样给（去掉首尾空白），**空的 / 没给的一律 null**——页面照这个整行不显示，不造占位词（底线 3） */
export const orNull = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t ? t : null;
};
/** 这一项的关键点（只有第一段有；w1 那条在内容文件里，见上面 `STAGES`） */
export const keyOf = (item: DrillItem): string => (item.key ?? '').trim();

/** 第三段「对方先说一句」：两段都是空字符串就当**没有**（占位版就是空的，页面上什么都不显示） */
export function promptOf(id: string): { en: string; zh: string } | null {
  const p = STAGE3[id];
  if (!p) return null;
  const en = (p.prompt_en ?? '').trim();
  const zh = (p.prompt_zh ?? '').trim();
  return en || zh ? { en, zh } : null;
}

/** 他要说出来的那句英文：**第三段以 `STAGE3` 为准**（盖掉 `STAGES` 里原来的 s1～s6） */
export const enOf = (item: DrillItem): string => (STAGE3[item.id]?.en ?? '').trim() || item.en;
/** 卡片上先显示的中文：第三段用 `prompt_zh`，没有就退回 `STAGES` 的中文情境 */
export const zhOf = (item: DrillItem): string => promptOf(item.id)?.zh || item.zh;

/**
 * 发音的编号：18 项各一段，**另加第三段 6 句「对方说的那句」**（`s1p`～`s6p`）。
 * 一共 24 段，第一次需要时生成一次就存 D1（src/drill-audio.ts、表 `drill_audio`）。
 */
export const AUDIO_IDS: string[] = [...ALL_IDS, ...STAGES[2].items.map((i) => i.id + 'p')];

/** 念出来之前只去掉"给眼睛看的符号"（填空的 ___、破折号），**不改一个词** */
export const sayText = (en: string): string => en.replace(/_+/g, ' ').replace(/[—–-]+$/g, ' ').replace(/\s+/g, ' ').trim();

/** 某一段发音要念的英文；编号不认识回 null（内容文件没给「对方说的那句」时，`s#p` 也回 null） */
export function audioTextOf(audioId: string): string | null {
  if (/^s[1-6]p$/.test(audioId)) {
    const pr = promptOf(audioId.slice(0, -1));
    return pr?.en ? sayText(pr.en) : null;
  }
  const item = STAGES.flatMap((s) => s.items).find((i) => i.id === audioId);
  return item ? sayText(enOf(item)) : null;
}

/**
 * 两句话有没有 **n 个词以上**的连续重合。
 * 第三段「对方说的那句」会**显示在卡片上**（那是对方的话，不是答案），所以它里面不许藏着答案；
 * `test/drill.test.ts` 用这个守着内容文件（产品换内容也得过这一关）。
 */
export function sharesWordRun(a: string, b: string, n = 4): boolean {
  const words = (t: string) => t.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
  const [A, B] = [words(a), words(b)];
  if (A.length < n || B.length < n) return false;
  const runs = new Set<string>();
  for (let i = 0; i + n <= A.length; i++) runs.add(A.slice(i, i + n).join(' '));
  for (let i = 0; i + n <= B.length; i++) if (runs.has(B.slice(i, i + n).join(' '))) return true;
  return false;
}

/**
 * 卡片上要的一整项。**null 的一律不显示那一行**（页面照这个画，不自己造"暂无"）。
 *   音标：只有第一段给（`CONTENT[id].ipa`）；重音提示：第二、三段给（`CONTENT[id].stress`）。
 *   发音：`发音` 是他要说的那句，`对方发音` 是第三段对方说的那句（没有就 null）。
 */
export function cardOf(item: DrillItem): Record<string, unknown> {
  const n = STAGE_OF.get(item.id) ?? 0;
  const c = CONTENT[item.id];
  const pr = promptOf(item.id);
  return {
    id: item.id,
    段: n,
    中文: zhOf(item),
    英文: enOf(item),
    关键点: keyOf(item),
    音标: n === 1 ? orNull(c?.ipa) : null,
    重音: n === 1 ? null : orNull(c?.stress),
    字面意思: orNull(c?.meaning),
    什么场合用: orNull(c?.usage),
    对方说的: pr?.en || null,
    对方说的中文: pr?.zh || null,
    发音: item.id,
    对方发音: n === 3 && pr?.en ? item.id + 'p' : null,
  };
}

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
        return { id: i.id, 中文: zhOf(i), 英文: passed(r) ? enOf(i) : null, 关键点: passed(r) ? keyOf(i) : null, 会了: passed(r), 第一次就会: !!r && r.pass_try === 1 };
      }),
    },
    // 现在考哪一项（英文、关键点、音标 / 重音、词义、用法一起给，页面先藏着，点「看答案」当场显示，不用再跑一趟接口）
    当前: now ? cardOf(now) : null,
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
