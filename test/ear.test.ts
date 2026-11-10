/**
 * 工作台「带练 → 听辨小测」（src/ear.ts、src/ear-page.ts、src/ear-content.ts、migrations/0017_ear.sql）的测试。
 *
 * 为什么有这一块（Amos 2026-11-10 原话）：「自然拼读有很多我都不会，读的不标准，那也就意味着我听出来的
 * 声音也就有问题，**所以可能会听不懂别人在说什么**」。所以不背拼读规则，直接练耳朵。
 *
 * 守住九件事：
 *   1. **内容一个字都没改**：8 组最小对立对的词形、音标、在分什么音在测试里**逐字写死**（防手滑）；
 *      音标都带得出剑桥词条页地址。内容归产品（src/ear-content.ts），界面代码一个字都不许自己编。
 *   2. **不新开菜单项**：工作台还是 8 项、公共工具还是 8 项（T-4：第 9 项会撑破手机菜单）；
 *      听辨小测在已有的 `#w-drill` 里当第二个模式，**默认藏着**（打开带练先看到的还是带练）。
 *   3. **全程不让他看到答案词是哪个**：结构里不出现任何一个词、不出现任何一个编号（p1a…p8b），
 *      「🔊」那个按钮上**只有「再听一次」**；两个词的拼写是脚本现场写进按钮的。
 *   4. **三个按钮一样高**：两个词并排 + 「两个听着一样」，全部 ≥52px（实际 56px），字号一样大。
 *   5. **答完才给对比**：对 / 错 + 点名刚才放的是哪个词 + 两个词单独能听 + 差在哪 + 两个音标。
 *   6. **记下他错在哪**（这才是真正的产出）：tries / ok / same 三个数分开记，`same` 单独一列——
 *      它是唯一能把"他分不出"和"机器没念出区别"分开的办法。
 *   7. **发音复用带练那一套**：16 个编号挂在 drill.ts 的 AUDIO_IDS / audioTextOf()，念的就是那个词本身；
 *      页面调的是带练露出来的同一个 `dAudio`（连点闸、「正在生成」提示、失败当面说、不自动重试都跟着复用）。
 *   8. **不调 AI、不花钱、不碰密钥、不让他打字**：ear.ts 不 import 任何 AI 模块，SQL 只有 ear_pair；
 *      整块一个 `<input>` 都没有、不出现命令行。
 *   9. **迁移 0017 只 CREATE**：一条 CREATE TABLE，没有 ALTER / DROP / 索引 / 回填；
 *      在已有 0001～0016 数据的库上跑，旧表一行不动。
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import { ADMIN_PAGE } from '../src/admin-page';
import { DRILL_MOD } from '../src/drill-page';
import { EAR_CSS, EAR_JS, EAR_MOD } from '../src/ear-page';
import { PAIRS } from '../src/ear-content';
import { earState, earWordOf, EAR_N, EAR_PAIR_IDS, EAR_WORD_IDS, type EarRow } from '../src/ear';
import { AUDIO_IDS, audioTextOf } from '../src/drill';
import { ROOT, T0 } from './helpers';

const PASS = 'ci_only_copilot_password_01';
const HOST = 'https://copilot.example.test';
const MIG = path.join(ROOT, 'migrations');
const M0017 = '0017_ear.sql';

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
  await db.batch(['ear_pair', 'drill_audio', 'ai_usage', 'model_usage', 'usage_by_project', 'usage_by_purpose', 'auth_fail', 'auth_lock'].map((t) => db.prepare(`DELETE FROM ${t}`)));
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
  const r = await handle(req('/api/drill/ear/' + p, body === undefined ? { cookie: ck } : { method: 'POST', cookie: ck, body: JSON.stringify(body) }), env(), now);
  return { status: r.status, body: (await r.json()) as Record<string, any> };
};
/** 假的 Workers AI：melotts 回 {audio: base64} */
const MP3 = Uint8Array.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x11, 0x22, 0x33]);
const b64 = (a: Uint8Array) => btoa(String.fromCharCode(...a));
function fakeAi() {
  const calls: { model: string; inp: Record<string, unknown> }[] = [];
  const AI = { run: async (model: string, inp: unknown) => { calls.push({ model, inp: inp as Record<string, unknown> }); return { audio: b64(MP3) }; } };
  return { calls, env: (): Env => ({ ...env(), AI }) };
}
/** 答一组：组号、刚才放的是 a 还是 b、他点了什么 */
const answer = (组: string, 放的: string, 选的: string, now = T0) => api('answer', { 组, 放的, 选的 }, now);
/** 结构里**看得见的那些字**（标签、属性、class 名不算，`.dr-card` 里的 card 不能算成那个词） */
const visible = (html: string) => html.replace(/<[^>]*>/g, ' ');

