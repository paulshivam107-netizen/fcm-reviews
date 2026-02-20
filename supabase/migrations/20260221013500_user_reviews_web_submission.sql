-- Web-submitted user reviews + aggregate integration.
-- This keeps frontend reads fast by folding approved user reviews into the
-- existing materialized summary.

CREATE TABLE IF NOT EXISTS public.user_review_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,

  source_platform TEXT NOT NULL DEFAULT 'user' CHECK (source_platform = 'user'),
  submission_fingerprint TEXT NOT NULL,
  submitted_from_ip INET,
  user_agent TEXT,

  submitted_username TEXT,
  submitted_username_type TEXT,

  sentiment_score NUMERIC(4, 2) NOT NULL CHECK (sentiment_score BETWEEN 1 AND 10),
  played_position TEXT NOT NULL,
  mentioned_rank_text TEXT,
  rank_tier SMALLINT GENERATED ALWAYS AS (public.normalize_rank(mentioned_rank_text)) STORED,
  rank_label TEXT GENERATED ALWAYS AS (
    public.rank_tier_label(public.normalize_rank(mentioned_rank_text))
  ) STORED,

  pros TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(pros) <= 5),
  cons TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(cons) <= 5),
  note TEXT,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  review_weight NUMERIC(4, 2) NOT NULL DEFAULT 0.80
    CHECK (review_weight > 0 AND review_weight <= 1),

  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  moderated_at TIMESTAMPTZ,
  moderation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_review_submissions
  ALTER COLUMN status SET DEFAULT 'pending';

