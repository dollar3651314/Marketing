/**
 * 把「要念哪些句子」这份清单打印成 JSON（一行一个对象的 JSON 数组）。
 *
 * 为什么要这么一个小脚本：清单是 TypeScript 算出来的（`src/en-audio-list.ts`），
 * 而生成语音的是 Python（`scripts/build-audio.py`）、预置测试数据的是 Node（`scripts/e2e-platform.mjs`）。
 * 让它们各自再实现一遍哈希，迟早算出不一样的键 —— 所以**只有这一处算**，别人都来问它要。
 *
 *   node_modules/.bin/vite-node scripts/audio-manifest.ts
 *
 * 输出：[{ 键, 文, 声音, 来自 }, …]，再加一行注释说明也没有，纯 JSON，方便 `JSON.parse` / `json.loads`。
 */
import { 语音清单 } from '../src/en-audio-list';
import { 语速, 声音们, AUDIO_REV } from '../src/en-audio';

const 清单 = 语音清单();
process.stdout.write(JSON.stringify({ 版本: AUDIO_REV, 语速, 声音们: [...声音们], 条数: 清单.length, 清单 }, null, 0) + '\n');
