/**
 * "那个数不能再误导人"（Amos 2026-11-03 被后台的用量数字误导了两次之后加的）。
 *
 * 发生了什么：后台写"今天已用 115 / 9500，还剩 9385"，点生成却被 Cloudflare 直接拒了
 * （`4006: you have used up your daily free allocation of 10,000 neurons…`）。
 * 根因：`wrangler.toml` 里 `marketing` 和 `marketing-staging` 是**两个不同的 D1**，各记各的账；
 * 而 Cloudflare 的 **10,000 neurons/天是按整个账号算的**，两个环境共用。
 *
 * 守住五条：
 *   1. **迁移 0011 只建表**：一条 CREATE TABLE，没有 ALTER / DROP / INDEX / INSERT / UPDATE / DELETE；旧表一行不动。
 *   2. **"还剩多少"当面说清**：Workers AI 那一行必须写明是**本环境**记下的、Cloudflare 按**整个账号**算、
 *      测试版和上线前的用量都不在里面，所以只是个**下限**，不是真实剩余；**不把两个环境的数加起来冒充真实值**（底线 3）。
 *   3. **按文案认"账号级额度用尽"**：Amos 看到的 4006 不在官方错误表里（表里是 3036 Account limited），
 *      只认码会漏；3036、429 也认，普通错误和我们自己设的上限不能误判。
 *   4. **Cloudflare 真说过的话记下来并显示**：记一行 `account_limit`，后台"还剩多少"置顶一句红字，
 *      清零时间从 `nextReset()` 算（UTC 0 点＝台湾早上 8 点），**不写死字符串**；到下一个 UTC 日**自动失效**。
 *   5. **英文报错翻成人话**：素材生成器和语音生成回 429 + 中文"出错"，说清三件事（整个账号的额度、明早 8 点清零、
 *      要继续得升级付费计划且由 Amos 决定），英文原话附在括号里；**不给升级链接、不建议他升级**（C117 / 底线 8）。
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import { ADMIN_PAGE } from '../src/admin-page';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import {
  accountLimit, accountLimitedMessage, CF_ACCOUNT_FREE_NEURONS, envName, isAccountLimited, noteAccountLimit,
  nextReset, twText, usageLeft, utcDay, WAI_KEY, type AccountLimit, type UsageLeft, type UsageRow,
} from '../src/usage';
import { ROOT, T0 } from './helpers';

const HOST = 'https://marketing-staging.example.test';
const PASS = 'test_only_password_0123456789';
const MIG = path.join(ROOT, 'migrations');
const M0011 = '0011_account_limit.sql';
/** 迁移 0011 以前就有的表：跑完 0011 以后这些表的结构一个字都不能变 */
const OLD_TABLES = ['events', 'rate', 'queue', 'auth_fail', 'auth_lock', 'ai_usage', 'model_usage', 'settings', 'usage_by_project', 'asset_gen', 'usage_by_purpose'];

/** Amos 2026-11-03 真的看到的那一句（码 4006，官方错误表里没有这个码） */
const CF_4006 = '4006: you have used up your daily free allocation of 10,000 neurons, please upgrade to Cloudflare’s Workers Paid plan if you would like to continue usage.';
/** 官方错误表里登记的账号级那一条 */
const CF_3036 = 'AiError: 3036: Account limited';

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

/** 替身 AI：想让它成功就给字节，想让它被 Cloudflare 拒就 throw 那句英文 */
const okAi = () => ({ async run(model: string): Promise<unknown> { return model.includes('flux') ? { image: btoa('fake-jpg') } : { audio: btoa('fake-mp3') }; } });
const boomAi = (msg: string) => ({ async run(): Promise<unknown> { throw new Error(msg); } });

const env = (over: Partial<Env> = {}): Env => ({ DB: db, ENVIRONMENT: 'staging', COPILOT_PASSWORD: PASS, AI: okAi(), ...over });
const call = (p: string, e: Env, init?: RequestInit, now = T0) => handle(new Request(`${HOST}${p}`, { redirect: 'manual', ...init }), e, now);

let SID = '';
beforeEach(async () => {
  await db.batch([...OLD_TABLES, 'account_limit'].map((t) => db.prepare(`DELETE FROM ${t}`)));
  const r = await call('/api/login', env(), { method: 'POST', body: JSON.stringify({ password: PASS }), headers: { 'content-type': 'application/json' } });
  SID = (r.headers.get('set-cookie') ?? '').split(';')[0];
});

interface UsageBody { rows: UsageRow[]; left: UsageLeft[]; accountLimit: AccountLimit | null }
const get = <T>(p: string, e: Env = env(), now = T0) => call(p, e, { headers: { cookie: SID } }, now).then((r) => r.json() as Promise<T>);
const genAsset = (e: Env, now = T0) =>
  call('/api/assets/gen', e, { method: 'POST', headers: { 'content-type': 'application/json', cookie: SID }, body: JSON.stringify({ scene: '01', slot: 'correct', text: 'a cat on a table', steps: 4 }) }, now);
