-- Web Push. Each device a user turned notifications on for, what they want
-- to hear about (both on until they say otherwise), and the household's VAPID
-- key pair, made on first use so a deploy needs no extra secrets.
CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX push_subscriptions_user ON push_subscriptions(user_id);
ALTER TABLE users ADD COLUMN notify_expenses INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN notify_payments INTEGER NOT NULL DEFAULT 1;
CREATE TABLE vapid_keys (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  public_key TEXT NOT NULL,
  private_jwk TEXT NOT NULL
);
