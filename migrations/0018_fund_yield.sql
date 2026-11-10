-- 「基金观察」第二版 ③：债券类 16 只的"未来 1～3 年预期年化"（服务端 src/funds-api.ts refreshYields()、配置和解析 src/funds-yield.ts）。
--
-- 一只一行（最多 16 行）：最近一次取到的值（JSON：value、kind auto/approx、label 口径、duration 久期、asOf 数据日期、source 来源名）。
-- 页面点"刷新数据"、45 只取完后调一次 POST /api/funds/yields；**取不到时 data 保留上次的**，只记 err / err_at，页面标"过期"，不显示 0。
--
-- 只 CREATE，不 ALTER、不 DROP、不加索引。不存任何密钥（底线 1），数据全是公开页面上的收益率。
CREATE TABLE fund_yield (
  code TEXT PRIMARY KEY,      -- 页面上的代码（AGG、A35、511990…），清单在 src/funds-yield.ts 的 BOND_YIELDS
  data TEXT,                  -- 最近一次取到的值（BondYield 的 JSON）；从没取到过是 NULL
  ok_at INTEGER,              -- 最近一次取到的毫秒时间戳
  err TEXT,                   -- 最近一次没取到的原因（中文）；取到后清空
  err_at INTEGER              -- 最近一次没取到的毫秒时间戳
);
