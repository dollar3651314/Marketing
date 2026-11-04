/**
 * 工作台"英语练习"模块（src/english-page.ts，#/work/english）的单元测试。守住六条：
 *   1. **位置**：在工作台页 #v-work 里，二级菜单 #sub-work 正好 7 项、第 7 项是"英语练习"、排在"经营会"后面；
 *      **公共工具菜单一个位子都不许占**（还是 8 项，T-4：第 9 项会撑破手机菜单）。
 *   2. **8 条、原文照抄**：顺序 C-1～C-6、N-1、N-2，☆ 难度标记在；每条都带"今天只聊一件事"那句钉死的小事，
 *      8 条共用的"规则 / 开场之前 / 我说 done 的时候"三段**一字不差地一样**（agents《测试场景-提示词-上.md》《-下.md》8 个代码块）。
 *   3. **每条一个"复制"按钮**，data-for 指到自己那条的 <pre>，id 不重复；
 *      **按钮在 <details> 外面**——手机上不展开就能点到（Amos 原话：长按选中一大段文字很痛苦）。
 *   4. **复制有兜底**：先 navigator.clipboard.writeText，抛了 / 没有就退回隐藏 textarea + document.execCommand('copy')；
 *      成功变"已复制 ✓"，2000 毫秒变回来。
 *   5. **4 步用法 + 「卡住了怎么办」三行**印在模块顶部：v3 新增 help / slow down / Let me think for a second…，
 *      **不折叠、和提示词正文分开**（Amos 11/4：紧张就接不上话，要在页面上给提示）。
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
      '- Speak slowly and clearly, with a short pause between sentences. Use common, simple words — no idioms, no fast contractions.',
      '- Keep every reply to 1–2 short sentences.',
      '- 保持角色不出戏，中途不要纠错我的英文。',
      '- 我会说 "slow down" 或 "say that again"，你就把刚才那句放慢重说一遍，用同样的词，不要换新说法。',
      // v3（2026-11-04）：紧张 → 接不上话。四条都是"卡住时有话可说"，不是"别卡住"
      '- 我卡住超过 5 秒没说话，你就主动帮我：把刚才那个问题换成一个更简单的、能用 yes/no 或二选一回答的问题，别重复原来那句。',
      '- 我说 "help" 的时候，你给我 2 个可以直接念出来的英文句子（英文 + 中文意思），让我接着往下说，给完就等我，不要替我说下去。',
      '- 你每次说完，如果话题还能继续，用一个具体的小问题结尾，不要用开放式的大问题。',
      '- 允许我停顿和重说，我卡壳不是错，别安慰我也别夸我，自然往下聊就行。',
    ].join('\n');
    // v3：5 个语块之外再给 3 句"拖时间"的话——母语者接不上时也靠这个争取时间
    const 开场 = '开始之前：先给我 5 个这个场景会用到的语块，再给我 3 句"拖时间"的话（像 Let me think for a second… / That\'s a good question… / How do I put this…），都要英文 + 中文意思，然后等我说 ready 再开口。';
    const 收尾 = [
      '我说 done 的时候，用中文告诉我：',
      '1) 我哪 3 句最不地道（原句 / 母语者会怎么说 / 为什么）',
      '2) 这个场景里我本该用上但没用的 3 个地道说法',
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
      // v3 的四条提示规则：8 条各出现正好一次，不多不少
      for (const r of ['我卡住超过 5 秒没说话', '我说 "help" 的时候', '用一个具体的小问题结尾', '我卡壳不是错']) {
        expect((text.match(new RegExp(r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length, id + ' / ' + r).toBe(1);
      }
    }
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

describe('5. 顶部 4 步用法 +「卡住了怎么办」三行', () => {
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
    expect(steps[3]).toContain('10 分钟封顶');
  });

  it('"卡住了怎么办"三行摆在醒目的位置：help / slow down / 拖时间的话，且"这不算失败"还在', () => {
    const call = /<div class="en-call en-stuck">([\s\S]*?)<\/div>/.exec(MOD)?.[1] ?? '';
    // v2 就有的三条，一条都没丢
    expect(call).toContain('slow down');
    expect(call).toContain('say that again');
    expect(call).toContain('这不算失败');
    // v3 新增：卡住时有话可说（Amos 11/4 原话"紧张就会接不上话"）
    expect(call).toContain('<code>help</code>');
    expect(call).toContain('Let me think for a second…');
    // 正好三行，每行一个办法
    const lis = [...call.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
    expect(lis).toHaveLength(3);
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
