/**
 * 英语练习"跨轮记忆"（src/english-memory.ts、src/english-memory-page.ts、migrations/0012_english_memory.sql）的测试。
 * 守住八件事：
 *   1. **迁移只 CREATE**：0012 里没有 ALTER / DROP / 索引 / 回填；空库和已有 0001～0011 数据的库都能跑，旧表一行不动。
 *   2. **提示词是原文照抄**：v4 的规则段、"开始之前"、"我说 done 的时候"三段，和 ENGLISH_MOD 里那 8 条**一字不差**；
 *      新东西只能**追加**在后面（这一条是"别重写 v4"的机器保证）。
 *   3. **#LOG 的解析**：只 grep #LOG…#END，粘多粘少都不影响；有好几块时取最后一块。
 *   4. **解析失败不静默吞掉**：没有 #LOG / 没有 #END / 块里一行有用的都没有，三种各有自己的"出错 + 怎么办"，
 *      而且接口回的是 4xx，不是假装成功（2026-11-03 踩过的坑：报错被盖掉，他以为是额度用光）。
 *   5. **跨轮间隔**：1 → 3 → 7，说对往上走、走完毕业；说不出来退回第一档，下一轮马上再考。
 *   6. **北极星只看跨轮**：到期被**真的考到**的才算分母；没考到的顺延、不算分母，也**不许**用 0 冒充"还没有数据"。
 *   7. **三步流程**端到端走一遍：测词汇线 → 开始这一轮（提示词带上线、回收句、新词）→ 贴回来入库 → 下一轮考到期的那几句。
 *   8. **不花钱、不碰密钥**：整个模块不调任何 AI、不出现密钥变量名；页面不让他打字（只有按钮和一个粘贴框）。
 *   9. **v5 的四件**（2026-11-04 第 1 轮真实数据之后）：新词一轮只教 1 个；这一轮新教的词不许进帮扶句；
 *      帮扶句不超过 5 个词；A / B / C 三个数 + 跨轮两个数 + 每轮一行的历史表摆在页面上（`/api/english/history`，
 *      **不新建表、不新增迁移**）。两条新规则在测试里**逐字写死**，改一个字就红。
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import { ENGLISH_MOD } from '../src/english-page';
import { EM_CSS, EM_JS, EM_MOD } from '../src/english-memory-page';
import { buildPrompt, GAPS, NEW_PER_ROUND, NEW_WORD_NOT_IN_HELP, nextDue, normSentence, parseLog, recallRate, roundRows, segments, SHORT_HELP_SENTENCE, vocabLine, WORDLIST } from '../src/english-memory';
import { ROOT, T0 } from './helpers';

const PASS = 'ci_only_copilot_password_01';
const HOST = 'https://copilot.example.test';
const MIG = path.join(ROOT, 'migrations');
const M0012 = '0012_english_memory.sql';

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
  await db.batch(['en_word', 'en_sentence', 'en_round', 'auth_fail', 'auth_lock'].map((t) => db.prepare(`DELETE FROM ${t}`)));
});

const env = (): Env => ({ DB: db, ENVIRONMENT: 'test', COPILOT_PASSWORD: PASS });
const req = (p: string, init: RequestInit & { cookie?: string } = {}) =>
  new Request(`${HOST}${p}`, { ...init, headers: { 'content-type': 'application/json', origin: HOST, 'cf-connecting-ip': '203.0.113.9', ...(init.cookie ? { cookie: init.cookie } : {}) } });
async function cookie(): Promise<string> {
  const r = await handle(req('/api/login', { method: 'POST', body: JSON.stringify({ password: PASS }) }), env(), T0);
  return r.headers.get('set-cookie')!.split(';')[0];
}
let ck = '';
beforeAll(async () => { ck = await cookie(); });
const api = async (p: string, body?: unknown, now = T0) => {
  const r = await handle(req('/api/english/' + p, body === undefined ? { cookie: ck } : { method: 'POST', cookie: ck, body: JSON.stringify(body) }), env(), now);
  return { status: r.status, body: (await r.json()) as Record<string, any> };
};
/** 把词汇线整张表答完：band ≤ line 的全答"认识"，再往上全答"不认识" */
async function fillLine(line: number) {
  for (const w of WORDLIST) await api('word', { word: w.word, known: w.band <= line });
}

