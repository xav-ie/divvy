-- Personal access tokens for assistants (the HTTP MCP endpoint). Only a
-- SHA-256 of the token is stored, plus its short public prefix for display.
CREATE TABLE api_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  prefix TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used TEXT,
  revoked TEXT
);
CREATE INDEX api_tokens_user ON api_tokens(user_id);
