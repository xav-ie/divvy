-- Tax, tip and discount keep how they were entered: a fixed amount in cents
-- or a percent of the item subtotal. The *_cents columns stay the computed amount.
ALTER TABLE expenses ADD COLUMN tax_mode TEXT NOT NULL DEFAULT 'amount' CHECK (tax_mode IN ('amount', 'percent'));
ALTER TABLE expenses ADD COLUMN tax_value REAL NOT NULL DEFAULT 0;
ALTER TABLE expenses ADD COLUMN tip_mode TEXT NOT NULL DEFAULT 'amount' CHECK (tip_mode IN ('amount', 'percent'));
ALTER TABLE expenses ADD COLUMN tip_value REAL NOT NULL DEFAULT 0;
ALTER TABLE expenses ADD COLUMN discount_mode TEXT NOT NULL DEFAULT 'amount' CHECK (discount_mode IN ('amount', 'percent'));
ALTER TABLE expenses ADD COLUMN discount_value REAL NOT NULL DEFAULT 0;
UPDATE expenses SET tax_value = tax_cents, tip_value = tip_cents, discount_value = discount_cents;
