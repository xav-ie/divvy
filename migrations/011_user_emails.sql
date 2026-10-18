-- Several sign-in emails per account. users.email stays the primary one; every
-- email Access may present resolves through this table. Links are proven by a
-- single-use code opened while signed in with the other email.
CREATE TABLE user_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  verified_at TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1))
);
CREATE UNIQUE INDEX user_emails_one_primary ON user_emails(user_id) WHERE is_primary = 1;
INSERT INTO user_emails (user_id, email, verified_at, is_primary)
  SELECT id, email, created, 1 FROM users;

CREATE TABLE email_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires TEXT NOT NULL,
  used TEXT
);
