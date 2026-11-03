-- 素材生成器（公共工具 → 素材生成器，src/assets.ts）：Practical Level 1 盲听卡的图片和音频批量生成。
-- 只建一张新表，旧表一行不动。表里**不存图片和音频的字节**（素材留在 Amos 浏览器里，打包下载），只记"哪一格生成过几次、留用了没有、估算用了多少 neurons"。
-- 两个用处：① 断点续传——下次打开知道哪些已经生成过，接着跑；② 真实出图成功率——tries 与 kept 的比值，用来校正 agents《素材方案》里 1/3 那个【推断】。
CREATE TABLE asset_gen (
  scene TEXT NOT NULL,                   -- 场景编号，例如 01
  slot TEXT NOT NULL,                    -- audio / correct / d1-phoneme / d2-action / d3-function
  tries INTEGER NOT NULL DEFAULT 0,      -- 一共生成过几次（含重做）
  kept INTEGER NOT NULL DEFAULT 0,       -- 1 = 这一格已经有留用的成品
  neurons REAL NOT NULL DEFAULT 0,       -- 这一格累计估算用掉的 neurons（估算，不是账单）
  first_at INTEGER NOT NULL,             -- 第一次生成的时间
  at INTEGER NOT NULL,                   -- 最后一次生成的时间
  PRIMARY KEY (scene, slot)
);
