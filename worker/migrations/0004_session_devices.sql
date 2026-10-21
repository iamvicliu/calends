-- 登录设备：记录来源，供设置页列出并单独移出
ALTER TABLE sessions ADD COLUMN ip TEXT;
ALTER TABLE sessions ADD COLUMN location TEXT;
ALTER TABLE sessions ADD COLUMN method TEXT;
ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER;
