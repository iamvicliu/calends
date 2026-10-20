// 由 scripts/migrations.mjs 生成，请勿手改
export const MIGRATIONS: Array<{ name: string; statements: string[] }> = [
  {
    "name": "0001_init.sql",
    "statements": [
      "CREATE TABLE subscriptions (\n  id TEXT PRIMARY KEY,\n  data TEXT NOT NULL,\n  updated_at TEXT NOT NULL DEFAULT (datetime('now'))\n)",
      "CREATE TABLE methods (\n  id TEXT PRIMARY KEY,\n  data TEXT NOT NULL,\n  updated_at TEXT NOT NULL DEFAULT (datetime('now'))\n)",
      "CREATE TABLE kv (\n  key TEXT PRIMARY KEY,\n  value TEXT NOT NULL,\n  updated_at TEXT NOT NULL DEFAULT (datetime('now'))\n)",
      "CREATE TABLE sessions (\n  token_hash TEXT PRIMARY KEY,\n  expires_at INTEGER NOT NULL,\n  created_at TEXT NOT NULL DEFAULT (datetime('now')),\n  user_agent TEXT\n)",
      "CREATE TABLE notify_log (\n  dedupe_key TEXT PRIMARY KEY,\n  kind TEXT NOT NULL,\n  subject TEXT NOT NULL,\n  status TEXT NOT NULL,\n  error TEXT,\n  sent_at TEXT NOT NULL DEFAULT (datetime('now'))\n)",
      "CREATE TABLE login_attempts (\n  ip TEXT PRIMARY KEY,\n  fails INTEGER NOT NULL,\n  window_start INTEGER NOT NULL\n)"
    ]
  },
  {
    "name": "0002_fx_daily.sql",
    "statements": [
      "CREATE TABLE fx_daily (\n  date TEXT PRIMARY KEY,\n  rates TEXT NOT NULL,\n  source TEXT NOT NULL,\n  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))\n)"
    ]
  },
  {
    "name": "0003_auth.sql",
    "statements": [
      "CREATE TABLE passkeys (\n  id TEXT PRIMARY KEY,\n  public_key TEXT NOT NULL,\n  counter INTEGER NOT NULL DEFAULT 0,\n  transports TEXT,\n  name TEXT NOT NULL,\n  created_at TEXT NOT NULL DEFAULT (datetime('now')),\n  last_used_at TEXT\n)",
      "CREATE TABLE auth_challenges (\n  id TEXT PRIMARY KEY,\n  challenge TEXT NOT NULL,\n  kind TEXT NOT NULL,\n  expires_at INTEGER NOT NULL\n)"
    ]
  },
  {
    "name": "0004_session_devices.sql",
    "statements": [
      "ALTER TABLE sessions ADD COLUMN ip TEXT",
      "ALTER TABLE sessions ADD COLUMN location TEXT",
      "ALTER TABLE sessions ADD COLUMN method TEXT",
      "ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER"
    ]
  }
];
