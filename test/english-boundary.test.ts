/**
 * 英语学习这一块的**拆分护栏**（2026-11-13，Amos 点名要的）。
 *
 * 他的原话：「但是要做好随时可以拆出来的准备，一旦我学有所成…那个时候咱们再将这个项目拆出来单独发展」。
 *
 * 合进来容易，拆出去难 —— 难的不是复制文件，是**半年后没人说得清哪些东西算英语的**：
 * 工作台的代码悄悄 import 了发音训练的某个函数、一条 SQL 把 `pron_round` 和 `queue` JOIN 在一起、
 * 接口散落在 `/api/pron/`、`/api/s2/`、`/api/drill/` 三个前缀下。到那时拆就等于重写。
 *
 * 所以这个文件守四条界，清单在 `src/english.ts`（**新增英语文件必须同时加进那份清单**，否则这里会红）：
 *   ① 清单上的文件**只许**被清单上的文件、`src/admin-page.ts`、`src/queue.ts` import —— 别人 import 就红。
 *   ② 清单上的文件**只许** import 共用底座（./env、./usage、./workers-ai、./tts）和清单内部 —— 伸手去拿工作台/基金/副驾驶就红。
 *   ③ 英语的 SQL **不许**和非英语的表出现在同一条语句里（不 JOIN）—— 拆库时才切得干净。
 *   ④ 英语的接口**只在 `/api/en/` 前缀下** —— 换域名时一条正则就迁得完。
 *
 * 这四条每一条都用**反例**验过真的会红（写一条跨界 import / 跨界 JOIN / 旧前缀，测试立刻失败）。
 * 这个文件只读源码，不改它们，也不起服务、不连库。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers';
import { 共用底座, 共用表里的前缀, 接口, 接口前缀, 允许的宿主, 源文件, 测试, 表, 迁移, 页面模块 } from '../src/english';

const 读 = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
/** 去掉注释和模板字符串以外的噪音：只去注释，保留字符串（SQL 和路径都在字符串里） */
const 去注释 = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');

const 英语文件 = new Set<string>(源文件);
const 宿主 = new Set<string>(允许的宿主);
const SRC = readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.ts')).map((f) => 'src/' + f);

