-- What divvy found at the user's public Venmo profile, checked server-side on
-- save: the photo (stored under $DIVVY_DATA_DIR/venmo-avatars) and whether the
-- profile exists ('found', 'not_found', 'unavailable').
ALTER TABLE users ADD COLUMN venmo_status TEXT CHECK (venmo_status IN ('found', 'not_found', 'unavailable'));
ALTER TABLE users ADD COLUMN venmo_avatar TEXT;
