/**
 * 句子训练的存档（src/s2.ts）。
 *
 * 这个文件守的头一件事和功能无关：**键是按课内序号编的**（`s2:6:12`），
 * 序号跟着 s2-lesson.ts 的生成顺序走。顺序一变，Amos 库里那些行就全错位 ——
 * 第 6 课第 12 步的进度会变成另一步的进度，页面还一脸正常。
 * 所以第一组测试把**每课的步数逐个钉死**：课件或生成顺序动了，这里先红。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  一共几课, 每课步数, 总步数, 进度键, 错题键, 解析键, 有这一步, 是题,
  接着练, 小结, 每课进度, 错题组, type DoneRow,
} from '../src/s2';
import { 生成 } from '../src/s2-lesson';

const 行 = (k: string, by = 'auto'): DoneRow => ({ k, at: 1_700_000_000_000, by });
/** 把第 1 课第 1 步到第 n 步全标成走完 */
const 走完前几步 = (n: number): DoneRow[] => {
  const out: DoneRow[] = [];
  let 剩 = n;
  for (let 课 = 1; 课 <= 一共几课 && 剩 > 0; 课++)
    for (let 步 = 1; 步 <= 每课步数[课 - 1] && 剩 > 0; 步++, 剩--) out.push(行(进度键(课, 步)));
  return out;
};

describe('1. 序号钉死 —— 动了它旧存档就错位', () => {
  it('13 课，每课的步数一个都不许变', () => {
    expect(一共几课).toBe(13);
    expect(每课步数).toEqual([4, 5, 8, 4, 7, 25, 18, 7, 9, 10, 3, 23, 3]);
  });
  it('一共 126 步', () => {
    expect(总步数).toBe(126);
    expect(每课步数.reduce((a, b) => a + b, 0)).toBe(126);
  });
  it('每课步数和 s2-lesson 生成出来的完全对得上（不是另抄一份数字）', () => {
    expect(生成().map((c) => c.步.length)).toEqual(每课步数);
  });
  it('哪几步是题也钉住：规则 41 + 题 85', () => {
    const 全部 = 生成().flatMap((c) => c.步.map((s) => s.类型));
    expect(全部.filter((t) => t === '规则').length).toBe(41);
    expect(全部.filter((t) => t === '题').length).toBe(85);
  });
});

describe('2. 键：页面传什么进来都写不脏库', () => {
  it('正常的键解析得出来', () => {
    expect(解析键('s2:6:12', 's2')).toEqual({ 课: 6, 步: 12 });
    expect(解析键('s2x:6:12', 's2x')).toEqual({ 课: 6, 步: 12 });
  });
  it('前缀不对就不认（进度键不会被当成错题键，反过来也一样）', () => {
    expect(解析键('s2:6:12', 's2x')).toBeNull();
    expect(解析键('s2x:6:12', 's2')).toBeNull();
  });
  it('越界的一律回 null', () => {
    expect(解析键('s2:0:1', 's2')).toBeNull();       // 没有第 0 课
    expect(解析键('s2:14:1', 's2')).toBeNull();      // 只有 13 课
    expect(解析键('s2:1:0', 's2')).toBeNull();       // 步从 1 起
    expect(解析键('s2:1:5', 's2')).toBeNull();       // 第 1 课只有 4 步
    expect(解析键('s2:11:4', 's2')).toBeNull();      // 第 11 课只有 3 步
  });
  it('乱七八糟的输入不会炸，也不会解析成功', () => {
    for (const k of ['', 's2:', 's2::', 's2:a:b', 's1:g1:follow', null, undefined, 42, {}, 's2:1:1 ', ' s2:1:1'])
      expect([String(k), 解析键(k as unknown, 's2')]).toEqual([String(k), k === 's2:1:1 ' || k === ' s2:1:1' ? { 课: 1, 步: 1 } : null]);
  });
  it('有这一步：边界刚好在每课的最后一步上', () => {
    expect(有这一步(1, 4)).toBe(true);
    expect(有这一步(1, 5)).toBe(false);
    expect(有这一步(6, 25)).toBe(true);
    expect(有这一步(6, 26)).toBe(false);
    expect(有这一步(13, 3)).toBe(true);
    expect(有这一步(1.5, 1)).toBe(false);
  });
});

