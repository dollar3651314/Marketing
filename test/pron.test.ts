/**
 * 工作台「发音训练」（src/pron.ts、src/pron-page.ts、migrations/0019_pron.sql）的测试。
 * 语音那条链路（src/en-audio.ts、en_audio 表、生成脚本）在 test/en-audio.test.ts，这里只测**页面怎么用它**。
 * 内容在 src/pron-content.ts（主会话从课件逐张抽的，**这个测试不许改那个文件，只读它**）。
 *
 * 守住十件事：
 *   1. **位置**：工作台二级菜单从 8 项变 **7 项**（去掉「英语练习」「带练」，加「发音训练」）；
 *      **上限还是 8**、**公共工具那 8 项一个都没动**（T-4：第 9 项会撑破手机菜单）。
 *   2. **四步循环**：跟我做（一次一句）→ 对照听（他自己点「我听出来了，开始考」才进考）→ 同一组连考 10 题
 *      （答错当场把对照听塞回来）→ 10 题对 8 题（80%）过关给绕口令 + 三最法。
 *      第 1 步的阶梯本身由 test/pron-lesson.test.ts 守（src/pron-lesson.ts）。
 *   3. **照实说，不硬凑**（底线 3）：第 7 组一对最小对立对都没有 → 没有听辨题、不给「开始考」按钮；
 *      第 4 组只有 1 对 → 说明里写明题会重复。
 *   4. **对错由服务端算**（页面不自己判）；一轮考完记一行 `pron_round`，过没过由 `passedRound` 算。
 *   5. **纠说**：措辞永远是「机器听成了什么」，**不许**出现"你念对了 / 念错了"；
 *      三种结果（命中目标 / 命中另一个 / 两个都不是）各记一笔 `pron_say`；
 *      `asr: false` 的词（ketch、reen、roose、rove）**不给纠说**。
 *   6. **两道额度闸**：Amos 自己设的 cap + 一天最多 200 次；失败**不自动重试**，按估算记一笔账。
 *   7. **发音是预先生成好的**（2026-11-13 改）：微软 Edge 的神经网络语音（英文 Sonia），
 *      页面按**内容哈希的键**去 `/api/en/audio/<键>` 取一段现成的 mp3，**运行时一次 AI 都不调**；
 *      库里没有就**当面照实说「还没生成」**，不回退去调 AI、不静默无声（底线 3）。
 *   8. **迁移只 CREATE**：0019 里只有三条 CREATE TABLE，没有 ALTER / DROP；**旧表一张都没删**
 *      （drill_item / drill_review / drill_audio / ear_pair / en_* 全在，他的历史数据还在）。
 *   9. **不让他打字**：整块里一个 `<input>` 都没有（录音按钮不是 input）；按钮 ≥52px；字号只用全站那几级。
 *  10. **不碰密钥**（底线 1）：whisper 走 env.AI 绑定，源码里不出现密钥变量名、不出现命令行。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import { ADMIN_PAGE } from '../src/admin-page';
import { PRON_CSS, PRON_JS, PRON_MOD } from '../src/pron-page';
import {
  ASR_MODEL, ASR_PER_MIN, asrNeurons, audioTextOf, canEar, earNote, groupCard, groupOf, groupStats, judgeSay, MAX_SAY_PER_DAY,
  normalize, PASS_RATE, passedRound, PRON_ASR_PURPOSE, PRON_PROJECT, PRON_WORD_IDS, ROUND_N, sayStats, wordId, wordOf, type RoundRow,
} from '../src/pron';
import { audioKey, AUDIO_REV, 英文声音, 中文声音, 指令文本 } from '../src/en-audio';
import { asrWordsOf, GROUPS, groupsForEar, minimalPairsOf } from '../src/pron-content';
import { LESSON, 级 } from '../src/pron-lesson';
import { PURPOSES } from '../src/usage';
import { ROOT, T0 } from './helpers';

const PASS = 'ci_only_copilot_password_01';
const HOST = 'https://copilot.example.test';
const MIG = path.join(ROOT, 'migrations');
const M0019 = '0019_pron.sql';
const migs = () => readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
const stmtsOf = (files: string[]) =>
  files.map((f) => readFileSync(path.join(MIG, f), 'utf8').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n'))
    .join(';\n').split(';').map((s) => s.trim()).filter(Boolean);

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
  await db.batch(['pron_round', 'pron_say', 'pron_audio', 'en_audio', 'en_audio_part', 'settings', 'ai_usage', 'model_usage', 'usage_by_project', 'usage_by_purpose', 'auth_fail', 'auth_lock'].map((t) => db.prepare(`DELETE FROM ${t}`)));
});

const env = (): Env => ({ DB: db, ENVIRONMENT: 'test', COPILOT_PASSWORD: PASS });
const req = (p: string, init: RequestInit & { cookie?: string } = {}) =>
  new Request(`${HOST}${p}`, { ...init, headers: { 'content-type': 'application/json', origin: HOST, 'cf-connecting-ip': '203.0.113.9', ...(init.cookie ? { cookie: init.cookie } : {}) } });
let ck = '';
beforeAll(async () => {
  const r = await handle(req('/api/login', { method: 'POST', body: JSON.stringify({ password: PASS }) }), env(), T0);
  ck = r.headers.get('set-cookie')!.split(';')[0];
});
const api = async (p: string, body?: unknown, e: Env = env(), now = T0) => {
  const r = await handle(req('/api/en/pron/' + p, body === undefined ? { cookie: ck } : { method: 'POST', cookie: ck, body: JSON.stringify(body) }), e, now);
  return { status: r.status, body: (await r.json()) as Record<string, any> };
};
/** 直接拿 Response（发音回的是 audio/mpeg，不是 JSON） */
const getRaw = (p: string, e: Env = env(), now = T0) => handle(req('/api/en/pron/' + p, { cookie: ck }), e, now);
/** 语音在 /api/en/audio/<键>（2026-11-13 起 S1 S2 共用这一条，不再挂在 /api/en/pron/ 下面） */
const getAudio = (key: string, e: Env = env(), now = T0) => handle(req('/api/en/audio/' + key, { cookie: ck }), e, now);

/** 假的 Workers AI：发音默认回 {audio: base64}（toMp3 两种都认），纠说回 whisper 那种 {text, transcription_info} */
const MP3 = Uint8Array.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x11, 0x22, 0x33]);
const b64 = (a: Uint8Array) => {
  let s = '';
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
  return btoa(s);
};
function fakeAi(fn?: (model: string, inp: Record<string, unknown>) => Promise<unknown>) {
  const calls: { model: string; inp: Record<string, unknown> }[] = [];
  const AI = {
    run: async (model: string, inp: unknown) => {
      calls.push({ model, inp: inp as Record<string, unknown> });
      if (fn) return await fn(model, inp as Record<string, unknown>);
      return model === ASR_MODEL ? { text: 'bad', transcription_info: { duration: 1.2 } } : { audio: b64(MP3) };
    },
  };
  return { calls, env: (): Env => ({ ...env(), AI }) };
}
const AUDIO_B64 = b64(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]));
/** g1（/e/ vs /æ/）第 1 对就是 bed / bad，两个词都能纠说 */
const G1 = GROUPS[0];
const BED = wordId(G1, 0, 'a');
const BAD = wordId(G1, 0, 'b');

