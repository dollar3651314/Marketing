/** 带练场景 0 的内容数据（音标、词意、用法、第三段的对话情境）。
 *  **只有这个文件可以放内容**；src/drill.ts 只管结构和逻辑，一个字都不许自己编。
 *  每条的 src 是实际打开过的词典页 URL；查不到写 '未查到'，对应字段写 null（底线 3）。
 *
 *  **出处说明（2026-11-10 逐条抓页核对，别改成"照抄原文"）**：
 *   - `ipa`：全部取自剑桥词典词条页上的 **us**（美式）音标，一字未改。六个词都查到了，没有一条是编的。
 *     单音节词剑桥本来就不标重音符号（例 /kætʃ/），不是漏了。
 *   - `meaning`：按同一张词条页上**那条用得上的释义**翻译成中文（例 catch 取
 *     "to manage to hear or see something, so you understand or remember it"，不是"接住球"那条）。
 *   - `src`：就是上面那张词条页的地址，可以点开核对。p 和 s 两段的 src 指向**这一条的关键语块**的词条页
 *     （p6/s6 没有词条，指向剑桥语法的 wh- 分裂句那页）。
 *   - **`stress` 和 `usage` 不是词典原文**：是本会话按英语连读 / 重音的通例写的教学提示和场合说明，
 *     没有逐条出处，不要当成剑桥的话引用（底线 3、9：没验证的如实标出来）。
 *
 *  **第三段为什么整段重做**：旧版 s1～s6 是第二段 p1～p6 后面接个尾巴（例 p2
 *  `Sorry, I didn't catch that.` → s3 加 `Could you say it again?`），刚背完立刻考同一句，
 *  Amos 2026-11-09 走完 18 项第二段 6/6、第三段 6/6——全对不是因为会了，是题目重复。
 *  新形式见 `STAGE3`：**对方先说一句英文，他来接**，`prompt_en` 里不出现答案里的语块。
 */

/** 一项的内容：音标 / 重音提示 / 字面意思 / 用法 / 出处 */
export interface DrillContent {
  ipa?: string | null;        // 只有 w1～w6 有
  stress?: string | null;     // 只有 p*/s* 有：重音和连读提示
  meaning: string | null;     // 字面意思
  usage: string | null;       // 什么场合用
  src: string;                // 出处 URL 或 '未查到'
}

/** 第三段新形式：对方先说一句，他来接 */
export interface DrillPrompt { prompt_en: string; prompt_zh: string; en: string }

/**
 * w1 的关键点（Amos 2026-11-10 定稿，照抄别改字）。
 * 旧版写的是"没听清用 catch，不要用 understand"——那是条**假禁令**：understand 是好词，
 * 只是意思不同。说 catch 对方会把那句**重说一遍**；说 understand 对方会**换一套说法从头解释**。
 */
export const W1_KEY = 'catch 是耳朵没收到；understand 是听清了但没懂。说错了对方会帮错忙';

/** 剑桥词典词条页（下面反复引用，集中放一处，改地址只改这里） */
const C = (slug: string) => `https://dictionary.cambridge.org/dictionary/english/${slug}`;
/** 剑桥语法：wh- 分裂句（`What you're saying is ...` 这个结构） */
const CLEFT = 'https://dictionary.cambridge.org/grammar/british-grammar/cleft-sentences-it-was-in-june-we-got-married';

