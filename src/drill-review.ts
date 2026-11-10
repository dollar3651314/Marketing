/**
 * 工作台「带练」的**复考**（表 `drill_review` / 迁移 0015；页面 src/drill-page.ts；内容和逻辑在 src/drill.ts）。
 *
 * **为什么有这一块**（Amos 2026-11-09 原话）：「做完后**不知道该干什么**」。
 * 18 项走完以后，小结页给一个大按钮「明天再考我这 18 项」——按下去就记一笔"明天同一时刻到期"。
 *
 * 三种状态，页面顶上永远只有一句话（这句话**由服务端给**，页面原样显示，不自己编）：
 *   - 没安排：什么都不写（小结页才出那个按钮）。
 *   - 还没到期：「下次复考：X 月 X 日」，并且**可以提前开始**（按钮「现在就复考」）。
 *   - 已经到期：「今天是复考：只考，不给关键点、不给词意……」，走完 18 项（三段合一轮、**顺序打散**），
 *     **只给对错**，最后报「说得出来 N / 18」。
 *
 * 两条边界：
 *   1. **复考不动 `drill_item`**（迁移 0013 那张表一行不改）：他哪一项是第几次会的是"学"的记录，
 *      复考是"考"，不该把它刷掉。所以复考只读那 18 项的内容，不写进度。
 *   2. **一轮复考中途的进度不存**（表里只有 scene / due_at / mode 三列，不为它加列、加表）：
 *      18 项一口气走完，中途刷新就从头考。页面上照实写了这一句，不假装存着（底线 3、9）。
 *
 * **不调任何 AI、不花一分钱**（底线 8 / C117）；**不碰密钥**（底线 1）：这里只有场景号、时间戳和一个方式名。
 */
import { ALL_IDS, cardOf, SCENE, STAGES } from './drill';
import type { Env } from './env';

/** 这一版只有一种复考方式：只考（不给关键点、不给词意，只记对错） */
export const REVIEW_MODE = '只考';
/** 「明天同一时刻」就是 24 小时后 */
export const DAY = 24 * 3600_000;
/** 一轮复考考几项（三段合一轮） */
export const REVIEW_N = ALL_IDS.length;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const bad = (出错: string, 怎么办: string, status = 400) => json({ 出错, 怎么办 }, status);

/** 台湾时间（UTC+8）的「X 月 X 日」：全站的日期都按这个时区写 */
export function dayText(ms: number): string {
  const d = new Date(ms + 8 * 3600_000);
  return `${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日`;
}

export interface ReviewRow { scene: number; due_at: number; mode: string }

/**
 * 顶上那一句话（页面原样显示）。**到期了才说"今天是复考"**，没到期只说下次是哪天。
 */
export function reviewLine(row: ReviewRow | null, now: number): string {
  if (!row) return '';
  if (now >= row.due_at) return `今天是复考：${row.mode}，不给关键点、不给词意；${REVIEW_N} 项打散走一轮，最后报你说得出来几项。`;
  return `下次复考：${dayText(row.due_at)}（${row.mode}）。还没到期，想现在考也可以。`;
}

/** 页面要的复考状态 */
export function reviewState(row: ReviewRow | null, now: number): Record<string, unknown> {
  return {
    有安排: !!row,
    到期时间: row?.due_at ?? null,
    到期了: !!row && now >= row.due_at,
    方式: row?.mode ?? REVIEW_MODE,
    一共: REVIEW_N,
    一句话: reviewLine(row, now),
    中途刷新: '复考中途刷新会从头考（一轮的进度不存库）',
  };
}

/**
 * 打散顺序：按到期时间当种子算出来的固定顺序（同一次复考刷新几遍都是同一张卷子，换一次复考就换一张）。
 * 用最简单的线性同余 + Fisher-Yates，**不用随机数**，测试才能逐条对。
 */
export function shuffleIds(ids: string[], seed: number): string[] {
  const out = [...ids];
  let x = (Math.abs(Math.trunc(seed)) % 2147483647) + 1;
  const next = () => (x = (x * 48271) % 2147483647);
  for (let i = out.length - 1; i > 0; i--) {
    const j = next() % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 一轮复考的卷子：**只有题面、答案和发音**，不给关键点、不给词意（这就是"只考"） */
export function reviewCards(seed: number): Record<string, unknown>[] {
  const all = new Map(STAGES.flatMap((s) => s.items.map((i) => [i.id, i] as const)));
  return shuffleIds(ALL_IDS, seed).map((id) => {
    const c = cardOf(all.get(id)!);
    return { id: c.id, 段: c.段, 中文: c.中文, 英文: c.英文, 对方说的: c.对方说的, 对方说的中文: c.对方说的中文, 发音: c.发音, 对方发音: c.对方发音 };
  });
}

async function readRow(env: Env): Promise<ReviewRow | null> {
  return (await env.DB.prepare('SELECT scene, due_at, mode FROM drill_review WHERE scene = ?1').bind(SCENE).first<ReviewRow>()) ?? null;
}

/**
 * 复考的接口。`sub` 是去掉 `/api/drill/review` 以后的那一段（''、'/plan'、'/start'、'/done'）。
 * 鉴权在 queue.ts 的 adminApi 里已经过了（和 /api/drill/* 同一套后台登录）。
 */
export async function drillReviewApi(env: Env, req: Request, now: number, sub: string): Promise<Response | null> {
  if (sub === '' && req.method === 'GET') return json(reviewState(await readRow(env), now));

  if (req.method !== 'POST') return null;

  // 「明天再考我这 18 项」：记一笔明天同一时刻到期
  if (sub === '/plan') {
    const due = now + DAY;
    await env.DB.prepare('INSERT INTO drill_review (scene, due_at, mode) VALUES (?1, ?2, ?3) ON CONFLICT (scene) DO UPDATE SET due_at = ?2, mode = ?3').bind(SCENE, due, REVIEW_MODE).run();
    return json({ ...reviewState({ scene: SCENE, due_at: due, mode: REVIEW_MODE }, now), 记下了: `明天这个时候再考这 ${REVIEW_N} 项（${dayText(due)}）。` });
  }

  // 开始这一轮（到期了点「开始复考」，没到期点「现在就复考」都走这里）
  if (sub === '/start') {
    const row = await readRow(env);
    if (!row) return bad('还没安排复考。', '三段走完以后，小结那里有一个「明天再考我这 18 项」的按钮。', 409);
    return json({ ...reviewState(row, now), 题目: reviewCards(row.due_at) });
  }

  // 考完了：报成绩、把这一笔安排清掉（成绩不入库——那是他自己判的对错，不是机器测出来的，不留假数据）
  if (sub === '/done') {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const 对 = typeof body.对 === 'number' && Number.isInteger(body.对) ? body.对 : -1;
    if (对 < 0 || 对 > REVIEW_N) return bad('没收到这一轮说得出来几项。', '从头走一遍这一轮，走到最后一项它会自动报成绩。', 400);
    const row = await readRow(env);
    if (!row) return bad('这一轮复考已经结束了。', '要再考一次，点「明天再考我这 18 项」。', 409);
    await env.DB.prepare('DELETE FROM drill_review WHERE scene = ?1').bind(SCENE).run();
    return json({ ...reviewState(null, now), 这一轮: `说得出来 ${对} / ${REVIEW_N}`, 对: 对, 一共: REVIEW_N });
  }

  return null;
}
