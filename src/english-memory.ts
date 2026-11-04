/**
 * 英语练习的"跨轮记忆"（工作台 → 英语练习 #/work/english，页面在 src/english-memory-page.ts，表在 migrations/0012_english_memory.sql）。
 *
 * **只做记忆 + 出题，不做语音、不做对话引擎**（Amos 2026-11-04 批的方案 b）：对话仍然在 Gemini Live 里进行。
 * 唯一的卖点是补上 Gemini Live 没有的那一块——**跨轮记忆**：
 *   - 他上一轮不认识 pitch，这一轮它照样用 → 我们把"词汇水平线"写进提示词，AI 只许用线内的词 + 今天要教的 3～5 个新词；
 *   - 他上一轮靠提示才说出来的句子，永远不会被再考一次 → 我们按**间隔**（1 轮 → 3 轮 → 7 轮）排下次该考的轮次，到期的自动进下一轮提示词。
 * 提示词 v4 里已经有的"同一轮之内回收"只能证明短时记住，**证明不了学会**，所以北极星指标是**跨轮**回收成功率。
 *
 * 三条硬约定（改这个文件前先看清楚）：
 * 1. **不花一分钱**（底线 8 / C117）：这里不调任何 AI（不接 Gemini、不接 OpenAI、不用 Workers AI），
 *    只做字符串拼接和 D1 读写。出题是模板拼的，不是生成的。
 * 2. **不解析整篇对话**——那不可靠。改成在生成的提示词里要求 AI 收尾时多吐一段机器可读的块，
 *    他把整段对话原样粘回来，我们只 grep `#LOG…#END`（parseLog）。**粘多粘少都不影响**。
 *    解析失败一律明确告诉他失败了和为什么（badLog 的 出错 + 怎么办），**不许静默吞掉**
 *    （2026-11-03 踩过这个坑：报错被盖掉，他以为是额度用光）。
 * 3. **提示词 v4 的全部规则原样保留**：规则段、"开始之前"段、"我说 done 的时候"段、8 条场景，
 *    一律从 src/english-page.ts 的 ENGLISH_MOD **现场抽出来**（segments()），不另抄一份——抄一份就会漂。
 *    新加的几条（词汇范围、跨轮回收、新词、#LOG）**追加在后面**，不改原文一个字。
 *
 * 入口只有 `/api/english/*` 一个，走后台登录（queue.ts 的 sessionOk）；后台密码没填时整个后台 404（queue.ts 的 adminEnabled）。
 * **不碰密钥**（底线 1）：这里读写的只有单词、句子、轮次计数和他粘回来的 #LOG 原文。
 */
import type { Env } from './env';
import { ENGLISH_MOD } from './english-page';

// ======================================================================
// 一、提示词的原料：从 ENGLISH_MOD 现场抽，不另抄一份
// ======================================================================

/** 8 条提示词正文（页面上的先后顺序），从 ENGLISH_MOD 的 <pre> 里抽出来 */
function rawPrompts(): { code: string; text: string }[] {
  const codes = [...ENGLISH_MOD.matchAll(/<span class="en-code">([CN]-\d)<\/span>/g)].map((m) => m[1]);
  const texts = [...ENGLISH_MOD.matchAll(/<pre class="en-pre" id="en-p\d+-t">([\s\S]*?)<\/pre>/g)].map((m) => m[1]);
  return texts.map((text, i) => ({ code: codes[i] ?? `C-${i + 1}`, text }));
}

/** 一条提示词拆成四段：场景 / 规则 / 开始之前 / 我说 done 的时候。四段都是**原文照抄**，一个字没动 */
export interface Segments { code: string; scene: string; rules: string; before: string; ending: string }
export function segments(i: number): Segments {
  const all = rawPrompts();
  const { code, text } = all[((i % all.length) + all.length) % all.length];
  const r = text.indexOf('规则：');
  const b = text.indexOf('开始之前：');
  const e = text.indexOf('我说 done 的时候');
  if (r < 0 || b < 0 || e < 0 || !(r < b && b < e)) throw new Error('english-page.ts 的提示词正文变了，四段切不出来（规则 / 开始之前 / 我说 done 的时候）');
  return { code, scene: text.slice(0, r).trim(), rules: text.slice(r, b).trim(), before: text.slice(b, e).trim(), ending: text.slice(e).trim() };
}

/** 一共几条场景（= ENGLISH_MOD 里的 8 条） */
export const SCENE_COUNT = rawPrompts().length;