ALTER TABLE public.user_review_submissions
  ADD COLUMN IF NOT EXISTS submitted_username TEXT,
  ADD COLUMN IF NOT EXISTS submitted_username_type TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_review_submissions_username_type_chk'
  ) THEN
    ALTER TABLE public.user_review_submissions
      ADD CONSTRAINT user_review_submissions_username_type_chk
      CHECK (
        submitted_username_type IS NULL
        OR submitted_username_type IN ('reddit', 'game')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_review_submissions_username_pair_chk'
  ) THEN
    ALTER TABLE public.user_review_submissions
      ADD CONSTRAINT user_review_submissions_username_pair_chk
      CHECK (
        (submitted_username IS NULL AND submitted_username_type IS NULL)
        OR (submitted_username IS NOT NULL AND submitted_username_type IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_review_submissions_username_len_chk'
  ) THEN
    ALTER TABLE public.user_review_submissions
      ADD CONSTRAINT user_review_submissions_username_len_chk
      CHECK (
        submitted_username IS NULL
        OR char_length(btrim(submitted_username)) BETWEEN 2 AND 32
      );
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_user_review_submissions_player_status_time
  ON public.user_review_submissions (player_id, status, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_review_submissions_fingerprint_time
  ON public.user_review_submissions (submission_fingerprint, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_review_submissions_status_time
  ON public.user_review_submissions (status, submitted_at DESC);

ALTER TABLE public.user_review_submissions ENABLE ROW LEVEL SECURITY;

-- Hard throttle at DB level: max 5 review submissions per fingerprint in rolling 24h.
CREATE OR REPLACE FUNCTION public.enforce_user_review_submission_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  recent_count INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(COALESCE(NEW.submission_fingerprint, ''), 0)
  );

  SELECT COUNT(*)::INTEGER
  INTO recent_count
  FROM public.user_review_submissions urs
  WHERE urs.submission_fingerprint = NEW.submission_fingerprint
    AND urs.submitted_at >= (NOW() - INTERVAL '24 hours');

  IF recent_count >= 5 THEN
    RAISE EXCEPTION 'Submission limit reached: max 5 reviews per 24 hours'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_review_submissions_cap
  ON public.user_review_submissions;

CREATE TRIGGER trg_user_review_submissions_cap
BEFORE INSERT ON public.user_review_submissions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_user_review_submission_cap();

-- Rebuild aggregate view to include approved user submissions.
DROP MATERIALIZED VIEW IF EXISTS public.mv_player_sentiment_summary CASCADE;

CREATE MATERIALIZED VIEW public.mv_player_sentiment_summary AS
WITH reddit_mentions AS (
  SELECT
    psm.player_id,
    psm.sentiment_score,
    psm.rank_tier,
    psm.is_out_of_position,
    psm.pros,
    psm.cons,
    psm.llm_processed_at AS processed_at
  FROM public.player_sentiment_mentions psm
),
user_mentions AS (
  SELECT
    urs.player_id,
    urs.sentiment_score,
    urs.rank_tier,
    (upper(urs.played_position) <> upper(p.base_position)) AS is_out_of_position,
    urs.pros,
    urs.cons,
    urs.submitted_at AS processed_at
  FROM public.user_review_submissions urs
  JOIN public.players p ON p.id = urs.player_id
  WHERE urs.status = 'approved'
),
all_mentions AS (
  SELECT * FROM reddit_mentions
  UNION ALL
  SELECT * FROM user_mentions
),
sentiment_base AS (
  SELECT
    am.player_id,
    COUNT(*)::INTEGER AS mention_count,
    ROUND(AVG(am.sentiment_score)::NUMERIC, 2) AS avg_sentiment_score,
    COUNT(*) FILTER (WHERE am.rank_tier IS NOT NULL)::INTEGER AS rank_specific_mentions,
    COUNT(*) FILTER (WHERE am.is_out_of_position IS TRUE)::INTEGER AS oop_mentions,
    MAX(am.processed_at) AS last_processed_at
  FROM all_mentions am
  GROUP BY am.player_id
),
pros_counts AS (
  SELECT
    am.player_id,
    lower(btrim(item)) AS term,
    COUNT(*)::INTEGER AS freq
  FROM all_mentions am
  CROSS JOIN LATERAL unnest(am.pros) AS item
  WHERE item IS NOT NULL AND btrim(item) <> ''
  GROUP BY am.player_id, lower(btrim(item))
),
pros_ranked AS (
  SELECT
    pc.player_id,
    pc.term,
    pc.freq,
    ROW_NUMBER() OVER (
      PARTITION BY pc.player_id
      ORDER BY pc.freq DESC, pc.term
    ) AS rn
  FROM pros_counts pc
),
pros_agg AS (
  SELECT
    pr.player_id,
    jsonb_agg(
      jsonb_build_object('text', pr.term, 'count', pr.freq)
      ORDER BY pr.freq DESC, pr.term
    ) AS top_pros
  FROM pros_ranked pr
  WHERE pr.rn <= 5
  GROUP BY pr.player_id
),
cons_counts AS (
  SELECT
    am.player_id,
    lower(btrim(item)) AS term,
    COUNT(*)::INTEGER AS freq
  FROM all_mentions am
  CROSS JOIN LATERAL unnest(am.cons) AS item
  WHERE item IS NOT NULL AND btrim(item) <> ''
  GROUP BY am.player_id, lower(btrim(item))
),
cons_ranked AS (
  SELECT
    cc.player_id,
    cc.term,
    cc.freq,
    ROW_NUMBER() OVER (
      PARTITION BY cc.player_id
      ORDER BY cc.freq DESC, cc.term
    ) AS rn
  FROM cons_counts cc
),
cons_agg AS (
  SELECT
    cr.player_id,
    jsonb_agg(
      jsonb_build_object('text', cr.term, 'count', cr.freq)
      ORDER BY cr.freq DESC, cr.term
    ) AS top_cons
  FROM cons_ranked cr
  WHERE cr.rn <= 5
  GROUP BY cr.player_id
)
SELECT
  p.id AS player_id,
  p.player_name,
  p.base_ovr,
  p.base_position,
  p.program_promo,
  COALESCE(sb.mention_count, 0) AS mention_count,
  sb.avg_sentiment_score,
  COALESCE(sb.rank_specific_mentions, 0) AS rank_specific_mentions,
  COALESCE(sb.oop_mentions, 0) AS oop_mentions,
  COALESCE(pa.top_pros, '[]'::jsonb) AS top_pros,
  COALESCE(ca.top_cons, '[]'::jsonb) AS top_cons,
  sb.last_processed_at,
  NOW()::TIMESTAMPTZ AS refreshed_at
FROM public.players p
LEFT JOIN sentiment_base sb ON sb.player_id = p.id
LEFT JOIN pros_agg pa ON pa.player_id = p.id
LEFT JOIN cons_agg ca ON ca.player_id = p.id
WHERE p.is_active = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_summary_player_id
  ON public.mv_player_sentiment_summary (player_id);

CREATE INDEX IF NOT EXISTS idx_mv_summary_name_trgm
  ON public.mv_player_sentiment_summary USING GIN (player_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_mv_summary_position_rank
  ON public.mv_player_sentiment_summary (base_position, avg_sentiment_score DESC, mention_count DESC);

CREATE INDEX IF NOT EXISTS idx_mv_summary_ovr_name
  ON public.mv_player_sentiment_summary (base_ovr DESC, player_name);

CREATE INDEX IF NOT EXISTS idx_mv_summary_latest
  ON public.mv_player_sentiment_summary (last_processed_at DESC);
