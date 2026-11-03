/**
 * 用量监控（Amos 2026-11-03："最好提炼出一个 token 监控的模块，可以看到剩余和分别用到了哪里"）的单元测试。
 * 这个模块**没有另开一个页**，是补进后台"公共工具 → 用量和限额"（#/tools/usage）里的两块：
 * "还剩多少"（GET /api/usage 的 left）和"分别用到了哪里"（byPurpose，表 usage_by_purpose，迁移 0010）。
 *
 * 守住六条：
 *   1. **迁移 0010 只建表**：一条 CREATE TABLE，没有 ALTER / DROP / INDEX / INSERT / UPDATE / DELETE；跑完以后旧表一行不动。
 *   2. **三个问题都答得出**：还剩多少（已用 / 上限 / 还剩）、分别用到了哪里（按用途的 neurons 和次数）、什么时候清零
 *      （Workers AI 按 UTC、Gemini 按美国太平洋时间，和 dayFor / nextReset 同一套口径，不是另写一个数）。
 *   3. **两本账不混**：Workers AI 的 neurons 和 Gemini 的次数分开两行，单位不一样，不加在一起。
 *   4. **用途真的分得开**：素材生成器的图片和音频都算 practical-assets 这一个项目，按项目看分不出来；按用途看是两行。
 *   5. **不编数字**：按用途加起来 ≤ 今天的总量；差额单独列成"没按用途记下来的"，那一行的 Workers AI 次数是 null
 *      （页面写"没记录"），**不补 0、不估算**；差额小于一次调用的量时不显示这一行。
 *   6. **不影响原来的东西**：rows、byProject 原样还在；usage_by_purpose 写不进去（表没建）时接口照常返回。
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import { ADMIN_PAGE } from '../src/admin-page';
import { PURPOSE_AUDIO, PURPOSE_IMAGE } from '../src/assets';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import { TTS_PURPOSE } from '../src/tts';
import {
  PURPOSES, UNLABELED, unlabeledUsage, usageLeft, purposeLabel,
  WAI_DEFAULT_CAP, WAI_KEY, GEMINI_DEFAULT_CAP, nextReset, dayFor, utcDay, pacificDay,
  type PurposeUsage, type UsageLeft, type UsageRow,
} from '../src/usage';
import { ROOT, T0 } from './helpers';

const HOST = 'https://marketing-staging.example.test';
const PASS = 'test_only_password_0123456789';
const MIG = path.join(ROOT, 'migrations');
const M0010 = '0010_usage_by_purpose.sql';
/** 迁移 0010 以前就有的表：跑完 0010 以后这些表的结构一个字都不能变 */
const OLD_TABLES = ['events', 'rate', 'queue', 'auth_fail', 'auth_lock', 'ai_usage', 'model_usage', 'settings', 'usage_by_project', 'asset_gen'];

