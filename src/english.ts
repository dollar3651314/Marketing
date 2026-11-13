/**
 * 英语学习这一块的**拆分清单**（2026-11-13，Amos 点名要的护栏）。
 *
 * 他的原话有两句，要一起看：
 *   「practical 项目 现在只是带着我学习，所以把它合并到 marketing 项目中吧（公用仓库、数据库、服务器、域名）」
 *   「**但是要做好随时可以拆出来的准备**，一旦我学有所成…那个时候咱们再将这个项目拆出来单独发展」
 *
 * 所以这个文件就是一件事：**把"属于英语学习的全部东西"写成一份清单**。
 * 要拆出去的那天，照着这份清单复制文件、导出几张表、换个域名就完事，不用再去翻一遍仓库猜哪些算英语的。
 * 清单不是说明文字，是**会被测试读的数据**：`test/english-boundary.test.ts` 按它守四条界（谁能 import 谁、
 * SQL 不许跨界 JOIN、接口只在 `/api/en/` 下面）。清单漏写一个文件，那条界就守不住，所以**新增英语文件必须同时加进这里**。
 *
 * 三步怎么拆，正文写在《项目地图》「英语这块怎么拆出去」一节。
 */

/** 属于英语学习的源文件（相对仓库根）。拆出去 = 把这几个文件原样复制到新仓库。 */
export const 源文件 = [
  // 全部语音（S1 S2 共用：元数据在 en_audio、字节分块存在 en_audio_part；预先生成，运行时只读）
  'src/en-audio.ts',
  'src/en-audio-list.ts',
  // 发音训练（S1 七组易错音）
  'src/pron.ts',
  'src/pron-content.ts',
  'src/pron-lesson.ts',
  'src/pron-page.ts',
  // 句子训练（S2 十三课语法）；src/s2-content.ts 是**第三方课程材料**，一个字节都不许改，要对外卖必须整个换掉
  'src/s2-content.ts',
  'src/s2-derive.ts',
  'src/s2-annotate.ts',
  'src/s2-lesson.ts',
  'src/s2-page.ts',
  // 这份清单自己
  'src/english.ts',
] as const;

/** 属于英语学习的测试（相对仓库根）。 */
export const 测试 = [
  'test/en-audio.test.ts',
  'test/pron.test.ts',
  'test/pron-lesson.test.ts',
  'test/s2.test.ts',
  'test/english-boundary.test.ts',
] as const;

/**
 * 清单里的文件**只许**被这几个外人 import。
 * 它们是宿主：页面把模块插进工作平台（admin-page.ts），路由把接口挂上去（queue.ts）。
 * 拆出去那天，要改的也只有这两个文件 —— 这就是把入口压到两个的意义。
 */
export const 允许的宿主 = ['src/admin-page.ts', 'src/queue.ts'] as const;

/**
 * 清单里的文件**只许**往外 import 这几个共用底座（除此之外只能 import 清单内部）。
 * 拆出去那天，这几个要在新仓库里重建一份（或者只抄用到的那几个函数）：
 *   ./env         Env 类型（D1、AI 绑定）
 *   ./usage       额度闸、账号限额、utcDay
 *   ./workers-ai  Workers AI 的调用和记账
 *
 * **2026-11-13 少了一个**：原来还有 `./tts`（aura-2-en 的调用和 neurons 换算）。
 * 语音换成微软 Edge 的神经网络语音、改成**预先生成写进 D1**之后，运行时一次 TTS 都不调了，
 * 这条底座就断干净了 —— 拆出去那天要重建的东西又少一样。
 */
export const 共用底座 = ['./env', './usage', './workers-ai'] as const;

/**
 * 英语学习自己的表（迁移在 `迁移` 里）。**这几张里是 Amos 练出来的真实成绩，任何时候都不许 DROP。**
 * 2026-11-13 多一张 `en_audio_part`（迁移 0023）：一条语音的字节**拆成多行存**，
 * `en_audio` 还在、还存元数据（线上 `SQLITE_TOOBIG` 那次，详见 src/en-audio.ts）。
 * 同一天再多一张 `en_done`（迁移 0024）：「发音训练」清单上**打上勾的那几条**
 * （`follow` 跟我做走完、`listen` 对照听过；另外两条按 `pron_round` / `pron_say` 现算，不落库）。
 */
export const 表 = ['pron_round', 'pron_say', 'pron_audio', 'en_audio', 'en_audio_part', 'en_done'] as const;

/**
 * 建这几张表的迁移。拆出去 = 把这个文件照抄过去 + 从旧库 `.dump` 出这三张表的数据。
 * 句子训练这一批**不存进度、不加迁移**（学习进度模块是第二批，由 Amos 决定要不要做）。
 */
export const 迁移 = ['migrations/0019_pron.sql', 'migrations/0022_en_audio.sql', 'migrations/0023_en_audio_part.sql', 'migrations/0024_en_done.sql'] as const;

/**
 * 共用的 key-value 表 `settings` 里属于英语的 key 前缀（纠说的一天 200 次闸）。
 * `settings` **不是**英语的表（回帖上限等等也在里面），所以拆出去时不是搬表，是把这几个前缀的行挑出来。
 * 读写它的语句里**只有 `settings` 一张表**，不和 `pron_*` JOIN —— 这一条由 english-boundary 守着。
 */
export const 共用表里的前缀 = ['pron_say:'] as const;

/** 英语学习的接口全部在这个前缀下（2026-11-13 起；旧的 `/api/pron/*` 直接去掉，不留兼容）。 */
export const 接口前缀 = '/api/en/' as const;

/** 具体几条接口（`src/queue.ts` 里挂的就是这两段）。 */
export const 接口 = ['/api/en/pron/', '/api/en/audio/'] as const;

/** 页面上的位置：工作平台 → Practical 项目页的两个模块（别的项目整块 hidden）。 */
export const 页面模块 = [
  { id: 'f-pron', 地址: '#/Practical/pron', 名: '发音训练' },
  { id: 'f-s2', 地址: '#/Practical/s2', 名: '句子训练' },
] as const;

/**
 * 拆出去时要带走的用量用途标签（`src/usage.ts` 的 PURPOSES）。
 * `pron-tts` 这一条 2026-11-13 起**不再新增**（发音改成预先生成，运行时一次 AI 都不调），
 * 但库里有它当时记的账，所以标签留着、也跟着一起搬（去掉它那些行就只剩一个看不懂的代号，底线 3）。
 */
export const 用量用途 = ['pron-tts', 'pron-asr'] as const;
