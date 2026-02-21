-- Archive players that have not received sentiment updates for N days.
-- "Update" is based on latest approved/public sentiment activity.

CREATE OR REPLACE FUNCTION public.archive_stale_players(days_without_update INTEGER DEFAULT 30)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  safe_days INTEGER := GREATEST(COALESCE(days_without_update, 30), 1);
  cutoff TIMESTAMPTZ := NOW() - make_interval(days => safe_days);
  archived_count INTEGER := 0;
BEGIN
  WITH activity AS (
    SELECT
      p.id,
      GREATEST(
        COALESCE((
          SELECT MAX(psm.llm_processed_at)
          FROM public.player_sentiment_mentions psm
          WHERE psm.player_id = p.id
        ), '-infinity'::TIMESTAMPTZ),
        COALESCE((
          SELECT MAX(urs.submitted_at)
          FROM public.user_review_submissions urs
          WHERE urs.player_id = p.id
            AND urs.status = 'approved'
        ), '-infinity'::TIMESTAMPTZ),
        p.created_at
      ) AS last_activity_at
    FROM public.players p
    WHERE p.is_active = TRUE
  ),
  stale AS (
    SELECT a.id
    FROM activity a
    WHERE a.last_activity_at < cutoff
  ),
  archived AS (
    UPDATE public.players p
    SET
      is_active = FALSE,
      updated_at = NOW()
    WHERE p.id IN (SELECT id FROM stale)
    RETURNING p.id
  )
  SELECT COUNT(*)::INTEGER INTO archived_count
  FROM archived;

  RETURN archived_count;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_stale_players(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_stale_players(INTEGER) TO service_role;
