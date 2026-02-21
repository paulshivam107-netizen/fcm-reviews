-- Supports duplicate-note checks scoped to player and recent submission window.

CREATE INDEX IF NOT EXISTS idx_user_review_submissions_player_time_note
  ON public.user_review_submissions (player_id, submitted_at DESC)
  WHERE note IS NOT NULL;

