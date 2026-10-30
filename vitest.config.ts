/**
 * 测试（vitest）：Node 里跑中转服务的代码，D1 用 wrangler getPlatformProxy 给的本地实现（Miniflare 的真实 SQLite）；
 * Gemini、Workers AI 用替身；插件的读取适配器用 jsdom。插件侧边栏的浏览器级测试在 scripts/e2e-ext.mjs（agents C141）。
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // 结构化日志（{"event":…}）不打印到测试输出
    onConsoleLog: (log) => !log.startsWith('{"event"'),
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
