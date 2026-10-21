-- 保留失败提醒快照；首次发送后最多在之后整点补发三次。
ALTER TABLE notify_log ADD COLUMN digest TEXT;
ALTER TABLE notify_log ADD COLUMN attempts INTEGER NOT NULL DEFAULT 1;
ALTER TABLE notify_log ADD COLUMN retry_at INTEGER;
CREATE INDEX notify_retry ON notify_log(status, retry_at);
