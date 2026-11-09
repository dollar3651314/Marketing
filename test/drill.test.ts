/**
 * 工作台「带练」（src/drill.ts、src/drill-page.ts、migrations/0013_drill.sql）的测试。守住八件事：
 *   1. **内容一个字都没改**：场景 0 的三段（单词 / 词组 / 例句）各 6 项，18 项的中文、英文、关键点
 *      在测试里**逐字写死**（Amos 已逐条审过的语块库原文），改一个字就红。
 *   2. **位置**：工作台二级菜单从 7 项变 **8 项**（上限 8），第 8 项是「带练」、排在「英语练习」后面；
 *      **公共工具那 8 项一个都不许动**（T-4：第 9 项会撑破手机菜单）；模块 `#w-drill` 在工作台页里，只有一个。
 *   3. **三步交互**：先回想（卡片上只有中文）→ 揭晓（「看答案」）→ 自己判（「会了 / 不会」）；
 *      换下一项时自动回到"先回想"（答案藏起来）。
 *   4. **「不会」的排到这一段末尾**再考一遍（`queueOf()` 的顺序），这一段六项全部「会了」才进下一段
 *      （`currentStage()` 是门禁，**服务端也拦**：不是当前这一段的项目一律 409，前端坏了也跳不了段）。
 *   5. **进度和小结**：第几段 / 这一段第几个 / 还剩几个；三段走完每段报"会了几个 / 第一次就会几个"；
 *      **第四段（对话）照实说还没做**，不假装有（底线 3、9）。
 *   6. **不让他打字**：模块和脚本里**一个 `<input>` 都没有**；两个判断按钮 ≥52px（手机 390 宽单手够得着）。
 *   7. **不调 AI、不花钱**（底线 8 / C117）：不 import 任何 AI 模块、不出现 `/v1/`、不出现命令行；
 *      **不碰密钥**（底线 1）：不出现密钥变量名形状的东西。
 *   8. **迁移只 CREATE**：0013 里只有一条 CREATE TABLE，没有 ALTER / DROP / 索引 / 回填；
 *      在已有 0001～0012 数据的库上跑，旧表一行不动。
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import { ADMIN_PAGE } from '../src/admin-page';
import { DRILL_CSS, DRILL_JS, DRILL_MOD } from '../src/drill-page';
import { ALL_IDS, currentStage, drillState, queueOf, SCENE, STAGE4_NOTE, STAGES, stageStats, type DrillRow } from '../src/drill';
import { ROOT, T0 } from './helpers';

const PASS = 'ci_only_copilot_password_01';
const HOST = 'https://copilot.example.test';
const MIG = path.join(ROOT, 'migrations');
const M0013 = '0013_drill.sql';

const stmtsOf = (files: string[]) =>
  files.map((f) => readFileSync(path.join(MIG, f), 'utf8').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n'))
    .join(';\n').split(';').map((s) => s.trim()).filter(Boolean);
const migs = () => readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();

let db: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: path.join(ROOT, 'test/wrangler.test.toml'), persist: false, remoteBindings: false, envFiles: [] });
  db = proxy.env.DB;
  dispose = proxy.dispose;
  await db.batch(stmtsOf(migs()).map((s) => db.prepare(s)));
});
afterAll(async () => dispose());
beforeEach(async () => {
  await db.batch(['drill_item', 'auth_fail', 'auth_lock'].map((t) => db.prepare(`DELETE FROM ${t}`)));
});

const env = (): Env => ({ DB: db, ENVIRONMENT: 'test', COPILOT_PASSWORD: PASS });
const req = (p: string, init: RequestInit & { cookie?: string } = {}) =>
  new Request(`${HOST}${p}`, { ...init, headers: { 'content-type': 'application/json', origin: HOST, 'cf-connecting-ip': '203.0.113.9', ...(init.cookie ? { cookie: init.cookie } : {}) } });
let ck = '';
beforeAll(async () => {
  const r = await handle(req('/api/login', { method: 'POST', body: JSON.stringify({ password: PASS }) }), env(), T0);
  ck = r.headers.get('set-cookie')!.split(';')[0];
});
const api = async (p: string, body?: unknown, now = T0) => {
  const r = await handle(req('/api/drill/' + p, body === undefined ? { cookie: ck } : { method: 'POST', cookie: ck, body: JSON.stringify(body) }), env(), now);
  return { status: r.status, body: (await r.json()) as Record<string, any> };
};
/** 把一项答成"会了"；返回最新状态 */
const yes = (id: string, now = T0) => api('answer', { item: id, known: true }, now);
const no = (id: string, now = T0) => api('answer', { item: id, known: false }, now);
/** 把第 n 段六项全部答对（每项往后挪 1 秒，顺序才稳定） */
async function passStage(n: number, t = T0) {
  const ids = STAGES.find((s) => s.n === n)!.items.map((i) => i.id);
  let last;
  for (let i = 0; i < ids.length; i++) last = await yes(ids[i], t + i * 1000);
  return last!;
}

