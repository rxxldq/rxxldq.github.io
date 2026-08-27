CREATE TABLE IF NOT EXISTS reading_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  view_id TEXT NOT NULL,
  article_slug TEXT NOT NULL,
  article_title TEXT NOT NULL,
  language TEXT NOT NULL,
  path TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('view', 'complete')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(view_id, event_type)
);

CREATE INDEX IF NOT EXISTS reading_events_article_created
  ON reading_events(article_slug, language, created_at);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_slug TEXT NOT NULL,
  article_title TEXT NOT NULL,
  language TEXT NOT NULL,
  path TEXT NOT NULL,
  sender_name TEXT,
  sender_email TEXT,
  message TEXT NOT NULL,
  sender_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS messages_status_created
  ON messages(status, created_at DESC);

CREATE INDEX IF NOT EXISTS messages_sender_created
  ON messages(sender_hash, created_at DESC);
