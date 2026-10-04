CREATE TABLE IF NOT EXISTS usage_daily (
  uid TEXT NOT NULL,
  day TEXT NOT NULL,
  n   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (uid, day)
);

CREATE TABLE IF NOT EXISTS chats (
  uid        TEXT NOT NULL,
  id         TEXT NOT NULL,
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  synced_at  INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (uid, id)
);
CREATE INDEX IF NOT EXISTS chats_sync ON chats (uid, synced_at);