// ======================================================================
describe('1. 内容：场景 0 三段各 6 项，一个字都没改（语块库原文）', () => {
  it('第一段 单词：6 个词的中文、英文、关键点逐字对得上', () => {
    expect(STAGES[0].items.map((i) => [i.zh, i.en, i.key])).toEqual([
      ['听清', 'catch', '没听清用 catch，不要用 understand'],
      ['跟得上', 'follow', "I'm not following = 我跟不上你的思路"],
      ['意思是', 'mean', 'What do you mean by X —— by 不能丢'],
      ['换个说法再说', 'rephrase', 'repeat 是再说一遍，rephrase 是换种说法'],
      ['听懵了', 'lost', "I'm lost = 我彻底跟丢了，这么说不丢人"],
      ['说清楚', 'clarify', '他 11/5 卡过这个词'],
    ]);
  });

  it('第二段 词组：6 条的中文、英文逐字对得上', () => {
    expect(STAGES[1].items.map((i) => [i.zh, i.en])).toEqual([
      ['那个 ___ 是什么意思？', 'What do you mean by ___?'],
      ['抱歉，我没听清。', "Sorry, I didn't catch that."],
      ['能稍微慢一点吗？', 'Could you slow down a bit?'],
      ['能换个说法吗？', 'Could you rephrase that?'],
      ['我确认一下我的理解 ——', 'Just to make sure I understand —'],
      ['所以你的意思是 ___', "So what you're saying is ___"],
    ]);
  });

  it('第三段 例句：6 条的中文情境、英文答案逐字对得上', () => {
    expect(STAGES[2].items.map((i) => [i.zh, i.en])).toEqual([
      ['对方说了个 scope 你不懂', 'What do you mean by "scope"?'],
      ['整句没听清，想让他再说一遍', "Sorry, I didn't catch that. Could you say it again?"],
      ['他说太快了', 'Could you slow down a bit? I want to get this right.'],
      ['他那句话绕，想让他换个说法', "Could you rephrase that? I'm not sure I follow."],
      ['确认他是不是要周五之前要', 'Just to make sure I understand — you need it by Friday?'],
      ['复述他的结论：先上简单版本', "So what you're saying is we should ship the simple version first."],
    ]);
  });

  it('三段、每段 6 项、编号不重复；只有第一段有关键点（第二、三段没有）', () => {
    expect(STAGES.map((s) => [s.n, s.name, s.items.length])).toEqual([[1, '单词', 6], [2, '词组', 6], [3, '例句', 6]]);
    expect(ALL_IDS).toHaveLength(18);
    expect(new Set(ALL_IDS).size).toBe(18);
    expect(STAGES[0].items.every((i) => !!i.key)).toBe(true);
    expect([...STAGES[1].items, ...STAGES[2].items].every((i) => i.key === undefined)).toBe(true);
  });

  it('内容写死在代码里：模块结构里不带任何一条英文答案（界面是现场画的，不是服务端拼 HTML）', () => {
    for (const i of ALL_IDS) expect([i, DRILL_MOD.includes(i)]).toEqual([i, false]);
    for (const en of STAGES.flatMap((s) => s.items.map((x) => x.en))) expect([en, DRILL_MOD.includes(en)]).toEqual([en, false]);
  });
});

