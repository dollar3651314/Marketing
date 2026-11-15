/**
 * e2e 里「等读回来」那个等法本身的测试（`scripts/e2e-look.mjs` 的 `apiSettled`）。
 *
 * 为什么给测试脚本写测试：2026-11-15 PR #126 的 CI 红了一次 ——
 *   `✗ 菜单数量（375 宽）：等 /api/company 读回来等了 4000ms（还有 1 个在途）`
 * 同一份代码本地单独跑是 503 / 0。病根不是超时设小了，是**量错了东西**：
 * 原来从头数 4 秒，到点就扔错，哪怕请求正一个接一个地回来。
 *
 * 改成量「有没有进展」之后，**两半都得证**：
 *   ① 慢但一直有请求回来 → **不许红**（这是修的那一半）
 *   ② 真卡住，一个都不回 → **必须红**（这一半不能丢，丢了就是放宽断言，底线 6）
 * 压力测试证不了这个（两份 e2e 同时跑会抢同一个本地 D1 文件，启动就死），
 * 所以这里用一个假的 page 直接驱动它。
 */
import { describe, expect, it } from 'vitest';
import { trackApi, apiSettled } from '../scripts/e2e-look.mjs';

/** 假的 playwright page：只实现 apiSettled 用到的那几样 */
function 假页() {
  const 听众: Record<string, ((r: unknown) => void)[]> = {};
  const page = {
    on(事件: string, fn: (r: unknown) => void) { (听众[事件] = 听众[事件] ?? []).push(fn); },
    evaluate: async () => 0,
  };
  const 发 = (事件: string, url = 'https://x/api/company') => (听众[事件] ?? []).forEach((f) => f({ url: () => url }));
  return { page, 发出请求: () => 发('request'), 回来一个: () => 发('requestfinished'), 失败一个: () => 发('requestfailed') };
}

describe('1. 本来就没有在途的，立刻返回', () => {
  it('一个请求都没发过 → 不等', async () => {
    const f = 假页();
    trackApi(f.page as never);
    const t0 = Date.now();
    await apiSettled(f.page as never, 50, 200);
    expect(Date.now() - t0).toBeLessThan(120);
  });
  it('发了又都回来了 → 不等', async () => {
    const f = 假页();
    trackApi(f.page as never);
    f.发出请求(); f.发出请求(); f.回来一个(); f.回来一个();
    const t0 = Date.now();
    await apiSettled(f.page as never, 50, 200);
    expect(Date.now() - t0).toBeLessThan(120);
  });
});

describe('2. **修的就是这一半**：慢，但一直有请求回来 → 不许红', () => {
  it('每 80ms 回来一个，一共拖了 400ms，闲置上限只有 150ms —— 照样不红', async () => {
    const f = 假页();
    trackApi(f.page as never);
    for (let i = 0; i < 5; i++) f.发出请求();
    // 每 80ms 放回来一个（<150ms 的闲置上限），总共 400ms —— 按老写法（总预算 150ms）早炸了
    const 定时 = setInterval(() => f.回来一个(), 80);
    await expect(apiSettled(f.page as never, 150, 5000)).resolves.toBeUndefined();
    clearInterval(定时);
  });
  it('请求失败也算"回来了"（requestfailed 同样重新计时）', async () => {
    const f = 假页();
    trackApi(f.page as never);
    for (let i = 0; i < 4; i++) f.发出请求();
    const 定时 = setInterval(() => f.失败一个(), 80);
    await expect(apiSettled(f.page as never, 150, 5000)).resolves.toBeUndefined();
    clearInterval(定时);
  });
});

describe('3. **这一半不能丢**：真卡住，一个都不回 → 必须红', () => {
  it('发了就没动静 → 到闲置上限扔错，话里写明"一个都没回"', async () => {
    const f = 假页();
    trackApi(f.page as never);
    f.发出请求();
    await expect(apiSettled(f.page as never, 120, 5000)).rejects.toThrow(/120ms 里一个都没回/);
  });
  it('错误里带上还有几个在途、一共回来过几个（查的时候要用）', async () => {
    const f = 假页();
    trackApi(f.page as never);
    f.发出请求(); f.发出请求(); f.发出请求(); f.回来一个();
    await expect(apiSettled(f.page as never, 120, 5000)).rejects.toThrow(/还有 2 个在途，这一页一共回来过 1 个/);
  });
  it('一直慢慢回、但超过总上限 → 也要红（不让它无限等）', async () => {
    const f = 假页();
    trackApi(f.page as never);
    for (let i = 0; i < 100; i++) f.发出请求();
    const 定时 = setInterval(() => f.回来一个(), 30);
    await expect(apiSettled(f.page as never, 5000, 300)).rejects.toThrow(/超过 300ms 还没完/);
    clearInterval(定时);
  });
});

describe('4. 默认值就是这次定下来的那两个', () => {
  it('闲置 10 秒、总共 60 秒（改了默认值这条先红，省得悄悄变回去）', () => {
    const 源 = String(apiSettled);
    expect(源).toMatch(/闲置上限 = 10000/);
    expect(源).toMatch(/总上限 = 60000/);
  });
  it('**没有退回"从头数一个总预算"的老写法**', () => {
    const 源 = String(apiSettled);
    expect(源).toContain('没动静从');
    expect(源).not.toMatch(/Date\.now\(\) - t0 > wait/);
  });
});
