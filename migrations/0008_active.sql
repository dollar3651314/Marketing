-- 公司平台批 3 · PR 4（agents 公司平台/技术方案-公司平台-Webhook.md 第二～四节；Amos 已定 P-2～P-5、P-7、T-4；C147）：只建新表，旧表一行不动。时间都是毫秒时间戳。
-- GitHub Webhook（POST /hooks/github）写这三张表；三个仓库的 company.yml 上报照旧，两条路互不覆盖。
-- C147：代码仓库（new-forecast、marketing）和外部人的提交说明、PR 正文一律不存；agents 只存提交说明第一行（≤ 200 字），PR 正文都不存。

-- "团队在做什么"：同一个 仓库 + 分支 一条，按事件更新（事件时间不早于库里的才覆盖，乱序不倒退）
CREATE TABLE active_item (
  repo TEXT NOT NULL,              -- agents / new-forecast / marketing
  branch TEXT NOT NULL,
  role TEXT NOT NULL,              -- main / pm / mkt / dev / qa / ops / review；认不出 none；不是 claude/ 开头 amos
  project TEXT NOT NULL,           -- forecast / platform / company
  labeled INTEGER NOT NULL,        -- 分支名合不合 claude/<岗位>-<项目>-<主题>（1 / 0）
  step TEXT NOT NULL DEFAULT '',   -- 上一步：agents 自己人的提交说明第一行；代码仓库、外部人一律空
  delivered INTEGER NOT NULL DEFAULT 0,  -- 最后一次提交说明以【交付】开头（只存这个是 / 否，不存说明）
  at INTEGER NOT NULL,             -- 最后一次事件的时间（事件里带的时间，没带用收到的时间）
  pr INTEGER,                      -- PR 号
  title TEXT NOT NULL DEFAULT '',  -- PR 标题（≤ 200 字）
  url TEXT NOT NULL DEFAULT '',    -- PR 或分支的 https 链接
  ci TEXT,                         -- success / failure（只认 workflow_run completed）
  ci_at INTEGER,                   -- 这次 CI 结果的时间（晚到的旧结果不覆盖新的）
  decide INTEGER NOT NULL DEFAULT 0,     -- PR 标题含【要你决定】且不是外部的
  external INTEGER NOT NULL DEFAULT 0,   -- 外部人的推送 / PR，或 fork 来的 PR
  end_kind TEXT,                   -- 空 = 进行中；merged / closed / deleted（24 小时没动静读的时候算，不写库）
  PRIMARY KEY (repo, branch)
);
CREATE INDEX active_item_at ON active_item (at);

-- 每个事件追加一行，保留 30 天（写入时顺手删更早的，P-7）；只记是什么事件，不存提交说明和正文
CREATE TABLE active_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo TEXT NOT NULL,
  branch TEXT NOT NULL,
  kind TEXT NOT NULL,              -- push / pr:<action> / ci:<结论> / delete
  at INTEGER NOT NULL              -- 收到的时间
);
CREATE INDEX active_log_at ON active_log (at);

-- 收到过的投递编号（X-GitHub-Delivery）：同一编号只处理一次（GitHub 手动重送时编号不变）；最近一次的时间就是页面上的"最近收到"；保留 30 天
CREATE TABLE gh_delivery (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  event TEXT NOT NULL,
  at INTEGER NOT NULL              -- 收到的时间
);
CREATE INDEX gh_delivery_at ON gh_delivery (at);