// ======================================================================
// 二、词汇水平线的测试词表
// ======================================================================

/**
 * 测词汇线用的词表。**全部是手工整理的职场高频词**，没有引入任何外部词表。
 *
 * 为什么不配 NGSL / COCA（2026-11-04 查、逐条核对的结果，底线 3）：
 *   - **NGSL**（New General Service List 1.2，Browne & Culligan 2013，https://www.newgeneralservicelist.com/ ）
 *     授权是 **CC BY-SA 4.0**（官网 NGSL-Spoken、Graded Reader 两页写明；【证实】）。免费可商用，但 **ShareAlike 是传染性的**——
 *     把它的词表搬进本仓库，会给仓库带上"同样条件共享"的义务。这是 Amos 才能拍板的事（法务口径，不是研发能自己定的），
 *     所以**这一版不引入**，在这里写明，等他定。
 *   - **COCA** 的词频表是**付费授权**（english-corpora.org 按许可证卖），破底线 8 / C117，直接排除。
 *   - 而且他的症结不是"通用高频词"，是**职场英语的词汇和语域**——NGSL 这种通用表本来就覆盖不到
 *     test the waters / spot on / lock it in 这一类，配上来也不解决问题。
 *
 * band 的意思：1 = 天天说的 → 4 = 商务习语（他撞墙的那一类）。
 * band 4 里带「撞墙」注释的 7 个，是 Amos 前 4 轮对话里**实际卡住**的词（任务书给的已查实事实，【证实】），
 * 其余是照着同一个语域手工补的（【推断】）。
 */
export interface WordCheck { word: string; band: 1 | 2 | 3 | 4; zh: string }
export const WORDLIST: WordCheck[] = [
  // band 1：天天说的（用来校准——这一档都答不上，说明线比我们想的还低）
  { word: 'meeting', band: 1, zh: '会议' },
  { word: 'problem', band: 1, zh: '问题' },
  { word: 'finish', band: 1, zh: '做完' },
  { word: 'change', band: 1, zh: '改 / 变动' },
  { word: 'wait', band: 1, zh: '等' },
  { word: 'busy', band: 1, zh: '忙' },
  { word: 'later', band: 1, zh: '晚点' },
  { word: 'team', band: 1, zh: '团队' },
  { word: 'week', band: 1, zh: '周' },
  { word: 'help', band: 1, zh: '帮忙' },
  // band 2：办公常用
  { word: 'update', band: 2, zh: '更新 / 同步进展' },
  { word: 'issue', band: 2, zh: '问题（正式一点）' },
  { word: 'deadline', band: 2, zh: '截止时间' },
  { word: 'schedule', band: 2, zh: '安排 / 日程' },
  { word: 'cover', band: 2, zh: '替某人顶上' },
  { word: 'reschedule', band: 2, zh: '改期' },
  { word: 'available', band: 2, zh: '有空 / 可用' },
  { word: 'approve', band: 2, zh: '批准' },
  { word: 'release', band: 2, zh: '发布' },
  { word: 'feedback', band: 2, zh: '反馈' },
  { word: 'confirm', band: 2, zh: '确认' },
  { word: 'delay', band: 2, zh: '推迟 / 延期' },
  { word: 'estimate', band: 2, zh: '估时 / 估算' },
  { word: 'owner', band: 2, zh: '负责人' },
  { word: 'blocker', band: 2, zh: '卡住的事' },
  // band 3：职场正式词（他说「80% words of you say」时，AI 用的多半是这一档）
  { word: 'mitigate', band: 3, zh: '把风险或影响降下来' }, // 撞墙（已查实）
  { word: 'scope', band: 3, zh: '范围' }, // 撞墙（已查实）
  { word: 'solidify', band: 3, zh: '敲定 / 坐实' }, // 撞墙（已查实）
  { word: 'prioritize', band: 3, zh: '排优先级' },
  { word: 'clarify', band: 3, zh: '讲清楚' },
  { word: 'align', band: 3, zh: '对齐（看法一致）' },
  { word: 'escalate', band: 3, zh: '升级上报' },
  { word: 'trade-off', band: 3, zh: '取舍' },
  { word: 'constraint', band: 3, zh: '限制条件' },
  { word: 'bandwidth', band: 3, zh: '（人的）精力 / 工时' },
  { word: 'handoff', band: 3, zh: '交接' },
  { word: 'rollback', band: 3, zh: '回滚' },
  { word: 'workaround', band: 3, zh: '临时绕过的办法' },
  { word: 'scope creep', band: 3, zh: '需求不断变大' },
  { word: 'stakeholder', band: 3, zh: '利益相关方' },
  { word: 'leverage', band: 3, zh: '利用（某个优势）' },
  { word: 'streamline', band: 3, zh: '把流程理顺' },
  { word: 'rough estimate', band: 3, zh: '粗估' },
  { word: 'sign off', band: 3, zh: '签字同意' },
  { word: 'take over', band: 3, zh: '接手' },
  // band 4：商务习语（**他的真正症结**；雅思听力根本不考这一类）
  { word: 'pitch', band: 4, zh: '（向人）推介、讲方案' }, // 撞墙（已查实）
  { word: 'test the waters', band: 4, zh: '先试探一下反应' }, // 撞墙（已查实）
  { word: 'spot on', band: 4, zh: '说得太对了' }, // 撞墙（已查实）
  { word: 'lock it in', band: 4, zh: '就这么定了' }, // 撞墙（已查实）
  { word: 'circle back', band: 4, zh: '回头再聊这件事' },
  { word: 'touch base', band: 4, zh: '碰个头、对一下' },
  { word: 'on the same page', band: 4, zh: '想法一致' },
  { word: 'ballpark', band: 4, zh: '大概的数' },
  { word: 'heads-up', band: 4, zh: '提前知会一声' },
  { word: 'loop in', band: 4, zh: '把某人拉进来' },
  { word: 'push back', band: 4, zh: '（礼貌地）反对' },
  { word: 'run it by you', band: 4, zh: '跟你过一遍' },
  { word: 'wrap up', band: 4, zh: '收尾' },
  { word: 'bring you up to speed', band: 4, zh: '把来龙去脉跟你说一遍' },
  { word: 'buy-in', band: 4, zh: '（对方的）认可和支持' },
  { word: 'off the top of my head', band: 4, zh: '我凭印象说' },
];