// ======================================================================
describe('1. 迁移 0012 只 CREATE', () => {
  const sql = readFileSync(path.join(MIG, M0012), 'utf8');
  const code = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

  it('只有三条 CREATE TABLE，没有 ALTER / DROP / CREATE INDEX / INSERT', () => {
    expect((code.match(/CREATE TABLE/g) ?? []).length).toBe(3);
    for (const w of ['ALTER ', 'DROP ', 'CREATE INDEX', 'INSERT ', 'UPDATE ', 'DELETE ']) expect([w, code.toUpperCase().includes(w)]).toEqual([w, false]);
    for (const t of ['en_word', 'en_sentence', 'en_round']) expect(code).toContain(`CREATE TABLE ${t} (`);
  });

  it('迁移文件里不存任何密钥（底线 1）', () => {
    for (const w of ['TOKEN', 'API_KEY', 'PASSWORD', 'SECRET']) expect([w, sql.includes(w)]).toEqual([w, false]);
  });

  it('旧库（0001～0011 已经有数据）上再跑 0012 也能过，旧表一行不动', async () => {
    const before = await db.prepare('SELECT COUNT(*) AS n FROM queue').first<{ n: number }>();
    const copy = await getPlatformProxy<{ DB: D1Database }>({ configPath: path.join(ROOT, 'test/wrangler.test.toml'), persist: false, remoteBindings: false, envFiles: [] });
    try {
      await copy.env.DB.batch(stmtsOf(migs().filter((f) => f !== M0012)).map((s) => copy.env.DB.prepare(s)));
      await copy.env.DB.prepare("INSERT INTO queue (at, updated_at, product, platform, post_id, author, snippet, score, reasons, draft, source, status) VALUES (1, 1, 'forecast', 'x', 'p1', 'a', 's', 1, '[]', 'd', '', 'pending')").run();
      await copy.env.DB.batch(stmtsOf([M0012]).map((s) => copy.env.DB.prepare(s)));
      const after = await copy.env.DB.prepare('SELECT COUNT(*) AS n FROM queue').first<{ n: number }>();
      expect(after?.n).toBe(1);
    } finally { await copy.dispose(); }
    expect((await db.prepare('SELECT COUNT(*) AS n FROM queue').first<{ n: number }>())?.n).toBe(before?.n);
  });
});

// ======================================================================
describe('2. 提示词：v4 原文一字不差，新东西只能追加', () => {
  const PRES = [...ENGLISH_MOD.matchAll(/<pre class="en-pre" id="en-p\d+-t">([\s\S]*?)<\/pre>/g)].map((m) => m[1]);

  it('8 条都切得出四段，每一段都是 ENGLISH_MOD 里的原文', () => {
    expect(PRES).toHaveLength(8);
    for (let i = 0; i < 8; i++) {
      const s = segments(i);
      for (const part of [s.scene, s.rules, s.before, s.ending]) expect([i, PRES[i].includes(part)]).toEqual([i, true]);
      expect(s.rules.startsWith('规则：')).toBe(true);
      expect(s.before.startsWith('开始之前：')).toBe(true);
      expect(s.ending.startsWith('我说 done 的时候，用中文告诉我：')).toBe(true);
    }
  });

  it('v4 的每一条规则在生成的提示词里**原样**还在（帮扶五级、回收、一轮一个问题、不要看屏幕…）', () => {
    const p = buildPrompt(segments(0), { line: 2, avoid: ['pitch'], due: ['I was wondering if you could cover the meeting.'], fresh: [{ word: 'mitigate', zh: '把风险或影响降下来' }] });
    for (const r of [
      '- 全程英文。',
      '- Speak slowly and clearly, with a short pause between sentences.',
      '- 只用日常办公常用词。万一用了超纲的词，主动用一句话解释它。',
      '- Keep every reply to 1–2 short sentences, and ask at most ONE question per turn.',
      '  第 1 级 先等 3 秒，别急着帮。',
      '  第 5 级 实在不行才给一整句让我念，每句不超过 8 个词、不带从句。这是最后一招，给完你要记住这一句。',
      '- 我说 "help" 的时候，从第 2 级开始给，不要直接跳到第 5 级。',
      '- 回收（最重要）：',
      '- 难度跟着我走：',
      '- 多让我说：',
      '- 不要让我看屏幕、看代码、看文件、发链接——我们只有声音。',
      '开始之前：先给我 5 个这个场景会用到的语块',
      '2) 报三个数：我自己造的句子几句 / 靠提示才说出来的几句 / 回收时独立说对的几句',
    ]) expect([r, p.includes(r)]).toEqual([r, true]);
    // 规则段整段原样嵌在里面（不是被重写过的）
    expect(p).toContain(segments(0).rules);
  });

  it('追加的四件事都在：用词范围、不许用的词、今天教的新词、这一轮要回收的句子', () => {
    const p = buildPrompt(segments(0), { line: 2, avoid: ['pitch', 'solidify'], due: ['I was wondering if you could cover the meeting.'], fresh: [{ word: 'mitigate', zh: '降低' }] });
    expect(p).toContain('用词范围（这一条优先于其他规则）：只用日常办公常用词');
    expect(p).toContain('整场**一个都不要用**：pitch、solidify');
    expect(p).toContain('今天只教这 1 个新词：mitigate（降低）');
    expect(p).toContain('跨轮回收（这一轮最重要的事）');
    expect(p).toContain('1) I was wondering if you could cover the meeting.');
    // #LOG 块的要求在最后
    expect(p).toContain('#LOG');
    expect(p.trimEnd().endsWith('这一段只许出现一次，放在整段回答的最后，前后不要加任何说明文字。')).toBe(true);
    for (const k of ['stuck:', 'helped:', 'recalled:', 'new:', 'counts:', '#END']) expect([k, p.includes(k)]).toEqual([k, true]);
  });

  it('没有要回收的句子、没有新词时，那两段就不出现（不给 AI 空指令）', () => {
    const p = buildPrompt(segments(1), { line: 4, avoid: [], due: [], fresh: [] });
    expect(p).not.toContain('跨轮回收（这一轮最重要的事）');
    expect(p).not.toContain('今天只教这');
    expect(p).not.toContain('整场**一个都不要用**');
    expect(p).toContain('用词范围（这一条优先于其他规则）：职场词和商务习语都可以用');
  });
});

