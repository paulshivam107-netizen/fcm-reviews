-- FC Mobile Opinion Tracker: Asynchronous Reddit Batch Processing Pipeline
-- Frontend reads from aggregated materialized view; backend writes raw + processed data.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- Shared trigger helper
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ============================================================
-- Rank normalization helpers (supports text or numeric mentions)
-- ============================================================
CREATE OR REPLACE FUNCTION public.normalize_rank(rank_value TEXT)
RETURNS SMALLINT
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE
    WHEN rank_value IS NULL THEN NULL
    WHEN lower(btrim(rank_value)) IN ('1', 'base', 'white') THEN 1
    WHEN lower(btrim(rank_value)) IN ('2', 'blue') THEN 2
    WHEN lower(btrim(rank_value)) IN ('3', 'purple') THEN 3
    WHEN lower(btrim(rank_value)) IN ('4', 'red') THEN 4
    WHEN lower(btrim(rank_value)) IN ('5', 'gold') THEN 5
    ELSE NULL
  END::SMALLINT;
$$;

CREATE OR REPLACE FUNCTION public.rank_tier_label(rank_tier SMALLINT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE rank_tier
    WHEN 1 THEN 'Base'
    WHEN 2 THEN 'Blue'
    WHEN 3 THEN 'Purple'
    WHEN 4 THEN 'Red'
    WHEN 5 THEN 'Gold'
    ELSE NULL
  END;
$$;

-- ============================================================
-- Batch tracking: one row per ingestion run
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ingest_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_platform TEXT NOT NULL DEFAULT 'reddit' CHECK (source_platform = 'reddit'),
  subreddits TEXT[] NOT NULL,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'partial')),
  pull_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pull_finished_at TIMESTAMPTZ,
  raw_comments_count INTEGER NOT NULL DEFAULT 0 CHECK (raw_comments_count >= 0),
  processed_mentions_count INTEGER NOT NULL DEFAULT 0 CHECK (processed_mentions_count >= 0),
  inserted_mentions_count INTEGER NOT NULL DEFAULT 0 CHECK (inserted_mentions_count >= 0),
  error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  error_log TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Raw source payloads: append-only + dedup by comment id
-- ============================================================
CREATE TABLE IF NOT EXISTS public.raw_reddit_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingest_run_id UUID NOT NULL REFERENCES public.ingest_runs(id) ON DELETE CASCADE,

  source_platform TEXT NOT NULL DEFAULT 'reddit' CHECK (source_platform = 'reddit'),
  subreddit TEXT NOT NULL,
  source_post_id TEXT,
  source_comment_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_author TEXT,
  comment_body TEXT NOT NULL,
  comment_score INTEGER,
  commented_at TIMESTAMPTZ,
  raw_payload JSONB NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_platform, source_comment_id)
);

-- ============================================================
-- Core entity: cards players can search for
-- ============================================================
CREATE TABLE IF NOT EXISTS public.players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name TEXT NOT NULL,
  base_ovr SMALLINT NOT NULL CHECK (base_ovr BETWEEN 1 AND 130),
  base_position TEXT NOT NULL,
  program_promo TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Optional alias map for fuzzy search/disambiguation
CREATE TABLE IF NOT EXISTS public.player_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_players_set_updated_at ON public.players;

CREATE TRIGGER trg_players_set_updated_at
BEFORE UPDATE ON public.players
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- LLM output: structured per-player mention sentiment
-- ============================================================
CREATE TABLE IF NOT EXISTS public.player_sentiment_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  ingest_run_id UUID REFERENCES public.ingest_runs(id) ON DELETE SET NULL,
  raw_comment_id UUID REFERENCES public.raw_reddit_comments(id) ON DELETE SET NULL,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,

  source_platform TEXT NOT NULL DEFAULT 'reddit' CHECK (source_platform = 'reddit'),
  source_subreddit TEXT NOT NULL,
  source_comment_id TEXT NOT NULL,
  source_url TEXT NOT NULL,

  -- extraction context
  mentioned_rank_text TEXT, -- "red", "4", etc.
  rank_tier SMALLINT GENERATED ALWAYS AS (public.normalize_rank(mentioned_rank_text)) STORED,
  rank_label TEXT GENERATED ALWAYS AS (public.rank_tier_label(public.normalize_rank(mentioned_rank_text))) STORED,
  mentioned_position TEXT,
  played_position TEXT,
  is_out_of_position BOOLEAN NOT NULL DEFAULT FALSE,

  -- sentiment payload
  sentiment_score NUMERIC(4,2) NOT NULL CHECK (sentiment_score BETWEEN 1 AND 10),
  pros TEXT[] NOT NULL DEFAULT '{}',
  cons TEXT[] NOT NULL DEFAULT '{}',
  llm_summary TEXT,

  llm_model TEXT NOT NULL,
  llm_version TEXT,
  llm_processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  extraction_json JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (source_platform, source_comment_id, player_id)
);

