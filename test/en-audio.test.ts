/**
 * 英语学习的**语音**（src/en-audio.ts、src/en-audio-list.ts、migrations/0022_en_audio.sql、
 * scripts/build-audio.py、scripts/audio-manifest.ts、.github/workflows/audio.yml）的测试。
 *
 * 2026-11-13 这一批换的是**谁在念、什么时候念**：
 *   · 谁在念：微软 Edge「大声朗读」背后的神经网络语音（英文 Sonia、中文 晓晓，语速 -5%），
 *     不再是 Workers AI 的 aura-2-en，也不再是浏览器自带的 speechSynthesis（Amos：**嫌手机朗读太机械**）。
 *   · 什么时候念：**预先生成**好写进 D1，运行时**只读不生成**。
 *
 * 守住七件事：
 *   1. **键是内容的哈希**，而且**钉死**几条（脚本、e2e、页面都按同一个键找同一段，错一位就全军覆没）。
 *   2. **清单不手抄**：56 个词 + 「跟我做」每一步 + S2 的 126 步，全从内容文件现读；按键去重；全部键互不相同。
 *   3. **大字只有英文的才念**（课件的英文例句），中文的大字标题不念。
 *   4. **运行时只读**：这个模块里没有 INSERT / UPDATE / DELETE、没有 env.AI、没有任何模型名。
 *   5. **库里没有就照实说**：404 + 两句话，**不回退去调 AI、不静默无声**（底线 3）。
 *   6. **迁移只 CREATE**，一张旧表都没碰；`pron_audio` 原样留着（aura 时代的行还查得出来）。
 *   7. **mp3 不进仓库**：git 跟踪的文件里一个 .mp3 都没有（两个仓库都是 public，念的是第三方课程材料）。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import { AUDIO_REV, audioKey, enAudioApi, toBytes, 中文声音, 内容哈希, 是英文, 键的样子, 指令文本, 英文声音, 语速, 还没生成 } from '../src/en-audio';
import { 语音清单 } from '../src/en-audio-list';
import { groupCard, PRON_WORD_IDS, audioTextOf } from '../src/pron';
import { GROUPS } from '../src/pron-content';
import { LESSON } from '../src/pron-lesson';
import { 生成 as s2生成 } from '../src/s2-lesson';
import { S2_DATA } from '../src/s2-page';
import { ROOT, T0 } from './helpers';

const PASS = 'ci_only_copilot_password_01';
const HOST = 'https://copilot.example.test';
const 读 = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
/** 一段真 mp3 的开头（测试只关心"原样进、原样出"，不关心它念的是什么） */
const MP3 = Uint8Array.from([0xff, 0xf3, 0x48, 0xc4, 0x00, 0x11, 0x22, 0x33]);

let db: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: path.join(ROOT, 'test/wrangler.test.toml'), persist: false, remoteBindings: false, envFiles: [] });
  db = proxy.env.DB;
  dispose = proxy.dispose;
  const sql = readdirSync(path.join(ROOT, 'migrations')).filter((f) => f.endsWith('.sql')).sort()
    .map((f) => 读('migrations/' + f).split('\n').map((l) => l.replace(/--.*$/, '')).join('\n'))
    .join(';\n').split(';').map((s) => s.trim()).filter(Boolean);
  await db.batch(sql.map((s) => db.prepare(s)));
});
afterAll(async () => dispose());
beforeEach(async () => { await db.batch([db.prepare('DELETE FROM en_audio'), db.prepare('DELETE FROM pron_audio')]); });