/** 一个文件里所有 import / export-from 的来源（相对说明符，原样返回） */
function 它import了谁(rel: string): string[] {
  const t = 去注释(读(rel));
  return [...t.matchAll(/(?:^|[\s;}])(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
}
/** './pron-page' → 'src/pron-page.ts'；不是相对路径（node:fs 之类）回 null */
function 解析(fromRel: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = path.posix.join(path.posix.dirname(fromRel), spec);
  for (const c of [base + '.ts', base + '/index.ts', base]) if (existsSync(path.join(ROOT, c))) return c;
  return base + '.ts';
}

// ======================================================================
describe('0. 清单本身：写的那些文件都真的在', () => {
  it('源文件、测试、迁移一个不少地躺在仓库里（清单指到不存在的文件就是假清单，底线 3）', () => {
    for (const f of [...源文件, ...测试, ...迁移]) expect([f, existsSync(path.join(ROOT, f))]).toEqual([f, true]);
  });

  it('src/ 里凡是发音训练 / 句子训练 / 语音的文件，清单上一个都不能漏（漏了下面三条界就守不住）', () => {
    // 2026-11-13 多认一类前缀 `en-`（src/en-audio.ts、src/en-audio-list.ts）：
    // 语音那两个文件不叫 pron 也不叫 s2，不认它们的话新文件可以悄悄绕过下面四条界
    const 该在清单里 = SRC.filter((f) => /\/(pron|s2|en)[-.]/.test(f));
    expect([...该在清单里].sort().filter((f) => !英语文件.has(f))).toEqual([]);
  });

  it('清单上的表和迁移对得上：两个迁移建的就是这四张（一张不多一张不少），而且**整个 migrations/ 一句 DROP 都没有**', () => {
    // 2026-11-13 多了一张 en_audio（迁移 0022）：守的东西没变 ——「清单上的表」和「清单上的迁移建的表」必须完全对得上，
    // 只是现在要把两个迁移建的表**并起来**比。逐个迁移也各自钉死，免得把表挪到别的迁移里还不被发现。
    expect([...读('migrations/0019_pron.sql').matchAll(/CREATE TABLE (\w+)/g)].map((m) => m[1]).sort())
      .toEqual(['pron_audio', 'pron_round', 'pron_say']);
    expect([...读('migrations/0022_en_audio.sql').matchAll(/CREATE TABLE (\w+)/g)].map((m) => m[1]))
      .toEqual(['en_audio']);
    const 建了 = 迁移.flatMap((f) => [...读(f).matchAll(/CREATE TABLE (\w+)/g)].map((m) => m[1]));
    expect(建了.sort()).toEqual([...表].sort());
    for (const f of readdirSync(path.join(ROOT, 'migrations'))) {
      const sql = 读('migrations/' + f).replace(/--.*$/gm, '');
      expect([f, /\bDROP\b/i.test(sql)]).toEqual([f, false]);
    }
  });

  it('句子训练**不存任何进度**：全仓库没有一张 s2 的表、没有一个 s2 的迁移（它的那份语音和发音训练共用 en_audio）', () => {
    // 2026-11-13：迁移清单从一个变成两个（多了语音的 0022）。守的那件事没变 ——
    // **句子训练自己不落库**：没有 s2_xxx 表、没有 s2 字样的迁移文件。
    // 它念的那几句和发音训练共用同一张 en_audio（键是内容哈希，谁先用到就存谁），不单开一张进度表。
    expect([...迁移]).toEqual(['migrations/0019_pron.sql', 'migrations/0022_en_audio.sql']);
    const 全部迁移 = readdirSync(path.join(ROOT, 'migrations')).sort();
    expect(全部迁移.filter((f) => /s2/i.test(f))).toEqual([]);
    expect(全部迁移.some((f) => /\bs2_/.test(读('migrations/' + f)))).toBe(false);
    expect([...表].filter((t) => /^s2/.test(t))).toEqual([]);
  });

  it('第三方课件 src/s2-content.ts 在清单里，而且文件自己写明了它是第三方课程材料（将来要卖必须换掉）', () => {
    expect(英语文件.has('src/s2-content.ts')).toBe(true);
    expect(读('src/s2-content.ts')).toContain('第三方课程材料');
  });
});

// ======================================================================
describe('1. 谁能 import 英语：只有清单内部 + admin-page + queue', () => {
  it('src/ 里别的模块**一个都不许** import 清单上的文件（工作台、基金、副驾驶伸手过来就红）', () => {
    const 越界: string[] = [];
    for (const f of SRC) {
      if (英语文件.has(f) || 宿主.has(f)) continue;
      for (const spec of 它import了谁(f)) {
        const r = 解析(f, spec);
        if (r && 英语文件.has(r)) 越界.push(`${f} → ${spec}`);
      }
    }
    expect(越界).toEqual([]);
  });

  it('两个宿主就是 admin-page.ts 和 queue.ts：admin-page 只插页面那三段，queue 只挂路由', () => {
    const 页面 = 它import了谁('src/admin-page.ts').map((x) => 解析('src/admin-page.ts', x)).filter((x) => x && 英语文件.has(x));
    expect([...new Set(页面)].sort()).toEqual(['src/pron-page.ts', 'src/s2-page.ts']);
    const 路由 = 它import了谁('src/queue.ts').map((x) => 解析('src/queue.ts', x)).filter((x) => x && 英语文件.has(x));
    expect([...new Set(路由)].sort()).toEqual(['src/en-audio.ts', 'src/pron.ts']);
  });

  it('入口一共就这两个文件 —— 拆出去那天，src/ 里要改的也只有它们', () => {
    const 有引用的外人 = SRC.filter((f) => !英语文件.has(f))
      .filter((f) => 它import了谁(f).some((spec) => { const r = 解析(f, spec); return !!r && 英语文件.has(r); }));
    expect(有引用的外人.sort()).toEqual([...允许的宿主].sort());
  });
});

// ======================================================================
describe('2. 英语能 import 谁：共用底座 + 清单内部，别的一律不许', () => {
  it('清单上每个文件的每一条 import，要么是共用底座，要么是清单内部，要么是 node: 内置', () => {
    const 越界: string[] = [];
    for (const f of 源文件) {
      for (const spec of 它import了谁(f)) {
        if ((共用底座 as readonly string[]).includes(spec)) continue;
        if (!spec.startsWith('.')) continue;          // node:fs 之类
        const r = 解析(f, spec);
        if (r && 英语文件.has(r)) continue;
        越界.push(`${f} → ${spec}`);
      }
    }
    expect(越界).toEqual([]);
  });

  it('共用底座就那四个，而且每个都真的在（拆出去那天要在新仓库重建的就是它们）', () => {
    // 2026-11-13 少了一个 ./tts：语音改成**预先生成**之后，运行时一次 TTS 都不调了 ——
    // 这是**少一条跨界依赖**（拆出去更容易），不是放宽：少写一个，上面那条"只许 import 底座和清单内部"就更严。
    expect([...共用底座]).toEqual(['./env', './usage', './workers-ai']);
    for (const m of 共用底座) expect([m, existsSync(path.join(ROOT, 'src', m.slice(2) + '.ts'))]).toEqual([m, true]);
  });

  it('具体点名几样**不许**出现在英语文件的 import 里：工作台 / 基金 / 副驾驶 / 公司总览', () => {
    const 禁 = ['./admin-page', './queue', './company', './funds', './funds-api', './funds-page', './hooks', './projects', './assets', './gemini', './voice'];
    const 犯规: string[] = [];
    for (const f of 源文件) for (const spec of 它import了谁(f)) if (禁.includes(spec)) 犯规.push(`${f} → ${spec}`);
    expect(犯规).toEqual([]);
  });
});

// ======================================================================
/**
 * 第 3 条界：SQL 不许跨界。
 * 非英语的表名从 migrations/ 里真实地扫出来（不是手写一份名单，免得新表一加就漏）。
 */
const 全部表 = (() => {
  const out = new Set<string>();
  for (const f of readdirSync(path.join(ROOT, 'migrations'))) for (const m of 读('migrations/' + f).matchAll(/CREATE TABLE (\w+)/g)) out.add(m[1]);
  return out;
})();
const 非英语表 = [...全部表].filter((t) => !(表 as readonly string[]).includes(t));
/** 一段源码里的 SQL 语句（SELECT / INSERT / UPDATE / DELETE 开头的字符串字面量；拼接的按一条算） */
function 语句们(rel: string): string[] {
  const t = 去注释(读(rel));
  return [...t.matchAll(/'((?:SELECT|INSERT|UPDATE|DELETE|REPLACE)\b[^']*)'/gi)].map((m) => m[1]);
}
/** 一条语句里点到了哪些表（FROM / JOIN / INTO / UPDATE 后面那个标识符） */
const 点到的表 = (sql: string) => [...sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-zA-Z_]\w*)/gi)].map((m) => m[1]);

