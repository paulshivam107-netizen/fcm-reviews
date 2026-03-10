-- Keep Reddit polling narrow and explicit.
-- One watchlist entry per player card, managed by admins via service-role routes.

CREATE TABLE IF NOT EXISTS public.reddit_watchlist_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  search_terms TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  subreddits TEXT[] NOT NULL DEFAULT ARRAY['FUTMobile', 'EASportsFCMobile'],
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_polled_at TIMESTAMPTZ,
  last_result_count INTEGER NOT NULL DEFAULT 0 CHECK (last_result_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (player_id)
);

CREATE INDEX IF NOT EXISTS idx_reddit_watchlist_entries_active_updated
  ON public.reddit_watchlist_entries (is_active, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_reddit_watchlist_entries_last_polled
  ON public.reddit_watchlist_entries (last_polled_at DESC NULLS LAST);

ALTER TABLE public.reddit_watchlist_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reddit_watchlist_entries_service_role_all
  ON public.reddit_watchlist_entries;

CREATE POLICY reddit_watchlist_entries_service_role_all
  ON public.reddit_watchlist_entries
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_reddit_watchlist_entries_set_updated_at
  ON public.reddit_watchlist_entries;

CREATE TRIGGER trg_reddit_watchlist_entries_set_updated_at
BEFORE UPDATE ON public.reddit_watchlist_entries
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();
