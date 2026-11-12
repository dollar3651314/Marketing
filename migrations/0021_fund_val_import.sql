-- 「基金观察」估值板块"参考：导入的历史"（Amos 2026-11-12：D1～D4、I1、I3 都按建议）。接口 POST /api/funds/valuation/import（src/funds-api.ts），计算 src/funds-import.ts。
--
-- fund_val_import：一只一行（code = 基金观察 45 只里的代码，例如 QQQ、588000），同一只再导入就整行覆盖。
--   data = 校验过的序列（ImpStored 的 JSON：name、funds、source、basis、as_of、series{pe,pb,dy}、meta）；选指标、百分位都在 GET 时现算。
--   数据是 Amos 自己上传的第三方数据（蛋卷、中证、Yahoo、SEC 等），只给他本人看，不转载；**不进仓库**（测试用自造的小夹具）。
--
-- 只 CREATE，不 ALTER、不 DROP、不加索引。不存任何密钥（底线 1）。
CREATE TABLE fund_val_import (
  code TEXT PRIMARY KEY,        -- 基金观察里的代码（src/funds.ts FUNDS 的 code）
  data TEXT NOT NULL,           -- ImpStored 的 JSON
  imported_at INTEGER NOT NULL, -- 导入的毫秒时间戳
  source TEXT,                  -- 文件里这一只的 source 原文（方便直接查库时看）
  basis TEXT                    -- 文件里这一只的 basis 原文
);
