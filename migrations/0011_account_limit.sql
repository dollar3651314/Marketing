-- Cloudflare 自己说"账号额度用完了"的时间（2026-11-03：后台写"今天已用 115 / 9500，还剩 9385"，点生成却被 Cloudflare 直接拒了，
-- Amos 被这个数误导了两次）。根因：wrangler.toml 里 marketing 和 marketing-staging 是两个 D1，各记各的账；
-- 而 Cloudflare 的 10,000 neurons/天是按**整个账号**算的，两个环境共用。所以我们自己记的用量只是个下限，
-- **唯一可靠的信号是 Cloudflare 自己报的那句话**：报了就记一行到这张表，后台"还剩多少"置顶一句红字。
-- 只建一张新表：旧表一行不动，不 ALTER、不 DROP、不加索引、不回填。
-- day 是 **UTC 日期**（和 ai_usage、model_usage 里 Workers AI 那一套同一个口径，src/usage.ts utcDay）：
-- 查的时候只查"今天这一行"，所以到了下一个 UTC 日（台湾早上 8 点）这条提示自动失效，不用定时任务去清（全账号只有 5 个定时任务，C120）。
-- last_error 存 Cloudflare 的英文原话（截断 300 字）方便对账；里面不会有密钥（底线 1）。
CREATE TABLE account_limit (
  day TEXT NOT NULL,                      -- UTC 日期 YYYY-MM-DD
  model TEXT NOT NULL,                    -- 'workers-ai'
  first_at INTEGER NOT NULL,              -- 这一天第一次被拒的毫秒时间戳
  at INTEGER NOT NULL,                    -- 最近一次被拒的毫秒时间戳
  hits INTEGER NOT NULL DEFAULT 0,        -- 这一天被拒了几次
  last_error TEXT NOT NULL DEFAULT '',    -- Cloudflare 的英文原话（截断）
  PRIMARY KEY (day, model)
);
