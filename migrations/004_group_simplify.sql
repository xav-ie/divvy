-- Show this group's balances as the fewest transfers that settle everyone.
ALTER TABLE groups ADD COLUMN simplify INTEGER NOT NULL DEFAULT 0 CHECK (simplify IN (0, 1));