describe('3. 接着练 —— 第一个没走完的步', () => {
  it('什么都没做：第 1 课第 1 步', () => {
    expect(接着练([])).toEqual({ 课: 1, 步: 1, 第几步: 1 });
  });
  it('走完第 1 课（4 步）：下一个是第 2 课第 1 步', () => {
    expect(接着练(走完前几步(4))).toEqual({ 课: 2, 步: 1, 第几步: 5 });
  });
  it('中间漏了一步就回那一步 —— 不是回最远的那一步', () => {
    // 第 1 课 1、2、4 走完了，第 3 步没有 → 接着练要指第 3 步
    const d = [行(进度键(1, 1)), 行(进度键(1, 2)), 行(进度键(1, 4))];
    expect(接着练(d)).toEqual({ 课: 1, 步: 3, 第几步: 3 });
  });
  it('全部走完回 null（页面那时不假装还有下一步）', () => {
    expect(接着练(走完前几步(126))).toBeNull();
  });
  it('错题的那些行不算走完（s2x 不许被当成 s2）', () => {
    expect(接着练([行(错题键(1, 1)), 行(错题键(1, 2))])).toEqual({ 课: 1, 步: 1, 第几步: 1 });
  });
  it('库里混进别人的行（发音训练的 s1:）也不影响', () => {
    expect(接着练([行('s1:g1:follow', 'me'), 行('s1:g2:listen', 'me')])).toEqual({ 课: 1, 步: 1, 第几步: 1 });
  });
});

describe('4. 小结 / 每课进度', () => {
  it('什么都没做：126 步还剩 126', () => {
    expect(小结([])).toEqual({ 一共: 126, 走完了: 0, 还剩: 126, 百分之几: 0 });
  });
  it('走完 63 步正好一半', () => {
    expect(小结(走完前几步(63))).toEqual({ 一共: 126, 走完了: 63, 还剩: 63, 百分之几: 50 });
  });
  it('全走完 100%', () => {
    expect(小结(走完前几步(126))).toEqual({ 一共: 126, 走完了: 126, 还剩: 0, 百分之几: 100 });
  });
  it('越界的脏行不计数（算出来的进度不会超过 126）', () => {
    const 脏 = [行('s2:99:99'), 行('s2:1:999'), 行('s2x:1:1'), 行('s1:g1:follow')];
    expect(小结(脏).走完了).toBe(0);
  });
  it('每课进度：13 行，每行的"一共"和每课步数对得上', () => {
    const p = 每课进度(走完前几步(9));
    expect(p.length).toBe(13);
    expect(p.map((x) => x.一共)).toEqual(每课步数);
    expect(p[0]).toMatchObject({ 课: 1, 一共: 4, 走完了: 4, 下一步: null });   // 第 1 课 4 步全完
    expect(p[1]).toMatchObject({ 课: 2, 一共: 5, 走完了: 5, 下一步: null });   // 第 2 课 5 步全完，正好 9
    expect(p[2]).toMatchObject({ 课: 3, 走完了: 0, 下一步: 1 });
  });
  it('每课都带课名（清单上每行第二排写的就是它，来自课件）', () => {
    for (const x of 每课进度([])) expect([x.课, typeof x.名]).toEqual([x.课, 'string']);
    expect(每课进度([])[0].名).toBe(生成()[0].名);
  });
});

