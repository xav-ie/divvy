-- Recurring bills are fixed amounts only. Amount-less ("varies") templates
-- that never billed are dropped; ones with bills keep their history but are
-- paused and renamed so nobody mistakes them for an automatic bill.
DELETE FROM recurring
WHERE amount_cents IS NULL
  AND id NOT IN (SELECT recurring_id FROM expenses WHERE recurring_id IS NOT NULL);
UPDATE recurring
SET paused = 1, title = title || ' (varied; add as expenses)', amount_cents = 1
WHERE amount_cents IS NULL;
