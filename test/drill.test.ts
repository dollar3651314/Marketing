/**
 * 工作台「带练」（src/drill.ts、src/drill-page.ts、migrations/0013_drill.sql）的测试。守住八件事：
 *   1. **内容一个字都没改**：场景 0 的三段（单词 / 词组 / 例句）各 6 项，18 项的中文、英文、关键点
 *      在测试里**逐字写死**，改一个字就红（防手滑）。**注意：18 项里有 6 项是本项目新加的、Amos 还没审**，
 *      哪些是哪些见 `src/drill.ts` 顶部的对应关系；这一组测的是「没被改掉」，不是「都审过了」。
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
import { ALL_IDS, audioTextOf, AUDIO_IDS, cardOf, orNull, currentStage, drillState, enOf, queueOf, sayText, SCENE, sharesWordRun, STAGE4_NOTE, STAGES, stageStats, zhOf, type DrillRow } from '../src/drill';
import { CONTENT, STAGE3 } from '../src/drill-content';
import { PAIRS } from '../src/ear-content';
import { EAR_WORD_IDS } from '../src/ear';
import { DRILL_PROJECT, DRILL_PURPOSE } from '../src/drill-audio';
import { dayText, DAY, REVIEW_MODE, REVIEW_N, reviewLine, shuffleIds } from '../src/drill-review';
import { TTS_MELOTTS } from '../src/tts';
import { PURPOSES } from '../src/usage';
import { ROOT, T0 } from './helpers';

const PASS = 'ci_only_copilot_password_01';
const HOST = 'https://copilot.example.test';
const MIG = path.join(ROOT, 'migrations');
const M0013 = '0013_drill.sql';
const M0014 = '0014_drill_audio.sql';
const M0015 = '0015_drill_review.sql';

/** 揭晓那一整块（#dr-ans）的 HTML：按 <div> 配对数出来，不靠"后面第一个 </div>"（那会切早） */
function ansBlock(): string {
  const start = DRILL_MOD.indexOf('<div id="dr-ans"');
  const re = /<div\b|<\/div>/g;
  re.lastIndex = start;
  let depth = 0;
  for (let m = re.exec(DRILL_MOD); m; m = re.exec(DRILL_MOD)) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return DRILL_MOD.slice(start, re.lastIndex);
  }
  return '';
}

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
  await db.batch(['drill_item', 'drill_audio', 'drill_review', 'ai_usage', 'model_usage', 'usage_by_project', 'usage_by_purpose', 'auth_fail', 'auth_lock'].map((t) => db.prepare(`DELETE FROM ${t}`)));
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
/** 假的 Workers AI：melotts 回 {audio: base64}，顺便记下被调了几次、每次什么参数 */
const MP3 = Uint8Array.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x11, 0x22, 0x33]);
const b64 = (a: Uint8Array) => btoa(String.fromCharCode(...a));
function fakeAi(fn?: (model: string, inp: unknown) => Promise<unknown>) {
  const calls: { model: string; inp: Record<string, unknown> }[] = [];
  const AI = {
    run: async (model: string, inp: unknown) => {
      calls.push({ model, inp: inp as Record<string, unknown> });
      return fn ? await fn(model, inp) : { audio: b64(MP3) };
    },
  };
  return { calls, env: (): Env => ({ ...env(), AI }) };
}
/** 直接拿 Response（发音回的是 audio/mpeg，不是 JSON） */
const getRaw = (p: string, e: Env = env(), now = T0) => handle(req('/api/drill/' + p, { cookie: ck }), e, now);

