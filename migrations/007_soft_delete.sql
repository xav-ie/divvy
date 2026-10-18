-- Deletes are soft so they can be undone for 7 days; deleted rows are
-- invisible to every read except restore.
ALTER TABLE expenses ADD COLUMN deleted_at TEXT;
ALTER TABLE expenses ADD COLUMN deleted_by INTEGER REFERENCES users(id);
ALTER TABLE payments ADD COLUMN deleted_at TEXT;
ALTER TABLE payments ADD COLUMN deleted_by INTEGER REFERENCES users(id);
