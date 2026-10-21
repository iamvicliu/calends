-- AI 助手的聊天记录：一行一个对话，data 存 { createdAt, turns, history }（图片不存，只留占位）
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