// ======================================================================
describe('1. 内容：8 组最小对立对，和定稿逐字一致（防手滑；内容归产品 src/ear-content.ts）', () => {
  it('8 组的两个词、音标、在分什么音逐字对得上', () => {
    expect(PAIRS.map((p) => [p.id, p.a.word, p.a.ipa, p.b.word, p.b.ipa, p.contrast])).toEqual([
      ['p1', 'bad', '/bæd/', 'bed', '/bed/', '/æ/ 和 /e/'],
      ['p2', 'seat', '/siːt/', 'sit', '/sɪt/', '/iː/ 和 /ɪ/'],
      ['p3', 'lock', '/lɑːk/', 'luck', '/lʌk/', '/ɑː/ 和 /ʌ/'],
      ['p4', 'right', '/raɪt/', 'light', '/laɪt/', '/r/ 和 /l/'],
      ['p5', 'think', '/θɪŋk/', 'sink', '/sɪŋk/', '/θ/ 和 /s/'],
      ['p6', 'vest', '/vest/', 'west', '/west/', '/v/ 和 /w/'],
      ['p7', 'thin', '/θɪn/', 'thing', '/θɪŋ/', '/n/ 和 /ŋ/'],
      ['p8', 'card', '/kɑːrd/', 'car', '/kɑːr/', '词尾 /d/ 在不在'],
    ]);
  });

  it('编号全局唯一（p1a…p8b 共 16 个）、每组都有一行"差在哪"、每个音标都带得出词条页地址', () => {
    expect(EAR_N).toBe(8);
    expect(EAR_PAIR_IDS).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']);
    expect(EAR_WORD_IDS).toHaveLength(16);
    expect(new Set(EAR_WORD_IDS).size).toBe(16);
    for (const p of PAIRS) {
      expect([p.id, p.a.id, p.b.id]).toEqual([p.id, p.id + 'a', p.id + 'b']);
      expect([p.id, p.explain.length > 0 && p.explain.length <= 30]).toEqual([p.id, true]);
      for (const w of [p.a, p.b]) expect([w.id, w.src.startsWith('https://dictionary.cambridge.org/')]).toEqual([w.id, true]);
      // 最小对立对：两个词必须不一样（只差一个音是人工核对的，这里只拦"抄成了同一个词"）
      expect([p.id, p.a.word === p.b.word]).toEqual([p.id, false]);
    }
    expect(earWordOf('p1a')).toBe('bad');
    expect(earWordOf('p8b')).toBe('car');
    expect(earWordOf('p9a')).toBe(null);
  });
});

