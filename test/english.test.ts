/**
 * 工作台"英语练习"模块（src/english-page.ts，#/work/english）的单元测试。守住六条：
 *   1. **位置**：在工作台页 #v-work 里，二级菜单 #sub-work 正好 7 项、第 7 项是"英语练习"、排在"经营会"后面；
 *      **公共工具菜单一个位子都不许占**（还是 8 项，T-4：第 9 项会撑破手机菜单）。
 *   2. **8 条、原文照抄 + 纯语音可行**：顺序 C-1～C-6、N-1、N-2，☆ 难度标记在；每条都带"今天只聊一件事"那句钉死的小事，
 *      而且那件小事**只有声音也办得成**（v4：C-2 原来是"帮我看一段代码"，实测时 AI 答"I cannot see your screen"，对话死在那儿）；
 *      8 条共用的"规则 / 开场之前 / 我说 done 的时候"三段**一字不差地一样**（agents《测试场景-提示词-上.md》《-下.md》8 个代码块）。
 *   3. **每条一个"复制"按钮**，data-for 指到自己那条的 <pre>，id 不重复；
 *      **按钮在 <details> 外面**——手机上不展开就能点到（Amos 原话：长按选中一大段文字很痛苦）。
 *   4. **复制有兜底**：先 navigator.clipboard.writeText，抛了 / 没有就退回隐藏 textarea + document.execCommand('copy')；
 *      成功变"已复制 ✓"，2000 毫秒变回来。
 *   5. **4 步用法 + 「卡住了怎么办」四行**印在模块顶部：help（先给中文让他自己翻）/ slow down / 卡住时点名念哪一句 /
 *      **回收**（靠提示说出来的句子这一轮结束前再考一次），**不折叠、和提示词正文分开**（Amos 11/4：紧张就接不上话，要在页面上给提示）。
 *   6. **纯静态**：模块里不调接口、不读数据库、不出现命令行（底线 1、C117：不新增费用）。
 */
import { describe, expect, it } from 'vitest';
import { ADMIN_PAGE } from '../src/admin-page';
import { ENGLISH_JS, ENGLISH_MOD } from '../src/english-page';

/** 模块本体那一段（从 id="w-english" 到它自己的 </section>） */
const MOD = ENGLISH_MOD;
/** 工作台二级菜单那一段 */
const SUB_WORK = ADMIN_PAGE.slice(
  ADMIN_PAGE.indexOf('id="sub-work"'),
  ADMIN_PAGE.indexOf('</nav>', ADMIN_PAGE.indexOf('id="sub-work"')),
);
/** 公共工具二级菜单那一段 */
const SUB_TOOLS = ADMIN_PAGE.slice(
  ADMIN_PAGE.indexOf('id="sub-tools"'),
  ADMIN_PAGE.indexOf('</nav>', ADMIN_PAGE.indexOf('id="sub-tools"')),
);
/** 8 条提示词的正文（按页面上的先后顺序） */
const TEXTS = [...MOD.matchAll(/<pre class="en-pre" id="(en-p\d+-t)">([\s\S]*?)<\/pre>/g)].map((m) => ({ id: m[1], text: m[2] }));

