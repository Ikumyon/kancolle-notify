CREATE TABLE IF NOT EXISTS account_state (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0,
  commit_id TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_batches (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_time ON audit_batches(created_at);
