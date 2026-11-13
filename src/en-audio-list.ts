/**
 * **要念哪些句子**的清单（`scripts/build-audio.py` 照这份生成，`src/en-audio.ts` 照同一套键去读）。
 *
 * 一条都不手抄：三个来源全都**从内容文件现读**，加了新内容这里自动就多出几条，
 * 脚本再跑一次只补新的那几句（键是内容哈希，老的那些一个字没变就不会重生成）。
 *
 *   ① `src/pron-content.ts` 的 56 个词（发音训练要跟读的标准音）     → 英文，Sonia
 *   ② `src/pron-lesson.ts` 的「跟我做」每一步：**那一句 + 提示**      → 中文，晓晓
 *   ③ `src/s2-lesson.ts` 的 126 步：`说`（+ 将来有 `提示` 也带上）     → 中文，晓晓
 *      以及 `大`——**只有当它是英文时**才念（课件的英文例句），中文的大字标题不念
 *
 * 去重按**键**（= 内容哈希）：`light` 在第 5、6 组各出现一次，「把它变成否定句。」出现几十次，
 * 它们都只生成一条、只存一行。
 *
 * 这个文件**运行时谁都不 import**（Worker 跑起来用不到它）：只有 `scripts/audio-manifest.ts` 读它，
 * `scripts/build-audio.py` 和 `scripts/e2e-platform.mjs` 都从那里拿同一份清单 ——
 * **哈希只有一处实现**（`src/en-audio.ts` 的 `audioKey`），不会两边算出不一样的键。
 */
import { audioKey, 是英文, 英文声音, 中文声音, 指令文本 } from './en-audio';
import { audioTextOf, PRON_WORD_IDS } from './pron';
import { LESSON } from './pron-lesson';
import { 生成 as s2生成 } from './s2-lesson';

export interface 语音条 {
  /** 存进 en_audio 的主键 */
  键: string;
  /** 要念的原文 */
  文: string;
  /** 用哪个声音 */
  声音: string;
  /** 这句话是从哪个文件、哪一处取来的（只为出错时说得清，不进库） */
  来自: string;
}

/** 全部要念的句子，按键去重（同一句只生成一次） */
export function 语音清单(): 语音条[] {
  const out: 语音条[] = [];
  const 见过 = new Set<string>();
  const 收 = (文: string | undefined | null, 声音: string, 来自: string) => {
    const t = String(文 ?? '').trim();
    if (!t) return;
    const 键 = audioKey(t, 声音);
    if (见过.has(键)) return;
    见过.add(键);
    out.push({ 键, 文: t, 声音, 来自 });
  };

  // ① 发音训练的 56 个词：念的就是那个词本身，一个修饰词都不加（和 audioTextOf 同一份）
  for (const id of PRON_WORD_IDS) 收(audioTextOf(id), 英文声音, `pron-content 词 ${id}`);

  // ② 「跟我做」每一步的那句指令（那一句 + 提示）
  for (const 组 of LESSON) for (let i = 0; i < 组.步.length; i++) 收(指令文本(组.步[i]), 中文声音, `pron-lesson ${组.组} 第 ${i + 1} 步`);

  // ③ S2 的 126 步
  for (const 课 of s2生成())
    for (let i = 0; i < 课.步.length; i++) {
      const s = 课.步[i] as { 说: string; 提示?: string; 大?: string };
      收(指令文本(s), 中文声音, `s2-lesson 第 ${课.课} 课第 ${i + 1} 步 · 说`);
      // 大字只有英文的才念（课件的英文例句）；中文的大字标题不念
      if (s.大 && 是英文(s.大)) 收(s.大, 英文声音, `s2-lesson 第 ${课.课} 课第 ${i + 1} 步 · 大`);
    }

  return out;
}