-- ============================================================
-- Aggregated frontend-read model (fast reads)
-- ============================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_player_sentiment_summary AS
WITH sentiment_base AS (
  SELECT
    psm.player_id,
    COUNT(*)::INTEGER AS mention_count,
    ROUND(AVG(psm.sentiment_score)::NUMERIC, 2) AS avg_sentiment_score,
    COUNT(*) FILTER (WHERE psm.rank_tier IS NOT NULL)::INTEGER AS rank_specific_mentions,
    COUNT(*) FILTER (WHERE psm.is_out_of_position IS TRUE)::INTEGER AS oop_mentions,
    MAX(psm.llm_processed_at) AS last_processed_at
  FROM public.player_sentiment_mentions psm
  GROUP BY psm.player_id
),
pros_counts AS (
  SELECT
    psm.player_id,
    lower(btrim(item)) AS term,
    COUNT(*)::INTEGER AS freq
  FROM public.player_sentiment_mentions psm
  CROSS JOIN LATERAL unnest(psm.pros) AS item
  WHERE item IS NOT NULL AND btrim(item) <> ''
  GROUP BY psm.player_id, lower(btrim(item))
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
    psm.player_id,
    lower(btrim(item)) AS term,
    COUNT(*)::INTEGER AS freq
  FROM public.player_sentiment_mentions psm
  CROSS JOIN LATERAL unnest(psm.cons) AS item
  WHERE item IS NOT NULL AND btrim(item) <> ''
  GROUP BY psm.player_id, lower(btrim(item))
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

-- ============================================================
-- High-performance indexes
-- ============================================================
-- raw ingestion/search
CREATE INDEX IF NOT EXISTS idx_raw_reddit_comments_ingest_run
  ON public.raw_reddit_comments (ingest_run_id);

CREATE INDEX IF NOT EXISTS idx_raw_reddit_comments_subreddit_time
  ON public.raw_reddit_comments (subreddit, commented_at DESC);

CREATE INDEX IF NOT EXISTS idx_raw_reddit_comments_created_at
  ON public.raw_reddit_comments (created_at DESC);

-- player lookup/filter
CREATE UNIQUE INDEX IF NOT EXISTS uq_players_identity_ci
  ON public.players (lower(player_name), base_ovr, base_position, lower(program_promo));

CREATE INDEX IF NOT EXISTS idx_players_name_trgm
  ON public.players USING GIN (player_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_players_position_ovr
  ON public.players (base_position, base_ovr DESC);

CREATE INDEX IF NOT EXISTS idx_players_program_ovr
  ON public.players (program_promo, base_ovr DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_player_aliases_ci
  ON public.player_aliases (player_id, lower(alias));

CREATE INDEX IF NOT EXISTS idx_player_aliases_alias_trgm
  ON public.player_aliases USING GIN (alias gin_trgm_ops);

-- mentions query patterns
CREATE INDEX IF NOT EXISTS idx_psm_player_time
  ON public.player_sentiment_mentions (player_id, llm_processed_at DESC);

CREATE INDEX IF NOT EXISTS idx_psm_player_rank_oop
  ON public.player_sentiment_mentions (player_id, rank_tier, is_out_of_position);

CREATE INDEX IF NOT EXISTS idx_psm_subreddit_time
  ON public.player_sentiment_mentions (source_subreddit, llm_processed_at DESC);

CREATE INDEX IF NOT EXISTS idx_psm_score
  ON public.player_sentiment_mentions (sentiment_score);

CREATE INDEX IF NOT EXISTS idx_psm_source_comment
  ON public.player_sentiment_mentions (source_platform, source_comment_id);

-- materialized view read patterns
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