describe('4.5 每课的「下一步」—— 点清单某一课要落到哪一步', () => {
  it('一步没走：每课都从第 1 步起', () => {
    expect(每课进度([]).map((x) => x.下一步)).toEqual(每课步数.map(() => 1));
  });
  it('走完一整课：那一课的下一步是 null（清单上才给勾）', () => {
    const p = 每课进度(走完前几步(4));
    expect(p[0].下一步).toBeNull();
    expect(p[1].下一步).toBe(1);
  });
  it('**走到一半回的是没走完的那一步**，不是第 1 步（这一条就是加它的理由）', () => {
    const d = [行(进度键(3, 1)), 行(进度键(3, 2))];
    expect(每课进度(d)[2]).toMatchObject({ 课: 3, 走完了: 2, 下一步: 3 });
  });
  it('**中间漏了一步就回那一步**，不是最远那一步', () => {
    // 第 3 课走了 1、2、5、6，第 3 步没走 → 下一步要指 3
    const d = [1, 2, 5, 6].map((i) => 行(进度键(3, i)));
    expect(每课进度(d)[2]).toMatchObject({ 课: 3, 走完了: 4, 下一步: 3 });
  });
  it('别人的行（发音训练的 s1:、错题的 s2x:）不影响这一课的下一步', () => {
    const d = [行('s1:g1:follow', 'me'), 行(错题键(3, 3))];
    expect(每课进度(d)[2].下一步).toBe(1);
    expect(每课进度(d)[2].走完了).toBe(0);
  });
  it('13 课全走完：每课的下一步都是 null', () => {
    expect(每课进度(走完前几步(126)).every((x) => x.下一步 === null)).toBe(true);
  });
});

describe('5. 错题组', () => {
  it('空库没有错题', () => {
    expect(错题组([])).toEqual([]);
  });
  it('按课、按步排好序（库里什么顺序都一样）', () => {
    const d = [行(错题键(6, 20)), 行(错题键(2, 3)), 行(错题键(6, 5))];
    expect(错题组(d)).toEqual([{ 课: 2, 步: 3 }, { 课: 6, 步: 5 }, { 课: 6, 步: 20 }]);
  });
  it('**规则步进不了错题组**：规则答不了错，库里真有这么一行也要滤掉', () => {
    // 第 1 课 4 步全是规则（规则 4 / 题 0）
    expect(是题(1, 1)).toBe(false);
    expect(错题组([行(错题键(1, 1))])).toEqual([]);
  });
  it('题步才进得去', () => {
    const 题步 = 生成()[1].步.findIndex((s) => s.类型 === '题') + 1;  // 第 2 课的第一道题
    expect(题步).toBeGreaterThan(0);
    expect(是题(2, 题步)).toBe(true);
    expect(错题组([行(错题键(2, 题步))])).toEqual([{ 课: 2, 步: 题步 }]);
  });
  it('进度的行不会被当成错题', () => {
    expect(错题组(走完前几步(126))).toEqual([]);
  });
});

describe('6. 存档不许花钱、不许越界（C117、拆分清单）', () => {
  const 源 = readFileSync(path.join(__dirname, '..', 'src', 's2.ts'), 'utf8');

  it('src/s2.ts 一次 AI 都不调（这一块的接口是纯读写 D1）', () => {
    for (const w of ['env.AI', '@cf/', 'workers-ai', 'aura', 'whisper', 'melotts'])
      expect([w, 源.includes(w)]).toEqual([w, false]);
  });

  it('它碰的表**只有 en_done** 一张 —— 不跨界、也不新建表', () => {
    const 表 = [...源.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_][a-z0-9_]*)/gi)].map((m) => m[1].toLowerCase());
    expect([...new Set(表)]).toEqual(['en_done']);
    expect(源).not.toMatch(/CREATE\s+TABLE|DROP\s+/i);
  });

  it('写库全部走参数绑定（没有一处把变量拼进 SQL）', () => {
    const 语句 = [...源.matchAll(/prepare\(([\s\S]*?)\)\s*\n?\s*\./g)].map((m) => m[1]);
    expect(语句.length).toBeGreaterThan(0);
    for (const q of 语句) expect([q.slice(0, 50), /\$\{|\+\s*[a-zA-Z一-龥]/.test(q)]).toEqual([q.slice(0, 50), false]);
  });
});

