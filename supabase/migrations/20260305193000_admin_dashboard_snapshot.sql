-- Admin dashboard snapshot RPC for moderation/traffic overview.
-- Service-role only.

CREATE OR REPLACE FUNCTION public.admin_dashboard_snapshot(
  p_window_days INTEGER DEFAULT 7
)
RETURNS TABLE (
  window_days INTEGER,
  unique_visitors_24h INTEGER,
  unique_visitors_window INTEGER,
  searches_24h INTEGER,
  card_opens_24h INTEGER,
  review_submissions_24h INTEGER,
  reviews_pending INTEGER,
  reviews_approved_24h INTEGER,
  reviews_rejected_24h INTEGER,
  review_approval_rate_24h NUMERIC(5, 2),
  feedback_submissions_24h INTEGER,
  feedback_pending INTEGER,
  feedback_reviewed_24h INTEGER,
  feedback_resolved_24h INTEGER,
  open_from_search_rate_pct NUMERIC(5, 2),
  review_submit_rate_pct NUMERIC(5, 2)
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
WITH bounds AS (
  SELECT
    GREATEST(COALESCE(p_window_days, 7), 1)::INTEGER AS window_days,
    NOW() - INTERVAL '24 hours' AS since_24h,
    NOW() - (GREATEST(COALESCE(p_window_days, 7), 1)::TEXT || ' days')::INTERVAL AS since_window
),
event_counts AS (
  SELECT
    COUNT(DISTINCT ael.client_fingerprint)
      FILTER (
        WHERE ael.created_at >= b.since_24h
          AND ael.client_fingerprint IS NOT NULL
          AND btrim(ael.client_fingerprint) <> ''
      )::INTEGER AS unique_visitors_24h,
    COUNT(DISTINCT ael.client_fingerprint)
      FILTER (
        WHERE ael.created_at >= b.since_window
          AND ael.client_fingerprint IS NOT NULL
          AND btrim(ael.client_fingerprint) <> ''
      )::INTEGER AS unique_visitors_window,
    COUNT(*) FILTER (
      WHERE ael.event_type = 'search_submitted'
        AND ael.created_at >= b.since_24h
    )::INTEGER AS searches_24h,
    COUNT(*) FILTER (
      WHERE ael.event_type = 'card_opened'
        AND ael.created_at >= b.since_24h
    )::INTEGER AS card_opens_24h,
    COUNT(*) FILTER (
      WHERE ael.event_type = 'review_submitted'
        AND ael.created_at >= b.since_24h
    )::INTEGER AS review_submissions_24h
  FROM public.app_event_logs ael
  CROSS JOIN bounds b
),
review_counts AS (
  SELECT
    COUNT(*) FILTER (WHERE urs.status = 'pending')::INTEGER AS reviews_pending,
    COUNT(*) FILTER (
      WHERE urs.status = 'approved'
        AND urs.submitted_at >= b.since_24h
    )::INTEGER AS reviews_approved_24h,
    COUNT(*) FILTER (
      WHERE urs.status = 'rejected'
        AND urs.submitted_at >= b.since_24h
    )::INTEGER AS reviews_rejected_24h
  FROM public.user_review_submissions urs
  CROSS JOIN bounds b
),
feedback_counts AS (
  SELECT
    COUNT(*) FILTER (
      WHERE ufs.created_at >= b.since_24h
    )::INTEGER AS feedback_submissions_24h,
    COUNT(*) FILTER (WHERE ufs.status = 'pending')::INTEGER AS feedback_pending,
    COUNT(*) FILTER (
      WHERE ufs.status = 'reviewed'
        AND ufs.created_at >= b.since_24h
    )::INTEGER AS feedback_reviewed_24h,
    COUNT(*) FILTER (
      WHERE ufs.status = 'resolved'
        AND ufs.created_at >= b.since_24h
    )::INTEGER AS feedback_resolved_24h
  FROM public.user_feedback_submissions ufs
  CROSS JOIN bounds b
)
SELECT
  b.window_days,
  COALESCE(e.unique_visitors_24h, 0) AS unique_visitors_24h,
  COALESCE(e.unique_visitors_window, 0) AS unique_visitors_window,
  COALESCE(e.searches_24h, 0) AS searches_24h,
  COALESCE(e.card_opens_24h, 0) AS card_opens_24h,
  COALESCE(e.review_submissions_24h, 0) AS review_submissions_24h,
  COALESCE(r.reviews_pending, 0) AS reviews_pending,
  COALESCE(r.reviews_approved_24h, 0) AS reviews_approved_24h,
  COALESCE(r.reviews_rejected_24h, 0) AS reviews_rejected_24h,
  CASE
    WHEN (COALESCE(r.reviews_approved_24h, 0) + COALESCE(r.reviews_rejected_24h, 0)) = 0 THEN NULL
    ELSE ROUND(
      (COALESCE(r.reviews_approved_24h, 0)::NUMERIC
      / (COALESCE(r.reviews_approved_24h, 0) + COALESCE(r.reviews_rejected_24h, 0))::NUMERIC) * 100,
      2
    )
  END AS review_approval_rate_24h,
  COALESCE(f.feedback_submissions_24h, 0) AS feedback_submissions_24h,
  COALESCE(f.feedback_pending, 0) AS feedback_pending,
  COALESCE(f.feedback_reviewed_24h, 0) AS feedback_reviewed_24h,
  COALESCE(f.feedback_resolved_24h, 0) AS feedback_resolved_24h,
  CASE
    WHEN COALESCE(e.searches_24h, 0) = 0 THEN NULL
    ELSE ROUND(
      (COALESCE(e.card_opens_24h, 0)::NUMERIC / COALESCE(e.searches_24h, 0)::NUMERIC) * 100,
      2
    )
  END AS open_from_search_rate_pct,
  CASE
    WHEN COALESCE(e.card_opens_24h, 0) = 0 THEN NULL
    ELSE ROUND(
      (COALESCE(e.review_submissions_24h, 0)::NUMERIC / COALESCE(e.card_opens_24h, 0)::NUMERIC) * 100,
      2
    )
  END AS review_submit_rate_pct
FROM bounds b
CROSS JOIN event_counts e
CROSS JOIN review_counts r
CROSS JOIN feedback_counts f;
$$;

REVOKE ALL ON FUNCTION public.admin_dashboard_snapshot(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_snapshot(INTEGER) TO service_role;