/** 每一档在提示词里怎么说给 AI 听（直接说"第 3 档"它听不懂） */
export const BAND_SAY: Record<number, string> = {
  0: '只用最基础的日常词（小学程度），每句不超过 8 个词',
  1: '只用天天都会说的日常词',
  2: '只用日常办公常用词',
  3: '日常办公常用词，正式一点的职场词也可以用',
  4: '职场词和商务习语都可以用',
};
/** 每一档在页面上怎么写给 Amos 看 */
export const BAND_ZH: Record<number, string> = {
  0: '还在最基础的日常词',
  1: '天天说的日常词',
  2: '办公常用词',
  3: '职场正式词',
  4: '商务习语',
};

/**
 * 算词汇线：从第 1 档往上，**每一档认识率都 ≥ 80%** 才算过，卡在哪一档线就在哪儿。
 * 没测过的词不算分母（底线 3：没测到就不猜）；一档一个词都没测过，到这里就停。
 */
export function vocabLine(answers: { band: number; known: boolean }[]): number {
  let line = 0;
  for (let b = 1; b <= 4; b++) {
    const inBand = answers.filter((a) => a.band === b);
    if (!inBand.length) break;
    if (inBand.filter((a) => a.known).length / inBand.length < 0.8) break;
    line = b;
  }
  return line;
}

// ======================================================================
// 三、#LOG 的解析（第 3 步，决定成败的那一步）
// ======================================================================

/** 归一化一句话：小写、去掉标点、压掉多余空格。同一句换个标点不算新句 */
export function normSentence(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9']+/g, ' ').trim().replace(/\s+/g, ' ');
}