// ======================================================================
describe('3. #LOG 的解析：只 grep 那一块，粘多粘少都不影响', () => {
  const LOG = [
    '#LOG',
    'stuck: pitch, solidify, scope',
    'helped: "I was wondering if you could cover the meeting." | "It requires a lot of time and money."',
    'recalled: "I was wondering if you could cover the meeting." = yes | "It requires a lot of time and money." = no',
    'new: mitigate, prioritize',
    'counts: A=12 B=9 C=4',
    '#END',
  ].join('\n');

  it('前后包着一大堆对话也照样切得出来', () => {
    const r = parseLog('Mike: What are you up to today?\n我: uh… I was checking an API timeout.\n（中间省略 3000 字）\n' + LOG + '\n\n希望这些对你有帮助！');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.log.stuck).toEqual(['pitch', 'solidify', 'scope']);
    expect(r.log.helped).toEqual(['I was wondering if you could cover the meeting.', 'It requires a lot of time and money.']);
    expect(r.log.recalled).toEqual([
      { text: 'I was wondering if you could cover the meeting.', ok: true },
      { text: 'It requires a lot of time and money.', ok: false },
    ]);
    expect(r.log.fresh).toEqual(['mitigate', 'prioritize']);
    expect(r.log.counts).toEqual({ a: 12, b: 9, c: 4 });
    expect(r.log.warnings).toEqual([]);
  });

  it('有好几块时取最后一块（他跑了一轮又补了一次收尾）', () => {
    const first = LOG.replace('counts: A=12 B=9 C=4', 'counts: A=1 B=1 C=1');
    const r = parseLog(first + '\n……重来一次……\n' + LOG);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.log.counts.a).toBe(12);
  });

  it('全角冒号、中文引号、少几行都认得；不认识的行记成提醒、不吞掉', () => {
    const r = parseLog('#LOG\nstuck：pitch、scope\nhelped：“I can cover it.”\nmood: happy\n#END');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.log.stuck).toEqual(['pitch', 'scope']);
    expect(r.log.helped).toEqual(['I can cover it.']);
    expect(r.log.recalled).toEqual([]);
    expect(r.log.warnings.join(' ')).toContain('有 1 行不认识');
  });

  it('recalled 写成别的词（maybe）不算进成功率，而且明确说出来', () => {
    const r = parseLog('#LOG\nrecalled: "I can cover it." = maybe | "Let me think." = yes\n#END');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.log.recalled).toEqual([{ text: 'Let me think.', ok: true }]);
    expect(r.log.warnings.join(' ')).toContain('maybe');
  });
});

