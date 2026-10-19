-- 单用户账本：订阅与支付方式以 JSON 文档存储，便于前端模型演进
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE methods (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- settings / fx 等单值
CREATE TABLE kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_agent TEXT
);

-- 先占位后发信，dedupe_key 保证同一提醒只发一次
CREATE TABLE notify_log (
  dedupe_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE login_attempts (
  ip TEXT PRIMARY KEY,
  fails INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