/** 去掉两边的引号（直引号、弯引号、中文引号都认），再 trim */
function unquote(s: string): string {
  return s.trim().replace(/^["'‘’“”「」]+/, '').replace(/["'‘’“”「」]+$/, '').trim();
}

const splitList = (s: string) => s.split(/[,、;；]/).map((x) => unquote(x).toLowerCase()).filter(Boolean).filter((x) => x.length <= 40).slice(0, 40);
const splitSentences = (s: string) => s.split('|').map(unquote).filter(Boolean).map((x) => x.slice(0, 200)).slice(0, 20);

export interface ParsedLog {
  stuck: string[];
  helped: string[];
  recalled: { text: string; ok: boolean }[];
  fresh: string[];
  counts: { a: number | null; b: number | null; c: number | null };
  raw: string;
  /** 看得懂但有点不对劲的地方：原样告诉他，不吞掉（底线 3、9） */
  warnings: string[];
}
export interface LogError { 出错: string; 怎么办: string }
export type LogResult = { ok: true; log: ParsedLog } | { ok: false; err: LogError };

/** #LOG 块里认识的键，页面上的"格式长什么样"也用这一份 */
export const LOG_KEYS = ['stuck', 'helped', 'recalled', 'new', 'counts'] as const;

/**
 * 从他粘回来的整段对话里 grep 出 `#LOG…#END` 并解析。**粘多粘少都不影响**，只看这一块。
 * 有好几块时取**最后一块**（他可能跑了一轮又补了一次收尾）。
 * 失败一律回 {ok:false}，带"出错"和"怎么办"两句话，页面原样显示——不许静默吞掉。
 */
export function parseLog(input: string): LogResult {
  const text = typeof input === 'string' ? input : '';
  if (!text.trim()) return { ok: false, err: { 出错: '输入框是空的，没收到任何内容。', 怎么办: '把 Gemini Live 那一整段对话（从头到尾，包含它最后吐出来的 #LOG 那一块）原样粘进来。' } };
  const i = text.lastIndexOf('#LOG');
  if (i < 0)
    return {
      ok: false,
      err: {
        出错: '粘进来的内容里找不到 #LOG 这一块（一共 ' + text.length + ' 个字，都看过了）。',
        怎么办: '多半是对话还没说 done、或者它漏了收尾那一段。回到 Gemini Live 里说一句 "done"，等它把 #LOG 到 #END 那一块吐出来，再整段粘回来。',
      },
    };
  const j = text.indexOf('#END', i);
  if (j < 0) return { ok: false, err: { 出错: '找到了 #LOG，但后面没有 #END，这一块是断的。', 怎么办: '多半是复制时少选了后面几行。回到对话里，从 #LOG 那一行一直选到 #END 那一行，再粘一次。' } };
  const raw = text.slice(i, j + 4);
  const body = text.slice(i + 4, j);

  const log: ParsedLog = { stuck: [], helped: [], recalled: [], fresh: [], counts: { a: null, b: null, c: null }, raw: raw.slice(0, 2000), warnings: [] };
  let hit = 0;
  const unknown: string[] = [];
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const m = /^([A-Za-z_]+)\s*[:：]\s*([\s\S]*)$/.exec(t);
    if (!m) { unknown.push(t.slice(0, 40)); continue; }
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (!(LOG_KEYS as readonly string[]).includes(key)) { unknown.push(t.slice(0, 40)); continue; }
    hit++;
    if (!val) continue;
    if (key === 'stuck') log.stuck = splitList(val);
    else if (key === 'new') log.fresh = splitList(val);
    else if (key === 'helped') log.helped = splitSentences(val);
    else if (key === 'recalled') {
      for (const part of splitSentences(val)) {
        const k = part.lastIndexOf('=');
        if (k < 0) { log.warnings.push(`recalled 里这一条没写 = yes 还是 = no，没算进回收成功率：${part.slice(0, 60)}`); continue; }
        const sent = unquote(part.slice(0, k));
        const verdict = part.slice(k + 1).trim().toLowerCase();
        if (!sent) { log.warnings.push(`recalled 里有一条只有 = 号、没有句子，跳过了：${part.slice(0, 60)}`); continue; }
        if (/^(yes|y|ok|true|对|是|会)$/.test(verdict)) log.recalled.push({ text: sent, ok: true });
        else if (/^(no|n|false|不对|不会|否)$/.test(verdict)) log.recalled.push({ text: sent, ok: false });
        else log.warnings.push(`recalled 里这一条的结果写成了「${verdict.slice(0, 20)}」，只认 yes / no，没算进回收成功率：${sent.slice(0, 40)}`);
      }
    } else if (key === 'counts') {
      const num = (c: string) => { const x = new RegExp(c + '\\s*=\\s*(\\d{1,4})', 'i').exec(val); return x ? Number(x[1]) : null; };
      log.counts = { a: num('A'), b: num('B'), c: num('C') };
      if (log.counts.a === null && log.counts.b === null && log.counts.c === null) log.warnings.push(`counts 这一行看不懂（要的是 A=12 B=9 C=4 这个样子）：${val.slice(0, 60)}`);
    }
  }
  if (unknown.length) log.warnings.push(`#LOG 里有 ${unknown.length} 行不认识、跳过了（只认 ${LOG_KEYS.join(' / ')}）：${unknown.slice(0, 3).join(' ／ ')}`);
  if (!hit)
    return {
      ok: false,
      err: {
        出错: '找到了 #LOG…#END，但里面一行有用的都没有（认识的只有 ' + LOG_KEYS.join(' / ') + '）。',
        怎么办: '把这一块原样发回给助理看一眼——多半是它换了格式。这一轮先不入库，免得存进去假数据。',
      },
    };
  return { ok: true, log };
}

// ======================================================================
// 四、跨轮回收的间隔
// ======================================================================

/** 间隔：第 1 次隔 1 轮、再隔 3 轮、再隔 7 轮；第 3 档再说对就毕业，不再考 */
export const GAPS = [1, 3, 7] as const;
/**
 * 考完一句之后，下一次该在第几轮考。
 * 说对 → 往上走一档（走完 GAPS 就毕业，step = GAPS.length，due_round = 0 表示不再派）；
 * 说不出来 → **退回第一档**，下一轮马上再考（间隔重排）。
 */
export function nextDue(step: number, round: number, ok: boolean): { step: number; due: number } {
  if (!ok) return { step: 0, due: round + GAPS[0] };
  const s = Math.min(step + 1, GAPS.length);
  return s >= GAPS.length ? { step: GAPS.length, due: 0 } : { step: s, due: round + GAPS[s] };
}

// ======================================================================
// 五、拼这一轮的提示词
// ======================================================================

/** 一轮要用到的记忆 */
export interface Memory { line: number; avoid: string[]; due: string[]; fresh: { word: string; zh: string }[] }

/**
 * 拼出完整的一段提示词。结构：
 *   场景（原文）→ 规则（v4 原文）+ 追加的 4 条 → 开始之前（原文）→ 我说 done 的时候（原文）+ #LOG 块要求。
 * **v4 原文一个字没动**，新东西全是追加的。
 */
export function buildPrompt(seg: Segments, m: Memory): string {
  const 线 = BAND_SAY[Math.max(0, Math.min(4, m.line))];
  const 追加: string[] = [`- 用词范围（这一条优先于其他规则）：${线}。超出这个范围的词一律换成范围内的说法；实在要用，先用一句话解释它。`];
  if (m.avoid.length) 追加.push(`- 下面这些词我明确说过不认识，整场**一个都不要用**：${m.avoid.join('、')}。`);
  if (m.fresh.length) 追加.push(`- 今天只教这 ${m.fresh.length} 个新词：${m.fresh.map((f) => `${f.word}（${f.zh}）`).join('、')}。每个都要造机会让我**自己说出来**一次，不是你说给我听。别教别的新词。`);
  if (m.due.length) {
    追加.push(
      `- 跨轮回收（这一轮最重要的事）：下面这 ${m.due.length} 句是我**前几轮靠提示才说出来的**，今天到期要考。` +
        `对话里找机会让我**重新说出同一个意思**，**不给任何提示**，也不要把原句念给我听。我说出来了就接着聊，说不出来就按五级台阶帮我：\n` +
        m.due.map((s, i) => `  ${i + 1}) ${s}`).join('\n'),
    );
  }
  const 块 = [
    '最后，另起一行，再吐一段**机器可读**的块，格式一字不差地照下面来（没有的项就写空，但那一行要在）：',
    '#LOG',
    'stuck: 这一轮我听不懂或说不出来的词，英文原词，逗号隔开',
    'helped: 这一轮我靠句首、关键词或整句才说出来的句子，每句用英文双引号括起来，句子之间用 | 隔开',
    'recalled: 上面"跨轮回收"那几句，每句写成 "原句" = yes 或 "原句" = no（yes = 不给提示我自己说出来了），句子之间用 | 隔开',
    'new: 今天教我的新词，逗号隔开',
    'counts: A=自己造的句子数 B=靠提示才说出来的句子数 C=同一轮之内回收时独立说对的句子数',
    '#END',
    '这一段只许出现一次，放在整段回答的最后，前后不要加任何说明文字。',
  ].join('\n');
  return [seg.scene, seg.rules + '\n' + 追加.join('\n'), seg.before, seg.ending + '\n\n' + 块].join('\n\n');
}

// ======================================================================
// 六、接口（/api/english/*，走后台登录）
// ======================================================================

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const bad = (出错: string, 怎么办: string, status = 400) => json({ 出错, 怎么办 }, status);

interface WordRow { word: string; band: number; known: number; source: string; taught_round: number }
interface SentRow { id: number; norm: string; text: string; from_round: number; due_round: number; step: number; asked: number; passed: number }
interface RoundRow { n: number; started_at: number; logged_at: number | null; scene: string; due_json: string; new_json: string; prompt: string; a: number | null; b: number | null; c: number | null; recall_due: number; recalled: number }

const BY_WORD = new Map(WORDLIST.map((p) => [p.word, p]));

async function readState(env: Env, now: number) {
  const [words, sents, rounds] = await Promise.all([
    env.DB.prepare('SELECT word, band, known, source, taught_round FROM en_word').all<WordRow>(),
    env.DB.prepare('SELECT id, norm, text, from_round, due_round, step, asked, passed FROM en_sentence ORDER BY due_round, id').all<SentRow>(),
    env.DB.prepare('SELECT n, started_at, logged_at, scene, due_json, new_json, prompt, a, b, c, recall_due, recalled FROM en_round ORDER BY n').all<RoundRow>(),
  ]);
  void now;
  return { words: words.results ?? [], sents: sents.results ?? [], rounds: rounds.results ?? [] };
}

/** 词汇线测到哪儿了：下一个要问的词、已答几个 */
function lineState(words: WordRow[]) {
  const done = new Set(words.filter((w) => w.source === 'line').map((w) => w.word));
  const next = WORDLIST.find((p) => !done.has(p.word)) ?? null;
  const answers = words.filter((w) => w.source === 'line' && BY_WORD.has(w.word)).map((w) => ({ band: w.band, known: !!w.known }));
  return { done: done.size, total: WORDLIST.length, next, line: vocabLine(answers), finished: done.size >= WORDLIST.length };
}

/** 北极星：跨轮回收成功率 = 到期被考、且不给提示说对了的 ÷ 到期被考总数。分母 0 时回 null，**不编造**（底线 3） */
export function recallRate(rounds: { recall_due: number; recalled: number }[]): { asked: number; passed: number; rate: number | null } {
  const asked = rounds.reduce((n, r) => n + r.recall_due, 0);
  const passed = rounds.reduce((n, r) => n + r.recalled, 0);
  return { asked, passed, rate: asked ? passed / asked : null };
}

export async function englishApi(env: Env, req: Request, now: number, sub: string): Promise<Response | null> {
  // ---- 看一眼现在是什么情况（页面每次打开都读这个） ----
  if (sub === 'state' && req.method === 'GET') {
    const { words, sents, rounds } = await readState(env, now);
    const pr = lineState(words);
    const open = rounds.find((r) => r.logged_at === null) ?? null;
    const last = rounds.length ? rounds[rounds.length - 1].n : 0;
    // 下一轮的轮次号：有开着的轮就是它自己，没有就是上一轮 + 1
    const next = open ? open.n : last + 1;
    const due = sents.filter((s) => s.step < GAPS.length && s.due_round > 0 && s.due_round <= next);
    return json({
      词汇线: { 已答: pr.done, 一共: pr.total, 测完了: pr.finished, 线: pr.line, 线说明: BAND_ZH[pr.line], 下一个: pr.next ? { 词: pr.next.word, 中文: pr.next.zh, 档: pr.next.band } : null },
      跨轮回收成功率: recallRate(rounds),
      轮次: { 已经跑过: rounds.filter((r) => r.logged_at !== null).length, 这一轮: next, 开着的轮: open ? { n: open.n, 场景: open.scene, 提示词: open.prompt } : null },
      到期要考: due.length,
      句子: { 一共: sents.length, 毕业: sents.filter((s) => s.step >= GAPS.length).length },
      不认识的词: words.filter((w) => !w.known).length,
      最近几轮: rounds.slice(-8).reverse().map((r) => ({ n: r.n, 场景: r.scene, 贴回来了: r.logged_at !== null, A: r.a, B: r.b, C: r.c, 到期考了: r.recall_due, 说对了: r.recalled })),
    });
  }

  if (req.method !== 'POST') return null;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // ---- 第 1 步：一次一个词，认识 / 不认识 ----
  if (sub === 'word') {
    const word = typeof body.word === 'string' ? body.word.trim() : '';
    const p = BY_WORD.get(word);
    if (!p) return bad(`这个词不在词表里：${word.slice(0, 40) || '（空）'}`, '刷新一下页面，它会重新给你下一个词。', 400);
    if (typeof body.known !== 'boolean') return bad('没收到"认识还是不认识"。', '点一下下面两个大按钮里的一个。', 400);
    await env.DB.prepare(
      'INSERT INTO en_word (word, band, known, source, taught_round, first_at, at) VALUES (?1, ?2, ?3, \'line\', 0, ?4, ?4) ' +
        'ON CONFLICT (word) DO UPDATE SET band = ?2, known = ?3, source = \'line\', at = ?4',
    ).bind(p.word, p.band, body.known ? 1 : 0, now).run();
    const { words } = await readState(env, now);
    const pr = lineState(words);
    return json({ ok: true, 已答: pr.done, 一共: pr.total, 测完了: pr.finished, 线: pr.line, 线说明: BAND_ZH[pr.line], 下一个: pr.next ? { 词: pr.next.word, 中文: pr.next.zh, 档: pr.next.band } : null });
  }

  // ---- 第 2 步：开始这一轮，生成提示词 ----
  if (sub === 'start') {
    const { words, sents, rounds } = await readState(env, now);
    const pr = lineState(words);
    if (!pr.finished) return bad(`词汇线还没测完（${pr.done} / ${pr.total}）。`, '先在上面一个一个点完"认识 / 不认识"，再开始这一轮——不然 AI 不知道该用哪些词。', 409);
    const open = rounds.find((r) => r.logged_at === null);
    if (open) return json({ ok: true, n: open.n, 场景: open.scene, 提示词: open.prompt, 说明: '这一轮已经开过了，还是同一份提示词。' });

    const n = (rounds.length ? rounds[rounds.length - 1].n : 0) + 1;
    const dueRows = sents.filter((s) => s.step < GAPS.length && s.due_round > 0 && s.due_round <= n).slice(0, 6);
    // 今天要教的 3～5 个新词：他说"不认识"、而且还没教过的，最常用的先教（band 小的在前）。
    // 词表里的词带中文解释；对话里 stuck 报上来的生词没有解释，就照实说它是哪来的（不编一个中文意思，底线 3）
    const freshRows = words
      .filter((w) => !w.known && !w.taught_round)
      .sort((a, b) => a.band - b.band || a.word.localeCompare(b.word))
      .slice(0, 5)
      .map((w) => ({ word: w.word, zh: BY_WORD.get(w.word)?.zh ?? '上一轮你卡住的词' }));
    // "整场一个都不要用"的黑名单：不认识、而且今天也不教的词（太长会把提示词撑爆，取最靠前的 30 个）
    const freshSet = new Set(freshRows.map((f) => f.word));
    const avoid = words.filter((w) => !w.known && !freshSet.has(w.word)).sort((a, b) => a.band - b.band).slice(0, 30).map((w) => w.word);
    const seg = segments(n - 1);
    const prompt = buildPrompt(seg, { line: pr.line, avoid, due: dueRows.map((s) => s.text), fresh: freshRows });

    await env.DB.prepare('INSERT INTO en_round (n, started_at, logged_at, scene, due_json, new_json, prompt) VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6)')
      .bind(n, now, seg.code, JSON.stringify(dueRows.map((s) => s.id)), JSON.stringify(freshRows.map((f) => f.word)), prompt)
      .run();
    if (freshRows.length)
      await env.DB.batch(freshRows.map((f) => env.DB.prepare('UPDATE en_word SET taught_round = ?1, at = ?2 WHERE word = ?3').bind(n, now, f.word)));
    return json({ ok: true, n, 场景: seg.code, 提示词: prompt, 这轮要回收: dueRows.length, 这轮要教: freshRows.map((f) => f.word) });
  }

  // ---- 第 3 步：贴回来，自动入库 ----
  if (sub === 'log') {
    const { sents, rounds } = await readState(env, now);
    const open = rounds.find((r) => r.logged_at === null);
    if (!open) return bad('现在没有开着的轮次，不知道这一段是哪一轮的。', '先点上面的「开始这一轮」，把提示词复制去 Gemini Live 聊完，再回来粘。', 409);
    const r = parseLog(typeof body.text === 'string' ? body.text : '');
    if (!r.ok) return json({ ...r.err, 轮次: open.n }, 422);
    const log = r.log;

    const byNorm = new Map(sents.map((s) => [s.norm, s]));
    const dueIds: number[] = (() => { try { const a = JSON.parse(open.due_json); return Array.isArray(a) ? a.filter((x): x is number => typeof x === 'number') : []; } catch { return []; } })();
    const dueSet = new Set(dueIds);
    const stmts: D1PreparedStatement[] = [];
    const warnings = [...log.warnings];

    // ① 生词：stuck（对话里卡住的）+ new（今天教的）都记成"不认识"，下次派新词时优先
    // 注意：词汇线里他点过"认识"、这一轮却真的卡住的词，这里会把 known 改回 0——
    // 对话里卡住是**实际证据**，比他自己报的更可信（底线 3），线会跟着往下调，下一轮 AI 就不再用它
    for (const w of [...log.stuck, ...log.fresh]) {
      const p = BY_WORD.get(w);
      stmts.push(
        env.DB.prepare(
          'INSERT INTO en_word (word, band, known, source, taught_round, first_at, at) VALUES (?1, ?2, 0, ?3, ?4, ?5, ?5) ' +
            'ON CONFLICT (word) DO UPDATE SET known = 0, at = ?5, taught_round = MAX(taught_round, ?4)',
        ).bind(w, p?.band ?? 4, log.fresh.includes(w) ? 'new' : 'stuck', log.fresh.includes(w) ? open.n : 0, now),
      );
    }

    // ② 靠提示才说出来的句子：没见过的存一条，下一轮就考（间隔第 1 档）
    let added = 0;
    for (const text of log.helped) {
      const norm = normSentence(text);
      if (!norm || byNorm.has(norm)) continue;
      byNorm.set(norm, { id: -1, norm, text, from_round: open.n, due_round: open.n + GAPS[0], step: 0, asked: 0, passed: 0 });
      added++;
      stmts.push(
        env.DB.prepare('INSERT INTO en_sentence (norm, text, from_round, due_round, step, asked, passed, last_result, first_at, at) VALUES (?1, ?2, ?3, ?4, 0, 0, 0, \'\', ?5, ?5) ON CONFLICT (norm) DO NOTHING')
          .bind(norm, text.slice(0, 200), open.n, open.n + GAPS[0], now),
      );
    }

    // ③ 跨轮回收的结果：只认**这一轮真的派出去考了**的句子（北极星的分母就是它）
    let askedN = 0;
    let passedN = 0;
    const hitIds = new Set<number>();
    for (const rc of log.recalled) {
      const s = byNorm.get(normSentence(rc.text));
      if (!s || s.id < 0) { warnings.push(`recalled 里这一句库里没有、也不是这一轮派出去的，没算进回收成功率：${rc.text.slice(0, 50)}`); continue; }
      if (!dueSet.has(s.id)) { warnings.push(`recalled 里这一句不是这一轮派出去考的，没算进回收成功率：${rc.text.slice(0, 50)}`); continue; }
      if (hitIds.has(s.id)) { warnings.push(`recalled 里这一句报了两次，只算第一次：${rc.text.slice(0, 50)}`); continue; }
      hitIds.add(s.id);
      askedN++;
      if (rc.ok) passedN++;
      const nx = nextDue(s.step, open.n, rc.ok);
      stmts.push(
        env.DB.prepare('UPDATE en_sentence SET step = ?1, due_round = ?2, asked = asked + 1, passed = passed + ?3, last_result = ?4, at = ?5 WHERE id = ?6')
          .bind(nx.step, nx.due, rc.ok ? 1 : 0, rc.ok ? 'yes' : 'no', now, s.id),
      );
    }
    const missed = dueIds.filter((id) => !hitIds.has(id));
    if (missed.length) {
      warnings.push(`这一轮派出去的 ${dueIds.length} 句里，有 ${missed.length} 句它没考到，**不算进成功率**，顺延到下一轮。`);
      stmts.push(env.DB.prepare(`UPDATE en_sentence SET due_round = ?1, at = ?2 WHERE id IN (${missed.map((_, i) => '?' + (i + 3)).join(',')})`).bind(open.n + 1, now, ...missed));
    }

    stmts.push(
      env.DB.prepare('UPDATE en_round SET logged_at = ?1, a = ?2, b = ?3, c = ?4, recall_due = ?5, recalled = ?6, raw = ?7 WHERE n = ?8')
        .bind(now, log.counts.a, log.counts.b, log.counts.c, askedN, passedN, log.raw, open.n),
    );
    await env.DB.batch(stmts);

    const after = await env.DB.prepare('SELECT recall_due, recalled FROM en_round').all<{ recall_due: number; recalled: number }>();
    console.log(JSON.stringify({ event: 'english.log_saved', round: open.n, asked: askedN, passed: passedN, added }));
    return json({
      ok: true,
      轮次: open.n,
      存下来了: { 新句子: added, 生词: log.stuck.length + log.fresh.length, 到期考了: askedN, 说对了: passedN },
      跨轮回收成功率: recallRate(after.results ?? []),
      提醒: warnings,
    });
  }

  return null;
}
