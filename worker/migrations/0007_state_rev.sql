-- One ledger revision, shared by Cloudflare D1 and Docker SQLite.
INSERT INTO kv (key, value) VALUES ('rev', '0') ON CONFLICT(key) DO NOTHING;

-- Triggers run inside the writer's transaction, including direct SQL and batch writes.
-- The kv allow-list excludes rev, even when recursive_triggers is enabled.
CREATE TRIGGER rev_subscriptions_insert AFTER INSERT ON subscriptions
BEGIN
  UPDATE kv SET value = CAST(value AS INTEGER) + 1 WHERE key = 'rev';
END;

CREATE TRIGGER rev_subscriptions_update AFTER UPDATE ON subscriptions
BEGIN
  UPDATE kv SET value = CAST(value AS INTEGER) + 1 WHERE key = 'rev';
END;

CREATE TRIGGER rev_subscriptions_delete AFTER DELETE ON subscriptions
BEGIN
  UPDATE kv SET value = CAST(value AS INTEGER) + 1 WHERE key = 'rev';
END;

CREATE TRIGGER rev_methods_insert AFTER INSERT ON methods
BEGIN
  UPDATE kv SET value = CAST(value AS INTEGER) + 1 WHERE key = 'rev';
END;

CREATE TRIGGER rev_methods_update AFTER UPDATE ON methods
BEGIN
  UPDATE kv SET value = CAST(value AS INTEGER) + 1 WHERE key = 'rev';
END;

CREATE TRIGGER rev_methods_delete AFTER DELETE ON methods
BEGIN
  UPDATE kv SET value = CAST(value AS INTEGER) + 1 WHERE key = 'rev';
END;

CREATE TRIGGER rev_fx_daily_insert AFTER INSERT ON fx_daily
BEGIN
  UPDATE kv SET value = CAST(value AS INTEGER) + 1 WHERE key = 'rev';
END;

CREATE TRIGGER rev_fx_daily_update AFTER UPDATE ON fx_daily
BEGIN
  UPDATE kv SET value = CAST(value AS INTEGER) + 1 WHERE key = 'rev';
END;

CREATE TRIGGER rev_fx_daily_delete AFTER DELETE ON fx_daily
BEGIN
  UPDATE kv SET value = CAST(value AS INTEGER) + 1 WHERE key = 'rev';
END;

CREATE TRIGGER rev_kv_insert AFTER INSERT ON kv
WHEN NEW.key IN ('settings', 'people', 'prefs', 'fx')
BEGIN
  UPDATE kv SET value = CAST(value AS INTEGER) + 1 WHERE key = 'rev';
END;

CREATE TRIGGER rev_kv_update AFTER UPDATE ON kv
WHEN NEW.key IN ('settings', 'people', 'prefs', 'fx') OR OLD.key IN ('settings', 'people', 'prefs', 'fx')
BEGIN
  UPDATE kv SET value = CAST(value AS INTEGER) + 1 WHERE key = 'rev';
END;

CREATE TRIGGER rev_kv_delete AFTER DELETE ON kv
WHEN OLD.key IN ('settings', 'people', 'prefs', 'fx')
BEGIN
  UPDATE kv SET value = CAST(value AS INTEGER) + 1 WHERE key = 'rev';
END;

