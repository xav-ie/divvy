ALTER TABLE recurring ADD COLUMN paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1));

-- A scanned receipt image under $DIVVY_DATA_DIR. Expenses link it through
-- expenses.receipt_path; until then only the uploader can see it.
CREATE TABLE receipts (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  media_type TEXT NOT NULL,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX expenses_receipt_path ON expenses(receipt_path) WHERE receipt_path IS NOT NULL;
