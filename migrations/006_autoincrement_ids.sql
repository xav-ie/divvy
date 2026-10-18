-- Rebuild every table with user-visible ids as AUTOINCREMENT so an id is never
-- reused after a delete. Runs with foreign keys off (see db/migrate.ts); the
-- runner checks them before committing. Also: names are 1..40 characters, and
-- the audit log can record restores.

CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO users_new (id, email, name, created)
  SELECT id, email, substr(name, 1, 40), created FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE TABLE members_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  invite_email TEXT COLLATE NOCASE,
  placeholder INTEGER NOT NULL DEFAULT 0 CHECK (placeholder IN (0, 1)),
  CHECK (placeholder = 0 OR user_id IS NULL)
);
INSERT INTO members_new (id, user_id, name, invite_email, placeholder)
  SELECT id, user_id, substr(name, 1, 40), invite_email, placeholder FROM members;
DROP TABLE members;
ALTER TABLE members_new RENAME TO members;
CREATE INDEX members_invite_email ON members(invite_email) WHERE placeholder = 1;

CREATE TABLE groups_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  emoji TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  simplify INTEGER NOT NULL DEFAULT 0 CHECK (simplify IN (0, 1))
);
INSERT INTO groups_new (id, name, emoji, created_by, created, simplify)
  SELECT id, substr(name, 1, 40), emoji, created_by, created, simplify FROM groups;
DROP TABLE groups;
ALTER TABLE groups_new RENAME TO groups;

CREATE TABLE recurring_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  day_of_month INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 28),
  amount_cents INTEGER CHECK (amount_cents IS NULL OR amount_cents > 0),
  split TEXT NOT NULL,
  payer_member INTEGER NOT NULL REFERENCES members(id),
  last_month TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1))
);
INSERT INTO recurring_new SELECT id, group_id, title, day_of_month, amount_cents, split, payer_member,
  last_month, created_by, paused FROM recurring;
DROP TABLE recurring;
ALTER TABLE recurring_new RENAME TO recurring;

CREATE TABLE expenses_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  tip_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  category TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  recurring_id INTEGER REFERENCES recurring(id) ON DELETE SET NULL,
  receipt_path TEXT,
  tax_mode TEXT NOT NULL DEFAULT 'amount' CHECK (tax_mode IN ('amount', 'percent')),
  tax_value REAL NOT NULL DEFAULT 0,
  tip_mode TEXT NOT NULL DEFAULT 'amount' CHECK (tip_mode IN ('amount', 'percent')),
  tip_value REAL NOT NULL DEFAULT 0,
  discount_mode TEXT NOT NULL DEFAULT 'amount' CHECK (discount_mode IN ('amount', 'percent')),
  discount_value REAL NOT NULL DEFAULT 0
);
INSERT INTO expenses_new SELECT id, group_id, title, date, total_cents, tax_cents, tip_cents, discount_cents,
  category, notes, created_by, created, updated, recurring_id, receipt_path, tax_mode, tax_value, tip_mode,
  tip_value, discount_mode, discount_value FROM expenses;
DROP TABLE expenses;
ALTER TABLE expenses_new RENAME TO expenses;
CREATE INDEX expenses_group_date ON expenses(group_id, date);
CREATE INDEX expenses_receipt_path ON expenses(receipt_path) WHERE receipt_path IS NOT NULL;

CREATE TABLE payments_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  from_member INTEGER NOT NULL REFERENCES members(id),
  to_member INTEGER NOT NULL REFERENCES members(id),
  cents INTEGER NOT NULL CHECK (cents > 0),
  date TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (from_member <> to_member)
);
INSERT INTO payments_new SELECT id, group_id, from_member, to_member, cents, date, note, created_by, created
  FROM payments;
DROP TABLE payments;
ALTER TABLE payments_new RENAME TO payments;
CREATE INDEX payments_group ON payments(group_id);

CREATE TABLE audit_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete', 'restore')),
  entity TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  summary TEXT NOT NULL,
  created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  data TEXT
);
INSERT INTO audit_new SELECT id, group_id, user_id, action, entity, entity_id, summary, created, data FROM audit;
DROP TABLE audit;
ALTER TABLE audit_new RENAME TO audit;
CREATE INDEX audit_group_created ON audit(group_id, created);

CREATE TABLE receipts_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  media_type TEXT NOT NULL,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO receipts_new SELECT id, path, media_type, uploaded_by, created FROM receipts;
DROP TABLE receipts;
ALTER TABLE receipts_new RENAME TO receipts;