describe('4. 解析失败明确报错，不静默吞掉（11/3 的坑）', () => {
  it('三种失败各有自己的"出错 + 怎么办"', () => {
    const cases: [string, string][] = [
      ['', '输入框是空的'],
      ['Mike: nice talking to you! 今天就聊到这儿。', '找不到 #LOG'],
      ['#LOG\nstuck: pitch', '后面没有 #END'],
      ['#LOG\n随便写点什么\n#END', '里面一行有用的都没有'],
    ];
    for (const [input, want] of cases) {
      const r = parseLog(input);
      expect([want, r.ok]).toEqual([want, false]);
      if (r.ok) continue;
      expect(r.err.出错).toContain(want);
      expect(r.err.怎么办.length).toBeGreaterThan(8);
    }
  });

  it('接口回 422 + 两句话，**不是**假装成功', async () => {
    await fillLine(2);
    await api('start', {});
    const r = await api('log', { text: '聊得很开心，但它忘了吐 #L0G' });
    expect(r.status).toBe(422);
    expect(r.body.出错).toContain('找不到 #LOG');
    expect(r.body.怎么办).toContain('done');
    expect(r.body.ok).toBeUndefined();
    // 轮次还开着，没被标成"贴回来了"
    const s = await api('state');
    expect(s.body.轮次.开着的轮).not.toBeNull();
  });

  it('还没开始这一轮就贴 → 409 + 告诉他先点哪个按钮', async () => {
    await fillLine(2);
    const r = await api('log', { text: '#LOG\nstuck: pitch\n#END' });
    expect(r.status).toBe(409);
    expect(r.body.怎么办).toContain('开始这一轮');
  });

  it('词汇线没测完就点"开始这一轮" → 409 + 告诉他还差几个', async () => {
    const r = await api('start', {});
    expect(r.status).toBe(409);
    expect(r.body.出错).toContain(`0 / ${WORDLIST.length}`);
  });
});

// ======================================================================
describe('5. 跨轮间隔 1 / 3 / 7', () => {
  it('说对往上走一档，走完毕业（due = 0，不再派）', () => {
    expect(GAPS).toEqual([1, 3, 7]);
    expect(nextDue(0, 5, true)).toEqual({ step: 1, due: 8 });
    expect(nextDue(1, 8, true)).toEqual({ step: 2, due: 15 });
    expect(nextDue(2, 15, true)).toEqual({ step: 3, due: 0 });
  });
  it('说不出来退回第一档，下一轮马上再考', () => {
    expect(nextDue(2, 15, false)).toEqual({ step: 0, due: 16 });
    expect(nextDue(0, 1, false)).toEqual({ step: 0, due: 2 });
  });
  it('同一句换个标点、大小写算同一句，不会重复入库', () => {
    expect(normSentence('I was wondering if you could COVER the meeting!!')).toBe(normSentence('i was wondering if you could cover the meeting.'));
    expect(normSentence('Let me think.')).not.toBe(normSentence('Let me check.'));
  });
});

describe('6. 北极星：只看跨轮，没数据就说没数据', () => {
  it('一轮都没考过时 rate 是 null，不是 0（底线 3）', () => {
    expect(recallRate([])).toEqual({ asked: 0, passed: 0, rate: null });
    expect(recallRate([{ recall_due: 0, recalled: 0 }]).rate).toBeNull();
  });
  it('分子分母是各轮累计', () => {
    expect(recallRate([{ recall_due: 2, recalled: 1 }, { recall_due: 3, recalled: 3 }])).toEqual({ asked: 5, passed: 4, rate: 0.8 });
  });
  it('词汇线：每一档都要 ≥ 80% 才算过，卡在哪一档线就在哪儿', () => {
    const band = (b: 1 | 2 | 3 | 4, ok: number, bad: number) => [...Array(ok).fill({ band: b, known: true }), ...Array(bad).fill({ band: b, known: false })];
    expect(vocabLine([...band(1, 10, 0), ...band(2, 9, 1), ...band(3, 5, 5)])).toBe(2);
    expect(vocabLine([...band(1, 5, 5)])).toBe(0);
    expect(vocabLine([...band(1, 10, 0), ...band(2, 10, 0), ...band(3, 10, 0), ...band(4, 10, 0)])).toBe(4);
    // 没测过的档不猜：第 2 档一个都没答，就停在第 1 档
    expect(vocabLine([...band(1, 10, 0)])).toBe(1);
  });
});

