-- Hold imported Reddit reviews until an admin explicitly approves publication.

CREATE TABLE IF NOT EXISTS public.reddit_import_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  source_mode TEXT NOT NULL
    CHECK (source_mode IN ('url', 'text')),
  source_url TEXT,
  source_subreddit TEXT,
  source_author TEXT,
  source_published_at TIMESTAMPTZ,
  source_external_id TEXT NOT NULL,
  source_post_id TEXT,
  title TEXT,
  body TEXT NOT NULL,
  player_id UUID REFERENCES public.players(id) ON DELETE SET NULL,
  player_name TEXT NOT NULL
    CHECK (char_length(btrim(player_name)) BETWEEN 2 AND 72),
  player_ovr SMALLINT NOT NULL
    CHECK (player_ovr BETWEEN 1 AND 130),
  event_name TEXT,
  played_position TEXT NOT NULL,
  mentioned_rank_text TEXT,
  sentiment_score NUMERIC(4,2) NOT NULL
    CHECK (sentiment_score BETWEEN 1 AND 10),
  pros TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  cons TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  summary TEXT,
  confidence NUMERIC(4,2) NOT NULL DEFAULT 0
    CHECK (confidence BETWEEN 0 AND 1),
  needs_review BOOLEAN NOT NULL DEFAULT TRUE,
  content_hash TEXT NOT NULL UNIQUE,
  raw_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  review_note TEXT,
  reviewed_at TIMESTAMPTZ,
  published_player_id UUID REFERENCES public.players(id) ON DELETE SET NULL,
  refreshed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reddit_import_queue_status_created
  ON public.reddit_import_queue (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reddit_import_queue_player_status
  ON public.reddit_import_queue (player_id, status, created_at DESC);

ALTER TABLE public.reddit_import_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reddit_import_queue_service_role_all
  ON public.reddit_import_queue;

CREATE POLICY reddit_import_queue_service_role_all
  ON public.reddit_import_queue
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_reddit_import_queue_set_updated_at
  ON public.reddit_import_queue;

CREATE TRIGGER trg_reddit_import_queue_set_updated_at
BEFORE UPDATE ON public.reddit_import_queue
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();