// ======================================================================
describe('2. 位置：不新开菜单项，放进已有的「带练」里当第二个模式，默认藏着', () => {
  const SUB_WORK = ADMIN_PAGE.slice(ADMIN_PAGE.indexOf('id="sub-work"'), ADMIN_PAGE.indexOf('</nav>', ADMIN_PAGE.indexOf('id="sub-work"')));
  const SUB_TOOLS = ADMIN_PAGE.slice(ADMIN_PAGE.indexOf('id="sub-tools"'), ADMIN_PAGE.indexOf('</nav>', ADMIN_PAGE.indexOf('id="sub-tools"')));

  it('工作台二级菜单还是 8 项、公共工具还是 8 项，没有「听辨」这一项（T-4：第 9 项会撑破手机菜单）', () => {
    expect([...SUB_WORK.matchAll(/data-s="(w-[a-z]+)"/g)].map((m) => m[1])).toEqual(['w-now', 'w-todo', 'w-live', 'w-proj', 'w-num', 'w-meet', 'w-english', 'w-drill']);
    expect(SUB_TOOLS.match(/data-s="t-/g) ?? []).toHaveLength(8);
    for (const nav of [SUB_WORK, SUB_TOOLS]) {
      expect(nav).not.toContain('听辨');
      expect(nav).not.toContain('dr-ear');
    }
  });

  it('整块在 #w-drill 里，只有一份；模式开关两个按钮「带练」「听辨小测」，默认选中「带练」', () => {
    const mod = ADMIN_PAGE.slice(ADMIN_PAGE.indexOf('id="w-drill"'), ADMIN_PAGE.indexOf('</section>', ADMIN_PAGE.indexOf('id="w-drill"')));
    expect(mod).toContain('id="dr-ear"');
    expect(ADMIN_PAGE.match(/id="dr-ear"/g) ?? []).toHaveLength(1);
    expect(DRILL_MOD).toContain(EAR_MOD);
    expect(DRILL_MOD).toContain('id="dr-m-drill" aria-pressed="true">带练</button>');
    expect(DRILL_MOD).toContain('id="dr-m-ear" aria-pressed="false">听辨小测</button>');
    // 默认藏着：打开带练先看到的还是带练；带练正文另有一个 #dr-main 包着，切模式只换这两个
    expect(EAR_MOD.startsWith('<div id="dr-ear" hidden>')).toBe(true);
    expect(DRILL_MOD).toContain('<div id="dr-main">');
    expect(EAR_JS).toContain("eShow('dr-main',!on);eShow('dr-ear',on);");
  });

  it('切到听辨：顶上那一句话和模块副标题跟着换成听辨的，切回带练**原样放回去**（不留下"三段都练完了"这种对不上的话）', () => {
    expect(DRILL_MOD).toContain('<span class="aux" id="dr-aux">场景 0 · 前三段</span>');
    expect(DRILL_MOD).toContain('<span class="soft" id="dr-soft">');
    expect(EAR_JS).toContain("if(!EA.keep)EA.keep={t:lt?lt.textContent:'',d:dot?dot.className:'',a:ax?ax.textContent:'',s:sf?sf.textContent:''};");
    expect(EAR_JS).toContain("if(lt)lt.textContent=EA.keep.t;");
    expect(EAR_JS).toContain("if(ax)ax.textContent='听辨小测 · 8 组';");
    expect(EAR_JS).toContain("eText('dr-lead-t','这一轮听对 '+ok+' / '+n+'（听辨小测）');");
  });
});

// ======================================================================
describe('3. 全程不让他看到答案词是哪个', () => {
  it('结构里不出现任何一个编号（p1a…p8b），也不出现那 16 个词', () => {
    for (const id of EAR_WORD_IDS) expect([id, EAR_MOD.includes(id)]).toEqual([id, false]);
    for (const id of EAR_PAIR_IDS) expect([id, EAR_MOD.includes('"' + id + '"')]).toEqual([id, false]);
    const txt = visible(EAR_MOD);
    for (const p of PAIRS) for (const w of [p.a.word, p.b.word]) {
      expect([w, new RegExp('(^|[^a-z])' + w + '([^a-z]|$)').test(txt)]).toEqual([w, false]);
    }
    // 音标也不许写死在结构里（那是答完才给的）
    for (const p of PAIRS) for (const w of [p.a, p.b]) expect([w.id, EAR_MOD.includes(w.ipa)]).toEqual([w.id, false]);
  });

  it('🔊 那个按钮上只有「再听一次」，两个选项按钮的字是脚本现场写进去的（结构里是占位的「—」）', () => {
    expect(EAR_MOD).toContain('id="dr-ear-say">🔊 再听一次</button>');
    expect(EAR_MOD).toContain('id="dr-ear-l">—</button>');
    expect(EAR_MOD).toContain('id="dr-ear-r">—</button>');
    expect(EAR_JS).toContain("eText('dr-ear-l',eWord(p,EA.left));");
    expect(EAR_JS).toContain("eText('dr-ear-r',eWord(p,eOther(EA.left)));");
    // 刚才放的是哪个（EA.say）只在**答完之后**由服务端的「放的是」写出来，脚本自己不往页面写
    expect(EAR_JS).toContain("var was=(j['放的是']||{})['词']||'';");
    expect(EAR_JS).not.toContain("eText('dr-ear-ver',eWord(p,EA.say)");
  });

  it('对错 / 刚才放的是哪个词 / 两个音标，全在答完才显示的 #dr-ear-res 里，默认藏着', () => {
    const res = EAR_MOD.slice(EAR_MOD.indexOf('<div id="dr-ear-res"'), EAR_MOD.indexOf('<div class="dr-ear-sum"'));
    expect(res.startsWith('<div id="dr-ear-res" hidden>')).toBe(true);
    for (const id of ['dr-ear-ver', 'dr-ear-wa', 'dr-ear-wb', 'dr-ear-ex', 'dr-ear-ipa', 'dr-ear-next']) expect([id, res.includes('id="' + id + '"')]).toEqual([id, true]);
    expect(EAR_JS).toContain("eShow('dr-ear-play',false);eShow('dr-ear-res',true);");
  });

  it('每组放哪个词、8 组的顺序、两个选项的左右，三样都随机（别让他靠位置猜）', () => {
    expect(EAR_JS).toContain('function eMix(a){for(var i=a.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));');
    expect(EAR_JS).toContain("function eCoin(){return Math.random()<0.5?'a':'b';}");
    expect(EAR_JS).toContain('EA.say=eCoin();EA.left=eCoin();');
    expect(EAR_JS).toContain('function eRound(){EA.order=eMix(EA.zu.slice());EA.i=0;EA.res=[];eGroup();}');
    // 「再来一轮」就是重新打散（不是接着上一轮的顺序）
    expect(EAR_MOD).toContain('id="dr-ear-again">再来一轮</button>');
    expect(EAR_JS).toContain("if(ag)ag.addEventListener('click',eRound);");
  });
});

// ======================================================================
describe('4. 三个按钮一样高、够大；不让他打字；不出现命令行', () => {
  it('两个词并排 + 「两个听着一样」，三个都走带练那条 ≥56px 的规则（.dr-two / .dr-one）', () => {
    expect(EAR_MOD).toContain('<div class="dr-two" id="dr-ear-pick">');
    expect(EAR_MOD).toContain('<div class="dr-one dr-ear-same"><button class="btn" type="button" id="dr-ear-same">两个听着一样</button></div>');
    // 「两个听着一样」**不是次要按钮**：和另外两个同一套 class、同一条高度和字号规则（它占满一整行，比另外两个还宽）
    const pick = EAR_MOD.slice(EAR_MOD.indexOf('id="dr-ear-pick"'), EAR_MOD.indexOf('</div>', EAR_MOD.indexOf('id="dr-ear-same"')));
    expect((pick.match(/class="btn"/g) ?? []).length).toBe(3);
    // 这一块自己不另写一条按钮高度规则（省得漏改一处就变小）
    expect(EAR_CSS).not.toContain('min-height');
  });

  it('整块里一个输入框都没有、不出现命令行、不出现密钥变量名（底线 1、把用户当小白）', () => {
    for (const s of [EAR_MOD, EAR_JS, EAR_CSS]) {
      for (const w of ['<input', 'input', '<textarea', 'contenteditable', 'TOKEN', 'API_KEY', 'PASSWORD', 'SECRET', 'npm ', 'curl ', 'wrangler ', 'node scripts/']) {
        expect([w, s.includes(w)]).toEqual([w, false]);
      }
    }
  });

  it('字号只用全站那几级（12 / 13 / 15 / 17 / 18 / 22 / 24 / 26 / 30，控件 14），不自己造一级', () => {
    const FS = [12, 13, 14, 15, 17, 18, 22, 24, 26, 30];
    const sizes = [...EAR_CSS.matchAll(/font-size:(\d+)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(2);
    expect(sizes.filter((x) => !FS.includes(x))).toEqual([]);
  });

  it('不造占位词：没有「暂无」「待补」这类（底线 3）', () => {
    for (const w of ['暂无', '待补', '待定', 'N/A']) expect([w, EAR_MOD.includes(w) || EAR_JS.includes(w)]).toEqual([w, false]);
  });
});

// ======================================================================
describe('5. 答完那一刻：对 / 错 + 点名放的是哪个词 + 两个词都能单独听 + 差在哪 + 两个音标', () => {
  it('三种结果各一句话，都点名「刚才放的是哪个词」', () => {
    expect(EAR_JS).toContain("eText('dr-ear-ver','✅ 对了 —— 刚才放的就是 '+was);");
    expect(EAR_JS).toContain("eText('dr-ear-ver','❌ 不对 —— 刚才放的是 '+was+'，你点的是 '+(j['你选的']||''));");
    expect(EAR_JS).toContain("eText('dr-ear-ver','你说两个听着一样 —— 刚才放的是 '+was);");
  });

  it('两个词各一个按钮能单独听（学习就发生在这一刻），一行差在哪，一行两个音标', () => {
    expect(EAR_JS).toContain("eText('dr-ear-wa','🔊 '+p.a['词']);");
    expect(EAR_JS).toContain("eText('dr-ear-wb','🔊 '+p.b['词']);");
    expect(EAR_JS).toContain("if(wa)wa.addEventListener('click',function(){var p=EA.order[EA.i];if(p)ePlay(p.a['编号'])});");
    expect(EAR_JS).toContain("if(wb)wb.addEventListener('click',function(){var p=EA.order[EA.i];if(p)ePlay(p.b['编号'])});");
    expect(EAR_JS).toContain("eText('dr-ear-ex',j['差在哪']||p['差在哪']||'');");
    expect(EAR_JS).toContain("eText('dr-ear-ipa',p.a['词']+' '+p.a['音标']+'　·　'+p.b['词']+' '+p.b['音标']);");
  });

  it('每个词给一个「听真人念」的链接，跳内容文件里那个词的出处（剑桥词条页有真人录音）', () => {
    // 为什么有这一行：上面那两个🔊是 melotts 合成的，**合成音可能把元音念歪**——
    // 他听得很清楚却选错，那是机器的错不是他的耳朵，而「两个听着一样」那个按钮**分不出这一种**。
    // （2026-11-10 两轮 16 题，他一次都没点那个按钮，bad/bed 和 lock/luck 两轮全错。）
    expect(EAR_MOD).toContain('id="dr-ear-human"');
    expect(EAR_JS).toContain('function eHuman(p){');
    expect(EAR_JS).toContain('eHuman(p);');
    // 地址只能来自内容文件的「出处」，**不许页面自己拼词典地址**
    expect(EAR_JS).toContain("a.href=w['出处'];");
    expect(EAR_JS).not.toMatch(/dictionary\.cambridge\.org/);
    // 用 createElement 建，不拼 HTML 字符串（出处是我们自己的内容，但不开这个口子）
    expect(EAR_JS).toContain("document.createElement('a')");
    expect(EAR_JS).not.toMatch(/dr-ear-human[^\n]*innerHTML/);
    // 外链要带 noopener（新标签页打开，别让对方页面拿到 window.opener）
    expect(EAR_JS).toContain("a.rel='noopener noreferrer';");
    expect(EAR_JS).toContain("a.target='_blank';");
    // 没有出处就不画那个链接（不造占位、不给死链，底线 3）
    expect(EAR_JS).toContain("if(!w||!w['出处'])return;");
    // 内容文件里 16 个词**每个都有出处**，所以线上这一行不会是空的
    expect(PAIRS.flatMap((p) => [p.a, p.b]).filter((w) => !w.src)).toEqual([]);
  });

  it('走完给小结：听对 N / 8、错的那几组、点过「两个听着一样」的那几组（并写明可能是机器没念出区别）', () => {
    expect(EAR_JS).toContain("eText('dr-ear-score','听对 '+ok+' / '+n);");
    expect(EAR_JS).toContain("var bad=EA.res.filter(function(x){return !x.对&&!x.一样});");
    expect(EAR_JS).toContain("var sm=EA.res.filter(function(x){return x.一样});");
    expect(EAR_JS).toContain("li.textContent=x.p.a['词']+' / '+x.p.b['词']+' —— 在分 '+x.p['在分什么音'];");
    expect(EAR_MOD).toContain('这几组要么是你还分不出来，<b>要么是机器没念出区别</b> —— 说一声，我们换模型。');
    // 没有错的 / 没点过「一样」的，那一段整块不显示（不写"无"）
    expect(EAR_JS).toContain("eShow('dr-ear-badwrap',bad.length>0);");
    expect(EAR_JS).toContain("eShow('dr-ear-smwrap',sm.length>0);");
  });
});

// ======================================================================
describe('6. 接口：对错由服务端算，三个数分开记（这才是真正的产出）', () => {
  it('GET state：8 组都给（两个词、音标、在分什么音、差在哪），记录一开始全是 0', async () => {
    const { status, body } = await api('state');
    expect(status).toBe(200);
    expect(body['一共']).toBe(8);
    expect(body['组']).toHaveLength(8);
    expect(body['组'][0]).toEqual({
      组: 'p1', 在分什么音: '/æ/ 和 /e/', 差在哪: PAIRS[0].explain, 挂在带练: 'catch',
      a: { 编号: 'p1a', 词: 'bad', 音标: '/bæd/', 出处: PAIRS[0].a.src },
      b: { 编号: 'p1b', 词: 'bed', 音标: '/bed/', 出处: PAIRS[0].b.src },
    });
    expect(body['记录']).toHaveLength(8);
    expect(body['记录'][0]).toEqual({ 组: 'p1', 两个词: 'bad / bed', 在分什么音: '/æ/ 和 /e/', 考过: 0, 对: 0, 两个听着一样: 0 });
    expect(body['累计']).toEqual({ 考过: 0, 对: 0, 两个听着一样: 0 });
  });

  it('选对 / 选错 / 点「两个听着一样」：三种各记一笔，tries / ok / same 分开记', async () => {
    const r1 = await answer('p1', 'a', 'a');
    expect([r1.status, r1.body['对'], r1.body['两个听着一样'], r1.body['放的是']]).toEqual([200, true, false, { 编号: 'p1a', 词: 'bad', 音标: '/bæd/' }]);
    const r2 = await answer('p1', 'b', 'a');
    expect([r2.status, r2.body['对'], r2.body['你选的'], r2.body['放的是']['词']]).toEqual([200, false, 'bad', 'bed']);
    const r3 = await answer('p2', 'a', 'same');
    expect([r3.status, r3.body['对'], r3.body['两个听着一样'], r3.body['你选的']]).toEqual([200, false, true, null]);
    const row = await db.prepare('SELECT pair, tries, ok, same, at FROM ear_pair ORDER BY pair').all<EarRow>();
    expect(row.results).toEqual([
      { pair: 'p1', tries: 2, ok: 1, same: 0, at: T0 },
      { pair: 'p2', tries: 1, ok: 0, same: 1, at: T0 },
    ]);
    // 页面要的累计跟着一起回来（答完不用再跑一趟 state）
    expect(r3.body['记着了']['累计']).toEqual({ 考过: 3, 对: 1, 两个听着一样: 1 });
  });

  it('「两个听着一样」不算对，但**算考过一次**（same 高的组要先去听机器念的那两段）', () => {
    const rows: EarRow[] = [{ pair: 'p5', tries: 3, ok: 0, same: 3, at: T0 }];
    const st = earState(rows) as Record<string, any>;
    expect(st['记录'].find((x: any) => x.组 === 'p5')).toEqual({ 组: 'p5', 两个词: 'think / sink', 在分什么音: '/θ/ 和 /s/', 考过: 3, 对: 0, 两个听着一样: 3 });
    expect(st['累计']).toEqual({ 考过: 3, 对: 0, 两个听着一样: 3 });
  });

  it('入参不对一律两句话、不进库：组号不认识 / 没说放的是哪个 / 没说选了哪个', async () => {
    for (const body of [{ 组: 'p9', 放的: 'a', 选的: 'a' }, { 组: 'p1', 放的: 'c', 选的: 'a' }, { 组: 'p1', 放的: 'a', 选的: 'x' }, {}]) {
      const r = await api('answer', body);
      expect([JSON.stringify(body), r.status]).toEqual([JSON.stringify(body), 400]);
      expect([JSON.stringify(body), typeof r.body['出错'], typeof r.body['怎么办']]).toEqual([JSON.stringify(body), 'string', 'string']);
    }
    expect((await db.prepare('SELECT COUNT(*) AS n FROM ear_pair').first<{ n: number }>())?.n).toBe(0);
  });

  it('走后台登录：没有 cookie 一律不给（和 /api/drill/* 同一套）', async () => {
    const r = await handle(req('/api/drill/ear/state'), env(), T0);
    expect(r.status).not.toBe(200);
  });

  it('不认识的路径回 404（不会悄悄落到带练那条上）', async () => {
    const r = await handle(req('/api/drill/ear/别的', { cookie: ck }), env(), T0);
    expect(r.status).toBe(404);
  });
});

// ======================================================================
describe('7. 发音：复用带练那一套（不另开第二套）', () => {
  it('16 个编号都挂在 drill.ts 的 AUDIO_IDS 上，念的就是那个词本身', () => {
    for (const id of EAR_WORD_IDS) {
      expect([id, AUDIO_IDS.includes(id)]).toEqual([id, true]);
      expect([id, audioTextOf(id)]).toEqual([id, earWordOf(id)]);
    }
    expect(audioTextOf('p1a')).toBe('bad');
    expect(audioTextOf('p8b')).toBe('car');
  });

  it('16 段都能生成、都存进 drill_audio；再点一遍一次都不再调 melotts（不新增一分钱费用）', async () => {
    const ai = fakeAi();
    for (const id of EAR_WORD_IDS) {
      const r = await handle(req('/api/drill/audio/' + id, { cookie: ck }), ai.env(), T0);
      expect([id, r.status, r.headers.get('content-type')]).toEqual([id, 200, 'audio/mpeg']);
    }
    expect(ai.calls).toHaveLength(16);
    expect(ai.calls.map((c) => c.inp.prompt)).toEqual(EAR_WORD_IDS.map((id) => earWordOf(id)));
    expect((await db.prepare('SELECT COUNT(*) AS n FROM drill_audio').first<{ n: number }>())?.n).toBe(16);
    for (const id of EAR_WORD_IDS) expect([id, (await handle(req('/api/drill/audio/' + id, { cookie: ck }), ai.env(), T0)).status]).toEqual([id, 200]);
    expect(ai.calls).toHaveLength(16);
  });

  it('页面调的就是带练露出来的那一个 dAudio（连点闸、「正在生成」提示、失败当面说、不自动重试全跟着复用）', () => {
    expect(EAR_JS).toContain("function ePlay(编号){if(编号&&window.drillAudio)window.drillAudio(编号,1,'ear','dr-ear-msg');}");
    // 这一块自己不另写一个播放器 / 另发一次 audio 请求
    for (const w of ['new Audio(', "'audio/'", 'playbackRate', 'setTimeout', 'setInterval']) expect([w, EAR_JS.includes(w)]).toEqual([w, false]);
    // 报错写进听辨自己那条（带练那条在另一个模式里，这会儿是藏着的）
    expect(EAR_MOD).toContain('<div class="dr-aumsg" id="dr-ear-msg" hidden></div>');
  });

  it('进这一组自动放一次；「🔊 再听一次」放的是同一个词（不是重新抽一个）', () => {
    const grp = EAR_JS.slice(EAR_JS.indexOf('function eGroup()'), EAR_JS.indexOf('/* 选完'));
    expect(grp).toContain("ePlay(p[EA.say]['编号']);");
    expect((grp.match(/EA\.say=eCoin\(\)/g) ?? []).length).toBe(1);
    expect(EAR_JS).toContain("if(sy)sy.addEventListener('click',function(){var p=EA.order[EA.i];if(p)ePlay(p[EA.say]['编号'])});");
  });
});

// ======================================================================
describe('8. 不调 AI、不花钱、不碰密钥；SQL 只有 ear_pair', () => {
  const src = readFileSync(path.join(ROOT, 'src/ear.ts'), 'utf8');

  it('ear.ts 不 import 任何 AI 模块、不出现模型名 / 接口地址 / 记账', () => {
    for (const w of ["from './ai'", "from './gemini'", "from './workers-ai'", "from './tts'", '@cf/', 'generativelanguage', '/v1/', 'chargeNeurons']) {
      expect([w, src.includes(w)]).toEqual([w, false]);
    }
    expect([...src.matchAll(/^import .*from '([^']+)';$/gm)].map((m) => m[1])).toEqual(['./env', './ear-content']);
  });

  it('只读写 ear_pair 这一张表，SQL 里没有别的表', () => {
    const sql = [...src.matchAll(/(?:FROM|INTO)\s+(\w+)/g)].map((m) => m[1]);
    expect([...new Set(sql)]).toEqual(['ear_pair']);
  });
});

// ======================================================================
describe('9. 迁移 0017 只 CREATE（旧表一行不动）', () => {
  const sql = readFileSync(path.join(MIG, M0017), 'utf8');
  const code = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

  it('只有一条 CREATE TABLE ear_pair，没有 ALTER / DROP / CREATE INDEX / 回填', () => {
    expect((code.match(/CREATE TABLE/g) ?? []).length).toBe(1);
    expect(code).toContain('CREATE TABLE ear_pair (');
    for (const w of ['ALTER ', 'DROP ', 'CREATE INDEX', 'INSERT ', 'UPDATE ', 'DELETE ']) expect([w, code.toUpperCase().includes(w)]).toEqual([w, false]);
  });

  it('五列：pair / tries / ok / same / at，主键是 pair', () => {
    expect([...code.matchAll(/^ {2}(\w+) (?:INTEGER|TEXT)/gm)].map((m) => m[1])).toEqual(['pair', 'tries', 'ok', 'same', 'at']);
    expect(code).toContain('pair TEXT PRIMARY KEY');
  });

  it('在已有 0001～0016 数据的库上跑：旧表一行不动（迁移跑完 drill_item、fund_snapshot 还在，ear_pair 是空的）', async () => {
    const old = await db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('events','queue','en_word','drill_item','drill_audio','drill_review','fund_snapshot')").first<{ n: number }>();
    expect(old?.n).toBe(7);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM ear_pair').first<{ n: number }>())?.n).toBe(0);
    // 0017 是最后一个迁移，前面 16 个一个都没被改名 / 删掉
    expect(migs()).toEqual(['0001_init.sql', '0002_queue.sql', '0003_workers_ai.sql', '0004_v03.sql', '0005_company.sql', '0006_platform_reports.sql', '0007_usage_by_project.sql',
      '0008_active.sql', '0009_asset_gen.sql', '0010_usage_by_purpose.sql', '0011_account_limit.sql', '0012_english_memory.sql', '0013_drill.sql', '0014_drill_audio.sql',
      '0015_drill_review.sql', '0016_funds.sql', M0017]);
  });
});