describe('7. 页面：新加的那张门面不会悄悄变透明', () => {
  // 2026-11-12 的真事（Practical 仓库）：给入口卡写了 background:var(--card)，而整站根本没有 --card
  // （它叫 --surface）。页面不报错，只会悄悄变透明 —— 这种错只有肉眼看才看得见，所以钉一条。
  const 读 = (f: string) => readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  it('句子训练这一块用到的每个 var(--x)，工作台都真的定义过', () => {
    const 定义 = new Set([...读('admin-page.ts').matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const 用到 = [...new Set([...读('s2-page.ts').matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]))];
    expect(用到.filter((v) => !定义.has(v))).toEqual([]);
    expect(用到.length).toBeGreaterThan(10);   // 别因为正则写坏了扫出 0 个还绿
  });
  it('门面上的四个位置都有 id（页面脚本靠它们写字）', () => {
    const mod = 读('s2-page.ts');
    for (const id of ['s2-go', 's2-go-t', 's2-all', 's2-allf', 's2-go-on', 's2-go-err', 's2-go-w'])
      expect([id, mod.includes('id="' + id + '"')]).toEqual([id, true]);
  });
});

describe('8. 三个选项的顺序（2026-11-15 找出来的真 bug）', () => {
  // 原来是 `选: [答, ...错]` —— **正确答案永远排第一个**，85 道题都是，
  // 闭着眼一路点第一个按钮就能全过，这道练习等于没有。给错题重练写 e2e 时撞出来的
  // （脚本连点十几次第一个选项一次都没答错）。这里守三件事，别再回去。
  const 题 = 生成().flatMap((c) => c.步).filter((s) => s.类型 === '题');

  it('有 85 道题，每道都是 3 个不重复的选项、答案在里面', () => {
    expect(题.length).toBe(85);
    for (const s of 题) {
      expect([s.大, s.选!.length]).toEqual([s.大, 3]);
      expect([s.大, new Set(s.选).size]).toEqual([s.大, 3]);
      expect([s.大, s.选!.includes(s.答!)]).toEqual([s.大, true]);
    }
  });

  it('**答案不是永远排第一个**：三个位置都真的用上了，而且没有哪个位置占了一大半', () => {
    const 位 = [0, 0, 0];
    for (const s of 题) 位[s.选!.indexOf(s.答!)]++;
    expect(位.every((n) => n > 0)).toBe(true);
    expect([位, Math.max(...位) <= 题.length * 0.6]).toEqual([位, true]);
  });

  it('顺序是**定死的**，不是随机的：再生成一次，每道题的选项顺序一模一样', () => {
    const 又 = 生成().flatMap((c) => c.步).filter((s) => s.类型 === '题');
    expect(又.map((s) => s.选!.join('|'))).toEqual(题.map((s) => s.选!.join('|')));
  });
});

describe('9. 13 课清单那一屏（2026-11-15）', () => {
  const 页 = readFileSync(path.join(__dirname, '..', 'src', 's2-page.ts'), 'utf8');
  const 脚本 = 页.slice(页.indexOf('function s2画课()'), 页.indexOf('function s2收起()'));

  it('按钮叫「13 课清单」，不再叫「换一课」', () => {
    expect(页).toContain('>13 课清单</button>');
    expect(页).not.toContain('>换一课</button>');
  });
  it('**勾只在整课走完时给**（下一步 === null），取不到存档一律空框', () => {
    expect(脚本).toContain("整课走完了=!!p&&p['下一步']===null");
    expect(脚本).toContain("整课走完了?'☑':'☐'");
  });
  it('取不到存档时**不写"走完几步"**，只写共几步 —— 不假装他做过（底线 3）', () => {
    expect(脚本).toMatch(/p\?\(走完\+' \/ '\+一共\+' 步'\):\(一共\+' 步'\)/);
  });
  it('**点一行落到那一课第一个没走完的步**，不是第 1 步', () => {
    expect(脚本).toMatch(/var 到=\(p&&p\['下一步'\]\)\|\|1;/);
    expect(脚本).toContain("s2跳(c['课'],到)");
  });
  it('每行有无障碍标签，把课号、课名、走到哪了念出来', () => {
    expect(脚本).toContain("b.setAttribute('aria-label'");
    expect(脚本).toMatch(/走完 '\+走完\+' \/ '\+一共\+' 步/);
  });
  it('课名来自课件（S2 那份数据的 名 字段），不是页面自己写的', () => {
    expect(脚本).toContain("c['名']");
    // 页面脚本里不许出现凭空写的课名
    for (const 名 of 生成().map((c) => c.名).filter(Boolean))
      expect([名, 脚本.includes("'" + 名 + "'")]).toEqual([名, false]);
  });
  it('清单改成一行一课（竖排），勾的颜色走设计变量', () => {
    expect(页).toContain('.s2 .s2-cards{flex-direction:column;flex-wrap:nowrap}');
    expect(页).toContain('.s2 .s2-card.s2-c-done .s2-c-tick{color:var(--ok)}');
  });
  it('[hidden] 那条覆盖还在 —— 清单收起时**真的看不见**（2026-11-12 栽过一次）', () => {
    // 2026-11-12 的真事：`.s2-cards{display:flex}` 把 [hidden] 的默认 display:none 盖掉了，
    // 属性设了、人还看得见。守的是**凡是给 .s2-cards 设 display 的规则，[hidden] 那条要排在最后**
    // （同优先级时后面的赢；真正兜底的是 e2e 里那条 getComputedStyle）。
    const 带display = [...页.matchAll(/\.s2 \.s2-cards(\[hidden\])?\{[^}]*display:[^;}]+/g)];
    expect(带display.length).toBeGreaterThan(1);
    const 最后 = 带display[带display.length - 1];
    expect([最后[0], 最后[1]]).toEqual([最后[0], '[hidden]']);
    expect(最后[0]).toContain('display:none');
  });
});

