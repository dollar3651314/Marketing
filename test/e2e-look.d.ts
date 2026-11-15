/**
 * `scripts/e2e-look.mjs` 是 e2e 用的普通 JS 脚本（没有类型）。
 * `test/e2e-settle.test.ts` 要直接驱动它的 `apiSettled`，所以在这里给用到的那两个
 * 函数写上签名 —— 顺带把参数的意思写死：**两种超时别混**。
 */
declare module '*/scripts/e2e-look.mjs' {
  /** 给这一页装上 /api/company 的计数（在途几个、回来过几个） */
  export function trackApi(page: unknown): void;
  /**
   * 等到这一页没有在途的 /api/company。
   * @param 闲置上限 从最后一个请求回来算起，这么久一个都没再回来才算卡住（默认 10 秒）
   * @param 总上限   真卡死时的兜底（默认 60 秒）
   */
  export function apiSettled(page: unknown, 闲置上限?: number, 总上限?: number): Promise<void>;
  /** 展开工作台那几组待办；前两个参数同上，第三个是 playwright 的操作超时（默认 4000ms） */
  export function openGroups(page: unknown, 闲置上限?: number, 总上限?: number, 操作超时?: number): Promise<void>;
}