// ======================================================================
describe('7. 三步流程端到端', () => {
  const log = (o: { stuck?: string; helped?: string; recalled?: string; fresh?: string; counts?: string }) =>
    ['#LOG', `stuck: ${o.stuck ?? ''}`, `helped: ${o.helped ?? ''}`, `recalled: ${o.recalled ?? ''}`, `new: ${o.fresh ?? ''}`, `counts: ${o.counts ?? ''}`, '#END'].join('\n');

  it('测词汇线 → 开始这一轮 → 贴回来 → 下一轮考到期的那几句', async () => {
    // 第 1 步：一次一个词
    const s0 = await api('state');
    expect(s0.body.词汇线.测完了).toBe(false);
    expect(s0.body.词汇线.下一个.词).toBe(WORDLIST[0].word);
    expect(s0.body.跨轮回收成功率.rate).toBeNull();
    const a1 = await api('word', { word: WORDLIST[0].word, known: true });
    expect(a1.body.已答).toBe(1);
    expect(a1.body.下一个.词).toBe(WORDLIST[1].word);
    await fillLine(2);
    const s1 = await api('state');
    expect(s1.body.词汇线.测完了).toBe(true);
    expect(s1.body.词汇线.线).toBe(2);

    // 第 2 步：开始第 1 轮
    const r1 = await api('start', {});
    expect(r1.status).toBe(200);
    expect(r1.body.n).toBe(1);
    expect(r1.body.这轮要回收).toBe(0);
    expect(r1.body.这轮要教.length).toBe(1); // v5：一轮只教 1 个（原来 3～5 个，第 1 轮真实数据 C=0）
    expect(r1.body.提示词).toContain('只用日常办公常用词');
    // 再点一次还是同一份（不会凭空多开一轮）
    expect((await api('start', {})).body.提示词).toBe(r1.body.提示词);

    // 第 3 步：贴回来
    const S1 = 'I was wondering if you could cover the meeting.';
    const S2 = 'It requires a lot of time and money.';
    const p1 = await api('log', { text: '随便一大段对话……\n' + log({ stuck: 'pitch, scope', helped: `"${S1}" | "${S2}"`, counts: 'A=12 B=9 C=4' }) });
    expect(p1.status).toBe(200);
    expect(p1.body.存下来了).toMatchObject({ 新句子: 2, 到期考了: 0, 说对了: 0 });
    expect(p1.body.跨轮回收成功率.rate).toBeNull();

    // 第 2 轮：上一轮那两句到期了，自动进提示词
    const r2 = await api('start', {});
    expect(r2.body.n).toBe(2);
    expect(r2.body.这轮要回收).toBe(2);
    expect(r2.body.提示词).toContain('1) ' + S1);
    expect(r2.body.提示词).toContain('2) ' + S2);
    // 上一轮 stuck 的词进了"整场一个都不要用"
    expect(r2.body.提示词).toContain('pitch');

    // 第 2 轮贴回来：一句说对、一句没说出来
    const p2 = await api('log', { text: log({ recalled: `"${S1}" = yes | "${S2}" = no`, counts: 'A=14 B=6 C=5' }) });
    expect(p2.status).toBe(200);
    expect(p2.body.存下来了).toMatchObject({ 到期考了: 2, 说对了: 1 });
    expect(p2.body.跨轮回收成功率).toEqual({ asked: 2, passed: 1, rate: 0.5 });

    // 说对的那句隔 3 轮再考（第 5 轮），说不出来的下一轮马上再考
    const r3 = await api('start', {});
    expect(r3.body.n).toBe(3);
    expect(r3.body.这轮要回收).toBe(1);
    expect(r3.body.提示词).toContain(S2);
    expect(r3.body.提示词).not.toContain('1) ' + S1);
  });

  it('到期派出去却没考到的句子：不算进成功率，顺延到下一轮，并且**明确提醒**', async () => {
    await fillLine(2);
    const S = 'Let me think for a second.';
    await api('start', {});
    await api('log', { text: log({ helped: `"${S}"` }) });
    const r2 = await api('start', {});
    expect(r2.body.这轮要回收).toBe(1);
    const p2 = await api('log', { text: log({ counts: 'A=3' }) });
    expect(p2.body.存下来了).toMatchObject({ 到期考了: 0, 说对了: 0 });
    expect(p2.body.跨轮回收成功率.rate).toBeNull(); // 分母还是 0，不拿 0% 冒充
    expect(p2.body.提醒.join(' ')).toContain('没考到');
    // 顺延：第 3 轮还在
    expect((await api('start', {})).body.这轮要回收).toBe(1);
  });

  it('recalled 里报了一句不是这一轮派出去的，照实说，不计进分母', async () => {
    await fillLine(2);
    await api('start', {});
    const p = await api('log', { text: log({ recalled: '"Something I never said." = yes' }) });
    expect(p.body.存下来了.到期考了).toBe(0);
    expect(p.body.提醒.join(' ')).toContain('没算进回收成功率');
  });

  it('对话里真卡住的词会把"认识"改回"不认识"，线跟着往下调（实际证据 > 自己报的）', async () => {
    await fillLine(4); // 整张表都说认识 → 线 = 4
    expect((await api('state')).body.词汇线.线).toBe(4);
    await api('start', {});
    const band4 = WORDLIST.filter((w) => w.band === 4).slice(0, 5).map((w) => w.word);
    await api('log', { text: log({ stuck: band4.join(', ') }) });
    const s = await api('state');
    expect(s.body.词汇线.线).toBe(3);
    expect(s.body.不认识的词).toBeGreaterThanOrEqual(5);
  });

  it('没登录一律 401，COPILOT_PASSWORD 没填时整块 404（和后台同一道门）', async () => {
    const noCk = await handle(req('/api/english/state'), env(), T0);
    expect(noCk.status).toBe(401);
    const off = await handle(req('/api/english/state', { cookie: ck }), { DB: db, ENVIRONMENT: 'test' } as Env, T0);
    expect(off.status).toBe(404);
  });
});

