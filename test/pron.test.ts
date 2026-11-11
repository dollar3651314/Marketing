/**
 * 工作台「发音训练」（src/pron.ts、src/pron-audio.ts、src/pron-page.ts、migrations/0019_pron.sql）的测试。
 * 内容在 src/pron-content.ts（主会话从课件逐张抽的，**这个测试不许改那个文件，只读它**）。
 *
 * 守住十件事：
 *   1. **位置**：工作台二级菜单从 8 项变 **7 项**（去掉「英语练习」「带练」，加「发音训练」）；
 *      **上限还是 8**、**公共工具那 8 项一个都没动**（T-4：第 9 项会撑破手机菜单）。
 *   2. **四步循环**：看口型 → 对照听（他自己点「我听出来了，开始考」才进考）→ 同一组连考 10 题
 *      （答错当场把对照听塞回来）→ 10 题对 8 题（80%）过关给绕口令 + 三最法。
 *   3. **照实说，不硬凑**（底线 3）：第 7 组一对最小对立对都没有 → 没有听辨题、不给「开始考」按钮；
 *      第 4 组只有 1 对 → 说明里写明题会重复。
 *   4. **对错由服务端算**（页面不自己判）；一轮考完记一行 `pron_round`，过没过由 `passedRound` 算。
 *   5. **纠说**：措辞永远是「机器听成了什么」，**不许**出现"你念对了 / 念错了"；
 *      三种结果（命中目标 / 命中另一个 / 两个都不是）各记一笔 `pron_say`；
 *      `asr: false` 的词（ketch、reen、roose、rove）**不给纠说**。
 *   6. **两道额度闸**：Amos 自己设的 cap + 一天最多 200 次；失败**不自动重试**，按估算记一笔账。
 *   7. **发音链路照搬带练那一条**：aura-2-en + `AUDIO_REV` 版本号键 + 额度闸 + 失败当面说；
 *      第一次生成存 `pron_audio`，第二次**一次 AI 都不调**。
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
import { audioKey, AUDIO_REV, PRON_TTS_PURPOSE } from '../src/pron-audio';
import { asrWordsOf, GROUPS, groupsForEar, minimalPairsOf } from '../src/pron-content';
import { mouthPair, mouthSpec } from '../src/pron-mouth';
import { AURA_SPEAKER, TTS_AURA, ttsNeurons } from '../src/tts';
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
  await db.batch(['pron_round', 'pron_say', 'pron_audio', 'settings', 'ai_usage', 'model_usage', 'usage_by_project', 'usage_by_purpose', 'auth_fail', 'auth_lock'].map((t) => db.prepare(`DELETE FROM ${t}`)));
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
  const r = await handle(req('/api/pron/' + p, body === undefined ? { cookie: ck } : { method: 'POST', cookie: ck, body: JSON.stringify(body) }), e, now);
  return { status: r.status, body: (await r.json()) as Record<string, any> };
};
/** 直接拿 Response（发音回的是 audio/mpeg，不是 JSON） */
const getRaw = (p: string, e: Env = env(), now = T0) => handle(req('/api/pron/' + p, { cookie: ck }), e, now);

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
describe('1. 位置：工作台二级菜单 7 项，上限还是 8，公共工具一个位子都没动', () => {
  const SUB_WORK = ADMIN_PAGE.slice(ADMIN_PAGE.indexOf('id="sub-work"'), ADMIN_PAGE.indexOf('</nav>', ADMIN_PAGE.indexOf('id="sub-work"')));
  const SUB_TOOLS = ADMIN_PAGE.slice(ADMIN_PAGE.indexOf('id="sub-tools"'), ADMIN_PAGE.indexOf('</nav>', ADMIN_PAGE.indexOf('id="sub-tools"')));

  it('正好 7 项，第 7 项是「发音训练」；「英语练习」「它记得住你」「带练」都不在了', () => {
    const mods = [...SUB_WORK.matchAll(/data-s="(w-[a-z]+)"/g)].map((m) => m[1]);
    expect(mods).toEqual(['w-now', 'w-todo', 'w-live', 'w-proj', 'w-num', 'w-meet', 'w-pron']);
    expect(SUB_WORK).toContain('<a href="#/work/pron" data-s="w-pron">发音训练</a>');
    // 上限就是 8（T-4）：现在 7 项，连上限都还没用满
    expect(mods.length).toBeLessThanOrEqual(8);
    for (const gone of ['w-english', 'w-engmem', 'w-drill', '英语练习', '带练']) expect([gone, SUB_WORK.includes(gone)]).toEqual([gone, false]);
  });

  it('公共工具菜单一个字没动：还是 8 项，没有「发音训练」（T-4）', () => {
    expect(SUB_TOOLS.match(/data-s="t-/g) ?? []).toHaveLength(8);
    expect(SUB_TOOLS).not.toContain('发音训练');
    expect(SUB_TOOLS).not.toContain('w-pron');
  });

  it('模块本体在工作台页 #v-work 里，只有一个，排在「经营会」后面（菜单顺序 = 页面顺序）', () => {
    const vwork = ADMIN_PAGE.slice(ADMIN_PAGE.indexOf('id="v-work"'), ADMIN_PAGE.indexOf('id="v-project"'));
    expect(vwork).toContain('id="w-pron"');
    expect(ADMIN_PAGE.match(/id="w-pron"/g) ?? []).toHaveLength(1);
    expect(vwork.indexOf('id="w-pron"')).toBeGreaterThan(vwork.indexOf('id="w-meet"'));
    // 下线的那三块一个都不在页面上了
    for (const gone of ['id="w-english"', 'id="w-engmem"', 'id="w-drill"', 'id="dr-ear"']) expect([gone, ADMIN_PAGE.includes(gone)]).toEqual([gone, false]);
  });

  it('进工作台时读一次记录（route() 里调 window.pronOpen），接口前缀是 /api/pron/', () => {
    expect(ADMIN_PAGE).toContain('window.pronOpen()');
    expect(ADMIN_PAGE).toContain("window.__pronBase='/api/pron/'");
    expect(ADMIN_PAGE).not.toContain('__drillBase');
    expect(ADMIN_PAGE).not.toContain('__engmemBase');
  });

  it('下线的那三块：源文件删干净了（T-3：文件直接删，不留注释掉的代码）', () => {
    for (const f of ['src/english-page.ts', 'src/english-memory.ts', 'src/english-memory-page.ts', 'src/drill.ts', 'src/drill-content.ts',
      'src/drill-page.ts', 'src/drill-review.ts', 'src/drill-audio.ts', 'src/ear.ts', 'src/ear-content.ts', 'src/ear-page.ts'])
      expect([f, existsSync(path.join(ROOT, f))]).toEqual([f, false]);
  });

  it('「最该做的事」没事做时那个按钮改去发音训练（原来指着已经没有的 #/work/english）', () => {
    expect(ADMIN_PAGE).toContain("link('趁空练 10 分钟发音 →','#/work/pron','btn big ghost')");
    expect(ADMIN_PAGE).not.toContain('#/work/english');
  });
});

// ======================================================================
describe('2. 四步循环：看口型 → 对照听 → 同一组连考 10 题 → 80% 过关给绕口令', () => {
  it('结构上就是四步，四块各一个，默认停在第 1 步（看口型）', () => {
    for (const id of ['pn-s1', 'pn-s2', 'pn-s3', 'pn-s4']) expect([id, PRON_MOD.includes('id="' + id + '"')]).toEqual([id, true]);
    expect(PRON_MOD).toMatch(/<div id="pn-s2" hidden>/);
    expect(PRON_MOD).toMatch(/<div id="pn-s3" hidden>/);
    expect(PRON_MOD).toMatch(/<div id="pn-s4" hidden>/);
    expect(PRON_MOD).not.toMatch(/<div id="pn-s1" hidden>/);
    expect(PRON_MOD).toContain('1 看口型');
    expect(PRON_MOD).toContain('2 对照听');
    expect(PRON_MOD).toContain('3 考 10 题');
    expect(PRON_MOD).toContain('4 过关');
  });

  it('第 1 步不考：两个音并排，课件原文的中文外号 + 逐条口型定位（页面从接口读，不自己造）', () => {
    const c = groupCard(G1) as Record<string, any>;
    expect(c.a).toEqual({ 音标: '/e/', 外号: '中咧嘴', 口型: ['咧嘴', '上下齿距离为 1cm 左右（可容纳一根食指）', '舌头平躺抵下齿'] });
    expect(c.b.外号).toBe('大咧嘴');
    expect(PRON_JS).toContain("nk.textContent=s['外号']");
    expect(PRON_JS).toContain("(s['口型']||[]).forEach");
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
    expect(earNote(g7)).toContain('只能看口型、跟读和纠说');
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
      const r = await handle(req('/api/pron/' + p, { method: p === 'state' ? 'GET' : 'POST', body: p === 'state' ? undefined : '{}' }), env(), T0);
      expect([p, r.status]).toEqual([p, 401]);
    }
  });

  it('不认识的路径回 404（不会悄悄落到别的接口上）', async () => {
    const r = await handle(req('/api/pron/whatever', { cookie: ck }), env(), T0);
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
    expect(PRON_JS).toContain('上面的看口型、对照听和考题照常能用');
    // 纠说那一块出错只写进它自己那条消息（#pn-saymsg），不影响第 1～3 步
    expect(PRON_MOD).toContain('id="pn-saymsg"');
    expect(PRON_JS).toContain("function pSayMsg(s){var m=pq('pn-saymsg');");
  });
});

// ======================================================================
describe('6. 发音：照搬带练那条链路（aura-2-en + 版本号键 + 额度闸 + 失败当面说）', () => {
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

  it('第一次点🔊：调一次 aura-2-en（text + speaker + encoding）、存进 pron_audio、回 audio/mpeg；第二次**不再调 AI**', async () => {
    const f = fakeAi();
    const r = await getRaw('audio/' + BED, f.env());
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('audio/mpeg');
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].model).toBe(TTS_AURA);
    expect(f.calls[0].inp).toEqual({ text: 'bed', speaker: AURA_SPEAKER, encoding: 'mp3' });
    const row = await db.prepare('SELECT item FROM pron_audio').first<{ item: string }>();
    expect(row?.item).toBe(audioKey(BED));
    expect(audioKey(BED)).toBe('a2:g1-1a');
    expect(AUDIO_REV).toBe('a2');
    const again = await getRaw('audio/' + BED, f.env());
    expect(again.status).toBe(200);
    expect(f.calls).toHaveLength(1); // 一次都没再调
  });

  it('56 段全生成一遍也远不到免费额度（别偷偷变成一笔新开销）', () => {
    const total = PRON_WORD_IDS.reduce((s, id) => s + ttsNeurons(TTS_AURA, audioTextOf(id)!), 0);
    expect(total).toBeLessThan(1000);
    expect(total).toBeGreaterThan(0);
  });

  it('没绑 Workers AI → 503 两句话；编号不认识 → 400；额度不够 → 429 且一次 AI 都不调（都不进库）', async () => {
    const off = await getRaw('audio/' + BED);
    expect(off.status).toBe(503);
    expect((await off.json() as any).怎么办).toBeTruthy();
    const f = fakeAi();
    const bad = await getRaw('audio/不认识的编号', f.env());
    expect(bad.status).toBe(400);
    expect(f.calls).toEqual([]);
    await db.prepare('INSERT INTO ai_usage (day, neurons) VALUES (?1, 99999)').bind(new Date(T0).toISOString().slice(0, 10)).run();
    const over = await getRaw('audio/' + BED, f.env());
    expect(over.status).toBe(429);
    expect(f.calls).toEqual([]);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM pron_audio').first<{ n: number }>())?.n).toBe(0);
  });

  it('模型出错 → 502 两句话、按估算记一笔账、库里不留半截；**失败就失败，不自动重试**', async () => {
    const f = fakeAi(async () => { throw new Error('aura 挂了'); });
    const r = await getRaw('audio/' + BED, f.env());
    expect(r.status).toBe(502);
    const j = await r.json() as any;
    expect(j.出错).toContain('aura 挂了');
    expect(j.怎么办).toContain('不会自动重试');
    expect((await db.prepare('SELECT COUNT(*) AS n FROM pron_audio').first<{ n: number }>())?.n).toBe(0);
    const u = await db.prepare('SELECT purpose FROM usage_by_purpose').first<{ purpose: string }>();
    expect(u?.purpose).toBe(PRON_TTS_PURPOSE);
    expect(PRON_TTS_PURPOSE).toBe('pron-tts');
  });

  it('aura 真实返回的是**二进制流**（不是 {audio: base64}）：这条路也要走得通', async () => {
    const f = fakeAi(async () => new Response(MP3).body as ReadableStream);
    const r = await getRaw('audio/' + BAD, f.env());
    expect(r.status).toBe(200);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(MP3);
  });

  it('页面：同一段只取一次、连点闸、「正在生成」提示、失败当面说（和带练那一套一字不差地同一个做法）', () => {
    expect(PRON_JS).toContain('if(PN.au[id]){pPlay(PN.au[id],msgId);return;}');
    expect(PRON_JS).toContain('if(PN.auBusy[id])return;');
    expect(PRON_JS).toContain("m.textContent='第一次要先生成这个词的发音，一两秒……'");
    expect(PRON_JS).toContain('function pAuErr(j,msgId)');
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

  it('没登录一律 401', async () => {
    const r = await handle(req('/api/pron/audio/' + BED), env(), T0);
    expect(r.status).toBe(401);
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
    expect(all[all.length - 1]).toBe(M0019);
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
    expect(PRON_CSS).toContain('#w-pron .pn-one .btn{width:100%;min-height:56px');
    expect(PRON_CSS).toContain('#w-pron .pn-two .btn{min-height:56px');
    expect(PRON_CSS).toContain('#w-pron .pn-pick .btn{display:block;min-height:56px');
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

  it('服务端不碰密钥：whisper 和 aura 都走 env.AI 绑定，没有新环境变量', () => {
    for (const f of ['src/pron.ts', 'src/pron-audio.ts']) {
      const t = readFileSync(path.join(ROOT, f), 'utf8');
      expect([f, /env\.(?!AI|DB)[A-Z]/.test(t)]).toEqual([f, false]);
      for (const w of ['API_KEY', 'TOKEN', 'PASSWORD', 'Authorization']) expect([f, w, t.includes(w)]).toEqual([f, w, false]);
    }
  });

  it('SQL 只碰自己那三张表 + settings（放今天纠了几次），别的表一个都不写', () => {
    const t = readFileSync(path.join(ROOT, 'src/pron.ts'), 'utf8') + readFileSync(path.join(ROOT, 'src/pron-audio.ts'), 'utf8');
    const tables = new Set([...t.matchAll(/(?:FROM|INTO|UPDATE)\s+(\w+)/g)].map((m) => m[1]).filter((x) => x !== 'SET'));
    expect([...tables].sort()).toEqual(['pron_audio', 'pron_round', 'pron_say', 'settings']);
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
describe('10. 口型图的依据：画面上每一处差别都指回 src/pron-content.ts 的 mouth 某一条（底线 3）', () => {
  it('每一条 mouth 原文都有归宿：要么翻成一个可见特征（画了），要么进"没画"，一条都不许丢', () => {
    for (const g of GROUPS) {
      for (const k of ['a', 'b'] as const) {
        const sp = mouthSpec(g[k]);
        const 收到 = [...sp.画了.map((f) => f.依据), ...sp.没画.map((x) => x.原文)];
        // 同一条原文可能画出不止一个特征（"2cm（可容纳两根食指）"= 开口 + 手指），所以比集合
        expect([g.id, k, [...new Set(收到)].sort()]).toEqual([g.id, k, [...g[k].mouth].sort()]);
        for (const f of sp.画了) expect([g.id, k, f.依据, g[k].mouth.includes(f.依据)]).toEqual([g.id, k, f.依据, true]);
      }
    }
  });

  it('逐组判：哪几组画得出口型差别、哪几组画不出（画不出的不许画出一个假的嘴型差别）', () => {
    expect(GROUPS.map((g) => [g.id, mouthPair(g).画得出差别])).toEqual([
      ['g1', true], // 开口 1cm vs 2cm
      ['g2', true], // 「由微张后慢慢闭合」vs「几乎为 0」
      ['g3', true], // 「先张嘴后咧嘴」+「张开后慢慢闭合」vs「咧嘴」+ 2cm
      ['g4', false], // /f/ /v/：都是「上齿轻咬下唇」，差在送气 / 声带
      ['g5', true], // 舌尖抵上齿龈 vs 舌尖卷起（在嘴里面，剖面示意）
      ['g6', false], // /n/ /l/：舌位一样，差在气流走鼻腔还是舌侧
      ['g7', false], // 课件一句口型都没给
    ]);
  });

  it('第 1 组：唯一该不一样的就是上下齿的开口，嘴型和舌位必须画成一样', () => {
    const m = mouthPair(GROUPS[0]);
    expect(m.差别.length).toBe(1);
    expect(m.差别[0]).toContain('上下齿的开口');
    expect(m.差别[0]).toContain('可容纳一根食指');
    expect(m.差别[0]).toContain('可容纳两根食指');
    // 嘴型、舌位两边一个值都不差
    expect(m.a.正面!.唇).toBe(m.b.正面!.唇);
    expect(m.a.剖面!.舌).toBe(m.b.剖面!.舌);
    expect(m.一样的).toEqual(['咧嘴', '舌头平躺抵下齿']);
    // 食指参照：课件说几根就画几根，不自己换算
    expect([m.a.正面!.手指, m.b.正面!.手指]).toEqual([1, 2]);
    expect([m.a.正面!.开口毫米, m.b.正面!.开口毫米]).toEqual([10, 20]);
  });

  it('课件没给尺寸的（「微张」「张开」）不许编一个厘米数：有尺寸 = false、不给食指参照', () => {
    for (const [i, k] of [[1, 'a'], [2, 'a']] as const) {
      const sp = mouthSpec(GROUPS[i][k]);
      expect([GROUPS[i].id, sp.正面!.有尺寸]).toEqual([GROUPS[i].id, false]);
      expect([GROUPS[i].id, sp.正面!.手指]).toEqual([GROUPS[i].id, null]);
      expect([GROUPS[i].id, sp.正面!.到毫米]).toEqual([GROUPS[i].id, 0]); // 「由…到闭合」是会动的两帧
    }
  });

  it('/f/ 和 /v/：口型一模一样，界面照实说"差别在喉咙，用手摸喉咙"（摸喉咙这句来自课件「声带振动」）', () => {
    const m = mouthPair(GROUPS[3]);
    expect(m.差别).toEqual([]);
    expect(m.a.正面!.唇).toBe('上齿轻咬下唇');
    expect(m.b.正面!.唇).toBe('上齿轻咬下唇');
    expect(m.摸喉咙).toBe(true);
    expect(m.说明).toContain('一模一样');
    expect(m.说明).toContain('送气不发声');
    expect(m.说明).toContain('声带振动');
    expect(m.说明).toContain('用手摸喉咙：振动的是 /v/');
  });

  it('/n/ 和 /l/：舌位一样、两个都振动声带 → 摸喉咙也分不出来，照实说（不许说摸喉咙管用）', () => {
    const m = mouthPair(GROUPS[5]);
    expect(m.差别).toEqual([]);
    expect(m.a.剖面!.舌).toBe(m.b.剖面!.舌);
    expect(m.摸喉咙).toBe(false);
    expect(m.说明).toContain('气流从鼻腔流出');
    expect(m.说明).toContain('气流从舌侧流出');
    expect(m.说明).toContain('摸喉咙也分不出来');
  });

  it('/ʒ/ 和 /dʒ/：课件一句口型都没有 → 一张图都不画，照实说（不编一个假的嘴型差别）', () => {
    const m = mouthPair(GROUPS[6]);
    for (const sp of [m.a, m.b]) {
      expect(sp.正面).toBeNull();
      expect(sp.剖面).toBeNull();
      expect(sp.画了).toEqual([]);
    }
    expect(m.说明).toContain('一句口型都没有');
    expect(m.说明).toContain('一张图都不画');
  });

  it('/l/ 和 /r/ 的差别在嘴里面：画剖面，并写明镜子里看不到', () => {
    const m = mouthPair(GROUPS[4]);
    expect(m.画得出差别).toBe(true);
    expect(m.有剖面).toBe(true);
    expect([m.a.剖面!.舌, m.b.剖面!.舌]).toEqual(['舌尖抵上齿龈', '舌尖卷起']);
    expect(m.a.正面).toBeNull(); // 课件没给这两个音的唇形 → 一个唇都不画
    expect(m.说明).toContain('镜子里看不到');
  });

  it('接口把口型图一起给页面（页面不自己造内容）', () => {
    const c = groupCard(GROUPS[0]) as Record<string, any>;
    expect(c['口型图']['画得出差别']).toBe(true);
    expect(c['口型图'].a['画了'][0]['依据']).toBe(GROUPS[0].a.mouth[0]);
  });
});

// ----------------------------------------------------------------------
// 页面脚本（src/pron-page.ts 的 PRON_JS）在 jsdom 里**真的跑一遍**（写法照 test/funds-impl.test.ts）：
// 口型图是不是照着依据画的、镜子有没有把画面送出去、录音回放的顺序对不对，这几件事光比字符串证明不了。
// ----------------------------------------------------------------------
type PWin = Window & typeof globalThis & { pronOpen(): void; eval(s: string): unknown };
/** 一台假的摄像头 / 麦克风：轨道被 stop() 过没有，测试直接数 */
const fakeStream = () => {
  const t = { stopped: 0, stop() { t.stopped++; }, kind: 'video' };
  return { track: t, getTracks: () => [t] };
};
/**
 * 开一个只有 #w-pron 的 jsdom 页面，跑真的 PRON_JS。
 * 网络一律走替身并**逐条记下来**（镜子那一段要证明"一次都没往外发"）。
 */
async function pronPage(opt: { cam?: 'ok' | 'deny' | 'none'; } = {}) {
  const jsdomName = 'jsdom';
  const { JSDOM } = await import(jsdomName);
  const dom = new JSDOM(`<!doctype html><body><main id="app">${PRON_MOD}</main></body>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window as unknown as PWin;
  const net: string[] = [];
  const plays: { src: string; rate: number }[] = [];
  const state = { 一共几组: GROUPS.length, 一轮几题: ROUND_N, 组: GROUPS.map(groupCard), 记录: [], 纠说: {}, 旧的去哪了: '样例' };
  const anyW = w as any;
  let 关了 = false;
  anyW.fetch = async (url: string, init?: { method?: string }) => {
    if (关了) return new Promise(() => {}); // 窗口关掉之后不再往回调（不然回调里 document 已经没了，冒一个假错误）
    net.push((init?.method ?? 'GET') + ' ' + url);
    if (/state$/.test(url)) return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(state)) };
    if (/audio\//.test(url)) return { ok: true, status: 200, headers: { get: () => 'audio/mpeg' }, blob: async () => new anyW.Blob(['mp3'], { type: 'audio/mpeg' }), json: async () => ({}) };
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
    this.pause = () => {};
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
          if (opt.cam === 'deny' && c.video) { const e = new Error('denied'); e.name = 'NotAllowedError'; throw e; }
          const s = fakeStream(); cams.push(s); return s;
        },
      },
    });
  }
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
  await until(() => w.document.querySelectorAll('#pn-draw .pn-mo').length === 2);
  /** 两个音那两块图：每个元素的样子（标签 + 全部属性），用来逐个比 */
  const pics = (sel = '#pn-draw') => [...w.document.querySelectorAll(sel + ' .pn-mo')].map((d) =>
    [...d.querySelectorAll('svg *')].map((e) => e.tagName + ' ' + [...e.attributes].map((a) => a.name + '=' + a.value).sort().join(' ')));
  const useGroup = (id: string) => {
    const b = [...w.document.querySelectorAll('#pn-pick .btn')].find((x) => x.textContent!.includes(id));
    (b as HTMLButtonElement).click();
  };
  // 关之前先让在飞的那几个 promise 落地（取发音、FileReader、POST say），再关窗口
  const close = async () => { 关了 = true; await new Promise((ok) => setTimeout(ok, 80)); w.close(); };
  return { w, $, click, until, net, plays, cams, pics, useGroup, close };
}

describe('11. 页面照着依据画：课件没说的一笔都不画（jsdom 里真跑一遍 PRON_JS）', () => {
  it('图里每一笔都带依据，而且依据就是这个音 mouth 里的原文（图框除外，图框两个音完全一样）', async () => {
    const p = await pronPage();
    try {
      for (const g of GROUPS) {
        p.useGroup(`${g.a.ipa} vs ${g.b.ipa}`);
        await p.until(() => p.$('pn-draw').querySelectorAll('.pn-mo').length === 2);
        const 块 = [...p.w.document.querySelectorAll('#pn-draw .pn-mo')];
        块.forEach((d, i) => {
          const sound = i === 0 ? g.a : g.b;
          for (const e of [...d.querySelectorAll('svg *')]) {
            const y = e.getAttribute('data-y');
            const frame = e.getAttribute('data-frame');
            // 一笔要么有依据、要么是图框，没有第三种
            expect([g.id, i, e.tagName, !!y || !!frame]).toEqual([g.id, i, e.tagName, true]);
            if (y) for (const one of y.split(' | ')) expect([g.id, i, one, sound.mouth.includes(one)]).toEqual([g.id, i, one, true]);
          }
        });
      }
    } finally { await p.close(); }
  });

  it('画不出差别的那几组（/f/ /v/、/n/ /l/）两个音的图**逐笔一模一样**，不编一个假的嘴型差别', async () => {
    const p = await pronPage();
    try {
      for (const g of [GROUPS[3], GROUPS[5]]) {
        p.useGroup(`${g.a.ipa} vs ${g.b.ipa}`);
        await p.until(() => p.$('pn-drawnote').textContent!.includes('一模一样'));
        const [A, B] = p.pics();
        expect([g.id, A]).toEqual([g.id, B]);
        expect([g.id, A.length > 0]).toEqual([g.id, true]);
      }
    } finally { await p.close(); }
  });

  it('第 1 组：两张图**只有**上下齿那几笔不一样，不一样的每一笔都指得回"开口"那条原文', async () => {
    const p = await pronPage();
    try {
      const g = GROUPS[0];
      const [A, B] = p.pics();
      // 两张图里凡是**对面没有一模一样一笔**的，依据里必须带"1cm / 2cm"那条原文 —— 别的地方一笔都不许不一样
      const 只在A = A.filter((x) => !B.includes(x));
      const 只在B = B.filter((x) => !A.includes(x));
      expect(只在A.length + 只在B.length).toBeGreaterThan(0);
      for (const x of [...只在A, ...只在B]) {
        expect([x, /data-y=/.test(x)]).toEqual([x, true]);
        expect([x, /1cm|2cm/.test(x)]).toEqual([x, true]);
      }
      // 没提到 cm 的那几笔（嘴唇拉开多少、舌头）两边完全一样，一笔不差
      expect(A.filter((x) => !x.includes('cm'))).toEqual(B.filter((x) => !x.includes('cm')));
      expect(A.filter((x) => x.includes('平躺抵下齿'))).toEqual(B.filter((x) => x.includes('平躺抵下齿')));
      expect(p.$('pn-drawnote').textContent).toContain('可容纳一根食指');
      expect(g.a.mouth[1]).toContain('一根食指');
    } finally { await p.close(); }
  });

  it('第 7 组：一张图都不画，面板上照实说"课件没给这个音的口型"', async () => {
    const p = await pronPage();
    try {
      p.useGroup(`${GROUPS[6].a.ipa} vs ${GROUPS[6].b.ipa}`);
      await p.until(() => p.$('pn-drawnote').textContent!.includes('一张图都不画'));
      expect(p.w.document.querySelectorAll('#pn-draw svg').length).toBe(0);
      expect(p.$('pn-draw').textContent).toContain('课件没给这个音的口型');
    } finally { await p.close(); }
  });

  it('来回切换：点一下两个音轮流高亮；课件写「由…到…」的音**两帧真的不一样**（会动的是它自己说的）', async () => {
    const p = await pronPage();
    try {
      p.useGroup(`${GROUPS[1].a.ipa} vs ${GROUPS[1].b.ipa}`); // /eɪ/「上下齿由微张后慢慢闭合」
      await p.until(() => p.$('pn-draw').querySelectorAll('.pn-mo').length === 2);
      const 帧0 = p.pics()[0];
      p.click('pn-anim');
      expect(p.$('pn-anim').getAttribute('aria-pressed')).toBe('true');
      expect(p.w.document.querySelectorAll('#pn-draw .pn-mo.lit').length).toBe(1);
      await p.until(() => JSON.stringify(p.pics()[0]) !== JSON.stringify(帧0)); // 450ms 一拍，第 2 帧和第 1 帧不同
      expect(JSON.stringify(p.pics()[0])).not.toBe(JSON.stringify(帧0));
      p.click('pn-anim');
      expect(p.$('pn-anim').getAttribute('aria-pressed')).toBe('false');
      expect(p.w.document.querySelectorAll('#pn-draw .pn-mo.lit').length).toBe(0);
      // 不会动的音（/iː/「距离几乎为 0」）两帧一样：不给它假装动
      const b0 = JSON.stringify(p.pics()[1]);
      p.click('pn-anim');
      await new Promise((ok) => setTimeout(ok, 500));
      expect(JSON.stringify(p.pics()[1])).toBe(b0);
      p.click('pn-anim');
    } finally { await p.close(); }
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
      expect(p.$('pn-mirtarget').querySelectorAll('svg').length).toBeGreaterThan(0); // 左边是目标口型图
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
        // 其余部分照常：口型图还在、能去第 2 步、对照听的按钮还在
        expect([cam, p.w.document.querySelectorAll('#pn-draw .pn-mo').length]).toEqual([cam, 2]);
        p.click('pn-go2');
        expect([cam, p.$('pn-s2').hidden]).toEqual([cam, false]);
        expect([cam, p.w.document.querySelectorAll('#pn-cmp .pn-pair button').length]).toEqual([cam, 8]);
      } finally { await p.close(); }
    }
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
      expect(p.net.slice(n0).filter((x) => x.startsWith('POST'))).toEqual(['POST /api/pron/say']);
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
