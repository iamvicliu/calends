-- 历史汇率：每个扣款日一行，USD 为基准（rates JSON 中 1 USD = x 外币）
CREATE TABLE fx_daily (
  date TEXT PRIMARY KEY,
  rates TEXT NOT NULL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