describe('1. 放在工作台，不占公共工具的位子', () => {
  it('二级菜单正好 7 项，第 7 项是"英语练习"、排在"经营会"后面', () => {
    const mods = [...SUB_WORK.matchAll(/data-s="(w-[a-z]+)"/g)].map((m) => m[1]);
    expect(mods).toEqual(['w-now', 'w-todo', 'w-live', 'w-proj', 'w-num', 'w-meet', 'w-english']);
    expect(SUB_WORK).toContain('<a href="#/work/english" data-s="w-english">英语练习</a>');
  });

  it('公共工具菜单一个字没动：还是 8 项，没有"英语练习"（T-4：第 9 项撑破手机菜单）', () => {
    expect(SUB_TOOLS.match(/data-s="t-/g) ?? []).toHaveLength(8);
    expect(SUB_TOOLS).not.toContain('英语练习');
    expect(SUB_TOOLS).not.toContain('w-english');
  });

  it('模块本体在工作台页 #v-work 里（不是项目页、不是公共工具页）', () => {
    const vwork = ADMIN_PAGE.slice(ADMIN_PAGE.indexOf('id="v-work"'), ADMIN_PAGE.indexOf('id="v-project"'));
    expect(vwork).toContain('id="w-english"');
    expect(ADMIN_PAGE.match(/id="w-english"/g) ?? []).toHaveLength(1);
  });
});

describe('2. 8 条提示词：顺序、难度、原文照抄', () => {
  it('正好 8 条，顺序是 C-1～C-6、N-1、N-2，☆ 难度标记都在', () => {
    const codes = [...MOD.matchAll(/<span class="en-code">([CN]-\d)<\/span>/g)].map((m) => m[1]);
    expect(codes).toEqual(['C-1', 'C-2', 'C-3', 'C-4', 'C-5', 'C-6', 'N-1', 'N-2']);
    const stars = [...MOD.matchAll(/<span class="en-star" title="难度">(☆+)<\/span>/g)].map((m) => m[1]);
    expect(stars).toEqual(['☆', '☆', '☆☆', '☆☆', '☆☆', '☆☆', '☆☆☆', '☆☆☆']);
    expect(TEXTS).toHaveLength(8);
  });

  it('每条都钉死一件具体小事，8 条各不相同', () => {
    const only = TEXTS.map(({ text }) => /今天只聊一件事：(.+?)别聊别的|今天只聊一件事：(.+?)别问别的/.exec(text)?.[0]);
    expect(only.filter(Boolean)).toHaveLength(8);
    expect(new Set(only).size).toBe(8);
  });

  it('8 条共用的三段一字不差地一样（规则 / 开场之前给 5 个语块 / 说 done 之后给两条反馈）', () => {
    const 规则 = [
      '规则：',
      '- 全程英文。',
      '- Speak slowly and clearly, with a short pause between sentences.',
      // v4（2026-11-04 夜）：它自己冒出 specific，Amos 当场问"这词什么意思"
      '- 只用日常办公常用词。万一用了超纲的词，主动用一句话解释它。',
      // v4：他全场只说 11 句、平均 6～8 个词，主动权全在 AI 手里 → 每轮最多一个问题
      '- Keep every reply to 1–2 short sentences, and ask at most ONE question per turn.',
      '- 保持角色不出戏，中途不要纠错我的英文。',
      '- 我会说 "slow down" 或 "say that again"，你就把刚才那句放慢重说一遍，用同样的词，不要换新说法。',
      // v4：屏幕上有拖时间的话他也用不上 → 不再换个简单问题，改成当场点名让他念哪一句
      '- 我卡住超过 5 秒没说话，你就直接提示我用哪一句，比如 "try saying: Let me think for a second"，然后等我。',
      // v4 帮扶分级：原来"说 help 就给 2 句直接念"等于照着屏幕念，念十句不等于会说一句（Amos：真能教会才是这产品的使命）
      '- 我卡住的时候，按这个顺序帮我，永远只给刚好够的那一级，别跳级：',
      '  第 1 级 先等 3 秒，别急着帮。',
      '  第 2 级 用中文说出我想表达的意思，让我自己翻。例如"你是想说\'我想请你帮个忙\'吗？"',
      '  第 3 级 只给句首，让我自己接完。例如 "I was wondering if you could..."',
      '  第 4 级 只给 2～3 个关键词，让我自己组句。',
      // L5 给整句仍然限 8 个词、不带从句（上一轮给的 I need help with some code that you know well. 带从句，他念成了两句）
      '  第 5 级 实在不行才给一整句让我念，每句不超过 8 个词、不带从句。这是最后一招，给完你要记住这一句。',
      '- 我说 "help" 的时候，从第 2 级开始给，不要直接跳到第 5 级。',
      // v4 回收：L5 必须从"终点"变成"台阶"——念可以，但得在没有拐杖的时候再走一次
      '- 回收（最重要）：凡是我靠句首、关键词或整句才说出来的，这一轮结束之前，你要换个说法再问我同一个意思一次，而且不给任何提示。我能自己说出来才算学会；还说不出来就再给一次句首，下一轮再考。',
      '- 难度跟着我走：我连着 3 句不用提示就说出来了，下一句就少给帮助、问得开放一点；我连着 2 句都要靠整句才说得出来，就把话题缩小、句子再短一点。',
      // v4：多让他说，别急着换下一个问题
      '- 多让我说：我答完一句，如果还能展开，就说 "tell me more about that" 或 "why is that?"，别急着换下一个问题。',
      '- 允许我停顿和重说，我卡壳不是错，别安慰我也别夸我，自然往下聊就行。',
      // v4 的兜底：C-2 撞墙的根因是纯语音看不了东西，8 条都要封死
      '- 不要让我看屏幕、看代码、看文件、发链接——我们只有声音。',
    ].join('\n');
    // v3：5 个语块之外再给 3 句"拖时间"的话——母语者接不上时也靠这个争取时间
    const 开场 = '开始之前：先给我 5 个这个场景会用到的语块，再给我 3 句"拖时间"的话（像 Let me think for a second… / That\'s a good question… / How do I put this…），都要英文 + 中文意思，然后等我说 ready 再开口。';
    // v4：上一轮复盘只给 3 句，还把 "Yes, it's urgent for me." 引述成 "Is it urgent for me." —— 逐句列全 + 引用一字不差
    const 收尾 = [
      '我说 done 的时候，用中文告诉我：',
      '1) 逐句列出我说过的所有不地道的地方，别只挑 3 句；引用我的原话必须一字不差',
      // v4 回收：三个数是"有没有真教会"的唯一量化口径
      '2) 报三个数：我自己造的句子几句 / 靠提示才说出来的几句 / 回收时独立说对的几句',
      '3) 这个场景里我本该用上但没用的 3 个地道说法',
    ].join('\n');
    for (const { id, text } of TEXTS) {
      expect(text, id).toContain(规则);
      expect(text, id).toContain(开场);
      expect(text, id).toContain(收尾);
      // 正文结尾就是收尾那一段，后面没多出东西
      expect(text.trimEnd().endsWith(收尾), id).toBe(true);
      // 原文照抄：没有被 HTML 转义弄脏，也没塞进 UI 的字
      expect(text, id).not.toContain('&lt;');
      expect(text, id).not.toContain('复制');
      // v4 的关键句：8 条各出现正好一次，不多不少
      for (const r of ['只用日常办公常用词', 'ask at most ONE question per turn', '我卡住超过 5 秒没说话', 'try saying: Let me think for a second', '每句不超过 8 个词、不带从句', 'tell me more about that', '我卡壳不是错', '我们只有声音',
        // v4 帮扶分级 + 回收：五级台阶齐、help 从第 2 级起、回收和难度调节各一条
        '第 1 级 先等 3 秒', '第 2 级 用中文说出我想表达的意思', '第 3 级 只给句首', '第 4 级 只给 2～3 个关键词', '第 5 级 实在不行才给一整句',
        '我说 "help" 的时候，从第 2 级开始给，不要直接跳到第 5 级。', '回收（最重要）：', '难度跟着我走：',
        '2) 报三个数：我自己造的句子几句 / 靠提示才说出来的几句 / 回收时独立说对的几句']) {
        expect((text.match(new RegExp(r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length, id + ' / ' + r).toBe(1);
      }
    }
  });

  // v4（2026-11-04 夜）：C-2 原来是"请同事帮我看一段代码"，Amos 实测时 Gemini Live 直接说
  // "I cannot see your screen right now. Can you share your screen or turn on your camera?" —— 对话死在这儿。
  // 根因是场景本身纯语音做不到，不是提示词不够细。这条守住：8 条都是**只有声音也能办成**的事。
  it('纯语音可行性：没有一条要求看屏幕 / 看代码 / 看文件，8 条都带那句封死的规则', () => {
    for (const { id, text } of TEXTS) {
      expect(text, id).toContain('不要让我看屏幕、看代码、看文件、发链接——我们只有声音。');
      // "今天只聊一件事"那句钉死的小事里，不许出现要对方看东西的动作
      const 小事 = /今天只聊一件事：(.+)/.exec(text)?.[1] ?? '';
      for (const w of ['看一段代码', '看一下代码', '看这段', '看我的屏幕', '看文档', '发给他', '发给她', '截图']) {
        expect(小事, id + ' / ' + w).not.toContain(w);
      }
    }
  });

  it('C-2 是"请同事帮我顶一个会"，不是"帮我看代码"（v4 重写，别改回去）', () => {
    const c2 = TEXTS[1].text;
    // 只看场景那一段（规则段里有"看代码"三个字，那是封死它的那条规则）
    const 场景 = c2.slice(0, c2.indexOf('规则：'));
    expect(场景).toContain('我想请他明天替我参加一个会');
    expect(场景).toContain('今天只聊一件事：我明天上午有个会去不了，想请他替我参加，大概一小时。别聊别的。');
    expect(场景).not.toContain('代码');
    expect(MOD).toContain('<b class="en-name">请同事帮我顶一下明天的一个会</b>');
    expect(MOD).not.toContain('请同事帮个忙');
  });

  it('每条都从"你扮演"开头、点名一个同事（原文第一句）', () => {
    for (const { id, text } of TEXTS) expect(text.startsWith('你扮演'), id).toBe(true);
    const 同事 = ['Mike', 'Raj', 'Tom', 'Sarah', 'Alex', 'Lisa', 'David', 'Emma'];
    TEXTS.forEach(({ id, text }, i) => expect(text, id).toContain(同事[i]));
  });
});

describe('3. 每条一个"复制"按钮，不展开就能点到', () => {
  it('8 个按钮，data-for 一一指到自己那条的 <pre>，id 不重复', () => {
    const btns = [...MOD.matchAll(/<button class="btn small primary en-copy" type="button" data-for="(en-p\d+-t)">复制<\/button>/g)].map((m) => m[1]);
    expect(btns).toHaveLength(8);
    expect(new Set(btns).size).toBe(8);
    expect(btns).toEqual(TEXTS.map((t) => t.id));
  });

  it('按钮在 <details> 外面：手机上不展开就能点（Amos：长按选一大段文字很痛苦）', () => {
    const cards = MOD.split('<article class="en-card">').slice(1);
    expect(cards).toHaveLength(8);
    for (const c of cards) {
      expect(c.indexOf('en-copy')).toBeGreaterThan(-1);
      expect(c.indexOf('en-copy')).toBeLessThan(c.indexOf('<details'));
    }
  });
});

describe('4. 复制的兜底', () => {
  it('先 clipboard.writeText，失败 / 没有就退回隐藏 textarea + execCommand', () => {
    expect(ENGLISH_JS).toContain('navigator.clipboard&&navigator.clipboard.writeText');
    expect(ENGLISH_JS).toContain("document.execCommand('copy')");
    expect(ENGLISH_JS).toContain("createElement('textarea')");
    // writeText 的 reject 分支也要走兜底，不能只 catch 同步的抛
    expect(ENGLISH_JS).toMatch(/writeText\(text\)\.then\(function\(\)\{done\(true\);\},function\(\)\{done\(enFallback\(text\)\);\}\)/);
  });

  it('成功变"已复制 ✓"，2000 毫秒变回来；失败不骗人（底线 3、9）', () => {
    expect(ENGLISH_JS).toContain("'已复制 \u2713'");
    expect(ENGLISH_JS).toContain("'复制不了，长按选'");
    expect(ENGLISH_JS).toMatch(/setTimeout\(function\(\)\{[^}]*\},2000\)/);
  });
});

describe('5. 顶部 4 步用法 +「卡住了怎么办」四行', () => {
  it('4 步照抄 agents 那份的"怎么用"', () => {
    const ol = /<ol class="en-steps">([\s\S]*?)<\/ol>/.exec(MOD)?.[1] ?? '';
    const steps = [...ol.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
    expect(steps).toHaveLength(4);
    expect(steps[0]).toContain('Gemini Live');
    expect(steps[0]).toContain('ChatGPT');
    expect(steps[1]).toContain('复制');
    expect(steps[2]).toContain('5 个语块');
    expect(steps[2]).toContain('拖时间');
    expect(steps[2]).toContain('ready');
    expect(steps[2]).toContain('done');
    expect(steps[3]).toContain('想跑几轮跑几轮');
    // Amos 2026-11-04「在这类事情上，咱们取消"日"的概念，多试」——页面不许再写"一天一条"
    expect(MOD).not.toContain('一天一条');
    expect(steps[3]).toContain('回收时独立说对几句');
  });

  it('"卡住了怎么办"四行摆在醒目的位置：help / slow down / 点名念哪一句 / 回收，且"这不算失败"还在', () => {
    const call = /<div class="en-call en-stuck">([\s\S]*?)<\/div>/.exec(MOD)?.[1] ?? '';
    // v2 就有的三条，一条都没丢
    expect(call).toContain('slow down');
    expect(call).toContain('say that again');
    expect(call).toContain('这不算失败');
    // v3 新增：卡住时有话可说（Amos 11/4 原话"紧张就会接不上话"）
    expect(call).toContain('<code>help</code>');
    // v4：光摆着拖时间的话他用不上，改成"它直接告诉你念哪一句"
    expect(call).toContain('卡住时它会<b>直接告诉你念哪一句</b>，照念就行');
    // v4 帮扶分级 + 回收：help 先给中文让他自己翻；靠提示说出来的句子这一轮结束前要再考一次
    expect(call).toContain('它<b>先用中文告诉你想说什么</b>，让你自己翻；真不行才给整句');
    expect(call).toContain('<b>这一轮结束前，靠提示说出来的句子它会再考你一次</b>');
    // v4 起正好四行，每行一个办法（第 4 行是"回收"）
    const lis = [...call.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
    expect(lis).toHaveLength(4);
  });

  it('"卡住了怎么办"不折叠、不在代码块里、排在 8 条提示词前面（手机上一眼看得到）', () => {
    const at = MOD.indexOf('en-stuck');
    expect(at).toBeGreaterThan(-1);
    // 在第一张提示词卡片之前
    expect(at).toBeLessThan(MOD.indexOf('<article class="en-card">'));
    // 不被 <details> 折叠、也没塞进 <pre> 正文
    const head = MOD.slice(0, MOD.indexOf('<article class="en-card">'));
    expect(head).not.toContain('<details');
    expect(head).not.toContain('<pre');
    for (const { id, text } of TEXTS) expect(text, id).not.toContain('卡住了怎么办');
  });
});

describe('6. 纯静态：不调接口、不花钱', () => {
  it('模块和脚本里没有 fetch、没有接口地址、没有命令行', () => {
    for (const s of [MOD, ENGLISH_JS]) {
      expect(s).not.toContain('fetch(');
      expect(s).not.toContain('/api/');
      expect(s).not.toContain('XMLHttpRequest');
      for (const w of ['npm ', 'curl ', 'wrangler ', 'node scripts/']) expect(s).not.toContain(w);
    }
  });

  it('不碰密钥：模块里不出现任何变量名形状的凭据（底线 1）', () => {
    for (const w of ['TOKEN', 'API_KEY', 'PASSWORD', 'SECRET']) expect(MOD).not.toContain(w);
  });

  it('没给它开任何服务端路由：src/index.ts 里没有 english / 英语 这类口子', async () => {
    const { readFileSync } = await import('node:fs');
    const idx = readFileSync('src/index.ts', 'utf8');
    expect(idx).not.toContain('english');
    expect(idx).not.toContain('英语');
  });
});
