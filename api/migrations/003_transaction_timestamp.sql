-- Preserve the exact time reported by the source notification.
-- Historical rows can only use their insertion time as a best available timestamp.
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS transaction_at TIMESTAMPTZ;
UPDATE public.transactions SET transaction_at = created_at WHERE transaction_at IS NULL;
ALTER TABLE public.transactions ALTER COLUMN transaction_at SET DEFAULT NOW();
ALTER TABLE public.transactions ALTER COLUMN transaction_at SET NOT NULL;
CREATE INDEX IF NOT EXISTS transactions_user_at_idx ON public.transactions (user_id, transaction_at DESC);
