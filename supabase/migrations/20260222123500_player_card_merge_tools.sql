-- Admin tooling for safe card merges:
-- - Preview source/target impact before merge
-- - Merge mentions/reviews/aliases/events in one transaction
-- - Archive source card and log audit trail

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS merged_into_player_id UUID
  REFERENCES public.players(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_players_merged_into
  ON public.players (merged_into_player_id);

CREATE TABLE IF NOT EXISTS public.player_card_merge_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE RESTRICT,
  target_player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE RESTRICT,
  merged_by_email TEXT,
  moved_mentions_count INTEGER NOT NULL DEFAULT 0 CHECK (moved_mentions_count >= 0),
  skipped_mentions_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_mentions_count >= 0),
  moved_user_reviews_count INTEGER NOT NULL DEFAULT 0 CHECK (moved_user_reviews_count >= 0),
  moved_aliases_count INTEGER NOT NULL DEFAULT 0 CHECK (moved_aliases_count >= 0),
  skipped_aliases_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_aliases_count >= 0),
  moved_event_logs_count INTEGER NOT NULL DEFAULT 0 CHECK (moved_event_logs_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  details JSONB
);

CREATE INDEX IF NOT EXISTS idx_player_card_merge_audit_source_time
  ON public.player_card_merge_audit (source_player_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_player_card_merge_audit_target_time
  ON public.player_card_merge_audit (target_player_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.preview_player_card_merge(
  p_source_player_id UUID,
  p_target_player_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  source_row public.players%ROWTYPE;
  target_row public.players%ROWTYPE;
  source_mentions INTEGER := 0;
  mention_conflicts INTEGER := 0;
  source_user_reviews_total INTEGER := 0;
  source_user_reviews_approved INTEGER := 0;
  source_user_reviews_pending INTEGER := 0;
  source_user_reviews_rejected INTEGER := 0;
  source_aliases_total INTEGER := 0;
  alias_conflicts INTEGER := 0;
  source_event_logs INTEGER := 0;
  target_mentions INTEGER := 0;
  target_user_reviews_total INTEGER := 0;
BEGIN
  IF p_source_player_id IS NULL OR p_target_player_id IS NULL THEN
    RAISE EXCEPTION 'source and target player ids are required'
      USING ERRCODE = '22023';
  END IF;

  IF p_source_player_id = p_target_player_id THEN
    RAISE EXCEPTION 'source and target cannot be the same player'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO source_row
  FROM public.players
  WHERE id = p_source_player_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'source player not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT *
  INTO target_row
  FROM public.players
  WHERE id = p_target_player_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'target player not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO source_mentions
  FROM public.player_sentiment_mentions
  WHERE player_id = p_source_player_id;

  SELECT COUNT(*)::INTEGER
  INTO mention_conflicts
  FROM public.player_sentiment_mentions s
  JOIN public.player_sentiment_mentions t
    ON t.player_id = p_target_player_id
   AND t.source_platform = s.source_platform
   AND t.source_comment_id = s.source_comment_id
  WHERE s.player_id = p_source_player_id;

  SELECT
    COUNT(*)::INTEGER,
    COUNT(*) FILTER (WHERE status = 'approved')::INTEGER,
    COUNT(*) FILTER (WHERE status = 'pending')::INTEGER,
    COUNT(*) FILTER (WHERE status = 'rejected')::INTEGER
  INTO
    source_user_reviews_total,
    source_user_reviews_approved,
    source_user_reviews_pending,
    source_user_reviews_rejected
  FROM public.user_review_submissions
  WHERE player_id = p_source_player_id;

  SELECT COUNT(*)::INTEGER
  INTO source_aliases_total
  FROM public.player_aliases
  WHERE player_id = p_source_player_id;

  SELECT COUNT(*)::INTEGER
  INTO alias_conflicts
  FROM public.player_aliases s
  JOIN public.player_aliases t
    ON t.player_id = p_target_player_id
   AND lower(t.alias) = lower(s.alias)
  WHERE s.player_id = p_source_player_id;

  SELECT COUNT(*)::INTEGER
  INTO source_event_logs
  FROM public.app_event_logs
  WHERE player_id = p_source_player_id;

  SELECT COUNT(*)::INTEGER
  INTO target_mentions
  FROM public.player_sentiment_mentions
  WHERE player_id = p_target_player_id;

  SELECT COUNT(*)::INTEGER
  INTO target_user_reviews_total
  FROM public.user_review_submissions
  WHERE player_id = p_target_player_id;

  RETURN jsonb_build_object(
    'sourcePlayer',
    jsonb_build_object(
      'id', source_row.id,
      'playerName', source_row.player_name,
      'baseOvr', source_row.base_ovr,
      'basePosition', source_row.base_position,
      'programPromo', source_row.program_promo,
      'isActive', source_row.is_active
    ),
    'targetPlayer',
    jsonb_build_object(
      'id', target_row.id,
      'playerName', target_row.player_name,
      'baseOvr', target_row.base_ovr,
      'basePosition', target_row.base_position,
      'programPromo', target_row.program_promo,
      'isActive', target_row.is_active
    ),
    'sourceCounts',
    jsonb_build_object(
      'mentions', source_mentions,
      'mentionConflicts', mention_conflicts,
      'mentionsToMove', GREATEST(source_mentions - mention_conflicts, 0),
      'userReviewsTotal', source_user_reviews_total,
      'userReviewsApproved', source_user_reviews_approved,
      'userReviewsPending', source_user_reviews_pending,
      'userReviewsRejected', source_user_reviews_rejected,
      'aliasesTotal', source_aliases_total,
      'aliasConflicts', alias_conflicts,
      'aliasesToMove', GREATEST(source_aliases_total - alias_conflicts, 0),
      'eventLogsToMove', source_event_logs
    ),
    'targetCounts',
    jsonb_build_object(
      'mentions', target_mentions,
      'userReviewsTotal', target_user_reviews_total
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.merge_player_cards(
  p_source_player_id UUID,
  p_target_player_id UUID,
  p_merged_by_email TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  source_row public.players%ROWTYPE;
  target_row public.players%ROWTYPE;
  moved_mentions_count INTEGER := 0;
  skipped_mentions_count INTEGER := 0;
  moved_user_reviews_count INTEGER := 0;
  moved_aliases_count INTEGER := 0;
  skipped_aliases_count INTEGER := 0;
  moved_event_logs_count INTEGER := 0;
  audit_id UUID;
BEGIN
  IF p_source_player_id IS NULL OR p_target_player_id IS NULL THEN
    RAISE EXCEPTION 'source and target player ids are required'
      USING ERRCODE = '22023';
  END IF;

  IF p_source_player_id = p_target_player_id THEN
    RAISE EXCEPTION 'source and target cannot be the same player'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO source_row
  FROM public.players
  WHERE id = p_source_player_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'source player not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT *
  INTO target_row
  FROM public.players
  WHERE id = p_target_player_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'target player not found'
      USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM public.player_sentiment_mentions s
  USING public.player_sentiment_mentions t
  WHERE s.player_id = p_source_player_id
    AND t.player_id = p_target_player_id
    AND t.source_platform = s.source_platform
    AND t.source_comment_id = s.source_comment_id;
  GET DIAGNOSTICS skipped_mentions_count = ROW_COUNT;

  UPDATE public.player_sentiment_mentions
  SET player_id = p_target_player_id
  WHERE player_id = p_source_player_id;
  GET DIAGNOSTICS moved_mentions_count = ROW_COUNT;

  UPDATE public.user_review_submissions
  SET player_id = p_target_player_id
  WHERE player_id = p_source_player_id;
  GET DIAGNOSTICS moved_user_reviews_count = ROW_COUNT;

  DELETE FROM public.player_aliases s
  USING public.player_aliases t
  WHERE s.player_id = p_source_player_id
    AND t.player_id = p_target_player_id
    AND lower(t.alias) = lower(s.alias);
  GET DIAGNOSTICS skipped_aliases_count = ROW_COUNT;

  UPDATE public.player_aliases
  SET player_id = p_target_player_id
  WHERE player_id = p_source_player_id;
  GET DIAGNOSTICS moved_aliases_count = ROW_COUNT;

  UPDATE public.app_event_logs
  SET player_id = p_target_player_id
  WHERE player_id = p_source_player_id;
  GET DIAGNOSTICS moved_event_logs_count = ROW_COUNT;

  UPDATE public.players
  SET is_active = FALSE,
      merged_into_player_id = p_target_player_id
  WHERE id = p_source_player_id;

  UPDATE public.players
  SET merged_into_player_id = NULL
  WHERE id = p_target_player_id
    AND merged_into_player_id IS NOT NULL;

  INSERT INTO public.player_card_merge_audit (
    source_player_id,
    target_player_id,
    merged_by_email,
    moved_mentions_count,
    skipped_mentions_count,
    moved_user_reviews_count,
    moved_aliases_count,
    skipped_aliases_count,
    moved_event_logs_count,
    details
  )
  VALUES (
    p_source_player_id,
    p_target_player_id,
    NULLIF(lower(btrim(COALESCE(p_merged_by_email, ''))), ''),
    moved_mentions_count,
    skipped_mentions_count,
    moved_user_reviews_count,
    moved_aliases_count,
    skipped_aliases_count,
    moved_event_logs_count,
    jsonb_build_object(
      'sourcePlayer',
      jsonb_build_object(
        'id', source_row.id,
        'playerName', source_row.player_name,
        'baseOvr', source_row.base_ovr,
        'basePosition', source_row.base_position,
        'programPromo', source_row.program_promo
      ),
      'targetPlayer',
      jsonb_build_object(
        'id', target_row.id,
        'playerName', target_row.player_name,
        'baseOvr', target_row.base_ovr,
        'basePosition', target_row.base_position,
        'programPromo', target_row.program_promo
      )
    )
  )
  RETURNING id INTO audit_id;

  PERFORM public.refresh_player_sentiment_summary();

  RETURN jsonb_build_object(
    'auditId', audit_id,
    'sourcePlayerId', p_source_player_id,
    'targetPlayerId', p_target_player_id,
    'movedMentionsCount', moved_mentions_count,
    'skippedMentionsCount', skipped_mentions_count,
    'movedUserReviewsCount', moved_user_reviews_count,
    'movedAliasesCount', moved_aliases_count,
    'skippedAliasesCount', skipped_aliases_count,
    'movedEventLogsCount', moved_event_logs_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.preview_player_card_merge(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merge_player_cards(UUID, UUID, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.preview_player_card_merge(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.merge_player_cards(UUID, UUID, TEXT) TO service_role;