// ======================================================================
describe('1. 位置：工作台二级菜单回到 6 项，发音训练挪进 Practical 项目页', () => {
  const SUB_WORK = ADMIN_PAGE.slice(ADMIN_PAGE.indexOf('id="sub-work"'), ADMIN_PAGE.indexOf('</nav>', ADMIN_PAGE.indexOf('id="sub-work"')));
  const SUB_TOOLS = ADMIN_PAGE.slice(ADMIN_PAGE.indexOf('id="sub-tools"'), ADMIN_PAGE.indexOf('</nav>', ADMIN_PAGE.indexOf('id="sub-tools"')));
  const SUB_PROJ = ADMIN_PAGE.slice(ADMIN_PAGE.indexOf('id="sub-project"'), ADMIN_PAGE.indexOf('</nav>', ADMIN_PAGE.indexOf('id="sub-project"')));

  it('工作台二级菜单正好 6 项，**里面再没有「发音训练」**；「英语练习」「它记得住你」「带练」也都不在了', () => {
    const mods = [...SUB_WORK.matchAll(/data-s="(w-[a-z]+)"/g)].map((m) => m[1]);
    expect(mods).toEqual(['w-now', 'w-todo', 'w-live', 'w-proj', 'w-num', 'w-meet']);
    expect(SUB_WORK).not.toContain('w-pron');
    expect(SUB_WORK).not.toContain('#/work/pron');
    expect(SUB_WORK).not.toContain('发音训练');
    // 上限就是 8（T-4）：现在 6 项
    expect(mods.length).toBeLessThanOrEqual(8);
    for (const gone of ['w-english', 'w-engmem', 'w-drill', '英语练习', '带练']) expect([gone, SUB_WORK.includes(gone)]).toEqual([gone, false]);
  });

  it('公共工具菜单一个字没动：还是 8 项，没有「发音训练」（T-4）', () => {
    expect(SUB_TOOLS.match(/data-s="t-/g) ?? []).toHaveLength(8);
    expect(SUB_TOOLS).not.toContain('发音训练');
    expect(SUB_TOOLS).not.toContain('w-pron');
  });

  it('模块本体在**项目页** #v-project 里，只有一个，排在「交接记录」后面（菜单顺序 = 页面顺序）', () => {
    const vproj = ADMIN_PAGE.slice(ADMIN_PAGE.indexOf('id="v-project"'), ADMIN_PAGE.indexOf('id="v-tools"'));
    const vwork = ADMIN_PAGE.slice(ADMIN_PAGE.indexOf('id="v-work"'), ADMIN_PAGE.indexOf('id="v-project"'));
    expect(vproj).toContain('id="f-pron"');
    expect(ADMIN_PAGE.match(/id="f-pron"/g) ?? []).toHaveLength(1);
    expect(vproj.indexOf('id="f-pron"')).toBeGreaterThan(vproj.indexOf('id="f-handoff"'));
    // 工作台那一份彻底没了（不是两份并存）
    expect(vwork).not.toContain('pn-pick');
    expect(ADMIN_PAGE).not.toContain('id="w-pron"');
    // 子菜单上那一项挂在项目页，而且**默认 hidden**（只有 Practical 这个项目上才打开，setProject() 管）
    expect(SUB_PROJ).toContain('data-s="f-pron" data-m="pron" hidden');
    expect(SUB_PROJ).toContain('data-s="f-s2" data-m="s2" hidden');
    // 下线的那三块一个都不在页面上了
    for (const gone of ['id="w-english"', 'id="w-engmem"', 'id="w-drill"', 'id="dr-ear"']) expect([gone, ADMIN_PAGE.includes(gone)]).toEqual([gone, false]);
  });

  it('进 **Practical 项目页**时读一次记录（route() 里调 window.pronOpen），接口前缀是 /api/en/pron/；换到别的项目先 pronStop()', () => {
    expect(ADMIN_PAGE).toContain("if(page==='project'&&proj===EN_PROJ){try{window.pronOpen();}catch(e){}");
    expect(ADMIN_PAGE).toContain("window.__pronBase='/api/en/pron/'");
    // 离开项目页、换到别的项目：两条路都要关摄像头（藏起来的 DOM 里摄像头照亮，指示灯不灭）
    expect(ADMIN_PAGE).toContain("if(page!=='project'&&typeof window.pronStop==='function')window.pronStop();");
    expect(ADMIN_PAGE).toContain("if(!en&&typeof window.pronStop==='function')window.pronStop();");
    expect(ADMIN_PAGE).toContain("const EN_PROJ='Practical'");
    expect(ADMIN_PAGE).not.toContain('__drillBase');
    expect(ADMIN_PAGE).not.toContain('__engmemBase');
  });

  it('下线的那三块：源文件删干净了（T-3：文件直接删，不留注释掉的代码）', () => {
    for (const f of ['src/english-page.ts', 'src/english-memory.ts', 'src/english-memory-page.ts', 'src/drill.ts', 'src/drill-content.ts',
      'src/drill-page.ts', 'src/drill-review.ts', 'src/drill-audio.ts', 'src/ear.ts', 'src/ear-content.ts', 'src/ear-page.ts'])
      expect([f, existsSync(path.join(ROOT, f))]).toEqual([f, false]);
  });

  it('「最该做的事」没事做时那个按钮指向发音训练的新家 #/Practical/pron，而且 Practical 不在名单里时不给这个按钮（不留死链）', () => {
    expect(ADMIN_PAGE).toContain("link('趁空练 10 分钟发音 →','#/Practical/pron','btn big ghost')");
    expect(ADMIN_PAGE).toContain("typeof PROJS!=='undefined'&&PROJS.indexOf('Practical')>=0");
    expect(ADMIN_PAGE).not.toContain('#/work/english');
    expect(ADMIN_PAGE).not.toContain('#/work/pron');
  });
});

// ======================================================================
describe('2. 四步循环：跟我做 → 对照听 → 同一组连考 10 题 → 80% 过关给绕口令', () => {
  it('结构上就是四步，四块各一个，默认停在第 1 步（跟我做）', () => {
    for (const id of ['pn-s1', 'pn-s2', 'pn-s3', 'pn-s4']) expect([id, PRON_MOD.includes('id="' + id + '"')]).toEqual([id, true]);
    expect(PRON_MOD).toMatch(/<div id="pn-s2" hidden>/);
    expect(PRON_MOD).toMatch(/<div id="pn-s3" hidden>/);
    expect(PRON_MOD).toMatch(/<div id="pn-s4" hidden>/);
    expect(PRON_MOD).not.toMatch(/<div id="pn-s1" hidden>/);
    // 2026-11-12：第 1 步从「看口型」（一张参考卡）改成「跟我做」（一次一句），标题跟着改
    expect(PRON_MOD).toContain('1 跟我做');
    expect(PRON_MOD).not.toContain('1 看口型');
    expect(PRON_MOD).toContain('2 对照听');
    expect(PRON_MOD).toContain('3 考 10 题');
    expect(PRON_MOD).toContain('4 过关');
  });

  // 2026-11-12 主会话复核时发现的一类洞：口型图整套撤掉了，可是**出错时弹给他看的那些话**
  // 还在把他指回那块屏幕（"上面的 X、对照听和考题照常能用""今天先 X 和音标""回第 1 步再 X 一遍"，X 就是那四个字）。
  // 一共 11 处，分散在 pron.ts / pron-page.ts / en-audio.ts 的错误分支里 ——
  // 全都只在录音失败、额度用完、没给权限、考砸了的时候才出现，**正是他最需要一句能照做的话的时候**，
  // 结果指着一块已经不存在的屏幕。钉一条结构性的：源码里（注释除外）不许再出现这四个字。
  it('撤掉的功能不许在任何一句出错提示里复活：源码里不留"看口型"（注释除外）', () => {
    const 去注释 = (t: string) =>
      t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    for (const f of ['pron.ts', 'pron-page.ts', 'en-audio.ts', 'pron-content.ts', 'pron-lesson.ts']) {
      const p = path.join(__dirname, '..', 'src', f);
      if (!existsSync(p)) continue;
      const 命中 = 去注释(readFileSync(p, 'utf8')).split('\n')
        .map((l, i) => [i + 1, l] as const).filter(([, l]) => l.includes('看口型'));
      expect([f, 命中]).toEqual([f, []]);
    }
  });

  it('第 1 步不考：接口照样把课件原文的外号和口型定位给页面（内容没被砍掉，只是不再一屏摊开）', () => {
    const c = groupCard(G1) as Record<string, any>;
    expect(c.a).toEqual({ 音标: '/e/', 外号: '中咧嘴', 口型: ['咧嘴', '上下齿距离为 1cm 左右（可容纳一根食指）', '舌头平躺抵下齿'] });
    expect(c.b.外号).toBe('大咧嘴');
    // 口型示意图整套撤掉了（Amos 2026-11-12：「口型图撤掉」）：接口不再给「口型图」，页面也不再画 SVG
    expect(c['口型图']).toBeUndefined();
    for (const w of ['pDrawAll', 'pFront', 'pSide', 'createElementNS', 'pn-draw', 'pn-anim', '来回切换'])
      expect([w, PRON_JS.includes(w)]).toEqual([w, false]);
    expect(existsSync(path.join(ROOT, 'src/pron-mouth.ts'))).toBe(false);
    // 第 1 步里没有判对错的东西
    const s1 = PRON_MOD.slice(PRON_MOD.indexOf('<div id="pn-s1">'), PRON_MOD.indexOf('<div id="pn-s2"'));
    for (const w of ['对了', '不对', '两个听着一样']) expect([w, s1.includes(w)]).toEqual([w, false]);
  });

  it('第 2 步不考，而且**他自己点「我听出来了，开始考」才进第 3 步**（不会自己跳过去）', () => {
    expect(PRON_MOD).toContain('id="pn-go3">我听出来了，开始考</button>');
    expect(PRON_JS).toContain("var g3=pq('pn-go3');if(g3)g3.addEventListener('click',pRound);");
    // 第 2 步的对照听：两个词各一个按钮，**想点几次点几次**（没有次数限制、没有计数）
    expect(PRON_JS).toContain("b.textContent='🔊 '+p[k]['词'];");
    const cmp = PRON_JS.slice(PRON_JS.indexOf('function pCmp'), PRON_JS.indexOf('function pSayWords'));
    for (const w of ['pRound(', '只能点', 'disabled']) expect([w, cmp.includes(w)]).toEqual([w, false]);
  });

  it('第 3 步：一轮 10 题，**只在这一组里出题**，不够 10 对就重复抽（放哪个词、左右位置都随机）', () => {
    expect(ROUND_N).toBe(10);
    const round = PRON_JS.slice(PRON_JS.indexOf('function pRound'), PRON_JS.indexOf('function pQ'));
    expect(round).toContain("var minimal=(PN.cur['对']||[]).filter(function(p){return p['最小对立对']});");
    expect(round).toContain('while(list.length<10)');
    expect(round).toContain('say:pCoin(),left:pCoin()');
    // 题目来自 PN.cur 这一组，**没有**换别的组的代码
    expect(round).not.toContain('PN.zu');
  });

  it('第 3 步答错：**当场把第 2 步的对照听塞回来**，两个词都能点，点「继续」才出下一题', () => {
    expect(PRON_MOD).toContain('id="pn-back"');
    expect(PRON_MOD).toContain('id="pn-wa"');
    expect(PRON_MOD).toContain('id="pn-wb"');
    expect(PRON_MOD).toContain('id="pn-next">继续</button>');
    expect(PRON_JS).toContain("var back=!j['对'];");
    expect(PRON_JS).toContain("pShow('pn-back',back);");
    expect(PRON_JS).toContain("pText('pn-wa','🔊 '+x.p.a['词']);");
    // 「继续」才换下一题（pNext 里才 PN.i++）
    expect(PRON_JS).toContain('function pNext(){\n  PN.i++;');
    expect(PRON_JS).toContain("var nx=pq('pn-next');if(nx)nx.addEventListener('click',pNext);");
  });

  it('「两个听着一样」那个按钮和它的全部语义都留着（它是唯一能把"他分不出"和"机器没念出来"分开的办法）', () => {
    expect(PRON_MOD).toContain('id="pn-same">两个听着一样</button>');
    expect(PRON_JS).toContain("bs.addEventListener('click',function(){pAnswer('same')})");
    expect(PRON_JS).toContain('PN.same++');
    expect(PRON_JS).toContain('机器没念出来');
  });

  it('第 4 步：80% 才算过（10 题对 8 题），过了才给绕口令 + 三最法', () => {
    expect(PASS_RATE).toBe(0.8);
    expect(passedRound(10, 8)).toBe(true);
    expect(passedRound(10, 7)).toBe(false);
    expect(passedRound(10, 10)).toBe(true);
    expect(passedRound(0, 0)).toBe(false);
    expect(PRON_MOD).toContain('绕口令挑战');
    expect(PRON_JS).toContain("pShow('pn-twwrap',!!j['绕口令']);");
  });
});

// ======================================================================
describe('3. 照实说，不硬凑题（底线 3）', () => {
  it('第 7 组（/ʒ/ vs /dʒ/）一对最小对立对都没有：没有听辨题，页面上照实说', () => {
    const g7 = GROUPS[6];
    expect(g7.id).toBe('g7');
    expect(minimalPairsOf(g7)).toEqual([]);
    expect(canEar(g7)).toBe(false);
    expect(groupsForEar().map((g) => g.id)).toEqual(['g1', 'g2', 'g3', 'g4', 'g5', 'g6']);
    expect(earNote(g7)).toContain('一对最小对立对都没有');
    expect(earNote(g7)).toContain('只能走「跟我做」、跟读和纠说');
    // 页面：这一组**不给「开始考」这个按钮**
    expect(PRON_JS).toContain("pShow('pn-go3wrap',!!PN.cur['能听辨']);");
    // 服务端也拦：这一组报不上来一轮成绩
    expect(PRON_JS).toContain("if(!PN.cur||!PN.cur['能听辨'])return;");
  });

  it('第 4 组只有 1 对最小对立对：说明里写明 10 题会一直考这一对', () => {
    const g4 = GROUPS[3];
    expect(minimalPairsOf(g4).map((p) => p.a.word + '/' + p.b.word)).toEqual(['ferry/very']);
    expect(earNote(g4)).toContain('只有 1 对最小对立对');
    expect(earNote(g4)).toContain('10 题会一直考这一对');
  });

  it('有 4 对的组照实说"同一对会考到好几次"（10 题 > 4 对，不装作每题都是新的）', () => {
    expect(earNote(G1)).toContain('4 对最小对立对');
    expect(earNote(G1)).toContain('同一对会考到好几次');
  });

  it('出题只从**真正的最小对立对**里挑：非最小对立对报上来一律 400（不是最小对立对就不是辨音题）', async () => {
    // g2 第 3 对 change / cheese 差不止一个音（minimal: false）
    const r = await api('answer', { 组: 'g2', 第几对: 3, 放的: 'a', 选的: 'a' });
    expect(r.status).toBe(400);
    expect(r.body.出错).toContain('不是最小对立对');
  });

  it('第 7 组报一轮成绩 → 409（它根本没有听辨题，不该有成绩）', async () => {
    const r = await api('round', { 组: 'g7', 考了: 10, 对: 10, 两个听着一样: 0 });
    expect(r.status).toBe(409);
    expect(r.body.出错).toContain('没有听辨题');
    expect((await db.prepare('SELECT COUNT(*) AS n FROM pron_round').first<{ n: number }>())?.n).toBe(0);
  });
});

// ======================================================================
describe('4. 接口：对错由服务端算，一轮记一行', () => {
  it('GET state：七组都给（口型、对比词、能不能听辨、绕口令），记录一开始全是 0', async () => {
    const r = await api('state');
    expect(r.status).toBe(200);
    expect(r.body.一共几组).toBe(7);
    expect(r.body.一轮几题).toBe(10);
    expect(r.body.及格线).toBe('10 题对 8 题（80%）');
    expect((r.body.组 as any[]).map((z) => z.组)).toEqual(['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7']);
    expect((r.body.组 as any[])[0].绕口令).toBe('Ann sent Andy ten hens and Andy sent Ann ten pens.');
    expect((r.body.记录 as any[]).every((x) => x.考过几轮 === 0 && x.最近一轮 === null)).toBe(true);
    expect(r.body.纠说.今天已经纠了几次).toBe(0);
    expect(r.body.纠说.一天最多).toBe(MAX_SAY_PER_DAY);
  });

  it('state 里**写明旧的那两块去哪了**，并说清楚历史数据还在库里没删（底线 9）', async () => {
    const r = await api('state');
    const t = String(r.body.旧的去哪了);
    expect(t).toContain('「英语练习」和「带练」');
    expect(t).toContain('已经去掉');
    expect(t).toContain('历史数据还在库里没删');
    // 页面把这句话**原样**显示在顶上的折叠说明里
    expect(PRON_MOD).toContain('id="pn-old-t"');
    expect(PRON_JS).toContain("pText('pn-old-t',j['旧的去哪了']||'');");
  });

  it('一题的对错由服务端算：选对 / 选错 / 点「两个听着一样」，三种各自的回答', async () => {
    const ok = await api('answer', { 组: 'g1', 第几对: 1, 放的: 'b', 选的: 'b' });
    expect(ok.status).toBe(200);
    expect([ok.body.对, ok.body.两个听着一样, ok.body.放的是.词, ok.body.先对照听]).toEqual([true, false, 'bad', false]);
    const no = await api('answer', { 组: 'g1', 第几对: 1, 放的: 'b', 选的: 'a' });
    expect([no.body.对, no.body.你选的, no.body.放的是.词, no.body.先对照听]).toEqual([false, 'bed', 'bad', true]);
    const same = await api('answer', { 组: 'g1', 第几对: 1, 放的: 'a', 选的: 'same' });
    expect([same.body.对, same.body.两个听着一样, same.body.你选的, same.body.先对照听]).toEqual([false, true, null, true]);
    // 一题一题不进库：一轮考完才记一行
    expect((await db.prepare('SELECT COUNT(*) AS n FROM pron_round').first<{ n: number }>())?.n).toBe(0);
  });

  it('答题的入参不对一律两句话、不进库：组号不认识 / 没说放的是哪个 / 没说选了哪个', async () => {
    for (const body of [{ 组: 'g9', 第几对: 1, 放的: 'a', 选的: 'a' }, { 组: 'g1', 第几对: 9, 放的: 'a', 选的: 'a' },
      { 组: 'g1', 第几对: 1, 选的: 'a' }, { 组: 'g1', 第几对: 1, 放的: 'a' }]) {
      const r = await api('answer', body);
      expect([JSON.stringify(body), r.status]).toEqual([JSON.stringify(body), 400]);
      expect(r.body.出错).toBeTruthy();
      expect(r.body.怎么办).toBeTruthy();
    }
  });

  it('一轮考完记一行：10 题对 8 题过关、给绕口令 + 三最法；对 7 题不过、不给绕口令', async () => {
    const pass = await api('round', { 组: 'g1', 考了: 10, 对: 8, 两个听着一样: 1 });
    expect(pass.status).toBe(200);
    expect(pass.body.过关).toBe(true);
    expect(pass.body.绕口令).toBe('Ann sent Andy ten hens and Andy sent Ann ten pens.');
    expect(pass.body.怎么读).toBe('用三最法读 —— 最大声、最清晰、最慢速，直到没有任何发音错误。');
    const fail = await api('round', { 组: 'g1', 考了: 10, 对: 7, 两个听着一样: 0 }, env(), T0 + 1000);
    expect(fail.body.过关).toBe(false);
    expect(fail.body.绕口令).toBeNull();
    expect(fail.body.一句话).toContain('差 1 题');
    const rows = await db.prepare('SELECT grp, asked, ok, same, passed FROM pron_round ORDER BY at').all<RoundRow>();
    expect(rows.results).toEqual([{ grp: 'g1', asked: 10, ok: 8, same: 1, passed: 1 }, { grp: 'g1', asked: 10, ok: 7, same: 0, passed: 0 }]);
  });

  it('一轮的成绩不合法 → 400，这一轮不记：题数不是 10 / 对的比考的多 / 不是整数', async () => {
    for (const body of [{ 组: 'g1', 考了: 9, 对: 9, 两个听着一样: 0 }, { 组: 'g1', 考了: 10, 对: 9, 两个听着一样: 2 },
      { 组: 'g1', 考了: 10, 对: 1.5, 两个听着一样: 0 }, { 组: 'g1', 考了: 10, 对: -1, 两个听着一样: 0 }, { 组: 'g1', 考了: 10 }]) {
      const r = await api('round', body);
      expect([JSON.stringify(body), r.status]).toEqual([JSON.stringify(body), 400]);
    }
    expect((await db.prepare('SELECT COUNT(*) AS n FROM pron_round').first<{ n: number }>())?.n).toBe(0);
  });

  it('记录按组分开算（考过几轮 / 过关几轮 / 最近一轮），**不合成一个"正确率"**', () => {
    const rows: RoundRow[] = [
      { grp: 'g1', at: 1, asked: 10, ok: 5, same: 2, passed: 0 },
      { grp: 'g1', at: 2, asked: 10, ok: 9, same: 0, passed: 1 },
      { grp: 'g3', at: 3, asked: 10, ok: 8, same: 1, passed: 1 },
    ];
    const st = groupStats(rows) as Record<string, any>[];
    expect(st.find((x) => x.组 === 'g1')).toMatchObject({ 考过几轮: 2, 过关几轮: 1, 最近一轮: { 考了: 10, 对: 9, 两个听着一样: 0, 过关: true } });
    expect(st.find((x) => x.组 === 'g2')).toMatchObject({ 考过几轮: 0, 过关几轮: 0, 最近一轮: null });
    expect(st.map((x) => x.组)).toEqual(['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7']);
    expect(JSON.stringify(st)).not.toContain('正确率');
  });

  it('没登录一律 401（和后台别的接口一样）', async () => {
    for (const p of ['state', 'answer', 'round', 'say']) {
      const r = await handle(req('/api/en/pron/' + p, { method: p === 'state' ? 'GET' : 'POST', body: p === 'state' ? undefined : '{}' }), env(), T0);
      expect([p, r.status]).toEqual([p, 401]);
    }
  });

  it('不认识的路径回 404（不会悄悄落到别的接口上）', async () => {
    const r = await handle(req('/api/en/pron/whatever', { cookie: ck }), env(), T0);
    expect(r.status).toBe(404);
  });
});

// ======================================================================
describe('5. 纠说：只说「机器听成了什么」，不说"你念对了"（底线 3、9）', () => {
  it('三种结果的措辞：命中目标 / 命中另一个 / 两个都不是，**一句都不许写成"你念对了 / 念错了"**', () => {
    expect(judgeSay('bad', 'bad', 'bed')).toEqual({ hit: 1, 一句话: '✅ 机器听成了 bad —— 对了' });
    expect(judgeSay('Bed.', 'bad', 'bed')).toEqual({ hit: 0, 一句话: '❌ 机器听成了 bed' });
    expect(judgeSay('bat', 'bad', 'bed')).toEqual({ hit: -1, 一句话: '🟡 机器听成了「bat」，两个都不是' });
    expect(judgeSay('', 'bad', 'bed')).toEqual({ hit: -1, 一句话: '🟡 机器听成了「（一个字都没听出来）」，两个都不是' });
    for (const 不许 of ['你念对了', '你念错了', '念对', '念错']) {
      for (const s of [judgeSay('bad', 'bad', 'bed').一句话, judgeSay('bed', 'bad', 'bed').一句话, judgeSay('bat', 'bad', 'bed').一句话])
        expect([不许, s.includes(不许)]).toEqual([不许, false]);
    }
  });

  it('比之前先去掉大小写、标点和首尾空白', () => {
    expect(normalize('  BAD! ')).toBe('bad');
    expect(normalize('Bed,')).toBe('bed');
    expect(normalize("I'm")).toBe("i'm");
  });

  it('源码里写明"这是线索不是判决"，页面也原样显示（语音识别对口音稳健，它认出来不等于你念对）', async () => {
    const src = readFileSync(path.join(ROOT, 'src/pron.ts'), 'utf8');
    expect(src).toContain('它听成什么是线索，不是判决');
    expect(PRON_MOD).toContain('它听成什么是线索，不是判决');
    const f = fakeAi();
    const r = await api('say', { 组: 'g1', 词: BAD, audio: AUDIO_B64, seconds: 1 }, f.env());
    expect(r.body.这是线索不是判决).toContain('线索，不是判决');
  });

  it('念一个词：调一次 whisper-large-v3-turbo（base64 + language: en），记一行 pron_say，并把听成的原样回来', async () => {
    const f = fakeAi();
    const r = await api('say', { 组: 'g1', 词: BAD, audio: AUDIO_B64, seconds: 1 }, f.env());
    expect(r.status).toBe(200);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].model).toBe('@cf/openai/whisper-large-v3-turbo');
    expect(f.calls[0].inp).toEqual({ audio: AUDIO_B64, task: 'transcribe', language: 'en' });
    expect(r.body).toMatchObject({ 词: 'bad', 另一个词: 'bed', 机器听成了: 'bad', 判定: 1, 一句话: '✅ 机器听成了 bad —— 对了' });
    expect(r.body.秒数来源).toBe('模型回的真实音频时长');
    const row = await db.prepare('SELECT grp, target, heard, hit FROM pron_say').first<Record<string, unknown>>();
    expect(row).toEqual({ grp: 'g1', target: 'bad', heard: 'bad', hit: 1 });
  });

  it('机器听成另一个词 / 两个都不是：hit 记成 0 / -1，**原样存**它听到的那串字', async () => {
    const f1 = fakeAi(async () => ({ text: 'bed' }));
    const a = await api('say', { 组: 'g1', 词: BAD, audio: AUDIO_B64, seconds: 1 }, f1.env());
    expect([a.body.判定, a.body.一句话]).toEqual([0, '❌ 机器听成了 bed']);
    const f2 = fakeAi(async () => ({ text: 'Bat!' }));
    const b = await api('say', { 组: 'g1', 词: BAD, audio: AUDIO_B64, seconds: 1 }, f2.env(), T0 + 1000);
    expect([b.body.判定, b.body.机器听成了]).toEqual([-1, 'Bat!']);
    const rows = await db.prepare('SELECT heard, hit FROM pron_say ORDER BY at').all<{ heard: string; hit: number }>();
    expect(rows.results).toEqual([{ heard: 'bed', hit: 0 }, { heard: 'Bat!', hit: -1 }]);
    expect(sayStats([{ grp: 'g1', target: 'bad', heard: 'bed', hit: 0, at: 1 }, { grp: 'g1', target: 'bad', heard: 'x', hit: -1, at: 2 }]))
      .toEqual({ 一共: 2, 听成目标词: 0, 听成另一个: 1, 两个都不是: 1 });
  });

  it('**只有 asr: true 的词能纠说**：ketch / reen / roose / rove 一律 400 并说清楚为什么', async () => {
    const 不能 = GROUPS.flatMap((g) => g.pairs.flatMap((p, i) => (['a', 'b'] as const).filter((k) => !p[k].asr).map((k) => ({ id: wordId(g, i, k), word: p[k].word, g: g.id }))));
    expect(不能.map((x) => x.word).sort()).toEqual(['ketch', 'reen', 'rook', 'roose', 'rove']);
    for (const x of 不能) {
      const f = fakeAi();
      const r = await api('say', { 组: x.g, 词: x.id, audio: AUDIO_B64, seconds: 1 }, f.env());
      expect([x.word, r.status]).toEqual([x.word, 400]);
      expect(r.body.出错).toContain('不能拿来纠说');
      expect(r.body.怎么办).toContain('不是现代常用词');
      expect(f.calls).toEqual([]); // 一次模型都不调
    }
    // 能纠说的词：第 1 组是 bed / bad / pet / pat / catch / leather / ladder（ketch 除外）
    expect(asrWordsOf(G1).map((w) => w.word)).toEqual(['bed', 'bad', 'pet', 'pat', 'catch', 'leather', 'ladder']);
  });

  it('没绑 Workers AI → 503 两句话，并且**说明其余部分照常能用**（纠说是加分项，不是前置条件）', async () => {
    const r = await api('say', { 组: 'g1', 词: BAD, audio: AUDIO_B64, seconds: 1 });
    expect(r.status).toBe(503);
    expect(r.body.出错).toContain('没有绑 Workers AI');
    expect(r.body.怎么办).toContain('照常能用');
    expect((await db.prepare('SELECT COUNT(*) AS n FROM pron_say').first<{ n: number }>())?.n).toBe(0);
  });

  it('没录音 / 不是 base64 / 太大：各自两句话，**一次模型都不调**', async () => {
    for (const body of [{ 组: 'g1', 词: BAD }, { 组: 'g1', 词: BAD, audio: '不是 base64 ###' }, { 组: 'g1', 词: BAD, audio: b64(new Uint8Array(2_000_001)) }]) {
      const f = fakeAi();
      const r = await api('say', body, f.env());
      expect([Object.keys(body).length, r.status >= 400 && r.status < 500]).toEqual([Object.keys(body).length, true]);
      expect(r.body.怎么办).toBeTruthy();
      expect(f.calls).toEqual([]);
    }
  });

  it('模型出错 → 502 两句话、按估算记一笔账、库里不留半截；**不自动重试**', async () => {
    const f = fakeAi(async () => { throw new Error('whisper 挂了'); });
    const r = await api('say', { 组: 'g1', 词: BAD, audio: AUDIO_B64, seconds: 1 }, f.env());
    expect(r.status).toBe(502);
    expect(r.body.出错).toContain('whisper 挂了');
    expect(r.body.怎么办).toContain('不会自动重试');
    expect(f.calls).toHaveLength(1); // 只调了一次，没有重试
    expect((await db.prepare('SELECT COUNT(*) AS n FROM pron_say').first<{ n: number }>())?.n).toBe(0);
    const u = await db.prepare('SELECT neurons FROM ai_usage').first<{ neurons: number }>();
    expect(u?.neurons).toBeCloseTo(asrNeurons(1), 5);
    // 页面也不重试：没有 setTimeout 再发一次的代码
    expect(PRON_JS).not.toContain('setTimeout(pSayGo');
  });

  it('两道额度闸：① 他自己设的 cap 不够 → 429，一次模型都不调；② 一天最多 200 次', async () => {
    await db.prepare("INSERT INTO ai_usage (day, neurons) VALUES (?1, 99999) ON CONFLICT (day) DO UPDATE SET neurons = 99999").bind(new Date(T0).toISOString().slice(0, 10)).run();
    const f = fakeAi();
    const over = await api('say', { 组: 'g1', 词: BAD, audio: AUDIO_B64, seconds: 1 }, f.env());
    expect(over.status).toBe(429);
    expect(over.body.出错).toContain('额度不够');
    expect(f.calls).toEqual([]);
    await db.prepare('DELETE FROM ai_usage').run();
    // 一天 200 次那道闸
    expect(MAX_SAY_PER_DAY).toBe(200);
    await db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)').bind('pron_say:' + new Date(T0).toISOString().slice(0, 10), '200', T0).run();
    const f2 = fakeAi();
    const capped = await api('say', { 组: 'g1', 词: BAD, audio: AUDIO_B64, seconds: 1 }, f2.env());
    expect(capped.status).toBe(429);
    expect(capped.body.出错).toContain('一天最多 200 次');
    expect(f2.calls).toEqual([]);
  });

  it('次数在调模型**之前**就记上：中途失败也算一次（宁可多算，闸才守得住）', async () => {
    const f = fakeAi(async () => { throw new Error('断了'); });
    await api('say', { 组: 'g1', 词: BAD, audio: AUDIO_B64, seconds: 1 }, f.env());
    const r = await db.prepare('SELECT value FROM settings WHERE key = ?1').bind('pron_say:' + new Date(T0).toISOString().slice(0, 10)).first<{ value: string }>();
    expect(r?.value).toBe('1');
  });

  it('记账走已有那一本：用途 pron-asr、项目 pron，而且在用量页有中文名', async () => {
    const f = fakeAi();
    await api('say', { 组: 'g1', 词: BAD, audio: AUDIO_B64, seconds: 1 }, f.env());
    const byP = await db.prepare('SELECT purpose, neurons FROM usage_by_purpose').first<{ purpose: string; neurons: number }>();
    expect(byP?.purpose).toBe('pron-asr');
    expect(byP?.neurons).toBeCloseTo(asrNeurons(1.2), 5);
    const byProj = await db.prepare('SELECT project FROM usage_by_project').first<{ project: string }>();
    expect(byProj?.project).toBe('pron');
    expect(PRON_PROJECT).toBe('pron');
    expect(PRON_ASR_PURPOSE).toBe('pron-asr');
    expect(PURPOSES).toContain('pron-asr');
    expect(PURPOSES).toContain('pron-tts');
    // 带练下线了，但它的用途**留在名单里**：库里还有它记的账（底线 3：不改旧数据的名字）
    expect(PURPOSES).toContain('drill-tts');
  });

  it('一次纠说很便宜（46.63 neurons / 音频分钟 → 念一个词约 0.78），算术对得上', () => {
    expect(ASR_MODEL).toBe('@cf/openai/whisper-large-v3-turbo');
    expect(ASR_PER_MIN).toBe(46.63);
    expect(asrNeurons(1)).toBeCloseTo(0.777, 3);
    expect(asrNeurons(0)).toBe(0);
    // 200 次（一天的上限）加起来也不到 160 neurons，远不到免费额度 10,000
    expect(asrNeurons(1) * MAX_SAY_PER_DAY).toBeLessThan(200);
  });

  it('页面：没有麦克风权限 / 浏览器不支持 / 读不出录音，都**当面说**，而且说明其余部分照常能用', () => {
    expect(PRON_JS).toContain('这个浏览器不支持录音，纠说用不了');
    expect(PRON_JS).toContain('没拿到麦克风权限');
    expect(PRON_JS).toContain('上面的「跟我做」、对照听和考题照常能用');
    // 纠说那一块出错只写进它自己那条消息（#pn-saymsg），不影响第 1～3 步
    expect(PRON_MOD).toContain('id="pn-saymsg"');
    expect(PRON_JS).toContain("function pSayMsg(s){var m=pq('pn-saymsg');");
  });
});