/** 直接按到期时间排一笔复考（后台登录的会话只有几个钟头，测"到期"不能把"现在"往后拨一天） */
const planAt = (due: number) => db.prepare('INSERT INTO drill_review (scene, due_at, mode) VALUES (?1, ?2, ?3) ON CONFLICT (scene) DO UPDATE SET due_at = ?2, mode = ?3').bind(SCENE, due, REVIEW_MODE).run();

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
describe('1. 内容：场景 0 三段各 6 项，和定稿逐字一致（防手滑；哪几项还没审见 src/drill.ts）', () => {
  it('第一段 单词：6 个词的中文、英文、关键点逐字对得上', () => {
    expect(STAGES[0].items.map((i) => [i.zh, i.en, i.key])).toEqual([
      ['听清', 'catch', 'catch 是耳朵没收到；understand 是听清了但没懂。说错了对方会帮错忙'],
      ['跟得上', 'follow', "I'm not following = 我跟不上你的思路"],
      ['意思是', 'mean', 'What do you mean by X —— by 不能丢'],
      ['换个说法再说', 'rephrase', 'repeat 是再说一遍，rephrase 是换种说法'],
      ['听懵了', 'lost', "I'm lost = 我彻底跟丢了，这么说不丢人"],
      ['说清楚', 'clarify', 'clarify 是请对方讲清楚；catch 是自己没听清，两个别混'],
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

  it('第三段 例句：6 条的「对方说的那句 / 中文情境 / 英文答案」逐字对得上（内容在 src/drill-content.ts 的 STAGE3）', () => {
    // 2026-11-10：第三段整段重做成「对方先说一句，你来接」（旧版是第二段词组加个尾巴，刚背完立刻考同一句）。
    // 这一组照旧**逐字写死**（改一个字就红，防手滑），只是钉的是现在真正显示的那三样，而且比以前多钉一样（对方说的那句）。
    expect(ALL_IDS.slice(12).map((id) => [STAGE3[id].prompt_en, STAGE3[id].prompt_zh, STAGE3[id].en])).toEqual([
      ['Before we sign anything, legal wants us to de-risk the whole merchant onboarding flow first.', '他蹦出一个你没听过的词', 'What do you mean by "de-risk"?'],
      ['Right, and the settlement window moves to T plus one for all the European corridors.', '他语速快，网又卡了一下', "Sorry, I didn't catch that."],
      ['Okay, so the three options are net thirty, net sixty, or prepay with a two percent discount.', '他一口气报了三个方案', 'Could you slow down a bit? I want to get all three.'],
      ["I think we're directionally aligned, but the sequencing of the rollout still worries me a lot.", '他那句话绕，你没抓到重点', "Could you rephrase that? I'm not sure I follow."],
      ["Let's get the deck over to them tonight and the full model can land Friday morning.", '两个时间点，你要确认一下', 'Just to make sure I understand — the deck goes out tonight, the model on Friday?'],
      ['Honestly, if we cut the reconciliation dashboard, we can hit the pilot date without adding headcount.', '他绕了一圈，你复述他的结论', "So what you're saying is we drop the dashboard to make the pilot date."],
    ]);
    // 第三段**两边不各存一份**：STAGES 第三段就是从 STAGE3 读的（卡片上的中文 = prompt_zh，答案 = en）
    expect(STAGES[2].items.map((i) => [i.id, zhOf(i), enOf(i)])).toEqual(ALL_IDS.slice(12).map((id) => [id, STAGE3[id].prompt_zh, STAGE3[id].en]));
  });

  it('第三段「对方说的那句」里不许藏着答案：没有 4 个词以上的连续重合（产品换内容也得过这一关）', () => {
    for (const id of ALL_IDS.slice(12)) {
      const p = STAGE3[id];
      expect([id, p.prompt_en.trim().length > 0]).toEqual([id, true]);
      expect([id, sharesWordRun(p.prompt_en, p.en, 4)]).toEqual([id, false]);
    }
    // 反过来验这个检查真的会抓人：把答案原样抄进对方那句就必须被抓到
    expect(sharesWordRun("He said: Sorry, I didn't catch that. Again?", "Sorry, I didn't catch that.", 4)).toBe(true);
  });

  it('三段、每段 6 项、编号不重复；只有第一段有关键点（第二、三段没有）', () => {
    expect(STAGES.map((s) => [s.n, s.name, s.items.length])).toEqual([[1, '单词', 6], [2, '词组', 6], [3, '例句', 6]]);
    expect(ALL_IDS).toHaveLength(18);
    expect(new Set(ALL_IDS).size).toBe(18);
    expect(STAGES[0].items.every((i) => !!i.key)).toBe(true);
    expect([...STAGES[1].items, ...STAGES[2].items].every((i) => i.key === undefined)).toBe(true);
  });

  it('内容写死在内容文件里：模块结构里不带任何一条英文答案、也不带第三段对方说的那句（界面是现场画的，不是服务端拼 HTML）', () => {
    for (const i of ALL_IDS) expect([i, DRILL_MOD.includes(i)]).toEqual([i, false]);
    for (const en of STAGES.flatMap((s) => s.items.map((x) => enOf(x)))) expect([en, DRILL_MOD.includes(en)]).toEqual([en, false]);
    // v2 多钉一样：对方说的那句虽然**要显示在卡片上**，也得是现场画的，不许写死在模块里
    for (const id of ALL_IDS.slice(12)) expect([id, DRILL_MOD.includes(STAGE3[id].prompt_en)]).toEqual([id, false]);
    // 词义、用法、音标同理
    for (const id of ALL_IDS) for (const v of [CONTENT[id].ipa, CONTENT[id].stress, CONTENT[id].meaning, CONTENT[id].usage]) {
      if (v) expect([id, v, DRILL_MOD.includes(v)]).toEqual([id, v, false]);
    }
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
    // 卡片上先只有中文：**揭晓那一整块**（#dr-ans，默认 hidden）里面装着英文、音标 / 重音、词义、用法、关键点和两个发音按钮。
    // 以前这里只切到 #dr-en 后面第一个 </div> 为止（切早了，#dr-key 根本没被看），现在整块都看，而且多钉了 4 个元素。
    const ans = ansBlock();
    for (const id of ['dr-en', 'dr-ipa', 'dr-zimian', 'dr-use', 'dr-key', 'dr-au']) expect([id, ans.includes('id="' + id + '"')]).toEqual([id, true]);
    // 中文、「对方说的那句」、**发音出错的提示**都在块外面。
    // `dr-aumsg` 原来钉在块**里面**——那条断言把一个真 bug 钉死了：第三段揭晓前 #dr-ans 还带 hidden，
    // 他点「🔊 听他这句」失败时 dAuErr 把 hidden=false 设在一个父元素还 hidden 的节点上，**页面一动不动、什么都看不到**
    // （2026-11-10 审查 🔴1）。现在反过来钉：它必须在块外面，否则那个 bug 回来就红。
    for (const id of ['dr-zh', 'dr-pr', 'dr-aumsg']) expect([id, ans.includes('id="' + id + '"')]).toEqual([id, false]);
    expect(DRILL_MOD).toContain('id="dr-aumsg"');
  });

  it('点「看答案」才揭晓：dReveal 把答案显示出来、换掉按钮；换下一项时 dPaint 又藏回去', () => {
    expect(DRILL_JS).toContain("dShow('dr-ans',true);dShow('dr-one',false);dShow('dr-two',true);");
    expect(DRILL_JS).toContain("dShow('dr-ans',false);dShow('dr-one',true);dShow('dr-two',false);");
  });

  it('答案本来就在手里（state 里带着英文和关键点）：点「看答案」不再跑一趟接口，没有延迟', () => {
    const st = drillState([]);
    expect((st.当前 as Record<string, string>).英文).toBe('catch');
    expect((st.当前 as Record<string, string>).关键点).toBe('catch 是耳朵没收到；understand 是听清了但没懂。说错了对方会帮错忙');
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
    expect(six[0]).toEqual({ id: 'w1', 中文: '听清', 英文: 'catch', 关键点: 'catch 是耳朵没收到；understand 是听清了但没懂。说错了对方会帮错忙', 会了: true, 第一次就会: true });
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
    // 钉死到底 import 了哪三个模块（比"只有一条 import"更严：多一条、换一个来源都红）。
    // 2026-11-10 听辨小测多了 './ear' 这一条：那 16 段发音挂进 AUDIO_IDS / audioTextOf()，**不另开第二套**。
    expect(src).toContain("import type { Env } from './env';");
    expect(src).toContain("import { CONTENT, STAGE3, W1_KEY } from './drill-content';");
    expect(src).toContain("import { earWordOf, EAR_WORD_IDS } from './ear';");
    expect([...src.matchAll(/^import .*from '([^']+)';$/gm)].map((m) => m[1])).toEqual(['./env', './drill-content', './ear']);
    // 多进来的这条**不许把 AI 带进来**：ear.ts 只 import ./env 和 ./ear-content，ear-content.ts 一条 import 都没有
    const earSrc = readFileSync(path.join(ROOT, 'src/ear.ts'), 'utf8');
    const earContentSrc = readFileSync(path.join(ROOT, 'src/ear-content.ts'), 'utf8');
    expect([...earSrc.matchAll(/^import .*from '([^']+)';$/gm)].map((m) => m[1])).toEqual(['./env', './ear-content']);
    expect([...earContentSrc.matchAll(/^import /gm)]).toHaveLength(0);
    for (const w of ["from './ai'", "from './gemini'", "from './workers-ai'", '@cf/', 'generativelanguage', '/v1/', 'chargeNeurons', 'neurons']) {
      expect([w, earSrc.includes(w) || earContentSrc.includes(w)]).toEqual([w, false]);
    }
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

// ======================================================================
describe('10. v2 内容：音标 / 重音、词义、用法（内容在 src/drill-content.ts，null 就整行不显示）', () => {
  const card = (id: string) => cardOf(STAGES.flatMap((s) => s.items).find((i) => i.id === id)!);

  it('单词段给音标、不给重音；词组和例句段给重音、不给音标（显示位分得清清楚楚）', () => {
    for (const id of ALL_IDS.slice(0, 6)) {
      expect([id, card(id).音标]).toEqual([id, CONTENT[id].ipa ?? null]);
      expect([id, card(id).重音]).toEqual([id, null]);
    }
    for (const id of ALL_IDS.slice(6)) {
      expect([id, card(id).重音]).toEqual([id, CONTENT[id].stress ?? null]);
      expect([id, card(id).音标]).toEqual([id, null]);
    }
  });

  it('词义和用法原样给（空白串一律当没有 → null，页面照规矩不显示那一行）', () => {
    for (const id of ALL_IDS) {
      expect([id, card(id).字面意思]).toEqual([id, (CONTENT[id].meaning ?? '').trim() || null]);
      expect([id, card(id).什么场合用]).toEqual([id, (CONTENT[id].usage ?? '').trim() || null]);
    }
  });

  it('空的内容一律变成 null（这是"整行不显示"的根：空字符串、只有空白、没给，都一样）', () => {
    for (const v of ['', '   ', '\n', null, undefined]) expect([String(v), orNull(v)]).toEqual([String(v), null]);
    expect(orNull('  /kætʃ/  ')).toBe('/kætʃ/');
  });

  it('内容文件里缺的字段：出来就是 null，不冒充、也不写「暂无」', () => {
    // 第二段没有 ipa、第一段没有 stress：这两处本来就是空的
    expect(ALL_IDS.slice(6).every((id) => (CONTENT[id].ipa ?? null) === null)).toBe(true);
    expect(ALL_IDS.slice(0, 6).every((id) => (CONTENT[id].stress ?? null) === null)).toBe(true);
    // 服务端给出去的一整项里，没有一个字段是「暂无」这类占位词
    const all = JSON.stringify(ALL_IDS.map((id) => card(id)));
    for (const w of ['暂无', '待补', 'TODO', 'null 占位', '未填']) expect([w, all.includes(w)]).toEqual([w, false]);
  });

  it('每一条内容都带出处（src），查不到的写「未查到」——不许留空', () => {
    for (const id of ALL_IDS) {
      const src = CONTENT[id].src.trim();
      expect([id, src.length > 0]).toEqual([id, true]);
      expect([id, src === '未查到' || src.startsWith('https://')]).toEqual([id, true]);
    }
  });

  it('第三段卡片上给「对方说的那句」+ 中文情境 + 它自己的发音编号；前两段没有', () => {
    for (const id of ALL_IDS.slice(12)) {
      expect([id, card(id).对方说的]).toEqual([id, STAGE3[id].prompt_en]);
      expect([id, card(id).对方说的中文]).toEqual([id, STAGE3[id].prompt_zh]);
      expect([id, card(id).对方发音]).toEqual([id, id + 'p']);
    }
    for (const id of ALL_IDS.slice(0, 12)) {
      expect([id, card(id).对方说的, card(id).对方发音]).toEqual([id, null, null]);
    }
    // 每一项都能点🔊（发音编号就是它自己）
    for (const id of ALL_IDS) expect([id, card(id).发音]).toEqual([id, id]);
  });

  it('state 的「当前」一次把该给的都给了（页面点「看答案」不用再跑一趟接口）', () => {
    const cur = drillState([]).当前 as Record<string, unknown>;
    expect(Object.keys(cur).sort()).toEqual(['中文', '什么场合用', '关键点', '发音', '字面意思', '对方发音', '对方说的', '对方说的中文', '段', '英文', '重音', '音标', 'id'].sort());
    expect(cur.音标).toBe(CONTENT.w1.ipa);
    expect(cur.字面意思).toBe(CONTENT.w1.meaning);
    expect(cur.什么场合用).toBe(CONTENT.w1.usage);
  });
});

// ======================================================================
describe('11. 发音：melotts 第一次需要时生成一次，存 D1 永久复用（40 段约 33 neurons）', () => {
  // 2026-11-10 听辨小测：24 段 → 40 段（多了听辨那 16 个词 p1a…p8b）。**这一组只往严里改**：
  // 原来只钉"一共几段"和末尾 6 段，现在三段都逐条钉死（18 项 / 6 句对方那句 / 16 个听辨词），
  // 而且第三段要和 src/ear-content.ts 的 PAIRS **对得上**（研发自己在 drill.ts 里另抄一份编号就红）。
  it('一共 40 段：18 项 + 第三段 6 句「对方说的那句」（s1p～s6p）+ 听辨小测 16 个词（p1a～p8b）', () => {
    expect(AUDIO_IDS).toHaveLength(40);
    expect(new Set(AUDIO_IDS).size).toBe(40);
    expect(AUDIO_IDS.slice(0, 18)).toEqual(ALL_IDS);
    expect(AUDIO_IDS.slice(18, 24)).toEqual(['s1p', 's2p', 's3p', 's4p', 's5p', 's6p']);
    expect(AUDIO_IDS.slice(24)).toEqual(['p1a', 'p1b', 'p2a', 'p2b', 'p3a', 'p3b', 'p4a', 'p4b', 'p5a', 'p5b', 'p6a', 'p6b', 'p7a', 'p7b', 'p8a', 'p8b']);
    // 听辨那 16 段**只能来自内容文件**，不许在 drill.ts 里另抄一份
    expect(AUDIO_IDS.slice(24)).toEqual(PAIRS.flatMap((p) => [p.a.id, p.b.id]));
    expect(AUDIO_IDS.slice(24)).toEqual(EAR_WORD_IDS);
  });

  it('每一段念的是什么：答案念答案、s#p 念对方那句；只去掉填空的 ___ 和破折号，一个词都不改', () => {
    for (const id of ALL_IDS) expect([id, audioTextOf(id)]).toEqual([id, sayText(enOf(STAGES.flatMap((s) => s.items).find((i) => i.id === id)!))]);
    for (const id of ALL_IDS.slice(12)) expect([id, audioTextOf(id + 'p')]).toEqual([id, sayText(STAGE3[id].prompt_en)]);
    expect(sayText('What do you mean by ___?')).toBe('What do you mean by ?');
    expect(sayText('Just to make sure I understand —')).toBe('Just to make sure I understand');
    expect(audioTextOf('w9')).toBe(null);
  });

  it('第一次点🔊：调一次 melotts（prompt + lang=en）、存进 drill_audio、回 audio/mpeg；第二次**不再调 AI**', async () => {
    const ai = fakeAi();
    const r1 = await getRaw('audio/w1', ai.env());
    expect(r1.status).toBe(200);
    expect(r1.headers.get('content-type')).toBe('audio/mpeg');
    expect(new Uint8Array(await r1.arrayBuffer())).toEqual(MP3);
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0].model).toBe(TTS_MELOTTS);
    expect(ai.calls[0].inp).toEqual({ prompt: 'catch', lang: 'en' });
    const row = await db.prepare("SELECT item, at FROM drill_audio WHERE item = 'w1'").first<{ item: string; at: number }>();
    expect([row?.item, row?.at]).toEqual(['w1', T0]);
    // 第二次：库里有了，一次 AI 都不调（永久复用，不再花钱）
    const r2 = await getRaw('audio/w1', ai.env(), T0 + 99_000);
    expect(r2.status).toBe(200);
    expect(new Uint8Array(await r2.arrayBuffer())).toEqual(MP3);
    expect(ai.calls).toHaveLength(1);
  });

  it('记账走已有那一本：用途 drill-tts、项目 drill、模型 melotts，而且 drill-tts 在用量页有中文名', async () => {
    const ai = fakeAi();
    await getRaw('audio/p2', ai.env());
    const p = await db.prepare('SELECT purpose, model, req, neurons FROM usage_by_purpose').first<{ purpose: string; model: string; req: number; neurons: number }>();
    // 记账那一本按"引擎"记（workers-ai），和语音生成工具、素材生成器同一套；真正跑的模型是 melotts（上一条测了）
    expect([p?.purpose, p?.model, p?.req]).toEqual([DRILL_PURPOSE, 'workers-ai', 1]);
    expect(p!.neurons).toBeGreaterThan(0);
    const j = await db.prepare('SELECT project FROM usage_by_project').first<{ project: string }>();
    expect(j?.project).toBe(DRILL_PROJECT);
    const a = await db.prepare('SELECT neurons FROM ai_usage').first<{ neurons: number }>();
    expect(a!.neurons).toBeGreaterThan(0);
    expect(DRILL_PURPOSE).toBe('drill-tts');
    expect(PURPOSES).toContain(DRILL_PURPOSE);
  });

  it('40 段全生成一遍：加起来远不到免费额度（别偷偷变成一笔新开销）', async () => {
    const ai = fakeAi();
    for (const id of AUDIO_IDS) expect([id, (await getRaw('audio/' + id, ai.env())).status]).toEqual([id, 200]);
    expect(ai.calls).toHaveLength(40);
    const a = await db.prepare('SELECT neurons FROM ai_usage').first<{ neurons: number }>();
    expect(a!.neurons).toBeLessThan(100); // 实测约 33；免费额度 10,000/天
    expect((await db.prepare('SELECT COUNT(*) AS n FROM drill_audio').first<{ n: number }>())?.n).toBe(40);
    // 再点一遍：**一次都不许再调 melotts**（存下来就永久复用，不新增一分钱费用）
    for (const id of AUDIO_IDS) expect([id, (await getRaw('audio/' + id, ai.env())).status]).toEqual([id, 200]);
    expect(ai.calls).toHaveLength(40);
  });

  it('没绑 Workers AI → 503 两句话；编号不认识 → 400（都不进库）', async () => {
    const r = await getRaw('audio/w1');
    expect(r.status).toBe(503);
    const j = (await r.json()) as Record<string, string>;
    expect(j.出错).toContain('生成不了发音');
    expect(j.怎么办).toBeTruthy();
    const bad = await getRaw('audio/w9', fakeAi().env());
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as Record<string, string>).出错).toContain('不在带练清单里');
    expect((await db.prepare('SELECT COUNT(*) AS n FROM drill_audio').first<{ n: number }>())?.n).toBe(0);
  });

  it('今天额度不够 → 429 两句话，**一次 AI 都不调**、不入库（C117：只看他自己设的那个上限）', async () => {
    await db.prepare("INSERT INTO ai_usage (day, neurons) VALUES ('2026-10-29', 8000)").run();
    const ai = fakeAi();
    const r = await getRaw('audio/w1', ai.env());
    expect(r.status).toBe(429);
    const j = (await r.json()) as Record<string, string>;
    expect(j.出错).toContain('额度不够');
    expect(j.怎么办).toContain('生成过的永久存着');
    expect(ai.calls).toHaveLength(0);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM drill_audio').first<{ n: number }>())?.n).toBe(0);
  });

  it('模型出错 → 502 两句话、按估算记一笔账、库里不留半截；**失败就失败，不自动重试**', async () => {
    const ai = fakeAi(async () => {
      throw new Error('melotts boom');
    });
    const r = await getRaw('audio/w1', ai.env());
    expect(r.status).toBe(502);
    const j = (await r.json()) as Record<string, string>;
    expect(j.出错).toContain('发音没生成出来');
    expect(j.怎么办).toContain('不会自动重试');
    expect(ai.calls).toHaveLength(1); // 只试了一次，没有重试风暴
    expect((await db.prepare('SELECT COUNT(*) AS n FROM drill_audio').first<{ n: number }>())?.n).toBe(0);
    expect((await db.prepare('SELECT neurons FROM ai_usage').first<{ neurons: number }>())!.neurons).toBeGreaterThan(0);
  });

  it('回来的是空的 → 502，不把空文件存进库（下次还能重新生成）', async () => {
    const ai = fakeAi(async () => ({ audio: '' }));
    const r = await getRaw('audio/w1', ai.env());
    expect(r.status).toBe(502);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM drill_audio').first<{ n: number }>())?.n).toBe(0);
  });

  it('没登录一律 401（和带练别的接口一样）', async () => {
    const r = await handle(req('/api/drill/audio/w1'), fakeAi().env(), T0);
    expect(r.status).toBe(401);
  });
});

// ======================================================================
describe('12. 复考：「明天再考我这 18 项」（表 drill_review，不动 drill_item）', () => {
  it('还没安排：一句话是空的，页面上什么都不写', async () => {
    const { status, body } = await api('review');
    expect(status).toBe(200);
    expect([body.有安排, body.到期了, body.一句话]).toEqual([false, false, '']);
    expect(body.一共).toBe(18);
  });

  it('按「明天再考我这 18 项」：记下**明天同一时刻**到期，方式是「只考」', async () => {
    const { body } = await api('review/plan', {});
    expect(body.到期时间).toBe(T0 + DAY);
    expect(body.方式).toBe(REVIEW_MODE);
    expect(body.到期了).toBe(false);
    const row = await db.prepare('SELECT scene, due_at, mode FROM drill_review').first<{ scene: number; due_at: number; mode: string }>();
    expect([row?.scene, row?.due_at, row?.mode]).toEqual([SCENE, T0 + DAY, REVIEW_MODE]);
  });

  it('没到期：顶上写「下次复考：X 月 X 日」（台湾时间）；到期了：写「今天是复考」并说明只考什么', () => {
    const row = { scene: SCENE, due_at: T0 + DAY, mode: REVIEW_MODE };
    expect(dayText(T0 + DAY)).toBe('10 月 30 日'); // T0 是台湾时间 10/29 12:00
    expect(reviewLine(row, T0)).toBe('下次复考：10 月 30 日（只考）。还没到期，想现在考也可以。');
    expect(reviewLine(row, T0 + DAY)).toContain('今天是复考');
    expect(reviewLine(row, T0 + DAY)).toContain('不给关键点、不给词意');
    expect(reviewLine(null, T0)).toBe('');
  });

  it('到期后再打开：到期了 = true（一句话由服务端给，页面原样显示）', async () => {
    await planAt(T0 - 1000);
    const { body } = await api('review');
    expect(body.到期了).toBe(true);
    expect(body.一句话).toContain('今天是复考');
  });

  it('开始这一轮：18 项**三段合一轮、顺序打散**，而且是那 18 项的排列（不多不少）', async () => {
    await planAt(T0 - 1000);
    const { body } = await api('review/start', {});
    const ids = (body.题目 as Record<string, string>[]).map((x) => x.id);
    expect(ids).toHaveLength(18);
    expect([...ids].sort()).toEqual([...ALL_IDS].sort());
    expect(ids).not.toEqual(ALL_IDS); // 打散了
    // 同一次复考刷新几遍是同一张卷子（种子是到期时间）
    const again = await api('review/start', {});
    expect((again.body.题目 as Record<string, string>[]).map((x) => x.id)).toEqual(ids);
    expect(shuffleIds(ALL_IDS, T0 - 1000)).toEqual(ids);
  });

  it('「只考」就是只考：题目里**没有**关键点、字面意思、什么场合用、音标（只有题面、答案和发音）', async () => {
    await planAt(T0 - 1000);
    const { body } = await api('review/start', {});
    for (const q of body.题目 as Record<string, unknown>[]) {
      expect(Object.keys(q).sort()).toEqual(['中文', '发音', '对方发音', '对方说的', '对方说的中文', '段', '英文', 'id'].sort());
    }
  });

  it('提前开始也行（没到期一样能 start）；没安排过就 start → 409', async () => {
    const no = await api('review/start', {});
    expect(no.status).toBe(409);
    expect(no.body.怎么办).toContain('明天再考我这 18 项');
    await api('review/plan', {});
    const early = await api('review/start', {}, T0 + 1000);
    expect(early.status).toBe(200);
    expect((early.body.题目 as unknown[]).length).toBe(18);
  });

  it('走完报「说得出来 N / 18」，这一笔安排清掉；**drill_item 的进度一行没动**', async () => {
    await yes('w1');
    const before = await db.prepare('SELECT item, tries, pass_try, at FROM drill_item').all();
    await planAt(T0 - 1000);
    const done = await api('review/done', { 对: 13 });
    expect(done.status).toBe(200);
    expect(done.body.这一轮).toBe('说得出来 13 / 18');
    expect(done.body.有安排).toBe(false);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM drill_review').first<{ n: number }>())?.n).toBe(0);
    const after = await db.prepare('SELECT item, tries, pass_try, at FROM drill_item').all();
    expect(after.results).toEqual(before.results);
  });

  it('成绩不合法（负数、超过 18、不是整数、没给）→ 400；这一轮已经结束了再报 → 409', async () => {
    await planAt(T0 - 1000);
    for (const v of [-1, 19, 1.5, '3']) expect([v, (await api('review/done', { 对: v })).status]).toEqual([v, 400]);
    expect((await api('review/done', {})).status).toBe(400);
    expect((await api('review/done', { 对: 18 })).status).toBe(200);
    expect((await api('review/done', { 对: 18 })).status).toBe(409);
  });

  it('打散是算出来的、不是随机的：同一个种子永远同一张卷子，换一个种子就不一样', () => {
    expect(shuffleIds(ALL_IDS, 123)).toEqual(shuffleIds(ALL_IDS, 123));
    expect(shuffleIds(ALL_IDS, 123)).not.toEqual(shuffleIds(ALL_IDS, 124));
    expect([...shuffleIds(ALL_IDS, 123)].sort()).toEqual([...ALL_IDS].sort());
    expect(REVIEW_N).toBe(18);
  });

  it('没登录一律 401', async () => {
    expect((await handle(req('/api/drill/review'), env(), T0)).status).toBe(401);
  });
});

// ======================================================================
describe('13. 迁移 0014 / 0015 只 CREATE（旧表一行不动）', () => {
  const code = (f: string) => readFileSync(path.join(MIG, f), 'utf8').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

  it('0014 只有一条 CREATE TABLE drill_audio（item / mp3 / at，主键 item），没有 ALTER / DROP / INDEX / 回填', () => {
    const c = code(M0014);
    expect((c.match(/CREATE TABLE/g) ?? []).length).toBe(1);
    expect(c).toContain('CREATE TABLE drill_audio (');
    expect(c).toContain('item TEXT PRIMARY KEY');
    for (const w of ['ALTER ', 'DROP ', 'CREATE INDEX', 'INSERT ', 'UPDATE ', 'DELETE ']) expect([w, c.toUpperCase().includes(w)]).toEqual([w, false]);
  });

  it('0015 只有一条 CREATE TABLE drill_review（scene / due_at / mode，主键 scene），同样只 CREATE', () => {
    const c = code(M0015);
    expect((c.match(/CREATE TABLE/g) ?? []).length).toBe(1);
    expect(c).toContain('CREATE TABLE drill_review (');
    expect(c).toContain('scene INTEGER PRIMARY KEY');
    for (const w of ['ALTER ', 'DROP ', 'CREATE INDEX', 'INSERT ', 'UPDATE ', 'DELETE ']) expect([w, c.toUpperCase().includes(w)]).toEqual([w, false]);
  });

  it('在已有 0001～0013 数据的库上跑：旧表还在、0013 的 drill_item 结构一个字没变，两张新表是空的', async () => {
    const old = await db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('events','queue','en_word','drill_item')").first<{ n: number }>();
    expect(old?.n).toBe(4);
    const cols = (await db.prepare("SELECT name FROM pragma_table_info('drill_item')").all<{ name: string }>()).results;
    expect(cols!.map((c) => c.name)).toEqual(['scene', 'item', 'tries', 'pass_try', 'at']);
    for (const t of ['drill_audio', 'drill_review']) {
      expect([t, (await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())?.n]).toEqual([t, 0]);
    }
    const au = (await db.prepare("SELECT name, type FROM pragma_table_info('drill_audio')").all<{ name: string; type: string }>()).results;
    expect(au!.map((c) => [c.name, c.type])).toEqual([['item', 'TEXT'], ['mp3', 'BLOB'], ['at', 'INTEGER']]);
    const rv = (await db.prepare("SELECT name, type FROM pragma_table_info('drill_review')").all<{ name: string; type: string }>()).results;
    expect(rv!.map((c) => [c.name, c.type])).toEqual([['scene', 'INTEGER'], ['due_at', 'INTEGER'], ['mode', 'TEXT']]);
  });
});

// ======================================================================
describe('14. 页面：音标 / 词意 / 发音 / 复考都在，一个输入框都没加', () => {
  it('揭晓那一块里：音标、字面意思、什么场合用各占一行，**空的那一行整行不显示**（dLine）', () => {
    expect(DRILL_JS).toContain("function dLine(id,s)");
    expect(DRILL_JS).toContain("e.hidden=!t;");
    for (const id of ['dr-ipa', 'dr-zimian', 'dr-use']) expect([id, DRILL_JS.includes("dLine('" + id + "'")]).toEqual([id, true]);
    // 页面自己不造占位词（内容是 null 就整行不显示；"这一项也没有音标"是发音失败时的实话，不是占位词）
    for (const w of ['暂无', '待补', '待定', 'N/A']) expect([w, DRILL_MOD.includes(w) || DRILL_JS.includes(w)]).toEqual([w, false]);
  });

  it('两个发音按钮：🔊 正常速 + 🐢 慢速 0.7 倍，**同一段音频**（慢速只是 playbackRate=0.7，不额外生成）', () => {
    expect(DRILL_MOD).toContain('id="dr-say">🔊 正常速</button>');
    expect(DRILL_MOD).toContain('id="dr-slow">🐢 慢速 0.7 倍</button>');
    expect(DRILL_JS).toContain("dAudio(DR.cur&&DR.cur['发音'],0.7,'ans')");
    expect(DRILL_JS).toContain('a.playbackRate=rate');
    // 同一段在生成中被连点（🔊 之后马上点 🐢）不许再发一个请求 —— 否则会再调一次 melotts、再记一次账
    // （2026-11-10 审查 🟡2）。auBusy 是那道闸。
    expect(DRILL_JS).toContain('if(DR.auBusy[id]){return;}');
    expect(DRILL_JS).toContain('DR.auBusy[id]=1;');
    expect(DRILL_JS).toContain('auBusy:{}');
    // 成功和失败两条路都要把闸放开，否则这一段再也点不响
    const da = DRILL_JS.slice(DRILL_JS.indexOf('function dAudio'), DRILL_JS.indexOf('/* ---- 画一遍'));
    expect([...da.matchAll(/done\(\);/g)].length).toBeGreaterThanOrEqual(3);
    // 两个按钮都在 .dr-two 里（和「会了 / 不会」同一条 ≥56px 的规则）
    expect(DRILL_MOD).toContain('<div class="dr-two dr-au" id="dr-au">');
    // 第三段还能单独听「对方那句」
    expect(DRILL_JS).toContain("dAudio(DR.cur&&DR.cur['对方发音'],1,'pr')");
  });

  it('复考到期当天，小结页的「明天再考我这 18 项」要藏起来（否则一点就把今天的复考推到明天）', () => {
    // 到期那天小结页照旧显示，里面那个按钮一点就无条件 due_at = now + 1 天，没有任何确认，
    // 今天该做的复考被悄悄取消（2026-11-10 审查 🟡3）。到期时只留顶上的「开始复考」。
    expect(DRILL_MOD).toContain('<div class="dr-one" id="dr-planwrap">');
    expect(DRILL_JS).toContain("dShow('dr-planwrap',!s['到期了']);");
  });

  it('发音生成不出来：当面说「发音这次没生成出来」+ 服务器那两句话，**不自动重试**', () => {
    // 文案要分清是哪一段没生成出来：原来不管点哪个按钮都说「下面只有音标」，
    // 可「对方那句」根本没有音标，而且音标在按钮**上面**，「下面」还是反的（2026-11-10 审查 🔴1b）。
    expect(DRILL_JS).toContain("which==='pr'?'对方那句的发音':'这一项的发音'");
    expect(DRILL_JS).toContain("'没生成出来，'");
    expect(DRILL_JS).toContain("先看上面的音标。");
    expect(DRILL_JS).toContain("这一次先跳过发音。");
    expect(DRILL_JS).toContain("怎么办：");
    // 三个按钮都要把自己是哪一段传进去，否则上面那句分不清
    expect(DRILL_JS).toContain("dAudio(DR.cur&&DR.cur['发音'],1,'ans')");
    expect(DRILL_JS).toContain("dAudio(DR.cur&&DR.cur['对方发音'],1,'pr')");
    // dAudio 里没有任何重试 / 定时器（不做重试风暴）
    const au = DRILL_JS.slice(DRILL_JS.indexOf('function dAudio'), DRILL_JS.indexOf('/* ---- 画一遍'));
    for (const w of ['setTimeout', 'setInterval', 'retry', '重试一次']) expect([w, au.includes(w)]).toEqual([w, false]);
  });

  it('复考：小结页一个大按钮「明天再考我这 18 项」，顶上一句话由服务端给、页面原样显示', () => {
    expect(DRILL_MOD).toContain('id="dr-plan">明天再考我这 18 项</button>');
    expect(DRILL_MOD).toContain('id="dr-go">现在就复考</button>');
    expect(DRILL_JS).toContain("dText('dr-rvline',s['一句话']||'')");
    expect(DRILL_JS).toContain("dText('dr-go',s['到期了']?'开始复考':'现在就复考')");
    // 复考时把关键点 / 音标 / 词意全藏起来（quiz=true），两个按钮改成「说得出来 / 说不出来」
    expect(DRILL_JS).toContain("dCard(DR.cur,true)");
    expect(DRILL_JS).toContain("dText('dr-yes','说得出来');dText('dr-no','说不出来')");
    // 复考时「看全部」藏起来（免得剧透）
    expect(DRILL_JS).toContain("dShow('dr-all',false)");
  });

  it('复考那一轮的进度不存库：页面上照实说「中途刷新会从头考」，不假装存着', () => {
    expect(DRILL_JS).toContain("dText('dr-rvhint',s['中途刷新']||'')");
    expect(DRILL_MOD).toContain('id="dr-rvhint"');
  });

  it('新加的这些东西里，还是一个输入框都没有、也没有命令行（底线 1、把用户当小白）', () => {
    for (const s of [DRILL_MOD, DRILL_JS, DRILL_CSS]) {
      for (const w of ['<input', 'input', '<textarea', 'contenteditable', 'TOKEN', 'API_KEY', 'PASSWORD', 'SECRET', 'npm ', 'curl ', 'wrangler ']) {
        expect([w, s.includes(w)]).toEqual([w, false]);
      }
    }
  });
});