const genTts = (e: Env, now = T0) =>
  call('/api/tts/gen', e, { method: 'POST', headers: { 'content-type': 'application/json', cookie: SID }, body: JSON.stringify({ text: 'Hand me the stapler now.' }) }, now);

/** 下一个 UTC 日的同一时刻：红字应该自己消失 */
const NEXT_DAY = T0 + 24 * 3600_000;

// ======================================================================
describe('① 迁移 0011：只建 account_limit，旧表一行不动', () => {
  it('有 0011_account_limit.sql，里面只有一条 CREATE TABLE（没有 ALTER / DROP / INDEX / INSERT / UPDATE / DELETE）', () => {
    const st = stmtsOf([M0011]);
    expect(st.length).toBe(1);
    expect(st[0]).toMatch(/^CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?account_limit\s*\(/i);
    expect(st[0]).not.toMatch(/\b(ALTER|DROP|CREATE\s+INDEX|INSERT|UPDATE|DELETE)\b/i);
  });

  it('跑完全部迁移：account_limit (day, model, first_at, at, hits, last_error)，主键 (day, model)', async () => {
    const cols = (await db.prepare("SELECT name, pk FROM pragma_table_info('account_limit')").all<{ name: string; pk: number }>()).results;
    expect(cols.map((c) => c.name).sort()).toEqual(['at', 'day', 'first_at', 'hits', 'last_error', 'model']);
    expect(cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name)).toEqual(['day', 'model']);
  });

  it('在只跑到 0010 的库上补跑 0011：旧表的结构一个字都没变，数据还在', async () => {
    const p = await getPlatformProxy<{ DB: D1Database }>({ configPath: path.join(ROOT, 'test/wrangler.test.toml'), persist: false, remoteBindings: false, envFiles: [] });
    const d = p.env.DB;
    try {
      await d.batch(stmtsOf(migs().filter((f) => f < M0011)).map((s) => d.prepare(s)));
      await d.prepare("INSERT INTO ai_usage (day, neurons) VALUES ('2026-11-03', 115.5)").run();
      const schema = async () => (await d.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND tbl_name != 'account_limit' ORDER BY name").all()).results;
      const s0 = await schema();
      await d.batch(stmtsOf([M0011]).map((s) => d.prepare(s)));
      expect(await schema()).toEqual(s0);
      expect((await d.prepare('SELECT neurons FROM ai_usage').first<{ neurons: number }>())!.neurons).toBeCloseTo(115.5, 9);
      expect((await d.prepare('SELECT COUNT(*) AS n FROM account_limit').first<{ n: number }>())!.n).toBe(0);
    } finally {
      await p.dispose();
    }
  });
});

// ======================================================================
describe('② 还剩多少：当面说清这个数是本环境记的，不是 Cloudflare 的真实剩余', () => {
  const rows = (used: number): UsageRow[] => [
    { model: WAI_KEY, label: '备用 AI', unit: 'neurons', req: 4, tokIn: 0, tokOut: 0, used, cap: 9_500, max: 9_500, state: 'ok', stateText: '正常', resetAt: nextReset(WAI_KEY, T0) },
    { model: 'gemini-3.6-flash', label: 'g', unit: '次', req: 1, tokIn: 0, tokOut: 0, used: 1, cap: 200, max: 10_000, state: 'ok', stateText: '正常', resetAt: nextReset('gemini-3.6-flash', T0) },
  ];

  it('Workers AI 那一行写明：本环境记的账 / Cloudflare 按整个账号算 / 测试版和上线前的不在里面 / 只是下限', () => {
    const wai = usageLeft(rows(115), '正式版').find((x) => x.key === WAI_KEY)!;
    // 看数字的时候就看得见的一句
    expect(wai.caveatShort).toBe('不是 Cloudflare 的真实剩余');
    const c = wai.caveat!;
    expect(c).toContain('正式版自己记下来的账'); // ← 去掉"本环境记下的"这句说明就会红
    expect(c).toContain('不是 Cloudflare 的真实剩余');
    expect(c).toContain('按「整个账号」算');
    expect(c).toContain('测试版花掉的');
    expect(c).toContain('这一版上线以前花掉的');
    expect(c).toContain('下限');
    expect(c).toContain('真实只会更少');
    expect(c).toContain('不会把两个环境的数加起来冒充真实值');
    expect(c).toContain(CF_ACCOUNT_FREE_NEURONS.toLocaleString('en-US'));
    // 不是"仅供参考"这种糊弄话
    expect(c).not.toContain('仅供参考');
  });

  it('环境名字是真的从 ENVIRONMENT 来的（正式版说"正式版"、测试版说"测试版"）', () => {
    expect(envName({ ENVIRONMENT: 'production' } as Env)).toBe('正式版');
    expect(envName({ ENVIRONMENT: 'staging' } as Env)).toBe('测试版');
    expect(usageLeft(rows(115), envName({ ENVIRONMENT: 'staging' } as Env))[0].caveat).toContain('测试版自己记下来的账');
  });

  it('没把两个环境加起来冒充真实值：已用还是本环境 ai_usage 的数，一个 neuron 都没多加', async () => {
    await db.prepare('INSERT INTO ai_usage (day, neurons) VALUES (?1, 115)').bind(utcDay(T0)).run();
    const j = await get<UsageBody>('/api/usage');
    const wai = j.left.find((x) => x.key === WAI_KEY)!;
    expect(wai.used).toBe(115);
    expect(wai.caveat).toContain('不是 Cloudflare 的真实剩余');
  });

  it('Gemini 那一行不带 Workers AI 的说明（两本账的毛病不一样，别抄错）', () => {
    expect(usageLeft(rows(115), '正式版').find((x) => x.key === 'gemini')!.caveat).toBeUndefined();
  });

  it('页面：红字的位置在"还剩多少"里，说明挂在表格底下，脚本读的就是 accountLimit / caveat', () => {
    const mod = ADMIN_PAGE.slice(ADMIN_PAGE.indexOf('id="t-usage"'), ADMIN_PAGE.indexOf('id="t-byproj"'));
    expect(mod.indexOf('id="u-acct"')).toBeGreaterThan(mod.indexOf('还剩多少'));
    expect(mod.indexOf('id="u-acct"')).toBeLessThan(mod.indexOf('id="u-left"'));
    expect(mod).toContain('id="u-left-notes"');
    expect(ADMIN_PAGE).toContain('renderAcct(j.accountLimit)');
    expect(ADMIN_PAGE).toContain('if(x.caveat)');
    expect(ADMIN_PAGE).toContain("if(x.caveatShort)");
    // 没有红字的时候整条不显示（不是显示一句空话）
    expect(ADMIN_PAGE).toContain("if(!a||!a.text){P.hidden=true;return;}");
    // 页面上也写清楚了真实剩余只有两条路
    expect(mod).toContain('按整个账号算的');
    expect(mod).toContain('要 Amos 的 API 令牌，这一版没做');
  });
});

// ======================================================================
describe('③ 怎么判"账号级额度用尽"：按文案，不只认错误码', () => {
  it('认 Amos 看到的那一句（4006，官方错误表里没有这个码）', () => {
    expect(isAccountLimited(CF_4006)).toBe(true);
    expect(isAccountLimited(new Error(CF_4006))).toBe(true);
    // 只认 3036 的写法会漏掉它 —— 这正是 Amos 被挡住的那一次
    expect(CF_4006).not.toContain('3036');
  });

  it('也认官方表里的 3036 Account limited 和 429', () => {
    expect(isAccountLimited(CF_3036)).toBe(true);
    expect(isAccountLimited('AiError: 429 Too Many Requests')).toBe(true);
  });

  it('普通的出错、我们自己设的上限、空错误，都不能误判成"账号额度用完"', () => {
    expect(isAccountLimited('替身：模型不可用')).toBe(false);
    expect(isAccountLimited('Workers AI 今天用到 8000 上限（台湾早上 8 点重置）')).toBe(false);
    expect(isAccountLimited('图片模型返回的格式不认识')).toBe(false);
    expect(isAccountLimited('AiError: 4290 ms timeout')).toBe(false);
    expect(isAccountLimited('')).toBe(false);
    expect(isAccountLimited(undefined)).toBe(false);
  });
});

// ======================================================================
describe('④ 英文报错翻成人话：素材生成器和语音生成', () => {
  const must = (zh: string) => {
    expect(zh).toContain('整个 Cloudflare 账号');          // ① 不是这个工具的问题
    expect(zh).toContain('不是这个工具坏了');
    expect(zh).toContain('10,000 neurons');
    expect(zh).toContain('清零，到点再点同一个按钮，没生成完的会接着跑'); // ② 明早 8 点清零、接着跑
    expect(zh).toContain('台湾时间 2026-10-30 08:00 清零');            // 从 nextReset 算出来的，不是写死的字符串
    expect(zh).toContain('Workers Paid');                              // ③ 要继续只能升级
    expect(zh).toContain('那要花钱，得 Amos 自己决定');
    expect(zh).toContain('（Cloudflare 原话：');                        // 英文原话留着，方便对账
    expect(zh).toContain('you have used up your daily free allocation');
    // 不给链接、不劝他升级
    expect(zh).not.toMatch(/https?:\/\//);
    expect(zh).not.toContain('建议');
  };

  it('accountLimitedMessage：三件事都说到，清零时间是算出来的', () => {
    must(accountLimitedMessage(CF_4006, T0));
    // 换一天跑，时间跟着变（写死字符串就会红）
    expect(accountLimitedMessage(CF_4006, NEXT_DAY)).toContain('台湾时间 2026-10-31 08:00 清零');
  });

  it('素材生成器：回 429 + 中文"出错"，不再把英文原样扔给 Amos', async () => {
    const r = await genAsset(env({ AI: boomAi(CF_4006) }));
    expect(r.status).toBe(429);
    const j = (await r.json()) as { 出错: string };
    must(j.出错);
  });

  it('语音生成：同一套中文', async () => {
    const r = await genTts(env({ AI: boomAi(CF_4006) }));
    expect(r.status).toBe(429);
    must(((await r.json()) as { 出错: string }).出错);
  });

  it('普通的模型出错照旧 502、照旧原样显示（没有把所有错都当成额度用完）', async () => {
    const r = await genAsset(env({ AI: boomAi('替身：模型不可用') }));
    expect(r.status).toBe(502);
    expect(((await r.json()) as { 出错: string }).出错).toContain('替身：模型不可用');
    expect(await accountLimit(env(), T0)).toBeNull();
  });
});

// ======================================================================
describe('⑤ Cloudflare 真说过的话：记下来、显示出来、到点自动失效', () => {
  it('被拒一次就记一行（UTC 日期 + workers-ai），再被拒只加次数、不多开一行', async () => {
    const e = env({ AI: boomAi(CF_4006) });
    await genAsset(e);
    await genTts(e);
    const rows = (await db.prepare('SELECT day, model, first_at, at, hits, last_error FROM account_limit').all<{ day: string; model: string; first_at: number; at: number; hits: number; last_error: string }>()).results!;
    expect(rows.length).toBe(1);
    expect(rows[0].day).toBe(utcDay(T0));
    expect(rows[0].model).toBe(WAI_KEY);
    expect(rows[0].hits).toBe(2);
    expect(rows[0].last_error).toContain('daily free allocation');
  });

  it('GET /api/usage 的 accountLimit：就是要置顶的那句红字，清零时间 = nextReset（UTC 0 点＝台湾早上 8 点）', async () => {
    await genAsset(env({ AI: boomAi(CF_4006) }));
    const j = await get<UsageBody>('/api/usage');
    const a = j.accountLimit!;
    expect(a.text).toBe('Cloudflare 在台湾时间 2026-10-29 12:00 说账号今天的 10,000 neurons 已经用完，台湾时间 2026-10-30 08:00 清零。');
    expect(a.resetAt).toBe(nextReset(WAI_KEY, T0));
    expect(new Date(a.resetAt).toISOString()).toBe('2026-10-30T00:00:00.000Z'); // 00:00 UTC
    expect(twText(a.resetAt).slice(11)).toBe('08:00'); // 台湾早上 8 点
    expect(a.raw).toContain('4006');
    expect(a.hits).toBe(1);
  });

  it('到点自动失效：同一条记录，到了下一个 UTC 日就不再返回（红字不会一直挂着吓人）', async () => {
    await noteAccountLimit(env(), T0, CF_4006);
    expect((await accountLimit(env(), T0))!.hits).toBe(1);
    // 台湾早上 8 点 = 下一个 UTC 日的 0 点：这一刻起就不显示了
    expect(await accountLimit(env(), nextReset(WAI_KEY, T0))).toBeNull();
    expect(await accountLimit(env(), NEXT_DAY)).toBeNull();
    // 但记录还在库里（对账用，不是删掉）
    expect((await db.prepare('SELECT COUNT(*) AS n FROM account_limit').first<{ n: number }>())!.n).toBe(1);
  });

  it('前一天被拒、今天没被拒：接口和页面都不显示昨天那条（红字不会一直挂着）', async () => {
    // 昨天 UTC 日里被拒过一次（台湾时间昨天下午）
    await noteAccountLimit(env(), T0 - 24 * 3600_000, CF_4006);
    expect(await accountLimit(env(), T0)).toBeNull();
    const j = await get<UsageBody>('/api/usage');
    expect(j.accountLimit).toBeNull();
    // 库里那一行还在，只是不显示了
    expect((await db.prepare('SELECT COUNT(*) AS n FROM account_limit').first<{ n: number }>())!.n).toBe(1);
  });

  it('没被拒过就是 null（不造一条出来）', async () => {
    expect((await get<UsageBody>('/api/usage')).accountLimit).toBeNull();
  });
});