describe('3. SQL 不跨界：英语的表不和非英语的表出现在同一条语句里', () => {
  it('migrations/ 里真有这些表（扫出来的名单不是空的，否则下面两条等于没守）', () => {
    for (const t of 表) expect([t, 全部表.has(t)]).toEqual([t, true]);
    expect(非英语表.length).toBeGreaterThan(10);
    expect(非英语表).toContain('queue');
    expect(非英语表).toContain('settings');
  });

  it('清单上每条 SQL：**要么只碰英语的表，要么只碰非英语的表**，没有一条同时碰两边（= 不会 JOIN）', () => {
    const 跨界: string[] = [];
    for (const f of 源文件) {
      for (const sql of 语句们(f)) {
        const ts = 点到的表(sql);
        const 英 = ts.filter((t) => (表 as readonly string[]).includes(t));
        const 非英 = ts.filter((t) => 非英语表.includes(t));
        if (英.length && 非英.length) 跨界.push(`${f}：${英.join('/')} ✕ ${非英.join('/')} —— ${sql.slice(0, 60)}`);
      }
    }
    expect(跨界).toEqual([]);
  });

  it('英语文件碰到的非英语表只有共用的 settings，而且只用 pron_say: 这个 key 前缀（拆库时按前缀挑行，不搬表）', () => {
    const 碰到的: string[] = [];
    for (const f of 源文件) for (const sql of 语句们(f)) for (const t of 点到的表(sql)) if (非英语表.includes(t)) 碰到的.push(t);
    expect([...new Set(碰到的)].sort()).toEqual(['settings']);
    const 全文 = 源文件.map(读).join('\n');
    const keys = [...全文.matchAll(/'([a-z_]+:)'\s*\+/g)].map((m) => m[1]);
    expect([...new Set(keys)].sort()).toEqual([...共用表里的前缀].sort());
  });

  it('英语的那几张表**只有英语文件碰**（别的模块连 SELECT 都不许，不然拆库时数据会被别人读着）', () => {
    const 外人: string[] = [];
    for (const f of SRC) {
      if (英语文件.has(f)) continue;
      const t = 去注释(读(f));
      for (const tb of 表) if (new RegExp('\\b' + tb + '\\b').test(t)) 外人.push(`${f} 碰了 ${tb}`);
    }
    expect(外人).toEqual([]);
  });
});

