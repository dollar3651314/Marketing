-- 工作台「带练」（#/work/drill，服务端 src/drill.ts、页面 src/drill-page.ts）。
--
-- 为什么只要一张很小的表：带练的**内容是写死在代码里的**（场景 0 的前三段，三段各 6 项，src/drill.ts 的 STAGES），
-- 这里只存"他练到哪儿了"。他换设备要能接着练，所以不放浏览器里（localStorage 换台机器就没了）。
-- 一项只要四件事就够：**哪个场景、哪一项、第几次答对的、最后一次是什么时候**。
--   第几次答对（pass_try）：0 = 还没点过「会了」；1 = 第一次就会；2 以上 = 中间点过「不会」。
--   队列顺序不存：**算得出来**——这一段里还没「会了」的项，按"最后一次答的时间"排，刚点完「不会」的自然排到这一段末尾。
--
-- 只 CREATE，不 ALTER、不 DROP、不加索引、不回填（旧表一行不动）。一共只有 Amos 一个用户，表最多十几行，不需要索引。
-- **不存任何密钥**（底线 1）：这张表里只有场景号、项目编号和几个数字。

CREATE TABLE drill_item (
  scene INTEGER NOT NULL,                -- 场景号（这一版只有场景 0）
  item TEXT NOT NULL,                    -- 项目编号，例如 w1（第一段第 1 个词）、p3、s6；编号表在 src/drill.ts
  tries INTEGER NOT NULL DEFAULT 0,      -- 一共点过几次「会了 / 不会」
  pass_try INTEGER NOT NULL DEFAULT 0,   -- 第几次点的「会了」（0 = 还没会，1 = 第一次就会）
  at INTEGER NOT NULL,                   -- 最后一次点的毫秒时间戳
  PRIMARY KEY (scene, item)
);