const env = (): Env => ({ DB: db, ENVIRONMENT: 'test', COPILOT_PASSWORD: PASS });
const 放进库 = (key: string, mp3: Uint8Array, voice = 英文声音, txt = 'bed') =>
  db.prepare('INSERT INTO en_audio (k, voice, txt, mp3, bytes, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind(key, voice, txt, mp3, mp3.byteLength, T0).run();
const 取 = (key: string) => enAudioApi(env(), new Request(`${HOST}/api/en/audio/${key}`), key);

// ======================================================================
describe('1. 键就是内容的哈希，而且钉死（脚本、页面、e2e 按的是同一个键）', () => {
  it('FNV-1a 64 位：几条钉死的向量（算法一改这里立刻红）', () => {
    expect(内容哈希('')).toBe('cbf29ce484222325');
    expect(内容哈希('a')).toBe('af63dc4c8601ec8c');
    expect(内容哈希('foobar')).toBe('85944171f73967e8');
    // 中文走 UTF-8 的字节，不是码点
    expect(内容哈希('你好')).toBe(内容哈希(new TextDecoder().decode(new TextEncoder().encode('你好'))));
    expect(内容哈希('bed')).not.toBe(内容哈希('bad'));
  });

  it('版本号、声音、语速都钉死；键 = 版本号 + 哈希，形状能被接口认出来', () => {
    expect(AUDIO_REV).toBe('e1');
    expect(英文声音).toBe('en-GB-SoniaNeural');   // Sonia，英国女声
    expect(中文声音).toBe('zh-CN-XiaoxiaoNeural'); // 晓晓（Amos 2026-11-13 听过试音确认）
    expect(语速).toBe('-5%');                      // 慢 5%，方便跟读
    expect(audioKey('bed', 英文声音)).toBe('e1-9eeb44316ba59b1e');
    expect(audioKey('Lucy is a doctor', 英文声音)).toBe('e1-a5c6e07a028cfdfa');
    expect(键的样子.test(audioKey('bed', 英文声音))).toBe(true);
    expect(键的样子.test('e1-9eeb44316ba59b1')).toBe(false);
    expect(键的样子.test('a2:g1-1a')).toBe(false);  // aura 时代那种键**不认**
  });

  it('同一句话换个声音、换个语速就是另一条（不会互相顶掉）', () => {
    expect(audioKey('bed', 中文声音)).not.toBe(audioKey('bed', 英文声音));
    expect(audioKey(' bed ', 英文声音)).toBe(audioKey('bed', 英文声音)); // 前后空白不算内容
  });

  it('「跟我做」念的是**那一句 + 提示**（只念前半句，他就还得低头看屏幕）', () => {
    expect(指令文本({ 说: '把嘴咧开，像笑一样。', 提示: '嘴角往两边拉，牙齿先不管。' })).toBe('把嘴咧开，像笑一样。　嘴角往两边拉，牙齿先不管。');
    expect(指令文本({ 说: '只有这一句。' })).toBe('只有这一句。');
  });
});

// ======================================================================
describe('2. 清单一条都不手抄：三个来源现读，按键去重', () => {
  const 清单 = 语音清单();
  const 键们 = 清单.map((x) => x.键);

  it('全部键互不相同（哈希撞了这里就红，不会两句话共用一段声音）', () => {
    expect(new Set(键们).size).toBe(键们.length);
    expect(清单.length).toBeGreaterThan(100);
    for (const x of 清单) expect([x.键, 键的样子.test(x.键)]).toEqual([x.键, true]);
  });

  it('① 发音训练那 56 个词一个不少（念的就是那个词本身，一个修饰词都不加）', () => {
    for (const id of PRON_WORD_IDS) {
      const 词 = audioTextOf(id)!;
      expect([id, 键们.includes(audioKey(词, 英文声音))]).toEqual([id, true]);
    }
    // 同一个词出现在两组里（light 在第 5、6 组都有）只存一条
    expect(PRON_WORD_IDS.length).toBe(56);
    expect(new Set(PRON_WORD_IDS.map((id) => audioTextOf(id)!)).size).toBeLessThan(56);
  });

  it('② 「跟我做」每一步那句指令都在（132 步，去重后少一些）', () => {
    const 步 = LESSON.flatMap((z) => z.步);
    expect(步.length).toBeGreaterThan(100);
    for (const s of 步) expect([s.说, 键们.includes(audioKey(指令文本(s), 中文声音))]).toEqual([s.说, true]);
  });

  it('③ S2 的 126 步：中文那一句都在；**大字只有英文的才念**，中文的大字标题不念', () => {
    const 步 = s2生成().flatMap((c) => c.步);
    expect(步.length).toBe(126);
    for (const s of 步) expect(键们.includes(audioKey(指令文本(s), 中文声音))).toBe(true);
    const 英文大 = 步.filter((s) => s.大 && 是英文(s.大));
    const 中文大 = 步.filter((s) => s.大 && !是英文(s.大));
    expect(英文大.length).toBeGreaterThan(50);
    expect(中文大.length).toBeGreaterThan(20);
    for (const s of 英文大) expect([s.大, 键们.includes(audioKey(s.大!, 英文声音))]).toEqual([s.大, true]);
    for (const s of 中文大) expect([s.大, 键们.includes(audioKey(s.大!, 英文声音))]).toEqual([s.大, false]);
  });

  it('「是英文」分得清：纯英文算，带一个中文字就不算，纯音标不算', () => {
    expect(是英文('Lucy is a doctor')).toBe(true);
    expect(是英文('Be 句型用来描述单个物体的静态性质')).toBe(false);
    expect(是英文("Let's Start —— 句式分类")).toBe(false);  // 英文里混一个中文词也不算
    expect(是英文('123')).toBe(false);                        // 一个拉丁字母都没有
    expect(是英文('')).toBe(false);
  });

  it('页面拿到的键和清单是同一套：groupCard 的「音键」、S2_DATA 的「说键 / 大键」都在清单里', () => {
    for (const g of GROUPS)
      for (const p of (groupCard(g).对 as { a: { 音键: string }; b: { 音键: string } }[]))
        for (const k of ['a', 'b'] as const) expect(键们).toContain(p[k].音键);
    for (const 课 of S2_DATA)
      for (const s of 课.步) {
        expect(键们).toContain(s.说键);
        if (s.大键) expect(键们).toContain(s.大键);
        // 中文的大字没有键 → 页面上就没有那个按钮（不给一个点了不响的按钮）
        if (s.大 && !是英文(s.大)) expect(s.大键).toBe('');
      }
  });

  it('清单由 scripts/audio-manifest.ts 原样打印出来（脚本和 e2e 都从那里拿，哈希只有一处实现）', () => {
    const out = execFileSync(path.join(ROOT, 'node_modules/.bin/vite-node'), ['scripts/audio-manifest.ts'], { cwd: ROOT, encoding: 'utf8' });
    const j = JSON.parse(out.slice(out.indexOf('{')));
    expect(j.版本).toBe(AUDIO_REV);
    expect(j.语速).toBe(语速);
    expect(j.声音们.sort()).toEqual([英文声音, 中文声音].sort());
    expect(j.条数).toBe(清单.length);
    expect(j.清单.map((x: { 键: string }) => x.键)).toEqual(键们);
  }, 60_000);
});

// ======================================================================
describe('3. 运行时只读：取得到就放，取不到就照实说（底线 3）', () => {
  it('库里有 → audio/mpeg，字节原样回来，带缓存头', async () => {
    const k = audioKey('bed', 英文声音);
    await 放进库(k, MP3);
    const r = (await 取(k))!;
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('audio/mpeg');
    expect(r.headers.get('cache-control')).toBe('private, max-age=86400');
    expect(r.headers.get('x-en-audio')).toBe(k);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(MP3);
  });

  it('库里没有 → **404 两句话**：照实说「还没生成」，怎么办也写清楚', async () => {
    const k = audioKey('还没生成过的一句', 中文声音);
    const r = (await 取(k))!;
    expect(r.status).toBe(404);
    const j = (await r.json()) as { 出错: string; 怎么办: string };
    expect(j.出错).toContain('还没生成');
    expect(j.出错).toContain(k);
    expect(j.怎么办).toBeTruthy();
    expect(j).toEqual(还没生成(k));
    // **不许**在"怎么办"里暗示它会自己补上 —— 它不会，要人去跑脚本
    expect(j.怎么办).toContain('build-audio.py');
  });

  it('库里那一行是空的（0 字节）也当成没有，**不回一段放不出声的 mp3**', async () => {
    const k = audioKey('bad', 英文声音);
    await 放进库(k, new Uint8Array(0), 英文声音, 'bad');
    expect((await 取(k))!.status).toBe(404);
  });

  it('键不像键 → 400，而且**根本不去查库**；不是 GET → 回 null（由路由给 404）', async () => {
    const r = (await 取('随便写的'))!;
    expect(r.status).toBe(400);
    expect((await r.json() as { 怎么办: string }).怎么办).toBeTruthy();
    expect(await enAudioApi(env(), new Request(`${HOST}/api/en/audio/x`, { method: 'POST' }), audioKey('bed', 英文声音))).toBeNull();
  });

  it('没登录一律 401（和后台别的接口同一套）', async () => {
    const r = await handle(new Request(`${HOST}/api/en/audio/${audioKey('bed', 英文声音)}`, { headers: { origin: HOST, 'cf-connecting-ip': '203.0.113.9' } }), env(), T0);
    expect(r.status).toBe(401);
  });

  it('D1 的 BLOB 三种形状都认得（ArrayBuffer / 定型数组 / 数字数组）', () => {
    expect(toBytes(MP3.buffer.slice(0))).toEqual(MP3);
    expect(toBytes(MP3)).toEqual(MP3);
    expect(toBytes([1, 2, 3])).toEqual(Uint8Array.from([1, 2, 3]));
    expect(toBytes(null)).toEqual(new Uint8Array(0));
  });

  it('**这个模块一次 AI 都不调、一个字节都不写**：源码里没有 INSERT / UPDATE / DELETE、没有 env.AI、没有模型名', () => {
    const 码 = 读('src/en-audio.ts').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
    for (const w of ['INSERT', 'UPDATE ', 'DELETE', 'env.AI', 'aura', 'melotts', 'whisper', '@cf/', 'chargeNeurons', 'dailyCap'])
      expect([w, 码.includes(w)]).toEqual([w, false]);
    expect((码.match(/SELECT/g) ?? []).length).toBe(1);
  });

  it('页面那两屏也不再有浏览器自带的朗读：speechSynthesis 一个字都不剩', async () => {
    const { PRON_JS } = await import('../src/pron-page');
    const { S2_JS } = await import('../src/s2-page');
    for (const 段 of [PRON_JS, S2_JS])
      for (const w of ['speechSynthesis', 'SpeechSynthesisUtterance']) expect([w, 段.includes(w)]).toEqual([w, false]);
  });
});

// ======================================================================
describe('4. 迁移 0022 只 CREATE；旧的 pron_audio 一行都没动', () => {
  const 码 = 读('migrations/0022_en_audio.sql').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

  it('一条 CREATE TABLE（en_audio），没有 ALTER / DROP / 回填', () => {
    expect((码.match(/CREATE TABLE/g) ?? []).length).toBe(1);
    expect(码).toContain('CREATE TABLE en_audio (');
    for (const w of ['ALTER ', 'DROP ', 'INSERT ', 'UPDATE ', 'DELETE ']) expect([w, 码.toUpperCase().includes(w)]).toEqual([w, false]);
  });

  it('列就是这几列', () => {
    expect([...码.slice(码.indexOf('CREATE TABLE en_audio')).split(');')[0].matchAll(/^ {2}(\w+) /gm)].map((m) => m[1]))
      .toEqual(['k', 'voice', 'txt', 'mp3', 'bytes', 'at']);
  });

  it('`pron_audio` 还在、还能写进去（aura 时代的历史行一条都不删）', async () => {
    await db.prepare('INSERT INTO pron_audio (item, mp3, at) VALUES (?1, ?2, ?3)').bind('a2:g1-1a', MP3, T0).run();
    expect((await db.prepare('SELECT COUNT(*) AS n FROM pron_audio').first<{ n: number }>())?.n).toBe(1);
  });

  it('迁移编号连续，旧文件一个都没删', () => {
    const all = readdirSync(path.join(ROOT, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
    expect(all.map((f) => Number(f.slice(0, 4)))).toEqual(all.map((_, i) => i + 1));
    expect(all[21]).toBe('0022_en_audio.sql');
  });
});

// ======================================================================
describe('5. mp3 不进仓库、脚本不碰密钥', () => {
  it('**生成出来的语音一个都不进仓库**：git 里唯一的 .mp3 是那段 0.26 秒的静音替身（e2e 预置用）', () => {
    const 文件 = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    // 这一条**只许**有这一个：test/fixtures/pron/silent.mp3 是本地 ffmpeg 生成的静音，不是任何人的声音、
    // 也不是课程内容。真的语音全部只存在 D1 的 en_audio 里（Amos 2026-11-13 的 A 方案）。
    expect(文件.filter((f) => /\.mp3$/i.test(f))).toEqual(['test/fixtures/pron/silent.mp3']);
    expect(readFileSync(path.join(ROOT, 'test/fixtures/pron/silent.mp3')).byteLength).toBeLessThan(10_000);
    // 生成脚本默认也不往仓库里写：要存文件得自己给 --out 指一个仓库外的文件夹
    expect(读('scripts/build-audio.py')).toContain('**别放进仓库**');
  });

  it('生成脚本在，而且**不新增任何密钥**：只用已经有的那两个 Cloudflare 变量', () => {
    expect(existsSync(path.join(ROOT, 'scripts/build-audio.py'))).toBe(true);
    const py = 读('scripts/build-audio.py');
    expect(py).toContain('edge-tts');
    expect(py).toContain('en-GB-SoniaNeural');
    expect(py).toContain('zh-CN-XiaoxiaoNeural');
    // 代理的根证书这件事**写进脚本本身**（换台机器才不会卡在 SSLCertVerificationError）
    expect(py).toContain('ca-bundle.crt');
    expect(py).toContain('SSLCertVerificationError');
    // 绝不关掉证书校验
    for (const w of ['verify=False', 'CERT_NONE', 'check_hostname = False']) expect([w, py.includes(w)]).toEqual([w, false]);
    const 变量 = [...py.matchAll(/environ(?:\.get)?[([]"?'?([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]);
    expect([...new Set(变量)].sort()).toEqual(['EXTRA_CA_BUNDLE', 'HTTPS_PROXY']);
  });

  it('CI 里是**单独一个 job**：手动能重跑、只在 main 上自动跑，**不在部署的关键路径上**', () => {
    const y = 读('.github/workflows/audio.yml');
    expect(y).toContain('workflow_dispatch:');
    expect(y).toContain('build-audio.py');
    expect(y).toContain('CLOUDFLARE_API_TOKEN');
    // 只用已经有的两个密钥，不新增
    expect([...new Set([...y.matchAll(/secrets\.([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]))].sort())
      .toEqual(['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']);
    // 部署那条流水线（ci.yml）里**一个字都没有**它：edge-tts 挂了不该拖垮部署
    expect(读('.github/workflows/ci.yml')).not.toContain('build-audio');
  });
});
