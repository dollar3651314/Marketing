-- 公司运营仪表盘（agents 产品/marketing/技术方案-运营仪表盘.md 第三节，Amos 2026-11-01 确认）：只建新表，旧表一行不动。时间都是毫秒时间戳。
-- 各仓库的自动检查（Action）把解析好的块推进来（POST /api/company/ingest），同一 (source, kind, key) 覆盖；周报 key 是日期，所以保留历史。
CREATE TABLE company_snapshot (
  source TEXT NOT NULL,          -- agents / new-forecast / marketing
  kind TEXT NOT NULL,            -- projects / status / handoff / todo / weekly / learning / prs / ci
  key TEXT NOT NULL,             -- 产品名、周报日期、岗位名；只有一块的用空字符串
  payload TEXT NOT NULL,         -- 解析好的内容（JSON）；status = error 时保留上次成功的
  status TEXT NOT NULL,          -- ok / error
  error TEXT NOT NULL DEFAULT '',
  source_at INTEGER NOT NULL,    -- 文件里写的"更新"时间（没有就用提交时间）；页面"更新于 X 小时前"用它
  updated_at INTEGER NOT NULL,   -- 最近一次推进来的时间
  PRIMARY KEY (source, kind, key)
);
-- 页面上点"我做了"：保留 90 天（写的时候顺手删更早的）
CREATE TABLE company_done (item_key TEXT PRIMARY KEY, done_at INTEGER NOT NULL);
CREATE INDEX company_done_at ON company_done (done_at);
-- ingest 每个来源每分钟最多 6 次（做法同 rate 表；旧 rate 表是全站一个计数器、不分来源，所以另建；只留最近 10 分钟）
CREATE TABLE company_rate (
  source TEXT NOT NULL,
  minute INTEGER NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (source, minute)
);
