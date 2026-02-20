-- RPC helper for backend pipeline to refresh the read model.
-- Uses a non-concurrent refresh so it can run safely via PostgREST RPC.

CREATE OR REPLACE FUNCTION public.refresh_player_sentiment_summary()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW public.mv_player_sentiment_summary;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_player_sentiment_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_player_sentiment_summary() TO service_role;