// ======================================================================
describe('8. 不花钱、不碰密钥、不让他打字', () => {
  const SRC = readFileSync(path.join(ROOT, 'src/english-memory.ts'), 'utf8');

  it('服务端不调任何 AI、不发任何外部请求（底线 8 / C117）', () => {
    for (const w of ['fetch(', 'workers-ai', 'env.AI', 'GEMINI', 'openai', 'chargeNeurons', 'askAi']) expect([w, SRC.includes(w)]).toEqual([w, false]);
  });

  it('不碰密钥：源码里没有凭据形状的变量名（底线 1）', () => {
    for (const w of ['TOKEN', 'API_KEY', 'PASSWORD', 'SECRET']) expect([w, SRC.includes(w)]).toEqual([w, false]);
    for (const w of ['TOKEN', 'API_KEY', 'PASSWORD', 'SECRET']) expect([w, EM_MOD.includes(w)]).toEqual([w, false]);
  });

  it('页面上不让他打字：只有按钮和一个粘贴框，没有 input，也没有命令行', () => {
    expect((EM_MOD.match(/<textarea/g) ?? []).length).toBe(1);
    expect(EM_MOD).not.toContain('<input');
    for (const w of ['npm ', 'curl ', 'wrangler ', 'node scripts/']) expect([w, EM_MOD.includes(w)]).toEqual([w, false]);
    // 认识 / 不认识两个大按钮（手机单手点）
    expect(EM_MOD).toContain('id="em-yes"');
    expect(EM_MOD).toContain('id="em-no"');
    expect(EM_CSS).toContain('.em .em-two button');
    // 这一行在 CSS 里：两个按钮至少 52px 高
    expect(EM_CSS).toContain('min-height:52px');
  });

  it('复制按钮有兜底（和 8 条提示词那块同一套）', () => {
    expect(EM_JS).toContain('navigator.clipboard&&navigator.clipboard.writeText');
    expect(EM_JS).toContain("document.execCommand('copy')");
    expect(EM_JS).toMatch(/writeText\(text\)\.then\(function\(\)\{done\(true\);\},function\(\)\{done\(emFallback\(text\)\);\}\)/);
  });

  it('出错一律把服务器那两句话摆出来（不静默吞掉）', () => {
    expect(EM_JS).toContain("j['出错']");
    expect(EM_JS).toContain("j['怎么办']");
    expect(EM_JS).toContain('e.hidden=false');
  });

  it('那一个数单独一块、还没数据时写"还没有数据"而不是 0%', () => {
    expect(EM_MOD).toContain('id="em-rate"');
    expect(EM_MOD).toContain('跨轮回收成功率');
    expect(EM_JS).toContain("e.textContent='还没有数据'");
  });

  it('词表全是手工整理的职场高频词，没有搬任何外部词表进来', () => {
    expect(WORDLIST.length).toBeGreaterThanOrEqual(50);
    expect(new Set(WORDLIST.map((w) => w.word)).size).toBe(WORDLIST.length);
    for (const b of [1, 2, 3, 4]) expect([b, WORDLIST.some((w) => w.band === b)]).toEqual([b, true]);
    // 他实际撞墙的 7 个词都在表里（任务书给的已查实事实）
    for (const w of ['test the waters', 'mitigate', 'pitch', 'solidify', 'scope', 'spot on', 'lock it in']) expect([w, WORDLIST.some((x) => x.word === w)]).toEqual([w, true]);
    // 授权结论写在源码注释里（NGSL 的 CC BY-SA 4.0、COCA 付费，为什么都没用）
    expect(SRC).toContain('CC BY-SA 4.0');
    expect(SRC).toContain('COCA');
  });
});