/** 18 项的内容：w1～w6（单词，给音标）、p1～p6 和 s1～s6（整句，给重音连读提示） */
export const CONTENT: Record<string, DrillContent> = {
  // ---- 第 1 段 单词：ipa 取剑桥词条页的 us 音标 ----
  w1: {
    ipa: '/kætʃ/',
    meaning: '听清、听到并记住（对方说的话）',
    usage: '开会最常用；后面常接 that 或 what',
    src: C('catch'),
  },
  w2: {
    ipa: '/ˈfɑː.loʊ/',
    meaning: '跟得上（对方正在说的思路）',
    usage: "常用否定进行时 I'm not following",
    src: C('follow'),
  },
  w3: {
    ipa: '/miːn/',
    meaning: '表达、指的是（某个想法或事实）',
    usage: '问人别光说 What？那太冲，加 do you mean',
    src: C('mean'),
  },
  w4: {
    ipa: '/ˌriːˈfreɪz/',
    meaning: '换一种、通常更清楚的说法再讲一遍',
    usage: '对方讲得绕时用；repeat 只会原样再来一遍',
    src: C('rephrase'),
  },
  w5: {
    ipa: '/lɑːst/',
    meaning: '（形容词）懵了、听不明白了',
    usage: "说 I'm lost 是求助信号，对方会从头讲",
    src: C('lost'),
  },
  w6: {
    ipa: '/ˈkler.ə.faɪ/',
    meaning: '把事情讲得更清楚、补上细节',
    usage: '正式场合用；比直接问 What 礼貌得多',
    src: C('clarify'),
  },

  // ---- 第 2 段 词组：整句不给 IPA（没用），给重音和连读 ----
  p1: {
    stress: '重音压在 mean 和 by 后面那个词',
    meaning: '直译：你说的 ___ 指的是什么？',
    usage: '点名问那一个词，比 What？精准',
    src: C('mean'),
  },
  p2: {
    stress: "didn't catch 连读；重音在 catch",
    meaning: '直译：抱歉，我没接住那句话',
    usage: '开会最常用；加 Sorry 不显得没礼貌',
    src: C('catch'),
  },
  p3: {
    stress: '重音在 slow 和 down，前面轻读带过',
    meaning: '直译：你能稍微放慢一点吗？',
    usage: 'a bit 是缓冲，省了听着像命令',
    src: C('slow-down'),
  },
  p4: {
    stress: '重音在 -phrase；that 轻读带过',
    meaning: '直译：你能换个说法说那句吗？',
    usage: '听清了但没懂时用；没听清用 catch',
    src: C('rephrase'),
  },
  p5: {
    stress: 'Just to 轻快带过；重音落在 sure',
    meaning: '直译：只是为了确认我理解对了 ——',
    usage: '开场缓冲句，后面接你自己的复述',
    src: C('make-sure'),
  },
  p6: {
    stress: "what you're 连读；重音在 saying",
    meaning: '直译：所以你说的是 ___',
    usage: 'wh- 分裂句，把结论顶到后半句',
    src: CLEFT,
  },

  // ---- 第 3 段 例句：他要接的那一句（情境见 STAGE3）----
  s1: {
    stress: '重音落在被问的那个词 de-risk 上',
    meaning: '直译：你说的 de-risk 是什么意思？',
    usage: '把不懂的词原样念回去，最省事',
    src: C('mean'),
  },
  s2: {
    stress: "didn't catch 连读；that 轻读带过",
    meaning: '直译：抱歉，我没接住那句话',
    usage: '整句没听清就用它，不用解释原因',
    src: C('catch'),
  },
  s3: {
    stress: 'slow down 连读；重音压在 slow',
    meaning: '直译：能慢一点吗？三个我都想记下',
    usage: '补一句理由，对方更愿意配合',
    src: C('slow-down'),
  },
  s4: {
    stress: '重音在 follow；前半句一串轻读',
    meaning: '直译：能换个说法吗？我不太跟得上',
    usage: '后半句说明是没懂，不是没听见',
    src: C('rephrase'),
  },
  s5: {
    stress: '破折号后抬高语调，听着像在提问',
    meaning: '直译：确认一下 —— 稿今晚发，模型周五？',
    usage: '复述两个时间点，错了对方当场纠正',
    src: C('make-sure'),
  },
  s6: {
    stress: 'So 后面稍停；重音在 drop 和 date',
    meaning: '直译：所以你的意思是砍掉面板保住试点',
    usage: '用自己的话复述结论，确认没理解歪',
    src: CLEFT,
  },
};

/**
 * 第三段的六个情境：`prompt_en` 是**对方先说的那一句**，他听完接 `en`。
 * 硬要求：`prompt_en` 里**绝不能出现 `en` 里的目标语块**（否则又变成照抄）。
 * 目标语块和第 2 段一一对应：s1=What do you mean by、s2=didn't catch that、
 * s3=slow down a bit、s4=rephrase、s5=Just to make sure I understand、s6=So what you're saying is。
 */
export const STAGE3: Record<string, DrillPrompt> = {
  s1: {
    prompt_en: 'Before we sign anything, legal wants us to de-risk the whole merchant onboarding flow first.',
    prompt_zh: '他蹦出一个你没听过的词',
    en: 'What do you mean by "de-risk"?',
  },
  // **s2 的答案和第二段 p2 一字不差，这是 Amos 2026-11-10 看过细节后定的「就这样用」，不是漏改。**
  // 背景：另外五条第三段都在第二段原句后面接了尾巴，只有这一条直接用了原句。实际后果他也知道：
  // 复考 18 项打散后，p2 和 s2 是两张题面不同、答案相同的卡，「说得出来 N / 18」把这一句算两次，
  // 这一句也占了两段发音（audioTextOf('p2') === audioTextOf('s2')，跑过）。
  // 当时提的改法是接上 `— could you say it again?`，**他明确回了「不用了，我就这样用」。**
  // 所以：**要改这一条得他本人再发话**，别当成 bug 顺手修掉（test/drill.test.ts 第 1 组逐字钉着，改了会红）。
  s2: {
    prompt_en: 'Right, and the settlement window moves to T plus one for all the European corridors.',
    prompt_zh: '他语速快，网又卡了一下',
    en: "Sorry, I didn't catch that.",
  },
  s3: {
    prompt_en: 'Okay, so the three options are net thirty, net sixty, or prepay with a two percent discount.',
    prompt_zh: '他一口气报了三个方案',
    en: 'Could you slow down a bit? I want to get all three.',
  },
  s4: {
    prompt_en: "I think we're directionally aligned, but the sequencing of the rollout still worries me a lot.",
    prompt_zh: '他那句话绕，你没抓到重点',
    en: "Could you rephrase that? I'm not sure I follow.",
  },
  s5: {
    prompt_en: "Let's get the deck over to them tonight and the full model can land Friday morning.",
    prompt_zh: '两个时间点，你要确认一下',
    en: 'Just to make sure I understand — the deck goes out tonight, the model on Friday?',
  },
  s6: {
    prompt_en: 'Honestly, if we cut the reconciliation dashboard, we can hit the pilot date without adding headcount.',
    prompt_zh: '他绕了一圈，你复述他的结论',
    en: "So what you're saying is we drop the dashboard to make the pilot date.",
  },
};
