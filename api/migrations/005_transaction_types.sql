-- Mark non-spending money movements so card settlements and wallet top-ups
-- do not inflate purchase totals. Existing rows are ordinary expenses.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS transaction_type TEXT NOT NULL DEFAULT 'expense';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transactions_transaction_type_check'
      AND conrelid = 'public.transactions'::regclass
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_transaction_type_check
      CHECK (transaction_type IN ('expense', 'refund', 'transfer', 'income'));
  END IF;
END $$;