// ======================================================================
describe('9. v5：新词只教 1 个、不进帮扶句、帮扶句砍到 5 个词、三个数摆出来', () => {
  // 这两句是 Amos 2026-11-04 给的**原话**，逐字写死在测试里：
  // 源码里的常量改一个字（哪怕只是把「绝对不许」写成「不许」）这里就红。
  const 新词不进帮扶句 = '- 今天要教的那个新词，你可以在你自己说的话里用一次让我听到，但**帮我造句子时绝对不许用它**。帮我的句子只许用我已经会的词。';
  const 帮扶句五个词 = '- 你给我念的句子：**不超过 5 个词、只用最简单的结构**（像 "I need more time." "Can you help me?"），不许带从句、不许用我不认识的词。宁可说得幼稚，也不要说得地道。';

  it('源码里的两条常量和 Amos 的原话一字不差', () => {
    expect(NEW_WORD_NOT_IN_HELP).toBe(新词不进帮扶句);
    expect(SHORT_HELP_SENTENCE).toBe(帮扶句五个词);
    expect(NEW_PER_ROUND).toBe(1);
  });

  it('有新词时，提示词里**原文**带上「这一轮的新词不许进帮扶句」', () => {
    const p = buildPrompt(segments(0), { line: 2, avoid: [], due: [], fresh: [{ word: 'estimate', zh: '估时 / 估算' }] });
    expect(p).toContain(新词不进帮扶句);
    expect(p).toContain('今天只教这 1 个新词：estimate（估时 / 估算）');
  });

  it('没有新词时不出现那条（不给 AI 空指令），但帮扶句那条照样在', () => {
    const p = buildPrompt(segments(0), { line: 2, avoid: [], due: [], fresh: [] });
    expect(p).not.toContain(新词不进帮扶句);
    expect(p).toContain(帮扶句五个词);
  });

  it('帮扶句那条**每一条提示词里都在**，并且写明优先于 v4 的「不超过 8 个词」', () => {
    for (let i = 0; i < 8; i++) {
      const p = buildPrompt(segments(i), { line: 1, avoid: [], due: [], fresh: [] });
      expect([i, p.includes(帮扶句五个词)]).toEqual([i, true]);
      expect([i, p.includes('**优先于上面规则里「每句不超过 8 个词、不带从句」那一句**')]).toEqual([i, true]);
      // v4 原文那一句**还在**（我们是追加覆盖，不是改掉它）
      expect([i, p.includes('第 5 级 实在不行才给一整句让我念，每句不超过 8 个词、不带从句。')]).toEqual([i, true]);
      // 覆盖的那条排在被覆盖的原文后面，AI 读到的最后一句才是 5 个词那条
      expect([i, p.indexOf(帮扶句五个词) > p.indexOf('每句不超过 8 个词、不带从句。这是最后一招')]).toEqual([i, true]);
    }
  });

  it('开一轮只派 1 个新词（反例：第 1 轮真实数据派了 5 个，C=0）', async () => {
    await fillLine(2);
    const r1 = await api('start', {});
    expect(r1.body.这轮要教.length).toBe(1);
    expect(r1.body.提示词).toContain('今天只教这 1 个新词：');
    expect(r1.body.提示词).toContain(新词不进帮扶句);
    // 入库的 new_json 也只有 1 个，而且教过的下一轮不会重复教
    const row = await db.prepare('SELECT new_json FROM en_round WHERE n = 1').first<{ new_json: string }>();
    expect(JSON.parse(row!.new_json)).toHaveLength(1);
    const first = r1.body.这轮要教[0];
    await api('log', { text: '#LOG\nstuck: \ncounts: A=1 B=1 C=0\n#END' });
    const r2 = await api('start', {});
    expect(r2.body.这轮要教).toHaveLength(1);
    expect(r2.body.这轮要教[0]).not.toBe(first);
  });

  it('/api/english/history：每一轮一行，A / B / C 原样回，没报的是 null（不拿 0 冒充）', async () => {
    await fillLine(2);
    const S = 'I need more time.';
    await api('start', {});
    await api('log', { text: ['#LOG', `helped: "${S}"`, 'counts: A=3 B=5 C=0', '#END'].join('\n') });
    await api('start', {});
    await api('log', { text: ['#LOG', `recalled: "${S}" = yes`, 'counts: A=4', '#END'].join('\n') });

    const h = await api('history');
    expect(h.status).toBe(200);
    expect(h.body.一共几轮).toBe(2);
    expect(h.body.轮次表).toHaveLength(2);
    expect(h.body.轮次表[0]).toMatchObject({ n: 1, A: 3, B: 5, C: 0, 到期考了: 0, 说对了: 0 });
    // 第 2 轮只报了 A，B / C **是 null**，不是 0（底线 3：没报就说没报）
    expect(h.body.轮次表[1]).toMatchObject({ n: 2, A: 4, B: null, C: null, 到期考了: 1, 说对了: 1 });
    expect(h.body.最近一轮.n).toBe(2);
    expect(h.body.跨轮回收成功率).toEqual({ asked: 1, passed: 1, rate: 1 });
    // state 里也带最近一轮的三个数（页面一进来就能摆出来）
    expect((await api('state')).body.最近一轮).toMatchObject({ n: 2, A: 4, B: null, C: null });
  });

  it('还开着、没贴回来的那一轮不进历史表（它一个数都没有，列出来会被当成 0）', async () => {
    await fillLine(2);
    await api('start', {});
    expect((await api('history')).body.轮次表).toHaveLength(0);
    expect((await api('history')).body.最近一轮).toBeNull();
    expect((await api('state')).body.最近一轮).toBeNull();
    await api('log', { text: '#LOG\ncounts: A=2 B=1 C=1\n#END' });
    await api('start', {}); // 第 2 轮开着
    const h = await api('history');
    expect(h.body.轮次表).toHaveLength(1);
    expect(h.body.轮次表[0].n).toBe(1);
  });

  it('history 和别的接口同一道门：没登录 401', async () => {
    const r = await handle(req('/api/english/history'), env(), T0);
    expect(r.status).toBe(401);
  });

  it('roundRows 只看已经贴回来的轮，顺序是从早到晚（趋势要能看出来）', () => {
    const mk = (n: number, logged: number | null, a: number | null) =>
      ({ n, started_at: 1, logged_at: logged, scene: 'C-1', due_json: '[]', new_json: '[]', prompt: '', a, b: null, c: null, recall_due: 0, recalled: 0 }) as any;
    const rows = roundRows([mk(1, 10, 3), mk(2, null, null), mk(3, 30, 7)]);
    expect(rows.map((r) => r.n)).toEqual([1, 3]);
    expect(rows.map((r) => r.A)).toEqual([3, 7]);
  });

  it('页面：A / B / C 三个数和历史表都在，数字够大（390 宽一眼看得到）', () => {
    for (const id of ['em-nums', 'em-a', 'em-b', 'em-c', 'em-nums-cap', 'em-histwrap', 'em-hist-b']) expect([id, EM_MOD.includes('id="' + id + '"')]).toEqual([id, true]);
    // 三个数的名字写给小白看，不是光一个字母
    for (const t of ['自己造的句子', '靠提示才说出来', '同一轮回收说对']) expect([t, EM_MOD.includes(t)]).toEqual([t, true]);
    // 历史表七列：轮次 / 场景 / A / B / C / 跨轮考 / 说对
    expect((EM_MOD.match(/<th>/g) ?? []).length).toBe(7);
    for (const t of ['<th>轮次</th>', '<th>跨轮考</th>', '<th>说对</th>']) expect([t, EM_MOD.includes(t)]).toEqual([t, true]);
    // 数字 34px（和首屏那个大数一个量级），窄屏放不下就横滑、不缩字
    expect(EM_CSS).toContain('.em .em-big{display:block;font-size:34px');
    expect(EM_CSS).toContain('.em .em-histwrap{margin:var(--s3) 0 0;overflow-x:auto');
    // 还是只有一个粘贴框、没有 input（v5 没破这条）
    expect((EM_MOD.match(/<textarea/g) ?? []).length).toBe(1);
    expect(EM_MOD).not.toContain('<input');
  });

  it('页面脚本：没报的数写「—」而不是 0，历史表走 textContent（不拼 HTML）', () => {
    expect(EM_JS).toContain("function eN(v){return (v===null||v===undefined)?'—':String(v)}");
    expect(EM_JS).toContain("eJson('history')");
    expect(EM_JS).toContain('td.textContent=String(v)');
    expect(EM_JS).toContain("eq('em-hist-b')");
    // 存完一轮之后立刻刷新三个数和历史表
    expect(EM_JS).toContain("eRate(j['跨轮回收成功率']);eState();eHistory();");
  });
});