describe('10. 课件自己重名的那句话（照实说，不硬凑）', () => {
  const 页 = readFileSync(path.join(__dirname, '..', 'src', 's2-page.ts'), 'utf8');
  const 脚本 = 页.slice(页.indexOf('function s2画课()'), 页.indexOf('function s2收起()'));

  it('课件里**真的有重名的课**（这句话不是凭空加的）', () => {
    const m: Record<string, number[]> = {};
    for (const c of 生成()) if (c.名) (m[c.名] = m[c.名] ?? []).push(c.课);
    const 重 = Object.keys(m).filter((n) => m[n].length > 1);
    expect(重.length).toBeGreaterThan(0);
    // 第 7～11 课在课件里就是同一个标题 —— 这是事实，不是 bug
    expect(m['时态分类']).toEqual([7, 8, 9, 10, 11]);
  });
  it('这句话**从数据算出来**，不是手写死的（页面脚本里不出现任何一个课名的字面量）', () => {
    expect(脚本).toContain("S2.forEach(function(c){var n=c['名']");
    for (const 名 of [...new Set(生成().map((c) => c.名).filter(Boolean))])
      expect([名, 脚本.includes("'" + 名 + "'")]).toEqual([名, false]);
  });
  it('没有重名的时候**一个字都不多说**（重名表空就不画这句）', () => {
    expect(脚本).toMatch(/if\(重名\.length\)\{/);
  });
  it('话里写明了"不是这里写重了"', () => {
    expect(脚本).toContain('不是这里写重了。');
  });
});
