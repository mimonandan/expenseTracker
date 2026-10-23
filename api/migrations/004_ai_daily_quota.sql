-- Enforce a shared per-user AI request cap across Edge Function instances.
-- The usage table is inaccessible to clients; only this fixed-limit RPC can update it.
CREATE TABLE IF NOT EXISTS public.spending_ai_usage (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_day DATE NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0)
);

ALTER TABLE public.spending_ai_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.spending_ai_usage FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.consume_spending_ai_request()
RETURNS TABLE (allowed BOOLEAN, retry_after_seconds INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requesting_user UUID := auth.uid();
  today_utc DATE := (now() AT TIME ZONE 'UTC')::date;
  used_today INTEGER;
BEGIN
  IF requesting_user IS NULL THEN
    RETURN QUERY SELECT FALSE, 0;
    RETURN;
  END IF;

  INSERT INTO public.spending_ai_usage AS existing_usage (user_id, usage_day, request_count)
  VALUES (requesting_user, today_utc, 1)
  ON CONFLICT (user_id) DO UPDATE
    SET usage_day = EXCLUDED.usage_day,
        request_count = CASE
          WHEN existing_usage.usage_day = EXCLUDED.usage_day THEN existing_usage.request_count + 1
          ELSE 1
        END
    WHERE existing_usage.usage_day <> EXCLUDED.usage_day
       OR existing_usage.request_count < 10
  RETURNING request_count INTO used_today;

  IF used_today IS NOT NULL THEN
    RETURN QUERY SELECT TRUE, 0;
  ELSE
    RETURN QUERY SELECT FALSE, GREATEST(
      1,
      EXTRACT(EPOCH FROM (((today_utc + 1)::timestamp AT TIME ZONE 'UTC') - now()))::integer
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_spending_ai_request() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_spending_ai_request() TO authenticated;
