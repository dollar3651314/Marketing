-- 英语学习的语音**按块存**（src/en-audio.ts 读、scripts/build-audio.py 写；接口 /api/en/audio/<键>）。
--
-- 为什么要这一张（2026-11-13 线上真实日志，不是推测）：
--   ✘ [ERROR] statement too long: SQLITE_TOOBIG
-- `scripts/build-audio.py --env production` 在 GitHub Actions 上写第一条就挂。量过的大小分布：
-- 190 条，最小 11,232 字节 / 中位 14,544 / **最大 83,232**。mp3 要进 D1 只能写成十六进制字面量
-- X'…'，**字符数是字节数的两倍** —— 最大那条 83,232 字节 → 166,464 个字符 ≈ 166 KB，
-- 超过 D1 **单条 SQL 100 KB** 的上限。`--batch` 本来就是 1，所以不是批太大，是**单条本身就超**。
--
-- 办法：**一条音频拆成多行存**，每块不超过 30,000 字节（十六进制 60,000 字符，离 100 KB 很远），
-- 读的时候按 part 从 0 开始顺序拼回去。
-- **不改成 base64**：base64 白白涨 33%，而且和现在 BLOB 那套读法不兼容。
--
-- en_audio 那张表**保留**，继续存元数据（k / voice / txt / bytes / at），它的 mp3 列**留着不动**
-- （已有数据 0 条，但**不删列、不删表**）；新写入一律走这张分块表，en_audio.mp3 写空 X''。
--
-- **只建表，没有 DROP、没有 ALTER**（整个 migrations/ 一句都没有，test/english-boundary.test.ts 守着）。
-- **不存任何密钥**（底线 1）：这里只有一段 mp3 字节。
--
-- 缺号怎么办（底线 3，src/en-audio.ts 的 拼块()）：块不从 0 开始、或者中间断了（有 0、2 没有 1），
-- **当成「这一段语音还没生成」**，绝不把残缺的音频当成完整的发出去。

CREATE TABLE en_audio_part (
  k    TEXT    NOT NULL,
  part INTEGER NOT NULL,   -- 从 0 开始，按顺序拼回去
  mp3  BLOB    NOT NULL,
  PRIMARY KEY (k, part)
);
