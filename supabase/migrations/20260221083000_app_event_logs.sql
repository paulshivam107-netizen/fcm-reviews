-- Lightweight product analytics for pilot usage patterns.
-- Server-only writes via service role; no direct client writes.

CREATE TABLE IF NOT EXISTS public.app_event_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL
    CHECK (event_type IN ('search_submitted', 'card_opened', 'review_submitted', 'review_moderated')),
  player_id UUID REFERENCES public.players(id) ON DELETE SET NULL,
  query_text TEXT,
  client_fingerprint TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_event_logs_type_time
  ON public.app_event_logs (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_event_logs_player_time
  ON public.app_event_logs (player_id, created_at DESC);

ALTER TABLE public.app_event_logs ENABLE ROW LEVEL SECURITY;

