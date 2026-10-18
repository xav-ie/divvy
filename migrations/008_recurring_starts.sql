-- The first month a template bills (YYYY-MM): a day that already passed when
-- it was created starts it next month. NULL for older templates.
ALTER TABLE recurring ADD COLUMN starts_month TEXT;
