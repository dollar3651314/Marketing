-- 公司平台批 2 · PR 3（agents 公司平台/技术方案-公司平台-PR与数据.md 第三、五节；D-3 用量按项目记、不回填）：只建新表，旧表一行不动，不给 events 加索引（范围与上线页第二节）。
-- 每次调 AI 按"哪个项目发起的"多记一行：打分、写稿记请求里的 product，设置页"测试 AI"记 _platform。只记、不当限额（上限还是看 model_usage、ai_usage）。
-- day、model 和 model_usage 同一套：Gemini 按美国太平洋时间的日期、模型名；Workers AI 按 UTC 日期、model = workers-ai。
CREATE TABLE usage_by_project (
  day TEXT NOT NULL,
  project TEXT NOT NULL,          -- forecast / _platform（平台自己，例如"测试 AI"）
  model TEXT NOT NULL,
  req INTEGER NOT NULL DEFAULT 0,
  tok_in INTEGER NOT NULL DEFAULT 0,
  tok_out INTEGER NOT NULL DEFAULT 0,
  neurons REAL NOT NULL DEFAULT 0, -- 只有 Workers AI 有（和 ai_usage 同一种算法）
  PRIMARY KEY (day, project, model)
);
