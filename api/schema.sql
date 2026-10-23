CREATE TABLE IF NOT EXISTS transactions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  client_ref TEXT,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  description TEXT NOT NULL,
  merchant TEXT,
  category TEXT NOT NULL DEFAULT 'Other',
  payment_method TEXT NOT NULL DEFAULT 'Other',
  transaction_type TEXT NOT NULL DEFAULT 'expense' CHECK (transaction_type IN ('expense', 'refund', 'transfer', 'income')),
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  transaction_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS transactions_date_idx ON transactions (transaction_date DESC);
CREATE INDEX IF NOT EXISTS transactions_category_idx ON transactions (category);
CREATE INDEX IF NOT EXISTS transactions_user_date_idx ON transactions (user_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS transactions_user_at_idx ON transactions (user_id, transaction_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS transactions_user_client_ref_uidx ON transactions (user_id, client_ref);
