-- Security hardening:
-- - Enable RLS on public tables flagged by Supabase Security Advisor.
-- - Keep sensitive pipeline/admin tables service-role only.
-- - Allow public read only for active player catalog data.

-- ============================================================
-- Enable RLS on pipeline + catalog tables
-- ============================================================
ALTER TABLE IF EXISTS public.ingest_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.raw_reddit_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.player_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.player_sentiment_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.pipeline_budget_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.pipeline_budget_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.player_card_merge_audit ENABLE ROW LEVEL SECURITY;

-- Existing RLS tables: ensure explicit service-role policies for backend routes.
ALTER TABLE IF EXISTS public.user_review_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.app_event_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Service-role policies (backend jobs/admin APIs)
-- ============================================================
DROP POLICY IF EXISTS ingest_runs_service_role_all ON public.ingest_runs;
CREATE POLICY ingest_runs_service_role_all
  ON public.ingest_runs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS raw_reddit_comments_service_role_all ON public.raw_reddit_comments;
CREATE POLICY raw_reddit_comments_service_role_all
  ON public.raw_reddit_comments
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS player_sentiment_mentions_service_role_all ON public.player_sentiment_mentions;
CREATE POLICY player_sentiment_mentions_service_role_all
  ON public.player_sentiment_mentions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS pipeline_budget_limits_service_role_all ON public.pipeline_budget_limits;
CREATE POLICY pipeline_budget_limits_service_role_all
  ON public.pipeline_budget_limits
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS pipeline_budget_events_service_role_all ON public.pipeline_budget_events;
CREATE POLICY pipeline_budget_events_service_role_all
  ON public.pipeline_budget_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS player_card_merge_audit_service_role_all ON public.player_card_merge_audit;
CREATE POLICY player_card_merge_audit_service_role_all
  ON public.player_card_merge_audit
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS user_review_submissions_service_role_all ON public.user_review_submissions;
CREATE POLICY user_review_submissions_service_role_all
  ON public.user_review_submissions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS app_event_logs_service_role_all ON public.app_event_logs;
CREATE POLICY app_event_logs_service_role_all
  ON public.app_event_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- Public read policies (catalog only)
-- ============================================================
DROP POLICY IF EXISTS players_public_read_active ON public.players;
CREATE POLICY players_public_read_active
  ON public.players
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS player_aliases_public_read_active_player ON public.player_aliases;
CREATE POLICY player_aliases_public_read_active_player
  ON public.player_aliases
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.players p
      WHERE p.id = player_aliases.player_id
        AND p.is_active = true
    )
  );

DROP POLICY IF EXISTS players_service_role_all ON public.players;
CREATE POLICY players_service_role_all
  ON public.players
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS player_aliases_service_role_all ON public.player_aliases;
CREATE POLICY player_aliases_service_role_all
  ON public.player_aliases
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
