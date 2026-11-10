-- 工作台「带练 → 听辨小测」的**错在哪**（服务端 src/ear.ts，内容 src/ear-content.ts，页面 src/ear-page.ts）。
--
-- 为什么有这一张（Amos 2026-11-10 原话）：「自然拼读有很多我都不会，读的不标准，那也就意味着我听出来的
-- 声音也就有问题，**所以可能会听不懂别人在说什么**」。治耳朵最快的路是直接练耳朵：放一段音，
-- 从只差一个音的两个词里选听到哪个。**这张表就是这件事的真正产出**——他到底在哪几个音上分不出来。
--
-- 三个数字分开记（不要合成一个"正确率"）：
--   tries  这一组考过几次
--   ok     选对几次
--   same   点过几次「两个听着一样」——**这一列不是凑数**：那 16 段发音是 melotts 现生成的，
--          点这个按钮是唯一能把"他分不出"和"机器根本没念出区别"分开的办法。same 高的组要先去听机器念的那两段。
-- 一组一行，最多 8 行（pair = src/ear-content.ts 的 PAIRS[i].id，p1..p8），所以不需要索引。
--
-- 只 CREATE，不 ALTER、不 DROP、不加索引、不回填（0001～0016 那些表一行不动）。
-- **不存任何密钥**（底线 1）：这张表里只有组号、三个计数和一个时间戳。
-- 发音本身不在这里，走已有的 drill_audio（迁移 0014，melotts 生成一次、永久复用，不新增一分钱费用）。

CREATE TABLE ear_pair (
  pair TEXT PRIMARY KEY,       -- p1..p8
  tries INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 0,       -- 选对几次
  same INTEGER NOT NULL DEFAULT 0,     -- 点过几次「两个听着一样」
  at INTEGER NOT NULL
);
