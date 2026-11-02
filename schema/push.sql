CREATE TABLE IF NOT EXISTS push_subscriptions (
  identity_key TEXT NOT NULL,
  endpoint TEXT PRIMARY KEY,
  subscription_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_identity ON push_subscriptions(identity_key);