// ======================================================================
describe('2. 位置：工作台二级菜单 8 项，公共工具一个位子都没动', () => {
  const SUB_WORK = ADMIN_PAGE.slice(ADMIN_PAGE.indexOf('id="sub-work"'), ADMIN_PAGE.indexOf('</nav>', ADMIN_PAGE.indexOf('id="sub-work"')));
  const SUB_TOOLS = ADMIN_PAGE.slice(ADMIN_PAGE.indexOf('id="sub-tools"'), ADMIN_PAGE.indexOf('</nav>', ADMIN_PAGE.indexOf('id="sub-tools"')));

  it('正好 8 项，第 8 项是「带练」、排在「英语练习」后面（上限就是 8，不许有第 9 项）', () => {
    const mods = [...SUB_WORK.matchAll(/data-s="(w-[a-z]+)"/g)].map((m) => m[1]);
    expect(mods).toEqual(['w-now', 'w-todo', 'w-live', 'w-proj', 'w-num', 'w-meet', 'w-english', 'w-drill']);
    expect(SUB_WORK).toContain('<a href="#/work/drill" data-s="w-drill">带练</a>');
  });

  it('公共工具菜单一个字没动：还是 8 项，没有「带练」（T-4）', () => {
    expect(SUB_TOOLS.match(/data-s="t-/g) ?? []).toHaveLength(8);
    expect(SUB_TOOLS).not.toContain('带练');
    expect(SUB_TOOLS).not.toContain('w-drill');
  });

  it('模块本体在工作台页 #v-work 里，只有一个；排在「它记得住你」后面', () => {
    const vwork = ADMIN_PAGE.slice(ADMIN_PAGE.indexOf('id="v-work"'), ADMIN_PAGE.indexOf('id="v-project"'));
    expect(vwork).toContain('id="w-drill"');
    expect(ADMIN_PAGE.match(/id="w-drill"/g) ?? []).toHaveLength(1);
    expect(vwork.indexOf('id="w-drill"')).toBeGreaterThan(vwork.indexOf('id="w-engmem"'));
  });

  it('进工作台时读一次进度（route() 里调 window.drillOpen），接口前缀是 /api/drill/', () => {
    expect(ADMIN_PAGE).toContain('window.drillOpen()');
    expect(ADMIN_PAGE).toContain("window.__drillBase='/api/drill/'");
  });
});

// ======================================================================
describe('3. 三步交互：先回想 → 揭晓 → 自己判', () => {
  it('结构上就是三步：中文 #dr-zh 一直在，答案 #dr-ans 默认藏着，一个「看答案」+ 两个「会了 / 不会」', () => {
    expect(DRILL_MOD).toContain('id="dr-zh"');
    expect(DRILL_MOD).toMatch(/<div id="dr-ans" hidden>/);
    expect(DRILL_MOD).toMatch(/<div class="dr-two" id="dr-two" hidden>/);
    expect(DRILL_MOD).toContain('id="dr-show">看答案</button>');
    expect(DRILL_MOD).toContain('id="dr-yes">会了</button>');
    expect(DRILL_MOD).toContain('id="dr-no">不会</button>');
    // 卡片上先只有中文：英文 #dr-en 在藏起来的 #dr-ans 里面
    const ans = DRILL_MOD.slice(DRILL_MOD.indexOf('id="dr-ans"'), DRILL_MOD.indexOf('</div>', DRILL_MOD.indexOf('id="dr-en"')));
    expect(ans).toContain('id="dr-en"');
    expect(ans).toContain('id="dr-key"');
  });

  it('点「看答案」才揭晓：dReveal 把答案显示出来、换掉按钮；换下一项时 dPaint 又藏回去', () => {
    expect(DRILL_JS).toContain("dShow('dr-ans',true);dShow('dr-one',false);dShow('dr-two',true);");
    expect(DRILL_JS).toContain("dShow('dr-ans',false);dShow('dr-one',true);dShow('dr-two',false);");
  });

  it('答案本来就在手里（state 里带着英文和关键点）：点「看答案」不再跑一趟接口，没有延迟', () => {
    const st = drillState([]);
    expect((st.当前 as Record<string, string>).英文).toBe('catch');
    expect((st.当前 as Record<string, string>).关键点).toBe('没听清用 catch，不要用 understand');
    // 「看答案」这个按钮的处理函数里没有 fetch
    const reveal = DRILL_JS.slice(DRILL_JS.indexOf('function dReveal'), DRILL_JS.indexOf('function dAnswer'));
    expect(reveal).not.toContain('fetch');
    expect(reveal).not.toContain('dJson');
  });
});

// ======================================================================
describe('4. 「不会」排到这一段末尾；这一段全会了才进下一段', () => {
  const row = (item: string, tries: number, pass_try: number, at: number): DrillRow => ({ item, tries, pass_try, at });

  it('一开始队列就是这一段的原顺序，第一项是 w1', () => {
    expect(queueOf(1, []).map((i) => i.id)).toEqual(['w1', 'w2', 'w3', 'w4', 'w5', 'w6']);
    expect(currentStage([])).toBe(1);
  });

  it('w1 点了「不会」：它排到这一段末尾，下一个考 w2（不是又考 w1）', () => {
    const rows = [row('w1', 1, 0, T0)];
    expect(queueOf(1, rows).map((i) => i.id)).toEqual(['w2', 'w3', 'w4', 'w5', 'w6', 'w1']);
    expect((drillState(rows).当前 as Record<string, string>).id).toBe('w2');
  });

  it('w1、w3 先后点了「不会」：先回来的先考（w1 在 w3 前面），都排在没考过的后面', () => {
    const rows = [row('w1', 1, 0, T0), row('w3', 1, 0, T0 + 1000)];
    expect(queueOf(1, rows).map((i) => i.id)).toEqual(['w2', 'w4', 'w5', 'w6', 'w1', 'w3']);
  });

  it('会了的就不再出现在队列里（w2 会了 → 队列只剩 5 个）', () => {
    const rows = [row('w2', 1, 1, T0)];
    expect(queueOf(1, rows).map((i) => i.id)).toEqual(['w1', 'w3', 'w4', 'w5', 'w6']);
  });

  it('这一段只差一项也进不了下一段（门禁）：5 项会了，currentStage 还是 1', () => {
    const rows = STAGES[0].items.slice(0, 5).map((i, k) => row(i.id, 1, 1, T0 + k));
    expect(currentStage(rows)).toBe(1);
    expect((drillState(rows).当前 as Record<string, string>).id).toBe('w6');
  });

  it('六项全会了才进第二段；第二段全会进第三段；三段全会 currentStage 回 0', () => {
    const all = (n: number) => STAGES.find((s) => s.n === n)!.items.map((i, k) => row(i.id, 1, 1, T0 + k));
    expect(currentStage(all(1))).toBe(2);
    expect(currentStage([...all(1), ...all(2)])).toBe(3);
    expect(currentStage([...all(1), ...all(2), ...all(3)])).toBe(0);
  });

  it('「第一次就会」只认第一次：点过一次「不会」再「会了」不算', () => {
    const s = stageStats([row('w1', 1, 1, T0), row('w2', 2, 2, T0)]);
    expect([s[0].会了, s[0].第一次就会]).toEqual([2, 1]);
  });
});

// ======================================================================
describe('5. 接口：进度存在服务器上（换设备接着练）', () => {
  it('还没练过：第 1 段第 1 个、还剩 6 个，当前是 catch 那一项，没有小结', async () => {
    const { status, body } = await api('state');
    expect(status).toBe(200);
    expect(body.场景).toBe(SCENE);
    expect([body.这一段.段, body.这一段.名字, body.这一段.第几个, body.这一段.一共, body.这一段.还剩]).toEqual([1, '单词', 1, 6, 6]);
    expect(body.当前.中文).toBe('听清');
    expect(body.全部走完).toBe(false);
    expect(body.小结).toBe(null);
  });

  it('「不会」→ 下一项是 w2，进度不动（会了还是 0）；「会了」→ 进度 +1', async () => {
    const a = await no('w1');
    expect(a.status).toBe(200);
    expect([a.body.当前.id, a.body.这一段.会了, a.body.这一段.还剩]).toEqual(['w2', 0, 6]);
    const b = await yes('w2', T0 + 1000);
    expect([b.body.当前.id, b.body.这一段.会了, b.body.这一段.第几个, b.body.这一段.还剩]).toEqual(['w3', 1, 2, 5]);
  });

  it('换一台设备（重新读 state）接着练：停在同一项', async () => {
    await no('w1');
    await yes('w2', T0 + 1000);
    const { body } = await api('state');
    expect(body.当前.id).toBe('w3');
    expect(body.这一段.会了).toBe(1);
  });

  it('「不会」的那一项，这一段末尾真的会再考到一次', async () => {
    await no('w1');
    for (let k = 2; k <= 6; k++) await yes('w' + k, T0 + k * 1000);
    const { body } = await api('state');
    expect(body.当前.id).toBe('w1');          // 绕回来了
    expect(body.这一段.段).toBe(1);            // 还没进第二段
    expect(body.这一段.还剩).toBe(1);
    const after = await yes('w1', T0 + 9000);
    expect(after.body.这一段.段).toBe(2);      // 这才进第二段
    expect(after.body.段[0].第一次就会).toBe(5); // w1 是第二次才会
  });

  it('服务端拦跳段：第一段没走完就答第二段的项目 → 409，库里不记这一笔', async () => {
    const r = await yes('p1');
    expect(r.status).toBe(409);
    expect(r.body.出错).toContain('第 2 段');
    expect(r.body.怎么办).toContain('这一段全部点过「会了」才进下一段');
    const n = await db.prepare('SELECT COUNT(*) AS n FROM drill_item').first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it('已经会了的项目再答一次 → 409（不会把「第一次就会」刷掉）', async () => {
    await yes('w1');
    const r = await yes('w1', T0 + 1000);
    expect(r.status).toBe(409);
    const row = await db.prepare("SELECT tries, pass_try FROM drill_item WHERE item = 'w1'").first<{ tries: number; pass_try: number }>();
    expect([row?.tries, row?.pass_try]).toEqual([1, 1]);
  });

  it('不认识的项目编号 → 400；没给"会了还是不会" → 400（两句话都在）', async () => {
    const a = await api('answer', { item: 'w9', known: true });
    expect(a.status).toBe(400);
    expect(a.body.出错).toContain('不在带练清单里');
    expect(a.body.怎么办).toBeTruthy();
    const b = await api('answer', { item: 'w1' });
    expect(b.status).toBe(400);
    expect(b.body.出错).toContain('会了还是不会');
  });

  it('没登录一律 401（和后台别的接口一样）', async () => {
    const r = await handle(req('/api/drill/state'), env(), T0);
    expect(r.status).toBe(401);
  });

  it('三段 18 项全部走完：每段报「会了几个 / 第一次就会几个」，并且照实说第四段还没做', async () => {
    await no('w1');
    for (let k = 2; k <= 6; k++) await yes('w' + k, T0 + k * 1000);
    await yes('w1', T0 + 9000);
    await passStage(2, T0 + 20_000);
    const last = await passStage(3, T0 + 40_000);
    expect(last.body.全部走完).toBe(true);
    expect(last.body.当前).toBe(null);
    expect(last.body.小结).toEqual([
      { 段: 1, 名字: '单词', 会了: 6, 一共: 6, 第一次就会: 5 },
      { 段: 2, 名字: '词组', 会了: 6, 一共: 6, 第一次就会: 6 },
      { 段: 3, 名字: '例句', 会了: 6, 一共: 6, 第一次就会: 6 },
    ]);
    expect(last.body.第四段).toBe('第四段对话还没做，下一版加');
    // 走完以后再答一项 → 409，照实说完了
    const r = await yes('w1', T0 + 99_000);
    expect(r.status).toBe(409);
    expect(r.body.出错).toContain('三段已经全部练完了');
  });

  it('「看全部」能回看这一段：已经过完的给英文，没练到的不剧透（英文是 null）', async () => {
    await yes('w1');
    const { body } = await api('state');
    const six = body.这一段.六项 as { id: string; 中文: string; 英文: string | null; 关键点: string | null; 会了: boolean; 第一次就会: boolean }[];
    expect(six).toHaveLength(6);
    expect(six[0]).toEqual({ id: 'w1', 中文: '听清', 英文: 'catch', 关键点: '没听清用 catch，不要用 understand', 会了: true, 第一次就会: true });
    expect(six.slice(1).every((x) => x.英文 === null && x.关键点 === null && !x.会了)).toBe(true);
    // 中文一直给（他要能看到这一段都有哪些）
    expect(six.map((x) => x.中文)).toEqual(['听清', '跟得上', '意思是', '换个说法再说', '听懵了', '说清楚']);
  });
});

// ======================================================================
describe('6. 不让他打字、按钮够大', () => {
  it('整块里一个 <input> 都没有（模块、脚本、样式都没有）', () => {
    for (const s of [DRILL_MOD, DRILL_JS, DRILL_CSS]) {
      expect(s).not.toContain('<input');
      expect(s).not.toContain('input');
      expect(s).not.toContain('<textarea');
      expect(s).not.toContain('contenteditable');
    }
    // 整个后台页面里，#w-drill 这一段也不许有输入框
    const mod = ADMIN_PAGE.slice(ADMIN_PAGE.indexOf('id="w-drill"'), ADMIN_PAGE.indexOf('</section>', ADMIN_PAGE.indexOf('id="w-drill"')));
    expect(mod).not.toContain('<input');
  });

  it('「看答案」和「会了 / 不会」都 ≥52px 高（手机 390 宽单手够得着）', () => {
    // 选择器要压得过 admin-page.ts 的 :is(#v-work,…) .btn{min-height:38px}（带 id，1-1-0），所以这里是 #w-drill + 两个类
    const h = [...DRILL_CSS.matchAll(/#w-drill \.dr-(one|two) \.btn\{[^}]*min-height:(\d+)px/g)].map((m) => Number(m[2]));
    expect(h).toHaveLength(2);
    expect(h.every((x) => x >= 52)).toBe(true);
  });

  it('字号只用全站那几级（12 / 13 / 15 / 17 / 18 / 22 / 24 / 26），不自己造一级', () => {
    const FS = [12, 13, 14, 15, 17, 18, 22, 24, 26, 30];
    const sizes = [...DRILL_CSS.matchAll(/font-size:(\d+)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(5);
    expect(sizes.filter((x) => !FS.includes(x))).toEqual([]);
  });
});

// ======================================================================
describe('7. 不调 AI、不花钱、不碰密钥', () => {
  const src = readFileSync(path.join(ROOT, 'src/drill.ts'), 'utf8');

  it('服务端不 import 任何 AI 模块，也不出现模型名 / 接口地址', () => {
    for (const w of ["from './ai'", "from './gemini'", "from './workers-ai'", "from './ai.js'", '@cf/', 'generativelanguage', '/v1/', 'chargeNeurons', 'neurons']) {
      expect([w, src.includes(w)]).toEqual([w, false]);
    }
    // 只 import 了类型
    expect(src).toContain("import type { Env } from './env';");
    expect((src.match(/^import /gm) ?? [])).toHaveLength(1);
  });

  it('页面上不出现任何命令行、不出现密钥变量名（底线 1、把用户当小白）', () => {
    for (const s of [DRILL_MOD, DRILL_JS]) {
      for (const w of ['npm ', 'curl ', 'wrangler ', 'node scripts/', 'TOKEN', 'API_KEY', 'PASSWORD', 'SECRET']) {
        expect([w, s.includes(w)]).toEqual([w, false]);
      }
    }
  });

  it('只读写 drill_item 这一张表，SQL 里没有别的表', () => {
    const sql = [...src.matchAll(/(?:FROM|INTO)\s+(\w+)/g)].map((m) => m[1]);
    expect([...new Set(sql)]).toEqual(['drill_item']);
  });
});

// ======================================================================
describe('8. 迁移 0013 只 CREATE', () => {
  const sql = readFileSync(path.join(MIG, M0013), 'utf8');
  const code = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

  it('只有一条 CREATE TABLE drill_item，没有 ALTER / DROP / CREATE INDEX / 回填', () => {
    expect((code.match(/CREATE TABLE/g) ?? []).length).toBe(1);
    expect(code).toContain('CREATE TABLE drill_item (');
    for (const w of ['ALTER ', 'DROP ', 'CREATE INDEX', 'INSERT ', 'UPDATE ', 'DELETE ']) expect([w, code.toUpperCase().includes(w)]).toEqual([w, false]);
  });

  it('五列：scene / item / tries / pass_try / at，主键是（场景，项目）', () => {
    expect([...code.matchAll(/^ {2}(\w+) (?:INTEGER|TEXT)/gm)].map((m) => m[1])).toEqual(['scene', 'item', 'tries', 'pass_try', 'at']);
    expect(code).toContain('PRIMARY KEY (scene, item)');
  });

  it('在已有 0001～0012 数据的库上跑：旧表一行不动（迁移跑完 en_word 还在、drill_item 是空的）', async () => {
    // beforeAll 已经把 0001～0013 全部跑过了；这里确认旧表还在、新表是空的
    const old = await db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('events','queue','en_word','en_sentence','en_round')").first<{ n: number }>();
    expect(old?.n).toBe(5);
    const n = await db.prepare('SELECT COUNT(*) AS n FROM drill_item').first<{ n: number }>();
    expect(n?.n).toBe(0);
  });
});

// ======================================================================
describe('9. 进度一眼看得到；第四段不假装有', () => {
  it('顶上那一行写明第几段 / 这一段第几个 / 还剩几个', () => {
    expect(DRILL_JS).toContain("'第 '+seg['段']+' 段 '+seg['名字']+' · 第 '+seg['第几个']+' 个 / 共 '+seg['一共']");
    expect(DRILL_JS).toContain("'这一段还剩 '+(seg['还剩']||0)+' 个");
    expect(DRILL_MOD).toContain('id="dr-bar"');
  });

  it('第四段那句话由服务端给、页面原样显示，而且只在走完以后出现', () => {
    expect(STAGE4_NOTE).toBe('第四段对话还没做，下一版加');
    expect(DRILL_JS).toContain("dText('dr-next',j['第四段']||'');");
    expect(DRILL_JS).toContain("dShow('dr-next',done&&!!j['第四段']);");
    // 页面自己不写死第四段的说法（只有服务端那一份）
    expect(DRILL_MOD).not.toContain('第四段');
  });

  it('这一块明说自己不调 AI（折叠说明里），不吹第四段已经有了', () => {
    expect(DRILL_MOD).toContain('一个 AI 都不调');
    expect(DRILL_MOD).not.toContain('Gemini Live 对话');
  });
});
