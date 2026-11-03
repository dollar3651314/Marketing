-- 用量监控（Amos 2026-11-03："最好提炼出一个 token 监控的模块，可以看到剩余和分别用到了哪里"）。
-- 为什么还要一张表：0007 的 usage_by_project 是按**项目**记的，素材生成器的图片和音频都算 practical-assets，
-- 光看项目分不出"这 300 neurons 是出图还是配音"；asset_gen（0009）虽然分得出格子，但它只有 first_at / at，
-- **没有按天的列**，算不出"今天这一项用了多少"。所以按**用途**另记一本。
-- 只建一张新表：旧表一行不动，不 ALTER、不 DROP、不加索引。
-- day、model 和 model_usage / usage_by_project 同一套（src/usage.ts dayFor）：
--   Gemini 按美国太平洋时间的日期 + 模型名；Workers AI 按 UTC 日期 + model = 'workers-ai'。
-- 只记、不当限额（上限还是看 model_usage、ai_usage）。
-- 这一版上线以前的用量没有用途，**不回填、不估算**：页面上单独列成"没按用途记下来的"。
CREATE TABLE usage_by_purpose (
  day TEXT NOT NULL,
  purpose TEXT NOT NULL,          -- assets-image / assets-audio / tts / draft / score / platform / other
  model TEXT NOT NULL,
  req INTEGER NOT NULL DEFAULT 0,
  tok_in INTEGER NOT NULL DEFAULT 0,
  tok_out INTEGER NOT NULL DEFAULT 0,
  neurons REAL NOT NULL DEFAULT 0, -- 只有 Workers AI 有（和 ai_usage 同一种估算）
  PRIMARY KEY (day, purpose, model)
);
