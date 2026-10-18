-- A month whose bill was deleted: offered again for manual billing, but the
-- daily `divvy recur` skips it. Cleared once that month is billed or restored.
ALTER TABLE recurring ADD COLUMN manual_month TEXT;
