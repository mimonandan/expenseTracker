-- Run this migration in the Supabase SQL editor for authenticated live updates.
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read their own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can insert their own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can update their own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can delete their own transactions" ON public.transactions;
DROP INDEX IF EXISTS public.transactions_user_client_ref_uidx;
CREATE UNIQUE INDEX transactions_user_client_ref_uidx ON public.transactions (user_id, client_ref);
CREATE POLICY "Users can read their own transactions" ON public.transactions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own transactions" ON public.transactions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own transactions" ON public.transactions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own transactions" ON public.transactions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
