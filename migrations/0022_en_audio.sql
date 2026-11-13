-- 英语学习的语音（src/en-audio.ts 读、scripts/build-audio.py 写；接口 /api/en/audio/<键>）。
--
-- 为什么另起一张、不往 pron_audio 里塞（Amos 2026-11-13 定的 A 方案 + 换声音）：
--  · 换了发声的人：原来是 Workers AI 的 aura-2-en **按需现生成**，现在是微软 Edge 的神经网络语音
--    （英文 Sonia、中文 晓晓，语速 -5%）**预先生成好写进来**，运行时只读不生成。
--  · 换了键的算法：pron_audio 的键是「版本号 + 词的编号」（a2:g1-1a），只装得下那 56 个词；
--    这里的键是**内容的哈希**（e1-<16 位>），同一句只存一行，发音训练的词、「跟我做」的每一句指令、
--    S2 的 126 步共用一张表。
--  · **pron_audio 一行都不删、不改**（底线 6 周边）：aura 生成过的那些留在库里，想对比还查得出来。
--
-- **只 CREATE，没有 DROP、没有 ALTER**（整个 migrations/ 一句 DROP 都没有，test/english-boundary.test.ts 守着）。
-- **不存任何密钥**（底线 1）：这里只有要念的那句话、用哪个声音、和一段 mp3 字节。
--
-- mp3 **不进仓库**：两个仓库都是 public，念的是第三方课程材料，所以字节只在这张表里。
-- 一条约 11～40 KB，这一版 154 条合计约 3.6 MB（D1 免费额度 5 GB），一个词一行，不需要索引。

CREATE TABLE en_audio (
  k TEXT NOT NULL PRIMARY KEY,   -- 版本号 + 内容哈希，例如 e1-9eeb44316ba59b1e（src/en-audio.ts 的 audioKey）
  voice TEXT NOT NULL,           -- en-GB-SoniaNeural / zh-CN-XiaoxiaoNeural
  txt TEXT NOT NULL,             -- 念的就是这一句（出错时说得清是哪条，也方便对账）
  mp3 BLOB NOT NULL,
  bytes INTEGER NOT NULL,
  at INTEGER NOT NULL
);
