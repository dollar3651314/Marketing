/* 句子训练的**存档**（2026-11-15，Amos 点的）。
 *
 * 他原来问的是：「S2 句子训练 为什么做的是清单，而不是代练呢」。
 * 答案是代练早就做完了（13 课 126 步，一屏一步），**缺的是它不记事** ——
 * 在这个文件之前，`src/s2-page.ts` 唯一的接口是取语音，关掉页面下次从第 1 课第 1 步重来。
 * 126 步的东西没有存档，这是硬伤，所以先补这一件。
 *
 * 存两样，都在**已有的 `en_done` 表**里（`k` 主键 / `at` / `by`），不新建表、不加迁移：
 *   `s2:<课>:<步>`   这一步走完了        → 「接着练」就是第一个没有这一行的步
 *   `s2x:<课>:<步>`  这道题**第一次就答错** → 攒成「错题重练」
 *
 * 为什么错题要记"第一次"：代练里答错会退回去重看规则、重选，**他最后一定是选对才往下走的**。
 * 要是"答对就销账"，错题组永远是空的，等于没做。所以第一次答错就记一笔，
 * **只有在错题重练里再答对才销**（`来自: '错题重练'`）—— 相当于隔一阵再考他一次。
 *
 * 键是按**课内序号**编的（1 起）。序号跟着 s2-lesson.ts 的生成顺序走，顺序一变旧存档就对不上号，
 * 所以 test/s2-progress.test.ts 把每课的步数钉死了：课件动一个字，那条测试先红。
 */
import type { Env } from './env';
import { 生成 } from './s2-lesson';

/** 这份阶梯有几课、每课几步（生成一次，运行时不再算） */
const 课表 = 生成();
export const 一共几课 = 课表.length;
/** 第 N 课有几步（下标 0 = 第 1 课） */
export const 每课步数: number[] = 课表.map((c) => c.步.length);
export const 总步数 = 每课步数.reduce((a, b) => a + b, 0);

/** `en_done` 里的一行（和 pron.ts 用的是同一张表、同一个形状） */
export interface DoneRow { k: string; at: number; by: string }

export const 进度键 = (课: number, 步: number): string => `s2:${课}:${步}`;
export const 错题键 = (课: number, 步: number): string => `s2x:${课}:${步}`;

/** 这一课这一步存不存在（课 1 起、步 1 起）。越界一律 false —— 存档只认真实存在的步。 */
export const 有这一步 = (课: unknown, 步: unknown): boolean =>
  Number.isInteger(课) && Number.isInteger(步) &&
  (课 as number) >= 1 && (课 as number) <= 一共几课 &&
  (步 as number) >= 1 && (步 as number) <= 每课步数[(课 as number) - 1];

/** 键 → 第几课第几步；不认识的、越界的都回 null（页面传什么进来都不会写进库） */
export function 解析键(k: unknown, 前缀: 's2' | 's2x'): { 课: number; 步: number } | null {
  const m = /^(s2x?):(\d+):(\d+)$/.exec(String(k ?? '').trim());
  if (!m || m[1] !== 前缀) return null;
  const 课 = Number(m[2]);
  const 步 = Number(m[3]);
  return 有这一步(课, 步) ? { 课, 步 } : null;
}

/** 这一步是不是题（只有题才有错题可言；规则步答不了错） */
export function 是题(课: number, 步: number): boolean {
  if (!有这一步(课, 步)) return false;
  return 课表[课 - 1].步[步 - 1].类型 === '题';
}

/**
 * 接着练：**第一个还没走完的步**，按第 1 课第 1 步往后数。
 * 全部走完回 null —— 页面那时写「13 课 126 步全走完了」，不假装还有下一步。
 */
export function 接着练(done: DoneRow[]): { 课: number; 步: number; 第几步: number } | null {
  const 有 = new Set(done.map((r) => r.k));
  let 第几步 = 0;
  for (let 课 = 1; 课 <= 一共几课; 课++) {
    for (let 步 = 1; 步 <= 每课步数[课 - 1]; 步++) {
      第几步++;
      if (!有.has(进度键(课, 步))) return { 课, 步, 第几步 };
    }
  }
  return null;
}

/** 一句话结论要的几个数（页面顶上写这个，不写"正在读取"） */
export function 小结(done: DoneRow[]): { 一共: number; 走完了: number; 还剩: number; 百分之几: number } {
  const 走完了 = done.filter((r) => 解析键(r.k, 's2')).length;
  return { 一共: 总步数, 走完了, 还剩: 总步数 - 走完了, 百分之几: Math.round((走完了 * 100) / 总步数) };
}

/** 每课走到哪了（「换一课」那排卡片上标的就是这个） */
export function 每课进度(done: DoneRow[]): { 课: number; 走完了: number; 一共: number }[] {
  const 有 = new Set(done.map((r) => r.k));
  return 课表.map((c) => ({
    课: c.课,
    一共: c.步.length,
    走完了: c.步.reduce((n, _s, i) => n + (有.has(进度键(c.课, i + 1)) ? 1 : 0), 0),
  }));
}

