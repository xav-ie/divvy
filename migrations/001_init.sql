CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- A person in groups: a signed-in user or a placeholder without an account.
CREATE TABLE members (
  id INTEGER PRIMARY KEY,
  user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  invite_email TEXT COLLATE NOCASE,
  placeholder INTEGER NOT NULL DEFAULT 0 CHECK (placeholder IN (0, 1)),
  CHECK (placeholder = 0 OR user_id IS NULL)
);
CREATE INDEX members_invite_email ON members(invite_email) WHERE placeholder = 1;

CREATE TABLE groups (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE group_members (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id),
  PRIMARY KEY (group_id, member_id)
);
CREATE INDEX group_members_member ON group_members(member_id);

CREATE TABLE recurring (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  day_of_month INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 28),
  amount_cents INTEGER CHECK (amount_cents IS NULL OR amount_cents > 0),
  split TEXT NOT NULL,
  payer_member INTEGER NOT NULL REFERENCES members(id),
  last_month TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id)
);

CREATE TABLE expenses (
  id INTEGER PRIMARY KEY,
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
  receipt_path TEXT
);
CREATE INDEX expenses_group_date ON expenses(group_id, date);

CREATE TABLE expense_items (
  id INTEGER PRIMARY KEY,
  expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_cents INTEGER NOT NULL,
  split_type TEXT NOT NULL CHECK (split_type IN ('equal', 'percent', 'exact', 'shares')),
  split TEXT NOT NULL
);
CREATE INDEX expense_items_expense ON expense_items(expense_id);

CREATE TABLE expense_payers (
  expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id),
  cents INTEGER NOT NULL,
  PRIMARY KEY (expense_id, member_id)
);

CREATE TABLE expense_shares (
  expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id),
  cents INTEGER NOT NULL,
  PRIMARY KEY (expense_id, member_id)
);
CREATE INDEX expense_shares_member ON expense_shares(member_id);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
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
CREATE INDEX payments_group ON payments(group_id);

CREATE TABLE audit (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  entity TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  summary TEXT NOT NULL,
  created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX audit_group_created ON audit(group_id, created);
