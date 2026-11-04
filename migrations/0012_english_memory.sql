-- 英语练习的"跨轮记忆"（工作台 → 英语练习，服务端 src/english-memory.ts、页面 src/english-memory-page.ts）。
--
-- 为什么要这三张表：Gemini Live **每轮都从零开始**——上一轮 Amos 不认识 pitch，这一轮它照样用；
-- 上一轮他靠提示才说出来的句子，**永远不会被再考一次**。同一轮之内的"回收"（提示词 v4 已经有了）只能证明短时记住，
-- 证明不了学会。我们不做语音、不做对话引擎（对话还在 Gemini Live 里进行），只补这一件事：**把记忆留在轮与轮之间**。
--
-- 三张表对应三件要跨轮留下来的东西：
--   en_word      哪些词他认识 / 不认识（一次性测出来的"词汇水平线"，加上每轮对话里新冒出来的生词）
--   en_sentence  他靠提示才说出来的句子，**带着下次该考的轮次**（间隔 1 轮 → 3 轮 → 7 轮）
--   en_round     每一轮：派出去考了哪几句、教了哪几个新词、贴回来的 #LOG 原文、到期考了几句 / 说对几句
--
-- 间隔为什么是 1 / 3 / 7：回忆练习（retrieval practice）的效果和**间隔**强相关，而且在**成功率中高 + 有反馈**时最好。
-- 这是设计依据【推断】，不是我们自己测出来的数字；北极星指标（跨轮回收成功率）就是用来验它的。
--
-- 只 CREATE，不 ALTER、不 DROP、不加索引、不回填（旧表一行不动）。一共只有 Amos 一个用户，表都很小，不需要索引。
-- **不存任何密钥**（底线 1）。raw 里存的是他粘回来的 #LOG 块原文（截断 2000 字），那是对话复盘，不含凭据。

-- 词：词汇水平线 + 对话里冒出来的生词
CREATE TABLE en_word (
  word TEXT PRIMARY KEY,                   -- 小写、去掉两边空格的词或词组，例如 pitch、test the waters
  band INTEGER NOT NULL DEFAULT 4,         -- 难度档 1～4（1 最常用、4 商务习语）；对话里冒出来的生词按 4 记
  known INTEGER NOT NULL DEFAULT 0,        -- 1 = 他说"认识"，0 = "不认识"
  source TEXT NOT NULL DEFAULT 'line',     -- line = 测词汇线时答的；stuck = 某一轮 #LOG 里 stuck 报上来的；new = 某一轮教过的新词
  taught_round INTEGER NOT NULL DEFAULT 0, -- 第几轮当作"今天要教的新词"派出去过（0 = 还没教过，不会重复教）
  first_at INTEGER NOT NULL,               -- 第一次记下来的毫秒时间戳
  at INTEGER NOT NULL                      -- 最后一次更新的毫秒时间戳
);

-- 句子：他靠提示（句首 / 关键词 / 整句）才说出来的，下次该在第几轮考
CREATE TABLE en_sentence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  norm TEXT NOT NULL UNIQUE,               -- 归一化后的句子（小写、去标点、压空格），同一句只存一条
  text TEXT NOT NULL,                      -- 原样的句子，派进提示词时用这一份
  from_round INTEGER NOT NULL,             -- 第几轮靠提示说出来的
  due_round INTEGER NOT NULL,              -- 下次该考的轮次（<= 当前轮 = 到期）
  step INTEGER NOT NULL DEFAULT 0,         -- 间隔走到第几档：0 → 隔 1 轮，1 → 隔 3 轮，2 → 隔 7 轮，3 = 毕业（不再考）
  asked INTEGER NOT NULL DEFAULT 0,        -- 到期被考过几次
  passed INTEGER NOT NULL DEFAULT 0,       -- 其中不给提示说对了几次
  last_result TEXT NOT NULL DEFAULT '',    -- 最近一次：yes / no / ''（还没考过）
  first_at INTEGER NOT NULL,
  at INTEGER NOT NULL
);

-- 轮次：一轮 = 一次 Gemini Live 对话
CREATE TABLE en_round (
  n INTEGER PRIMARY KEY,                   -- 轮次号，从 1 开始
  started_at INTEGER NOT NULL,             -- 点"开始这一轮"的时间
  logged_at INTEGER,                       -- 贴回 #LOG 的时间；NULL = 这一轮还开着
  scene TEXT NOT NULL DEFAULT '',          -- 用的是哪条场景（C-1…N-2）
  due_json TEXT NOT NULL DEFAULT '[]',     -- 这一轮派出去要回收的句子 id（JSON 数组），开轮时定死
  new_json TEXT NOT NULL DEFAULT '[]',     -- 这一轮要教的新词（JSON 数组）
  prompt TEXT NOT NULL DEFAULT '',         -- 生成的那一整段提示词（他复制走的就是这一份）
  a INTEGER,                               -- #LOG counts：A = 自己造的句子
  b INTEGER,                               -- B = 靠提示才说出来的
  c INTEGER,                               -- C = 同一轮之内回收时独立说对的
  recall_due INTEGER NOT NULL DEFAULT 0,   -- **跨轮**：这一轮到期、而且真考到了的句子数（北极星的分母）
  recalled INTEGER NOT NULL DEFAULT 0,     -- 其中不给提示说对了的句子数（北极星的分子）
  raw TEXT NOT NULL DEFAULT ''             -- #LOG…#END 块原文，截断 2000 字（对账用，不含凭据）
);