const stmtsOf = (files: string[]) =>
  files
    .map((f) => readFileSync(path.join(MIG, f), 'utf8').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n'))
    .join(';\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
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

/** 替身 AI：素材生成器要图片 / 音频的字节，备用 AI 要一段 JSON */
const fakeAi = () => ({
  async run(model: string): Promise<unknown> {
    if (model.includes('flux')) return { image: btoa('fake-jpg') };
    if (model.includes('melotts') || model.includes('aura')) return { audio: btoa('fake-mp3') };
    return { response: '{"ok":true}', usage: { prompt_tokens: 10, completion_tokens: 5 } };
  },
});

const env = (over: Partial<Env> = {}): Env => ({ DB: db, ENVIRONMENT: 'staging', COPILOT_PASSWORD: PASS, AI: fakeAi(), ...over });
const call = (p: string, e: Env, init?: RequestInit, now = T0) => handle(new Request(`${HOST}${p}`, { redirect: 'manual', ...init }), e, now);

let SID = '';
beforeEach(async () => {
  await db.batch([...OLD_TABLES, 'usage_by_purpose'].map((t) => db.prepare(`DELETE FROM ${t}`)));
  const r = await call('/api/login', env(), { method: 'POST', body: JSON.stringify({ password: PASS }), headers: { 'content-type': 'application/json' } });
  SID = (r.headers.get('set-cookie') ?? '').split(';')[0];
});

const get = <T>(p: string, e: Env = env(), now = T0) => call(p, e, { headers: { cookie: SID } }, now).then((r) => r.json() as Promise<T>);
const genAsset = (slot: string, e: Env = env()) =>
  call('/api/assets/gen', e, { method: 'POST', headers: { 'content-type': 'application/json', cookie: SID }, body: JSON.stringify({ scene: '01', slot, text: 'a cat on a table', steps: 4 }) }, T0);
const genTts = (e: Env = env()) =>
  call('/api/tts/gen', e, { method: 'POST', headers: { 'content-type': 'application/json', cookie: SID }, body: JSON.stringify({ text: 'Hand me the stapler now.' }) }, T0);

interface UsageBody { rows: UsageRow[]; byProject: { project: string }[]; left: UsageLeft[]; byPurpose: PurposeUsage[] }
const purposeRows = async () =>
  (await db.prepare('SELECT day, purpose, model, req, neurons FROM usage_by_purpose ORDER BY purpose').all<{ day: string; purpose: string; model: string; req: number; neurons: number }>()).results ?? [];

// ======================================================================
describe('① 迁移 0010：只建 usage_by_purpose，旧表一行不动', () => {
  it('有 0010_usage_by_purpose.sql，里面只有一条 CREATE TABLE（没有 ALTER / DROP / INDEX / INSERT / UPDATE / DELETE）', () => {
    const st = stmtsOf([M0010]);
    expect(st.length).toBe(1);
    expect(st[0]).toMatch(/^CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?usage_by_purpose\s*\(/i);
    expect(st[0]).not.toMatch(/\b(ALTER|DROP|CREATE\s+INDEX|INSERT|UPDATE|DELETE)\b/i);
  });

  it('跑完全部迁移：usage_by_purpose (day, purpose, model, req, tok_in, tok_out, neurons)，主键 (day, purpose, model)', async () => {
    const cols = (await db.prepare("SELECT name, pk FROM pragma_table_info('usage_by_purpose')").all<{ name: string; pk: number }>()).results;
    expect(cols.map((c) => c.name).sort()).toEqual(['day', 'model', 'neurons', 'purpose', 'req', 'tok_in', 'tok_out']);
    expect(cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name)).toEqual(['day', 'purpose', 'model']);
  });

  it('在只跑到 0009 的库上补跑 0010：旧表的结构一个字都没变，数据还在', async () => {
    const p = await getPlatformProxy<{ DB: D1Database }>({ configPath: path.join(ROOT, 'test/wrangler.test.toml'), persist: false, remoteBindings: false, envFiles: [] });
    const d = p.env.DB;
    try {
      const before = migs().filter((f) => f < M0010);
      await d.batch(stmtsOf(before).map((s) => d.prepare(s)));
      await d.batch([
        d.prepare("INSERT INTO ai_usage (day, neurons) VALUES ('2026-11-01', 123.456)"),
        d.prepare("INSERT INTO usage_by_project (day, project, model, req, neurons) VALUES ('2026-11-01', 'practical-assets', 'workers-ai', 2, 99.5)"),
      ]);
      const schema = async () => (await d.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND tbl_name != 'usage_by_purpose' ORDER BY name").all()).results;
      const s0 = await schema();
      await d.batch(stmtsOf([M0010]).map((s) => d.prepare(s)));
      expect(await schema()).toEqual(s0);
      expect((await d.prepare('SELECT neurons FROM ai_usage').first<{ neurons: number }>())!.neurons).toBeCloseTo(123.456, 9);
      expect((await d.prepare('SELECT COUNT(*) AS n FROM usage_by_purpose').first<{ n: number }>())!.n).toBe(0);
    } finally {
      await p.dispose();
    }
  });
});

// ======================================================================
describe('② 还剩多少：两本账分开，口径就是 dayFor / nextReset 那一套', () => {
  it('usageLeft：Workers AI 一行（neurons）、Gemini 一行（几个模型的上限加起来，次数），不加在一起', () => {
    const rows: UsageRow[] = [
      { model: 'gemini-3.6-flash', label: 'gemini-3.6-flash', unit: '次', req: 7, tokIn: 0, tokOut: 0, used: 7, cap: 200, max: 10_000, state: 'ok', stateText: '正常', resetAt: nextReset('gemini-3.6-flash', T0) },
      { model: 'gemini-3.8-flash', label: 'gemini-3.8-flash', unit: '次', req: 3, tokIn: 0, tokOut: 0, used: 3, cap: 200, max: 10_000, state: 'ok', stateText: '正常', resetAt: nextReset('gemini-3.8-flash', T0) },
      { model: WAI_KEY, label: '备用 AI', unit: 'neurons', req: 4, tokIn: 0, tokOut: 0, used: 1_200, cap: 8_000, max: 9_500, state: 'ok', stateText: '正常', resetAt: nextReset(WAI_KEY, T0) },
    ];
    const left = usageLeft(rows);
    expect(left.map((x) => [x.key, x.unit, x.used, x.cap, x.left])).toEqual([
      [WAI_KEY, 'neurons', 1_200, 8_000, 6_800],
      ['gemini', '次', 10, 400, 390],
    ]);
    // 清零时间不是另写的数：和 nextReset 一模一样；Workers AI 是 UTC 0 点，Gemini 是美国太平洋时间半夜
    expect(left[0].resetAt).toBe(nextReset(WAI_KEY, T0));
    expect(new Date(left[0].resetAt).toISOString()).toBe('2026-10-30T00:00:00.000Z');
    expect(left[1].resetAt).toBe(nextReset('gemini-3.6-flash', T0));
    expect(left[0].resetText).toBe('UTC 0 点（台湾早上 8 点）');
    expect(left[1].resetText).toBe('美国太平洋时间半夜（台湾下午 3～4 点）');
  });

  it('用超了也不会给出负的"还剩"（下限 0）', () => {
    const rows: UsageRow[] = [{ model: WAI_KEY, label: 'w', unit: 'neurons', req: 1, tokIn: 0, tokOut: 0, used: 9_000, cap: 8_000, max: 9_500, state: 'our_cap', stateText: '到了我们设的上限，今天先跳过', resetAt: nextReset(WAI_KEY, T0) }];
    expect(usageLeft(rows)[0].left).toBe(0);
  });

  it('没绑 Workers AI 时只有 Gemini 一行（不凭空造一行）', () => {
    const rows: UsageRow[] = [{ model: 'gemini-3.6-flash', label: 'g', unit: '次', req: 1, tokIn: 0, tokOut: 0, used: 1, cap: 200, max: 10_000, state: 'ok', stateText: '正常', resetAt: nextReset('gemini-3.6-flash', T0) }];
    expect(usageLeft(rows).map((x) => x.key)).toEqual(['gemini']);
  });

  it('"一天"的口径：Workers AI 按 UTC 日期、Gemini 按美国太平洋时间日期（T0 两边正好不是同一天，守住没有混用）', () => {
    expect(dayFor(WAI_KEY, T0)).toBe(utcDay(T0));
    expect(dayFor('gemini-3.6-flash', T0)).toBe(pacificDay(T0));
    expect(utcDay(T0)).toBe('2026-10-29');
    expect(pacificDay(T0)).toBe('2026-10-28');
  });

  it('GET /api/usage：left 两行，和 rows 对得上；默认上限就是 WAI_DEFAULT_CAP / GEMINI_DEFAULT_CAP', async () => {
    const j = await get<UsageBody>('/api/usage');
    const wai = j.left.find((x) => x.key === WAI_KEY)!;
    expect(wai.cap).toBe(WAI_DEFAULT_CAP);
    expect(wai.used).toBe(0);
    expect(wai.left).toBe(WAI_DEFAULT_CAP);
    const gem = j.left.find((x) => x.key === 'gemini')!;
    expect(gem.cap).toBe(gem.models * GEMINI_DEFAULT_CAP);
    // 原来的两块原样还在
    expect(Array.isArray(j.rows)).toBe(true);
    expect(Array.isArray(j.byProject)).toBe(true);
  });
});

// ======================================================================
describe('③ 分别用到了哪里：按项目分不出来的，按用途分得出来', () => {
  it('素材生成器的图片和音频：按项目是同一行 practical-assets，按用途是 assets-image / assets-audio 两行', async () => {
    expect((await genAsset('correct')).status).toBe(200);
    expect((await genAsset('audio', env())).status).toBe(200);
    const rows = await purposeRows();
    expect(rows.map((r) => r.purpose)).toEqual([PURPOSE_AUDIO, PURPOSE_IMAGE]);
    for (const r of rows) {
      expect(r.model).toBe(WAI_KEY);
      expect(r.day).toBe(utcDay(T0));
      expect(r.req).toBe(1);
      expect(r.neurons).toBeGreaterThan(0);
    }
    // 出图比配音贵得多：这两行确实是分开的两笔，不是同一个数抄两遍
    const img = rows.find((r) => r.purpose === PURPOSE_IMAGE)!;
    const aud = rows.find((r) => r.purpose === PURPOSE_AUDIO)!;
    expect(img.neurons).toBeGreaterThan(aud.neurons * 10);
    // 按项目看只有一行，分不出来——这正是要按用途另记一本的原因
    const byProject = (await db.prepare("SELECT project, req FROM usage_by_project WHERE model = 'workers-ai'").all<{ project: string; req: number }>()).results!;
    expect(byProject).toEqual([{ project: 'practical-assets', req: 2 }]);
  });

  it('语音生成记成 tts；接口的 byPurpose 每一项都有 neurons 和次数，加起来 = ai_usage（不多记也不漏记）', async () => {
    await genAsset('correct');
    await genTts();
    const j = await get<UsageBody>('/api/usage');
    expect(j.byPurpose.map((x) => x.purpose)).toEqual([PURPOSE_IMAGE, TTS_PURPOSE]);
    for (const x of j.byPurpose) {
      expect(x.waiReq).toBe(1);
      expect(x.geminiReq).toBe(0);
      expect(x.neurons).toBeGreaterThan(0);
      expect(x.label).toBe(purposeLabel(x.purpose));
    }
    const total = (await db.prepare('SELECT neurons FROM ai_usage').first<{ neurons: number }>())!.neurons;
    expect(j.byPurpose.reduce((a, x) => a + x.neurons, 0)).toBeCloseTo(total, 6);
    // 全都记上了，所以没有"没按用途记下来的"那一行
    expect(j.byPurpose.some((x) => x.purpose === UNLABELED)).toBe(false);
  });

  it('生成失败的那一次也按用途记（宁可多记不要漏记）', async () => {
    const boom = { run: async () => { throw new Error('替身：模型不可用'); } };
    expect((await genAsset('correct', env({ AI: boom }))).status).toBe(502);
    const rows = await purposeRows();
    expect(rows.map((r) => [r.purpose, r.req])).toEqual([[PURPOSE_IMAGE, 1]]);
    expect(rows[0].neurons).toBeGreaterThan(0);
  });

  it('PURPOSES 里的每一个都有中文名字，页面上不会冒出英文代号', () => {
    for (const p of PURPOSES) expect(purposeLabel(p)).not.toMatch(/^[a-z-]+$/);
    expect(purposeLabel(UNLABELED)).toBe('没按用途记下来的');
    // 不认识的用途原样显示，不猜
    expect(purposeLabel('something-new')).toBe('something-new');
  });
});

// ======================================================================
describe('④ 不编数字：记不出来的写"没记录"，差额单独列一行', () => {
  const left = (used: number): UsageLeft[] => [
    { key: WAI_KEY, label: 'w', unit: 'neurons', used, cap: 8_000, left: 8_000 - used, resetAt: 0, resetText: '', models: 1 },
    { key: 'gemini', label: 'g', unit: '次', used: 10, cap: 400, left: 390, resetAt: 0, resetText: '', models: 2 },
  ];
  const one = (neurons: number, geminiReq = 0): PurposeUsage[] => [{ purpose: 'tts', label: '语音生成', neurons, waiReq: 1, geminiReq }];

  it('今天的总量比按用途记下的多：多出来的单独一行，次数是 null（页面写"没记录"），不补 0', () => {
    const rest = unlabeledUsage(one(100, 4), left(900))!;
    expect(rest.purpose).toBe(UNLABELED);
    expect(rest.neurons).toBe(800);
    expect(rest.geminiReq).toBe(6);
    expect(rest.waiReq).toBeNull();
  });

  it('全都记上了（差额不到一次调用的量）：不显示这一行', () => {
    expect(unlabeledUsage(one(900, 10), left(900))).toBeNull();
    expect(unlabeledUsage(one(899.7, 10), left(900))).toBeNull();
  });

  it('不会算出负数（按用途记的比总量还多时取 0，而不是写一个负数上去）', () => {
    expect(unlabeledUsage(one(1_000, 99), left(900))).toBeNull();
  });

  it('真的有旧数据时：接口把差额列出来，而且不摊到任何一个用途头上', async () => {
    // 这一版上线以前的用量：只有 ai_usage / model_usage，没有用途
    await db.prepare("INSERT INTO ai_usage (day, neurons) VALUES (?1, 500)").bind(utcDay(T0)).run();
    await genTts();
    const j = await get<UsageBody>('/api/usage');
    const tts = j.byPurpose.find((x) => x.purpose === TTS_PURPOSE)!;
    const rest = j.byPurpose.find((x) => x.purpose === UNLABELED)!;
    expect(tts.neurons).toBeLessThan(5); // 一句话的配音，没有被旧数据污染
    expect(rest.neurons).toBeCloseTo(500, 0);
    expect(rest.waiReq).toBeNull();
    expect(j.byPurpose[j.byPurpose.length - 1].purpose).toBe(UNLABELED); // 永远排在最后
  });
});

// ======================================================================
describe('⑤ 它在"用量和限额"里，不是新开的一个页', () => {
  it('后台页面：两块都在 #t-usage 这个模块里，没有新的二级菜单项', () => {
    const mod = ADMIN_PAGE.slice(ADMIN_PAGE.indexOf('id="t-usage"'), ADMIN_PAGE.indexOf('id="t-byproj"'));
    expect(mod).toContain('还剩多少');
    expect(mod).toContain('分别用到了哪里');
    expect(mod).toContain('id="u-left"');
    expect(mod).toContain('id="u-purpose"');
    // 没有多出一个 #/tools/<新页>
    const subs = ADMIN_PAGE.slice(ADMIN_PAGE.indexOf('id="sub-tools"'), ADMIN_PAGE.indexOf('</nav>', ADMIN_PAGE.indexOf('id="sub-tools"')));
    expect([...subs.matchAll(/href="#\/tools\/([a-z]+)"/g)].map((m) => m[1]).sort()).toEqual(['assets', 'byproj', 'ext', 'hook', 'queue', 'reply', 'tts', 'usage']);
  });

  it('页面脚本读的就是 /api/usage 的 left 和 byPurpose 两个字段（接口改名就会红）', () => {
    expect(ADMIN_PAGE).toContain("renderLeft(j.left||[])");
    expect(ADMIN_PAGE).toContain("renderPurpose(j.byPurpose||[])");
    expect(ADMIN_PAGE).toContain("x.waiReq==null?'没记录'");
  });
});
