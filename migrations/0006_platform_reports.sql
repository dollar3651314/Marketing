-- 公司平台批 1（agents 公司平台/技术方案-公司平台-PR与数据.md 第五、七节，Amos 2026-11-01 确认"都按建议"）：只建新表，旧表一行不动。时间都是毫秒时间戳。
-- Amos 在工作台待办里"填数字"（X 关注、Threads 关注、名单人数、Claude 用量）：每次保存每个名称写一行，页面取每个 项目 + 名称 最新的一行；第一期只存平台、不写回 agents。
CREATE TABLE company_report (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_key TEXT NOT NULL,        -- 是哪件待办填的（同 company_done.item_key，例如 todo:forecast:R1）
  project TEXT NOT NULL,         -- 项目（forecast；公司层的写"公司"）
  name TEXT NOT NULL,            -- X 关注 / Threads 关注 / 名单人数 / Claude 用量
  value TEXT NOT NULL,           -- 规范化后的数字文字（全角转半角、去空格）
  at INTEGER NOT NULL            -- 保存时间
);
CREATE INDEX company_report_at ON company_report (at);