/** 错题组：第一次就答错、还没在重练里答对的那些题，按课内顺序 */
export function 错题组(done: DoneRow[]): { 课: number; 步: number }[] {
  return done
    .map((r) => 解析键(r.k, 's2x'))
    .filter((x): x is { 课: number; 步: number } => !!x && 是题(x.课, x.步))
    .sort((a, b) => a.课 - b.课 || a.步 - b.步);
}

// ======================================================================
// 接口 /api/en/s2/*
// ======================================================================

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
/** 出错一律两句话：出错了什么、怎么办（页面原样显示，不许静默吞掉） */
const bad = (出错: string, 怎么办: string, status = 400) => json({ 出错, 怎么办 }, status);

async function 读存档(env: Env): Promise<DoneRow[]> {
  const r = await env.DB.prepare("SELECT k, at, by FROM en_done WHERE k LIKE 's2:%' OR k LIKE 's2x:%'").all<DoneRow>();
  return r.results ?? [];
}

/** 做完一件事就顺手回一份新的存档，页面不用再跑一趟 */
async function 这份存档(env: Env): Promise<Record<string, unknown>> {
  const done = await 读存档(env);
  return { 接着练: 接着练(done), 小结: 小结(done), 每课: 每课进度(done), 错题: 错题组(done) };
}

async function state(env: Env): Promise<Response> {
  return json({ 一共几课, 每课步数, 总步数, ...(await 这份存档(env)) });
}

/**
 * 走完一步 / 答错一题。body：
 *   `课` `步`   第几课第几步（1 起）
 *   `对`        题步才有：true 答对、false 答错；规则步不传
 *   `来自`      `'正常'`（默认）或 `'错题重练'`
 *
 * 四种组合各干什么，见文件头。**规则步只记走完，不记对错**。
 */
async function 记一步(env: Env, now: number, body: Record<string, unknown>): Promise<Response> {
  const 课 = Number(body.课);
  const 步 = Number(body.步);
  if (!有这一步(课, 步))
    return bad(
      `句子训练里没有这一步：第 ${String(body.课 ?? '?')} 课第 ${String(body.步 ?? '?')} 步。`,
      '刷新一下页面，它会重新拿一份进度。',
      400,
    );
  const 重练 = body.来自 === '错题重练';
  const 题 = 是题(课, 步);
  const 对 = body.对;
  if (题 && typeof 对 !== 'boolean') return bad('这一步是道题，没收到"选对了还是选错了"。', '刷新一下页面，再做一遍这道题。', 400);
  if (!题 && 重练) return bad('这一步是规则，不是题，错题重练里不会有它。', '刷新一下页面，它会重新拿一份错题。', 400);

  if (重练) {
    // 重练里答对才销账；答错就留着，下次还考
    if (对 === true) await env.DB.prepare('DELETE FROM en_done WHERE k = ?1').bind(错题键(课, 步)).run();
    return json({ 课, 步, 来自: '错题重练', ...(await 这份存档(env)) });
  }

  // 正常走答错了：记一笔错题，这一步先不算走完。
  // **「第一次就答错」要名副其实**：这一步以前走完过（他是回头重走的），这次答错就不记 ——
  // 不然每重走一遍旧课，错题组就平白长一截，重练的意义就没了。
  // 同一步第一次答错后反复点错也只记一笔（ON CONFLICT DO NOTHING）。
  if (题 && 对 === false) {
    const 走过 = await env.DB.prepare('SELECT 1 AS x FROM en_done WHERE k = ?1').bind(进度键(课, 步)).first<{ x: number }>();
    if (!走过)
      await env.DB.prepare('INSERT INTO en_done (k, at, by) VALUES (?1, ?2, ?3) ON CONFLICT (k) DO NOTHING')
        .bind(错题键(课, 步), now, '第一次就答错')
        .run();
    return json({ 课, 步, 走完了: false, 记了错题: !走过, ...(await 这份存档(env)) });
  }
  // 走完这一步。**已经有一行就不动它**（不把第一次走完的时间改写成这次重走的）
  await env.DB.prepare('INSERT INTO en_done (k, at, by) VALUES (?1, ?2, ?3) ON CONFLICT (k) DO NOTHING')
    .bind(进度键(课, 步), now, 'auto')
    .run();
  return json({ 课, 步, 走完了: true, ...(await 这份存档(env)) });
}

/**
 * `/api/en/s2/state`（GET）、`/api/en/s2/step`（POST）。
 * 鉴权在 queue.ts 的 adminApi 里已经过了；不认识的 sub 返回 null，由调用方给 404。
 */
export async function s2Api(env: Env, req: Request, now: number, sub: string): Promise<Response | null> {
  if (sub === 'state' && req.method === 'GET') return state(env);
  if (sub !== 'step' || req.method !== 'POST') return null;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return 记一步(env, now, body);
}
