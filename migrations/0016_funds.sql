-- 公共工具「基金观察」（#/funds，服务端 src/funds-api.ts、页面 src/funds-page.ts、计算 src/funds.ts）。
--
-- 只存**每只的最新快照**（45 行，一只一行）：最新价、各期收益、各期最大回撤、一年复权价序列（JSON）。
-- 页面点"刷新数据"时服务端分批去 Yahoo / 东方财富取，取到就整行覆盖；**取不到时 data 保留上次的**，只记 err / err_at，
-- 页面据此写"没取到，显示的是 <日期> 的数据"。
--
-- 只 CREATE，不 ALTER、不 DROP、不加索引（最多 45 行）。不存任何密钥（底线 1），数据全是公开行情。
CREATE TABLE fund_snapshot (
  code TEXT PRIMARY KEY,      -- 页面上的代码（ES3、VOO、510300、000171…），清单在 src/funds.ts 的 FUNDS
  data TEXT,                  -- 最近一次取到的快照（FundSnapshot 的 JSON）；从没取到过是 NULL
  ok_at INTEGER,              -- 最近一次取到的毫秒时间戳
  err TEXT,                   -- 最近一次没取到的原因（中文）；取到后清空
  err_at INTEGER              -- 最近一次没取到的毫秒时间戳
);
