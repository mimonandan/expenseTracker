-- Existing local rows have no account owner and are intentionally left inaccessible.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS client_ref TEXT;
CREATE INDEX IF NOT EXISTS transactions_user_date_idx ON transactions (user_id, transaction_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS transactions_user_client_ref_uidx ON transactions (user_id, client_ref);