// ======================================================================
describe('6. 发音：预先生成好的 mp3，页面只去取、运行时一次 AI 都不调（2026-11-13 换掉 aura-2-en）', () => {
  it('56 个词的编号：7 组 × 4 对 × 2，念的就是那个词本身，一个修饰词都不加', () => {
    expect(PRON_WORD_IDS).toHaveLength(56);
    expect(new Set(PRON_WORD_IDS).size).toBe(56);
    expect(PRON_WORD_IDS.slice(0, 4)).toEqual(['g1-1a', 'g1-1b', 'g1-2a', 'g1-2b']);
    expect(audioTextOf('g1-1a')).toBe('bed');
    expect(audioTextOf('g7-4b')).toBe('huge');
    expect(audioTextOf('不认识')).toBeNull();
    expect(wordOf('g1-1b')?.word.word).toBe('bad');
    expect(wordOf('g9-1a')).toBeNull();
  });

  it('接口给页面的「音键」= 这个词内容的哈希（Sonia 念的那一条），版本号是 e1', () => {
    const 卡 = groupCard(GROUPS[0]) as { 对: { a: { 词: string; 音键: string }; b: { 词: string; 音键: string } }[] };
    for (const 对 of 卡.对)
      for (const k of ['a', 'b'] as const) expect([对[k].词, 对[k].音键]).toEqual([对[k].词, audioKey(对[k].词, 英文声音)]);
    expect(AUDIO_REV).toBe('e1');
    expect(卡.对[0].a.音键).toBe('e1-9eeb44316ba59b1e');   // bed，钉死
  });

  it('库里有 → 回 audio/mpeg；**整条路一次 AI 都不调**（给了 env.AI 也一次没碰）', async () => {
    const k = audioKey('bed', 英文声音);
    // 2026-11-13：字节存在分块表 en_audio_part 里（迁移 0023，线上 SQLITE_TOOBIG），en_audio 只留元数据
    await db.prepare('INSERT INTO en_audio (k, voice, txt, mp3, bytes, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
      .bind(k, 英文声音, 'bed', new Uint8Array(0), MP3.byteLength, T0).run();
    await db.prepare('INSERT INTO en_audio_part (k, part, mp3) VALUES (?1, 0, ?2)').bind(k, MP3).run();
    const f = fakeAi();
    const r = await getAudio(k, f.env());
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('audio/mpeg');
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(MP3);
    expect(f.calls).toEqual([]);           // ← 原来这里会调一次 aura，现在一次都不调
    // 再取一次还是不调（原来靠"第一次生成、之后复用"才做到，现在是根本没有生成这条路）
    expect((await getAudio(k, f.env())).status).toBe(200);
    expect(f.calls).toEqual([]);
  });

  it('库里没有 → **404 照实说「还没生成」**，不回退去调 AI、库里也不留半截', async () => {
    const f = fakeAi();
    const k = audioKey('bad', 英文声音);
    const r = await getAudio(k, f.env());
    expect(r.status).toBe(404);
    const j = (await r.json()) as { 出错: string; 怎么办: string };
    expect(j.出错).toContain('还没生成');
    expect(j.怎么办).toBeTruthy();
    expect(f.calls).toEqual([]);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM en_audio').first<{ n: number }>())?.n).toBe(0);
  });

  it('键不像键 → 400；没登录一律 401', async () => {
    expect((await getAudio('不认识的编号')).status).toBe(400);
    const r = await handle(req('/api/en/audio/' + audioKey('bed', 英文声音)), env(), T0);
    expect(r.status).toBe(401);
  });

  it('旧的 /api/en/pron/audio/<编号> 整条去掉（不留兼容：只有 Amos 一个人用）', async () => {
    const r = await getRaw('audio/' + BED);
    expect(r.status).toBe(404);
  });

  it('页面：同一段只取一次、连点闸、失败当面说；**不再有「第一次要先生成」那句话**（已经没有生成这回事）', () => {
    expect(PRON_JS).toContain('if(PN.au[key]){pPlay(PN.au[key],msgId);return;}');
    expect(PRON_JS).toContain('if(PN.auBusy[key])return;');
    expect(PRON_JS).toContain('function pAuErr(j,msgId,什么)');
    expect(PRON_JS).toContain('还没生成，这一次先跳过声音');
    expect(PRON_JS).not.toContain('第一次要先生成这个词的发音');
    // 取的地址是语音那一条，不是发音训练自己的前缀
    expect(PRON_JS).toContain("auBase:(window.__enAudioBase||'/api/en/audio/')");
    expect(PRON_JS).toContain('fetch(PN.auBase+encodeURIComponent(key))');
  });

  it('来回点两个词对比不许蹦假错误：play() 的 AbortError 要忽略掉', () => {
    // 第 2 步「对照听」就是让他来回点两个词。后一次 play() 必然打断前一次，
    // 前一次的 promise 以 **AbortError** 被拒（"The play() request was interrupted by a new load request"）。
    // 2026-11-11 合进 staging 后 CI 就是这条红的，而且**本地也复现**——
    // 之前那次本地通过是侥幸。他照我们设计的动作做，反而会看到「浏览器把这次播放挡住了」。
    expect(PRON_JS).toContain("if(e&&e.name==='AbortError')return;");
    // catch 必须拿到 e 才判得了（写成 function(){...} 就又瞎报了）
    expect(PRON_JS).toContain('pr.catch(function(e){');
    expect(PRON_JS).not.toContain("pr.catch(function(){pAuErr(");
    // 真被拦住的那条路还在
    expect(PRON_JS).toContain("'出错':'浏览器把这次播放挡住了。'");
  });
});

// ======================================================================
describe('7. 迁移 0019 只 CREATE，一张旧表都没 DROP', () => {
  const sql = readFileSync(path.join(MIG, M0019), 'utf8');
  const code = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

  it('三条 CREATE TABLE（pron_round / pron_say / pron_audio），没有 ALTER / DROP / CREATE INDEX / 回填', () => {
    expect((code.match(/CREATE TABLE/g) ?? []).length).toBe(3);
    for (const t of ['pron_round', 'pron_say', 'pron_audio']) expect([t, code.includes('CREATE TABLE ' + t + ' (')]).toEqual([t, true]);
    for (const w of ['ALTER ', 'DROP ', 'CREATE INDEX', 'INSERT ', 'UPDATE ', 'DELETE ']) expect([w, code.toUpperCase().includes(w)]).toEqual([w, false]);
  });

  it('列就是任务书上那几列（pron_round / pron_say 一字不差）', () => {
    const cols = (t: string) => [...code.slice(code.indexOf('CREATE TABLE ' + t)).split(');')[0].matchAll(/^ {2}(\w+) /gm)].map((m) => m[1]);
    expect(cols('pron_round')).toEqual(['id', 'grp', 'at', 'asked', 'ok', 'same', 'passed']);
    expect(cols('pron_say')).toEqual(['id', 'grp', 'target', 'heard', 'hit', 'at']);
    expect(cols('pron_audio')).toEqual(['item', 'mp3', 'at']);
  });

  it('**旧表一张都没删**：下线的那几块的表还在库里（他的历史数据不能删）', async () => {
    const want = ['events', 'queue', 'en_word', 'en_sentence', 'en_round', 'drill_item', 'drill_audio', 'drill_review', 'ear_pair', 'fund_snapshot'];
    const r = await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${want.map((_, i) => '?' + (i + 1)).join(',')})`).bind(...want).all<{ name: string }>();
    expect((r.results ?? []).map((x) => x.name).sort()).toEqual([...want].sort());
    // 三张新表是空的
    for (const t of ['pron_round', 'pron_say', 'pron_audio'])
      expect([t, (await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())?.n]).toEqual([t, 0]);
  });

  it('旧的迁移文件一个都没删、编号连续（下线模块 ≠ 删迁移）', () => {
    const all = migs();
    expect(all.map((f) => Number(f.slice(0, 4)))).toEqual(all.map((_, i) => i + 1));
    for (const f of ['0012_english_memory.sql', '0013_drill.sql', '0014_drill_audio.sql', '0015_drill_review.sql', '0017_ear.sql'])
      expect([f, all.includes(f)]).toEqual([f, true]);
    // 基金观察第四版（2026-11-11）加了 0020_fund_valuation.sql：原来"最后一个是 0019"改成"第 19 个就是 0019_pron.sql"（编号连续上面已经守着），守的东西不变
    expect(all[18]).toBe(M0019);
  });
});

// ======================================================================
describe('8. 不让他打字、按钮够大、不碰密钥', () => {
  it('整块里一个 <input> 都没有（录音按钮是 button，不是 input）', () => {
    for (const s of [PRON_MOD, PRON_JS, PRON_CSS]) {
      expect(s).not.toMatch(/<input/i);
      expect(s).not.toMatch(/<textarea/i);
      expect(s).not.toContain('contenteditable');
    }
    expect(PRON_JS).toContain("var b=document.createElement('button');");
    expect(PRON_JS).not.toContain("createElement('input')");
  });

  it('按钮都 ≥52px 高（这里全是 56px），而且压得过外框那条 min-height:38px', () => {
    expect(PRON_CSS).toContain('#f-pron .pn-one .btn{width:100%;min-height:56px');
    expect(PRON_CSS).toContain('#f-pron .pn-two .btn{min-height:56px');
    expect(PRON_CSS).toContain('#f-pron .pn-pick .btn{display:block;min-height:56px');
  });

  it('字号只用全站那几级（12 / 13 / 15 / 17 / 18 / 22 / 26，控件可以 14），不自己造一级', () => {
    const FS = [12, 13, 14, 15, 17, 18, 22, 24, 26, 30];
    const bad = [...PRON_CSS.matchAll(/font-size:(\d+)px/g)].map((m) => Number(m[1])).filter((n) => !FS.includes(n));
    expect(bad).toEqual([]);
  });

  it('页面上不出现命令行、不出现密钥变量名（底线 1、把用户当小白）', () => {
    for (const s of [PRON_MOD, PRON_JS]) {
      for (const w of ['npm ', 'npx ', 'wrangler', 'curl ', 'COPILOT_', 'GEMINI_', 'API_KEY', 'TOKEN', 'PASSWORD'])
        expect([w, s.includes(w)]).toEqual([w, false]);
    }
  });

  it('服务端不碰密钥：whisper 走 env.AI 绑定，语音只读库，没有新环境变量', () => {
    for (const f of ['src/pron.ts', 'src/en-audio.ts']) {
      const t = readFileSync(path.join(ROOT, f), 'utf8');
      expect([f, /env\.(?!AI|DB)[A-Z]/.test(t)]).toEqual([f, false]);
      for (const w of ['API_KEY', 'TOKEN', 'PASSWORD', 'Authorization']) expect([f, w, t.includes(w)]).toEqual([f, w, false]);
    }
  });

  it('SQL 只碰自己那几张表 + settings（放今天纠了几次），别的表一个都不写', () => {
    // 2026-11-13：发音从 pron_audio（aura 按需生成）换成 en_audio（预先生成，只读）。
    // pron.ts 自己只写 pron_round / pron_say / settings，en-audio.ts 只**读** en_audio —— 范围没变宽。
    const t = readFileSync(path.join(ROOT, 'src/pron.ts'), 'utf8') + readFileSync(path.join(ROOT, 'src/en-audio.ts'), 'utf8');
    const tables = new Set([...t.matchAll(/(?:FROM|INTO|UPDATE)\s+(\w+)/g)].map((m) => m[1]).filter((x) => x !== 'SET'));
    // 2026-11-13 第二次：语音的字节挪进分块表 en_audio_part（迁移 0023），en-audio.ts 那条 SELECT 查的是它。
    // 范围还是**没变宽**：多的那张是语音自己的表，照样在 src/english.ts 的清单里。
    expect([...tables].sort()).toEqual(['en_audio_part', 'pron_round', 'pron_say', 'settings']);
  });

  it('不造占位词：没有「暂无」「待补」这类（底线 3）', () => {
    for (const s of [PRON_MOD, PRON_JS]) for (const w of ['暂无', '待补', 'TODO', '占位']) expect([w, s.includes(w)]).toEqual([w, false]);
  });
});

// ======================================================================
describe('9. 内容只读不改：七组原样来自 src/pron-content.ts', () => {
  it('七组都在，课次和元音 / 辅音对得上（内容由主会话从课件逐张抽，这里只核对没被改掉）', () => {
    expect(GROUPS.map((g) => [g.id, g.lesson, g.kind])).toEqual([
      ['g1', 10, '元音'], ['g2', 10, '元音'], ['g3', 10, '元音'], ['g4', 11, '辅音'], ['g5', 11, '辅音'], ['g6', 11, '辅音'], ['g7', 11, '辅音'],
    ]);
    expect(GROUPS.every((g) => g.pairs.length === 4 && !!g.twister)).toBe(true);
  });

  it('页面一个字的内容都不写死：**界面部分**不出现任何一个对比词、也不出现绕口令（都是脚本从接口画上去的）', () => {
    // 两段折叠说明是例外：底下那段要点名 ketch / reen / roose / rove，说清楚"为什么这几个词不给纠说"。
    // 所以这里先把折叠说明切掉，只量真正的界面部分。
    const 界面 = PRON_MOD.split('<details class="more"').map((x, i) => (i === 0 ? x : x.slice(x.indexOf('</details>')))).join('');
    for (const g of GROUPS) {
      expect([g.id, PRON_MOD.includes(g.twister)]).toEqual([g.id, false]);
      for (const p of g.pairs) for (const k of ['a', 'b'] as const)
        expect([p[k].word, new RegExp('(^|[^A-Za-z])' + p[k].word + '([^A-Za-z]|$)').test(界面)]).toEqual([p[k].word, false]);
    }
    // 被点名的那四个词只出现在折叠说明里，而且是在讲"为什么不给纠说"
    for (const w of ['ketch', 'reen', 'roose', 'rove']) {
      expect([w, 界面.includes(w)]).toEqual([w, false]);
      expect([w, PRON_MOD.includes(w)]).toEqual([w, true]);
    }
    expect(PRON_MOD).toContain('不是现代常用词');
  });

  it('组号和编号对得上（wordId / wordOf 是一对互逆的函数）', () => {
    for (const id of PRON_WORD_IDS) {
      const w = wordOf(id)!;
      expect([id, wordId(w.g, w.i, w.k)]).toEqual([id, id]);
    }
    expect(groupOf('g1')?.id).toBe('g1');
    expect(groupOf('g9')).toBeNull();
  });
});

// ======================================================================
// 10～13 组：口型示意图 + 照镜子 + 慢速对照（2026-11-11，Amos：「有些发音我很难理解　你要给我做成教学视频」
// —— 真人视频拍不了、AI 生成的"会动的嘴"是编的不能做，改成这三样，他说「都要，按这个顺序做」）
// ======================================================================
// ----------------------------------------------------------------------
// 页面脚本（src/pron-page.ts 的 PRON_JS）在 jsdom 里**真的跑一遍**（写法照 test/funds-impl.test.ts）：
// 一次是不是真的只显示一步、点下一步有没有真前进、念给我听调没调到、镜子有没有把画面送出去、
// 录音回放的顺序对不对，这几件事光比字符串证明不了。
// ----------------------------------------------------------------------
type PWin = Window & typeof globalThis & { pronOpen(): void; pronStop?(): void; eval(s: string): unknown };
/** 一台假的摄像头 / 麦克风：轨道被 stop() 过没有，测试直接数 */
const fakeStream = () => {
  const t = { stopped: 0, stop() { t.stopped++; }, kind: 'video' };
  return { track: t, getTracks: () => [t] };
};
/**
 * 开一个只有 #f-pron 的 jsdom 页面，跑真的 PRON_JS。
 * 网络一律走替身并**逐条记下来**（镜子那一段要证明"一次都没往外发"）。
 */
async function pronPage(opt: { cam?: 'ok' | 'deny' | 'none'; camDelay?: number; 没有语音?: boolean; auto?: 'on' | 'off' } = {}) {
  const jsdomName = 'jsdom';
  const { JSDOM } = await import(jsdomName);
  // 给一个 url：about:blank 下 jsdom 没有 localStorage，而「自动念」的开关就存在那里
  const dom = new JSDOM(`<!doctype html><body><main id="app">${PRON_MOD}</main></body>`, { url: 'https://pron.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window as unknown as PWin;
  const net: string[] = [];
  const plays: { src: string; rate: number }[] = [];
  let pauses = 0;
  const state = { 一共几组: GROUPS.length, 一轮几题: ROUND_N, 组: GROUPS.map(groupCard), 记录: [], 纠说: {}, 旧的去哪了: '样例' };
  const anyW = w as any;
  let 关了 = false;
  anyW.fetch = async (url: string, init?: { method?: string }) => {
    if (关了) return new Promise(() => {}); // 窗口关掉之后不再往回调（不然回调里 document 已经没了，冒一个假错误）
    net.push((init?.method ?? 'GET') + ' ' + url);
    if (/state$/.test(url)) return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(state)) };
    if (/\/api\/en\/audio\//.test(url)) {
      // 没有语音 = 库里还没生成这一条：服务端回 404 两句话（src/en-audio.ts 的「还没生成」）
      if (opt.没有语音)
        return { ok: false, status: 404, headers: { get: () => 'application/json' },
          json: async () => ({ 出错: '这一段语音还没生成（库里没有这一条）。', 怎么办: '照着屏幕上的字做就行。' }) };
      return { ok: true, status: 200, headers: { get: () => 'audio/mpeg' }, blob: async () => new anyW.Blob(['mp3'], { type: 'audio/mpeg' }), json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => ({ 一句话: '✅ 机器听成了 bed —— 对了', 判定: 1, 这是线索不是判决: '线索', 今天已经纠了几次: 1, 一天最多: 200 }) };
  };
  // 往外发东西的路，一条都不许在镜子那一段被用到
  anyW.XMLHttpRequest = function () { net.push('XHR'); } as unknown as typeof XMLHttpRequest;
  anyW.WebSocket = function () { net.push('WS'); } as unknown as typeof WebSocket;
  anyW.navigator.sendBeacon = () => { net.push('beacon'); return true; };
  let n = 0;
  anyW.URL.createObjectURL = () => 'blob:fake-' + ++n;
  anyW.URL.revokeObjectURL = () => {};
  // 假播放器：记下每次放的是哪一段、倍速多少；放完触发 onended（「连着放」靠它接上第二段）
  anyW.Audio = function (this: any) {
    this.src = ''; this.playbackRate = 1; this.onended = null;
    // 停掉正在响的那一段：pShutUp()（离开这一屏、关掉自动念）靠它
    this.pause = () => { pauses++; };
    this.play = () => {
      plays.push({ src: this.src, rate: this.playbackRate });
      setTimeout(() => { if (this.onended) this.onended(); }, 0);
      return { catch: () => undefined };
    };
  };
  const cams: ReturnType<typeof fakeStream>[] = [];
  if (opt.cam !== 'none') {
    Object.defineProperty(anyW.navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async (c: { video?: unknown }) => {
          // camDelay 模拟**真机上等权限弹窗那一段**：流不是立刻就回来的，
          // 这中间他可能已经关掉镜子、走到第 2 步、或者又点了一下（审查 🔴2）
          if (opt.camDelay && c.video) await new Promise((ok) => setTimeout(ok, opt.camDelay));
          if (opt.cam === 'deny' && c.video) { const e = new Error('denied'); e.name = 'NotAllowedError'; throw e; }
          const s = fakeStream(); cams.push(s); return s;
        },
      },
    });
  }
  // 2026-11-13：「念给我听」不再用浏览器自带的那套朗读，改成放**预先生成好的中文语音**。
  // 所以这里**连假朗读都不给**（页面真去调的话会当场 undefined 报错），念了什么全看 plays / net。
  // 自动念的开关存 localStorage：测试要能从"他上次关掉了"这个状态开起来
  try { if (opt.auto) anyW.localStorage.setItem('pn-auto-speak', opt.auto); else anyW.localStorage.removeItem('pn-auto-speak'); } catch { /* 取不到就当默认开着 */ }
  // 假录音机：按一下开始、再按一下停止，停的时候吐一段 3 字节的音频
  anyW.MediaRecorder = function (this: any) {
    this.state = 'recording'; this.mimeType = 'audio/webm';
    this.start = () => {};
    this.stop = () => {
      this.state = 'inactive';
      if (this.ondataavailable) this.ondataavailable({ data: new anyW.Blob(['abc'], { type: 'audio/webm' }) });
      if (this.onstop) this.onstop();
    };
  };
  w.eval(PRON_JS);
  const $ = (id: string) => w.document.getElementById(id)!;
  const click = (id: string) => ($(id) as HTMLButtonElement).click();
  const until = async (cond: () => boolean) => { for (let k = 0; k < 400 && !cond(); k++) await new Promise((ok) => setTimeout(ok, 5)); return cond(); };
  w.pronOpen();
  await until(() => w.document.querySelectorAll('#pn-cbtns .btn').length > 0);
  const useGroup = (id: string) => {
    const b = [...w.document.querySelectorAll('#pn-pick .btn')].find((x) => x.textContent!.includes(id));
    (b as HTMLButtonElement).click();
  };
  /** 这一步按钮里带某几个字的那一个（「做好了」「🔈」「🎤」「🔊」「上一步」） */
  const cbtn = (t: string) => [...w.document.querySelectorAll('#pn-cbtns .btn')].find((b) => b.textContent!.includes(t)) as HTMLButtonElement | undefined;
  /** 屏幕上现在显示的这一步（页面只会显示一步，所以这就是全部） */
  const shown = () => ({
    lv: $('pn-clv').textContent!, say: $('pn-csay').textContent!, big: $('pn-cbig').hidden ? '' : $('pn-cbig').textContent!,
    hint: $('pn-chint').hidden ? '' : $('pn-chint').textContent!, src: $('pn-csrc').textContent!,
    num: $('pn-cnum').textContent!, btns: [...w.document.querySelectorAll('#pn-cbtns .btn')].map((b) => b.textContent!),
  });
  const next = () => cbtn('做好了')!.click();
  // 关之前先让在飞的那几个 promise 落地（取发音、FileReader、POST say），再关窗口
  const close = async () => { 关了 = true; await new Promise((ok) => setTimeout(ok, 80)); w.close(); };
  return { w, $, click, until, net, plays, pauses: () => pauses, cams, useGroup, cbtn, shown, next, close };
}

// ======================================================================
// 10～11 组：「跟我做」那一屏（2026-11-12，Amos：「完全不知道该怎么开口」「口型图撤掉，念给我听要，开始做」）
// ======================================================================
describe('10. 跟我做：一屏只有一步，他点一下才前进（jsdom 里真跑一遍 PRON_JS）', () => {
  /** 页面把课件原文里的两个星号渲染成加粗，所以比文字的时候要按同一把尺子去掉星号 */
  const 去星 = (s: string) => String(s ?? '').split('**').join('');

  it('一屏上**只有一步**：显示的那句就是阶梯的第 1 步，一个字不多、一个字不少', async () => {
    const p = await pronPage();
    try {
      const 步 = LESSON[0].步;
      const s = p.shown();
      expect(s.say).toBe(去星(步[0].说));
      expect(s.hint).toBe(去星(步[0].提示 ?? ''));
      // 依据原文照抄；依据本身不是那三个字开头的（机械拆分那几步），前面才补一个类别标签
      expect(s.src).toBe(步[0].依据.indexOf(步[0].类) === 0 ? 步[0].依据 : 步[0].类 + 步[0].依据);
      expect(s.big).toBe(步[0].大 ?? '');
      expect(s.num).toBe('第 1 / 共 ' + 步.length + ' 步');
      expect(s.lv).toBe('第 1 级 · ' + 级[步[0].lv]);
      // 屏幕上只摆得下这一步：别的步骤的那句话一个都不在 DOM 里
      const 整块 = p.$('pn-s1').textContent!;
      for (const x of 步.slice(1)) if (去星(x.说) !== 去星(步[0].说)) expect([x.说, 整块.includes(去星(x.说))]).toEqual([x.说, false]);
    } finally { await p.close(); }
  });

  it('点「做好了，下一步」真的前进一步；「上一步」真的退回来（进度条和第几步跟着走）', async () => {
    const p = await pronPage();
    try {
      const 步 = LESSON[0].步;
      p.next();
      expect(p.shown().say).toBe(去星(步[1].说));
      expect(p.shown().num).toBe('第 2 / 共 ' + 步.length + ' 步');
      expect(p.$('pn-cbar').getAttribute('style')).toContain(String(Math.round(2 * 100 / 步.length)) + '%');
      p.cbtn('上一步')!.click();
      expect(p.shown().say).toBe(去星(步[0].说));
      // 第 1 步没有「上一步」（退无可退就不画那个按钮，不画灰的）
      expect(p.cbtn('上一步')).toBe(undefined);
    } finally { await p.close(); }
  });

  it('**整条阶梯逐步走一遍**：每一句都和 src/pron-lesson.ts 对得上，走完给一屏收尾', async () => {
    const p = await pronPage();
    try {
      const 步 = LESSON[0].步;
      for (let i = 0; i < 步.length; i++) {
        expect([i, p.shown().say]).toEqual([i, 去星(步[i].说)]);
        expect([i, p.shown().lv]).toEqual([i, '第 ' + (步[i].lv + 1) + ' 级 · ' + 级[步[i].lv]]);
        expect([i, p.shown().src]).toEqual([i, 步[i].依据.indexOf(步[i].类) === 0 ? 步[i].依据 : 步[i].类 + 步[i].依据]);
        expect([i, p.shown().src.includes(步[i].依据)]).toEqual([i, true]);   // 依据一个字都不许改
        // 🔊 只在这一步有标准音时给、🎤 只在这一步能纠说时给（没有就不画，不画灰按钮）
        expect([i, !!p.cbtn('🔊')]).toEqual([i, !!步[i].音]);
        expect([i, !!p.cbtn('🎤')]).toEqual([i, !!步[i].麦]);
        p.next();
      }
      // 收尾屏：课程的作业标准照实写，并说明课程没给自查方法（这正是 🎤 要补的那一处）
      expect(p.$('pn-fin').hidden).toBe(false);
      expect(p.$('pn-coach').hidden).toBe(true);
      expect(p.$('pn-fin').textContent).toContain('直到没有任何发音错误');
      expect(p.$('pn-fin').textContent).toContain('没有给自查的办法');
      expect(p.$('pn-fin').textContent).toContain('机器听成了哪个词');
      // 四级都走完了 → 轨上四级全标成完成
      expect([...p.w.document.querySelectorAll('#pn-rail .pn-lv')].map((e) => e.className)).toEqual(级.map(() => 'pn-lv ok'));
      p.click('pn-redo');
      expect(p.shown().num).toBe('第 1 / 共 ' + 步.length + ' 步');
    } finally { await p.close(); }
  });

  it('四级轨就是课程那四级：当前级高亮、走过的标成完成（级数和名字都从 pron-lesson.ts 来）', async () => {
    const p = await pronPage();
    try {
      const 步 = LESSON[0].步;
      expect([...p.w.document.querySelectorAll('#pn-rail .pn-lv')].map((e) => e.textContent)).toEqual(级.map((n, k) => (k + 1) + '. ' + n));
      // 走到第 1 个第 2 级的步骤：轨上第 2 级高亮、第 1 级标完成
      let i = 0;
      while (步[i].lv === 0) { p.next(); i++; }
      expect(步[i].lv).toBe(1);
      expect([...p.w.document.querySelectorAll('#pn-rail .pn-lv')].map((e) => e.className))
        .toEqual(['pn-lv ok', 'pn-lv on', 'pn-lv', 'pn-lv']);
    } finally { await p.close(); }
  });

  it('换一组：阶梯跟着换成那一组的，从第 1 步重新开始（不会把上一组的步数带过来）', async () => {
    const p = await pronPage();
    try {
      p.next(); p.next();
      p.useGroup(`${GROUPS[6].a.ipa} vs ${GROUPS[6].b.ipa}`);
      const 步 = LESSON[6].步;
      expect(p.shown().num).toBe('第 1 / 共 ' + 步.length + ' 步');
      expect(p.shown().say).toBe(去星(步[0].说));
    } finally { await p.close(); }
  });

  it('这一步的 🎤：措辞还是「机器听成了什么」，而且结果出在**他正看着的那一屏**上', async () => {
    const p = await pronPage();
    try {
      const 步 = LESSON[0].步;
      const k = 步.findIndex((x) => !!x.麦);
      expect(k).toBeGreaterThan(-1);
      for (let i = 0; i < k; i++) p.next();
      const b = p.cbtn('🎤')!;
      expect(b.textContent).toBe('🎤 我念一遍');
      b.click();
      await p.until(() => /停止/.test(b.textContent ?? ''));
      b.click();
      await p.until(() => !p.$('pn-csayver').hidden);
      expect(p.$('pn-csayver').textContent).toContain('机器听成了');
      for (const 不许 of ['你念对了', '你念错了', '念对', '念错']) expect([不许, p.$('pn-csayver').textContent!.includes(不许)]).toEqual([不许, false]);
      expect(p.$('pn-csaynote').textContent).toContain('一天最多');
      expect(p.$('pn-sayver').hidden).toBe(true);   // 第 2 步那一份没被写花
    } finally { await p.close(); }
  });

  it('镜子左边就是**这一步的那句话**，翻一步它跟着换（口型图撤掉了，但隐私那一套一条没动）', async () => {
    const p = await pronPage({ cam: 'ok' });
    try {
      const 步 = LESSON[0].步;
      p.click('pn-mir');
      await p.until(() => !p.$('pn-mirwrap').hidden);
      expect(p.$('pn-mirtarget').textContent).toBe(去星(步[0].说));
      const n0 = p.net.length;
      p.next();
      expect(p.$('pn-mirtarget').textContent).toBe(去星(步[1].说));
      // 2026-11-13：翻页会**去取**下一句的朗读（自动念那一段预先生成好的中文语音）。
      // 守的那件事一点没松 —— **摄像头的画面一个字节都没出去**：
      // 翻页发出去的只能是 GET 取语音那一条，而且只能是 GET（没有任何 POST / 上传）。
      const 新发的 = p.net.slice(n0);
      expect(新发的.every((x) => /^GET \/api\/en\/audio\//.test(x))).toBe(true);
      expect(新发的.length).toBeLessThanOrEqual(1);
      expect(p.cams[0].track.stopped).toBe(0);
    } finally { await p.close(); }
  });

  it('走到收尾屏：镜子关掉（那一屏没有口型要做了，指示灯不许还亮着）', async () => {
    const p = await pronPage({ cam: 'ok' });
    try {
      p.click('pn-mir');
      await p.until(() => !p.$('pn-mirwrap').hidden);
      for (let i = 0; i < LESSON[0].步.length; i++) p.next();
      expect(p.$('pn-fin').hidden).toBe(false);
      expect(p.cams[0].track.stopped).toBe(1);
      expect(p.$('pn-mirwrap').hidden).toBe(true);
    } finally { await p.close(); }
  });
});

describe('11. 念给我听：放**预先生成好的中文语音（晓晓）**，不调 AI、不花钱；库里没有就当面说', () => {
  const 睡 = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
  // 2026-11-13 换掉的是**谁在念**：原来是浏览器自带的那套朗读（Amos：嫌手机朗读太机械），
  // 现在是微软 Edge 的神经网络语音，提前生成好存在库里。守的四件事一件没少、还多了一件：
  //   原来守：① 点了真的念出这一句（含提示）② 翻页自动念、和手点念的是同一段 ③ 开关关得掉、存得住
  //           ④ 念不了的时候当面说、其余照常能用
  //   现在守：①～④ 照旧（念 → 放那一段 mp3；"念不了" → "库里还没生成"），
  //           **另加**：念的是哪一段由**内容哈希的键**钉死（不可能一个念全、一个只念半句），
  //           而且整段脚本里连浏览器那套朗读的名字都不许出现（test/en-audio.test.ts 第 3 组）。
  const 键 = (i: number) => audioKey(指令文本(LESSON[0].步[i]), 中文声音);

  it('点「🔈 念给我听」真的去取**这一句 + 提示**那一段（晓晓念的那条键），并放出来', async () => {
    const p = await pronPage();
    try {
      const n0 = p.plays.length;
      p.cbtn('🔈')!.click();
      expect(await p.until(() => p.plays.length > n0)).toBe(true);
      expect(p.net.some((x) => x.includes('/api/en/audio/' + 键(0)))).toBe(true);
      // 这一句 + 提示才是他能照着做的那段话：键里**两段都在**
      expect(指令文本(LESSON[0].步[0])).toContain(LESSON[0].步[0].说);
      if (LESSON[0].步[0].提示) expect(指令文本(LESSON[0].步[0])).toContain(LESSON[0].步[0].提示!);
    } finally { await p.close(); }
  });

  it('点「下一步」之后**自动念新的那一句**，而且和手点「🔈」取的是同一条键（同一段，不可能一个念全一个念半句）', async () => {
    const p = await pronPage();
    try {
      expect(p.net.some((x) => x.includes('/api/en/audio/'))).toBe(false);  // 刚进来不念，不吓人
      p.next();
      expect(await p.until(() => p.net.some((x) => x.includes('/api/en/audio/' + 键(1))))).toBe(true);
      const 取过 = p.net.filter((x) => x.includes('/api/en/audio/')).length;
      const n0 = p.plays.length;
      p.cbtn('🔈')!.click();
      // 同一条键第二次不再发请求（取过一次就存着），但**还是要响**
      expect(await p.until(() => p.plays.length > n0)).toBe(true);
      expect(p.net.filter((x) => x.includes('/api/en/audio/')).length).toBe(取过);
    } finally { await p.close(); }
  });

  it('开关关掉之后**不再自动念**（手点「🔈」还是念），而且开关状态存得住', async () => {
    const p = await pronPage();
    try {
      p.click('pn-auto');
      expect(p.$('pn-auto').getAttribute('aria-pressed')).toBe('false');
      p.next(); p.next();
      await 睡(60);
      expect(p.net.some((x) => x.includes('/api/en/audio/'))).toBe(false);
      p.cbtn('🔈')!.click();                       // 自己点还是念
      expect(await p.until(() => p.plays.length > 0)).toBe(true);
      expect((p.w as any).localStorage.getItem('pn-auto-speak')).toBe('off');
    } finally { await p.close(); }
    // 上次关掉了：这次进来还是关着的，翻页也不念
    const q = await pronPage({ auto: 'off' });
    try {
      expect(q.$('pn-auto').getAttribute('aria-pressed')).toBe('false');
      q.next();
      await 睡(60);
      expect(q.net.some((x) => x.includes('/api/en/audio/'))).toBe(false);
    } finally { await q.close(); }
  });

  it('库里还没生成这一句：**当面照实说**，不静默、不假装在念，其余功能照常能用（不整屏挂掉）', async () => {
    const p = await pronPage({ 没有语音: true });
    try {
      const n0 = p.plays.length;
      p.cbtn('🔈')!.click();
      expect(await p.until(() => !p.$('pn-csaymsg').hidden)).toBe(true);
      const 话 = p.$('pn-csaymsg').textContent!;
      expect(话).toContain('这一句的朗读还没生成');
      expect(话).toContain('这一段语音还没生成');     // 服务端那两句原样摆出来
      expect(p.plays.length).toBe(n0);                // **一声都没响**，没有偷偷换个机械的声音顶上
      // 其余照常：翻页、🎤、镜子、去对照听都还在
      p.next();
      expect(p.shown().num).toBe('第 2 / 共 ' + LESSON[0].步.length + ' 步');
      p.click('pn-go2');
      expect(p.$('pn-s2').hidden).toBe(false);
      expect(p.w.document.querySelectorAll('#pn-cmp .pn-pair button').length).toBe(8);
    } finally { await p.close(); }
  });

  it('不调任何 AI、不花一分钱：念那一段只去取一个现成的字节流，脚本里没有第二条 TTS', async () => {
    const p = await pronPage();
    try {
      p.cbtn('🔈')!.click();
      p.next(); p.next();
      await 睡(60);
      // 发出去的请求**只有**取语音那一种（没有生成、没有记账、没有模型调用）
      expect(p.net.filter((x) => !/\/api\/en\/(audio|pron)\//.test(x))).toEqual([]);
      expect(p.net.every((x) => x.startsWith('GET '))).toBe(true);
    } finally { await p.close(); }
    const 段 = PRON_JS.slice(PRON_JS.indexOf('function pSpeak'), PRON_JS.indexOf('function pAutoToggle'));
    for (const w of ['aura', 'melotts', '@cf/', 'env.AI', 'AI.run', 'speechSynthesis']) expect([w, 段.includes(w)]).toEqual([w, false]);
  });
});

describe('12. 照镜子：画面不上传、不保存、不录；关掉时摄像头真的灭（底线 1、9）', () => {
  it('源码里**没有任何一条把画面送出去的路**：toBlob / toDataURL / canvas / 截帧 / 心跳一个都没有', () => {
    for (const w of ['toBlob', 'toDataURL', 'captureStream', 'ImageCapture', 'drawImage', 'createImageBitmap', 'canvas', 'OffscreenCanvas', 'sendBeacon', 'getDisplayMedia'])
      expect([w, PRON_JS.includes(w)]).toEqual([w, false]);
    // MediaRecorder 只在**纠说录音**那一段出现（那是他自己要的、本来就上传的那一次），镜子那一段一个都没有
    const 纠说段 = PRON_JS.slice(PRON_JS.indexOf('function pRec(b)'), PRON_JS.indexOf('function pSayGo'));
    const 数 = (s: string) => s.split('MediaRecorder').length - 1;
    expect(数(PRON_JS)).toBe(数(纠说段));
    const 镜子段 = PRON_JS.slice(PRON_JS.indexOf('function pMirMsg'), PRON_JS.indexOf("/* ---- 第 2 步：慢速对照"));
    expect(数(镜子段)).toBe(0);
    expect(镜子段).not.toContain('fetch');
    expect(镜子段).toContain('getTracks().forEach(function(t){t.stop();})');
    // 界面上当面写明（Amos 自己看得到这句话）
    expect(PRON_MOD).toContain('这个画面不会离开你的手机 —— 不上传、不保存、不录像');
  });

  it('开镜子：流只赋给 video.srcObject，**一次网络请求都没多发**；关掉时 track.stop()、画面清空', async () => {
    const p = await pronPage({ cam: 'ok' });
    try {
      const n0 = p.net.length;
      p.click('pn-mir');
      await p.until(() => !p.$('pn-mirwrap').hidden);
      expect(p.cams.length).toBe(1);
      expect((p.$('pn-cam') as any).srcObject).toBe(p.cams[0]);
      expect(p.net.slice(n0)).toEqual([]); // 从开镜子到现在：fetch / XHR / WebSocket / sendBeacon 一条都没有
      expect(p.$('pn-mir').getAttribute('aria-pressed')).toBe('true');
      // 2026-11-12：左边那张"目标口型图"随口型图一起撤掉了，改成**这一步要做的那句话**（一个字都来自课件）
      expect(p.$('pn-mirtarget').querySelectorAll('svg').length).toBe(0);
      expect(p.$('pn-mirtarget').textContent).toBe(p.$('pn-csay').textContent);
      expect(p.$('pn-mirtarget').textContent!.length).toBeGreaterThan(0);
      expect(p.cams[0].track.stopped).toBe(0);
      p.click('pn-miroff');
      expect(p.cams[0].track.stopped).toBe(1); // 关掉 = 摄像头指示灯灭
      expect((p.$('pn-cam') as any).srcObject).toBe(null);
      expect(p.$('pn-mirwrap').hidden).toBe(true);
      expect(p.net.slice(n0)).toEqual([]);
    } finally { await p.close(); }
  });

  it('离开第 1 步（去对照听）也会把摄像头关掉，不在后台一直亮着', async () => {
    const p = await pronPage({ cam: 'ok' });
    try {
      p.click('pn-mir');
      await p.until(() => !p.$('pn-mirwrap').hidden);
      p.click('pn-go2');
      expect(p.cams[0].track.stopped).toBe(1);
      expect(p.$('pn-mirwrap').hidden).toBe(true);
    } finally { await p.close(); }
  });

  it('不给权限 / 浏览器不支持：当面说清楚，**整屏其余部分照常能用**', async () => {
    for (const cam of ['deny', 'none'] as const) {
      const p = await pronPage({ cam });
      try {
        p.click('pn-mir');
        await p.until(() => !p.$('pn-mirmsg').hidden);
        const t = p.$('pn-mirmsg').textContent!;
        expect([cam, t.includes('怎么办：')]).toEqual([cam, true]);
        expect([cam, t.includes('照常能用')]).toEqual([cam, true]);
        expect([cam, p.$('pn-mirwrap').hidden]).toEqual([cam, true]);
        // 其余部分照常：这一步那句话还在、能去第 2 步、对照听的按钮还在
        expect([cam, p.$('pn-csay').textContent!.length > 0]).toEqual([cam, true]);
        p.click('pn-go2');
        expect([cam, p.$('pn-s2').hidden]).toEqual([cam, false]);
        expect([cam, p.w.document.querySelectorAll('#pn-cmp .pn-pair button').length]).toEqual([cam, 8]);
      } finally { await p.close(); }
    }
  });
});

describe('16. 后台页面那几段脚本必须是**能跑的纯 JS**（TypeScript 语法不许漏进去）', () => {
  // 2026-11-11 真踩过：往 admin-page.ts 的 route() 里加了一行 `(window as any).pronStop()`。
  // 那一段是**模板字符串装的纯 JS**，tsc 不看字符串里面，于是 `as any` 原样进了浏览器，
  // **整个后台脚本当场崩**——登录框都填不进去，e2e 跑了十分钟才暴露。这条测试 10 毫秒就逮住。
  it('ADMIN_PAGE 里每一段 <script> 都能被解析', () => {
    const m = [...ADMIN_PAGE.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    expect(m.length).toBeGreaterThan(0);
    m.forEach((x, i) => {
      expect([i, (() => { try { new Function(x[1]); return ''; } catch (e) { return (e as Error).message; } })()]).toEqual([i, '']);
    });
  });
  it('PRON_JS 本身能被解析', () => {
    expect([(() => { try { new Function(PRON_JS); return ''; } catch (e) { return (e as Error).message; } })()]).toEqual(['']);
  });
});

describe('14. 摄像头的三道竞态和一条出口（审查 🔴1、🔴2：指示灯必须真的灭）', () => {
  const 睡 = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

  it('还在等权限弹窗时他按了「关掉镜子」：流一回来就当场掐掉，**不许自己又开起来**', async () => {
    const p = await pronPage({ cam: 'ok', camDelay: 60 });
    try {
      p.click('pn-mir');            // 开（流 60ms 后才回）
      await 睡(10);
      p.click('pn-miroff');         // 他反悔了
      await 睡(140);                // 等流回来
      expect(p.cams.map((c) => c.track.stopped)).toEqual(p.cams.map(() => 1));
      expect(p.$('pn-mirwrap').hidden).toBe(true);
      expect((p.$('pn-mir') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('false');
      expect((p.w.document.getElementById('pn-cam') as HTMLVideoElement).srcObject ?? null).toBe(null);
    } finally { await p.close(); }
  });

  it('还在等权限弹窗时他走到第 2 步（对照听）：流一回来就掐掉，不许在看不见的 DOM 里亮着', async () => {
    const p = await pronPage({ cam: 'ok', camDelay: 60 });
    try {
      p.click('pn-mir');
      await 睡(10);
      p.click('pn-go2');            // 去对照听
      await 睡(140);
      expect(p.cams.map((c) => c.track.stopped)).toEqual(p.cams.map(() => 1));
      expect(p.$('pn-s1').hidden).toBe(true);
      expect(p.$('pn-mirwrap').hidden).toBe(true);
    } finally { await p.close(); }
  });

  it('连点两下「照镜子」（手机上等弹窗时很常见）：**只开一个流**，关掉后它真的停了', async () => {
    const p = await pronPage({ cam: 'ok', camDelay: 60 });
    try {
      p.click('pn-mir'); p.click('pn-mir');
      await 睡(140);
      expect(p.cams.length).toBe(1);
      p.click('pn-miroff');
      expect(p.cams.map((c) => c.track.stopped)).toEqual([1]);
    } finally { await p.close(); }
  });

  it('切到别的一级菜单（route() 调 window.pronStop）：摄像头关掉、没念完的那句也停掉', async () => {
    const p = await pronPage({ cam: 'ok' });
    try {
      p.click('pn-mir');
      p.cbtn('🔈')!.click();                 // 正在念这一句
      await p.until(() => p.cams.length === 1 && !p.$('pn-mirwrap').hidden && p.plays.length > 0);
      const c0 = p.pauses();
      expect(typeof p.w.pronStop).toBe('function');
      p.w.pronStop!();
      expect(p.cams[0].track.stopped).toBe(1);
      expect(p.$('pn-mirwrap').hidden).toBe(true);
      // 他已经看不见这一屏了，手机不许还在念 —— 正在放的那一段当场停掉
      expect(p.pauses()).toBeGreaterThan(c0);
      const n = p.plays.length; await 睡(200);
      expect(p.plays.length).toBe(n);
    } finally { await p.close(); }
  });

  it('页面被藏起来（切标签页 / 锁屏）也关掉：visibilitychange 兜底', async () => {
    const p = await pronPage({ cam: 'ok' });
    try {
      p.click('pn-mir');
      await p.until(() => p.cams.length === 1 && !p.$('pn-mirwrap').hidden);
      Object.defineProperty(p.w.document, 'hidden', { configurable: true, value: true });
      p.w.document.dispatchEvent(new p.w.Event('visibilitychange'));
      expect(p.cams[0].track.stopped).toBe(1);
    } finally { await p.close(); }
  });
});

describe('15. 播放的倍速和"放完做什么"不许漏到下一次（审查 🔴3）', () => {
  const 睡 = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

  it('「连着放」的尾巴不许落到考题上：第 3 步只放考题那个词、只用原速', async () => {
    const p = await pronPage();
    try {
      p.click('pn-go2');
      await p.until(() => !p.$('pn-s2').hidden);
      const 录 = [...p.w.document.querySelectorAll('#pn-saywords .btn')][0] as HTMLButtonElement;
      录.click(); await 睡(5); 录.click();
      await p.until(() => !p.$('pn-my').hidden);
      p.click('pn-slow');                       // 慢速开着
      p.click('pn-chain');                      // 连着放：标准音 → 停 0.3 秒 → 他的录音
      const n0 = p.plays.length;
      p.click('pn-go3');                        // **在那 0.3 秒里就开考**
      await p.until(() => !p.$('pn-s3').hidden);
      await 睡(500);                            // 等那个 300ms 的定时器本来该响的时候过去
      const 之后 = p.plays.slice(n0);
      // 他自己录的那一段绝不许在考题里再响一遍
      expect(之后.filter((x) => x.src === 'blob:fake-1' || /fake/.test(x.src) === false).map((x) => x.src)).toEqual([]);
      // 考题一律原速
      expect(之后.map((x) => x.rate)).toEqual(之后.map(() => 1));
    } finally { await p.close(); }
  });

  it('发音没取回来（页面当正常情况处理）也不许把 0.7 倍留在枪膛里', async () => {
    const p = await pronPage();
    try {
      p.click('pn-go2');
      await p.until(() => !p.$('pn-s2').hidden);
      p.click('pn-slow');
      // 没录过音时「连着放」不该做任何事，更不该把 rate 留下
      p.click('pn-chain');
      p.click('pn-slow');                        // 关掉慢速
      p.click('pn-go3');
      await p.until(() => !p.$('pn-s3').hidden);
      await 睡(500);
      expect(p.plays.map((x) => x.rate)).toEqual(p.plays.map(() => 1));
    } finally { await p.close(); }
  });
});

describe('13. 慢速对照 + 他自己的录音回放（录过才出现，刷新就没了）', () => {
  /** 录一次：按🎤 开始、再按一次停止（假录音机吐一段 3 字节的音频） */
  async function recOnce(p: Awaited<ReturnType<typeof pronPage>>) {
    p.click('pn-go2');
    const b = p.w.document.querySelector('#pn-saywords button') as HTMLButtonElement;
    b.click();
    await p.until(() => /停止/.test(b.textContent ?? ''));
    b.click();
    await p.until(() => !p.$('pn-my').hidden);
    return b;
  }

  it('没录过就**不显示**这几个按钮（不画占位、不画灰按钮）', async () => {
    const p = await pronPage();
    try {
      p.click('pn-go2');
      expect(p.$('pn-my').hidden).toBe(true);
      // 看得见的按钮里没有「标准音 / 我刚才念的 / 慢速 / 连着放」
      expect(p.$('pn-std').closest('[hidden]')).not.toBe(null);
    } finally { await p.close(); }
  });

  it('录完：那段录音留在浏览器里（不另外上传），四个按钮才出现', async () => {
    const p = await pronPage();
    try {
      const n0 = p.net.length;
      await recOnce(p);
      expect(p.$('pn-my').hidden).toBe(false);
      // 这一次上传就是**纠说本来那一次**（POST say），没有第二次
      await p.until(() => p.net.some((x) => x.startsWith('POST')));
      expect(p.net.slice(n0).filter((x) => x.startsWith('POST'))).toEqual(['POST /api/en/pron/say']);
      expect(p.$('pn-my-t').textContent).toContain('你刚才念的');
    } finally { await p.close(); }
  });

  it('标准音 / 我刚才念的 / 慢速 0.7 倍：两段都能慢放，考题那边不受影响', async () => {
    const p = await pronPage();
    try {
      await recOnce(p);
      p.plays.length = 0;
      p.click('pn-std');
      await p.until(() => p.plays.length === 1);
      expect(p.plays[0].rate).toBe(1);
      const 标准 = p.plays[0].src;
      p.click('pn-mine');
      await p.until(() => p.plays.length === 2);
      expect(p.plays[1].rate).toBe(1);
      expect(p.plays[1].src).not.toBe(标准); // 放的是他自己那一段
      p.click('pn-slow');
      expect(p.$('pn-slow').getAttribute('aria-pressed')).toBe('true');
      p.click('pn-std');
      await p.until(() => p.plays.length === 3);
      p.click('pn-mine');
      await p.until(() => p.plays.length === 4);
      expect([p.plays[2].rate, p.plays[3].rate]).toEqual([0.7, 0.7]); // 标准音和他的录音都慢
      // 慢速只管这一块：进第 3 步考题，放的还是原速
      p.click('pn-go3');
      await p.until(() => p.plays.length === 5);
      expect(p.plays[4].rate).toBe(1);
    } finally { await p.close(); }
  });

  it('连着放：标准音 → 停 0.3 秒 → 他的录音（对比效果最好的那个形式）', async () => {
    const p = await pronPage();
    try {
      await recOnce(p);
      p.click('pn-std'); // 先让标准音那一段取回来（之后复用，不再跑接口）
      await p.until(() => p.plays.length === 1);
      const 标准 = p.plays[0].src;
      p.plays.length = 0;
      const t0 = Date.now();
      p.click('pn-chain');
      await p.until(() => p.plays.length === 2);
      expect(p.plays[0].src).toBe(标准);
      expect(p.plays[1].src).not.toBe(标准);
      expect(Date.now() - t0).toBeGreaterThanOrEqual(290); // 中间真的停了 0.3 秒
    } finally { await p.close(); }
  });

  it('换一组：上一组录的那段当场丢掉（那是另一个词，留着会误导）', async () => {
    const p = await pronPage();
    try {
      await recOnce(p);
      expect(p.$('pn-my').hidden).toBe(false);
      p.useGroup(`${GROUPS[1].a.ipa} vs ${GROUPS[1].b.ipa}`);
      expect(p.$('pn-my').hidden).toBe(true);
    } finally { await p.close(); }
  });

  it('页面上照实说这段录音刷新就没了、不另外上传（底线 3、9）', () => {
    expect(PRON_MOD).toContain('留在这个页面里，不另外上传');
    expect(PRON_MOD).toContain('刷新页面就没了');
  });
});