// ======================================================================
describe('4. 接口只在 /api/en/ 下面', () => {
  it('清单上写的两条接口都在 /api/en/ 前缀下（2026-11-13：发音那条从 /api/en/pron/audio/ 挪成 /api/en/audio/，S1 S2 共用）', () => {
    expect(接口前缀).toBe('/api/en/');
    for (const a of 接口) expect([a, a.startsWith(接口前缀)]).toEqual([a, true]);
  });

  it('路由真的挂在 /api/en/pron/ 上（src/queue.ts 里就是这两段）', () => {
    const q = 读('src/queue.ts');
    for (const a of 接口) expect([a, q.includes(`'${a}'`)]).toEqual([a, true]);
  });

  // 旧前缀拼出来，不写成字面量：写死在这个文件里，它自己就会被下面那条扫到
  const 旧前缀 = '/api/' + 'pron/';
  it('**没搬过来之前那个旧前缀，全仓库一个都不剩**（不留兼容：只有 Amos 一个人用，没有外部调用方）', () => {
    const 残留: string[] = [];
    for (const f of [...SRC, ...测试, 'scripts/e2e-platform.mjs', 'scripts/e2e-admin.mjs', 'scripts/e2e-tools.mjs', 'scripts/e2e-queue.mjs']) {
      // 这个文件自己是守门的：旧前缀只在上面那行拼出来，不算残留
      if (f === 'test/english-boundary.test.ts' || !existsSync(path.join(ROOT, f))) continue;
      if (去注释(读(f)).includes(旧前缀)) 残留.push(f);
    }
    expect(残留).toEqual([]);
  });

  it('页面上那两块挂在 Practical 项目页，而且发音训练的接口前缀是 /api/en/pron/', async () => {
    const { ADMIN_PAGE } = await import('../src/admin-page');
    expect(ADMIN_PAGE).toContain("window.__pronBase='/api/en/pron/'");
    for (const m of 页面模块) {
      expect([m.id, ADMIN_PAGE.includes(`id="${m.id}"`)]).toEqual([m.id, true]);
      expect([m.id, ADMIN_PAGE.includes(`data-s="${m.id}"`)]).toEqual([m.id, true]);
    }
  });

  it('英语文件自己不许写死别的前缀（除了 /api/en/，一个 /api/ 字样都不出现）', () => {
    const 犯规: string[] = [];
    for (const f of 源文件) for (const m of 去注释(读(f)).matchAll(/\/api\/[a-z0-9/-]*/g)) if (!m[0].startsWith(接口前缀)) 犯规.push(`${f}：${m[0]}`);
    expect(犯规).toEqual([]);
  });
});
