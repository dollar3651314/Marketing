-- 「基金观察」第四版 ②：估值（6 个指数：沪深300、上证50、中证500、上证红利、中证红利、标普500）。服务端 src/funds-api.ts refreshValuation()、计算 src/funds-val.ts。
--
-- fund_valuation：一个指数一行（6 行）。data = 月末取样的市盈率序列（最近约 130 个月）+ 当前值 + 股息率（JSON，ValStored）；
--   分位、中位数、预期年化都在 GET 时现算（改口径不用重取）。取不到时 data 保留上次的，只记 err / err_at。
--   存的是中证指数有限公司、Robert Shiller 的数据，只给 Amos 本人看，不转载。
-- fund_val_fetch：每个来源的取数记录（日期都是新加坡 / 中国时间 UTC+8 的 YYYY-MM-DD）。安全经理限制：每个来源每天最多取成功 1 次（Shiller 每月 1 次）；
--   主会话 11/11 改：**取到并解析成功后才记 ok_day**（被 CPU 掐断的那次不算取过），但同一来源同一天**最多尝试 2 次**（发请求前先把 tries 加一，硬上限）。
--   src 例：cs-perf:000300、cs-xls:000300、shiller。
--
-- 只 CREATE，不 ALTER、不 DROP、不加索引。不存任何密钥（底线 1）。
CREATE TABLE fund_valuation (
  code TEXT PRIMARY KEY,      -- 指数代码（000300…，标普500 是 SPX），清单在 src/funds-val.ts 的 VAL_INDEXES
  data TEXT,                  -- 最近一次取到的值（ValStored 的 JSON）；从没取到过是 NULL
  ok_at INTEGER,              -- 最近一次取到的毫秒时间戳
  err TEXT,                   -- 最近一次没取到（或只取到一半）的原因（中文）；全部取到后清空
  err_at INTEGER              -- 最近一次没取到的毫秒时间戳
);
CREATE TABLE fund_val_fetch (
  src TEXT PRIMARY KEY,       -- 来源：cs-perf:<指数代码>、cs-xls:<指数代码>、shiller
  day TEXT NOT NULL,          -- 最近一次尝试的日期（UTC+8，YYYY-MM-DD）
  tries INTEGER NOT NULL,     -- 那一天已经尝试了几次（发请求前先加一；同一天到 2 就不再试）
  at INTEGER NOT NULL,        -- 最近一次尝试的毫秒时间戳
  ok_day TEXT                 -- 最近一次取到并解析成功的日期（UTC+8）；从没成功过是 NULL
);
