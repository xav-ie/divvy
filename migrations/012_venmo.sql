-- Optional Venmo username (stored without the @) so others can pay by link.
ALTER TABLE users ADD COLUMN venmo TEXT CHECK (venmo IS NULL OR length(venmo) BETWEEN 5 AND 30);
