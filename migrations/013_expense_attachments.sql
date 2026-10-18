-- Proof attached to expenses (statements, photos). Stored under
-- $DIVVY_DATA_DIR/attachments/<random id>, never under the user's filename.
-- expense_id is NULL between upload and the expense being saved; removed
-- attachments are soft-deleted, and an expense's soft delete hides its own.
CREATE TABLE expense_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_id INTEGER REFERENCES expenses(id) ON DELETE CASCADE,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  filename TEXT NOT NULL,
  label TEXT,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
CREATE INDEX expense_attachments_expense ON expense_attachments(expense_id);
