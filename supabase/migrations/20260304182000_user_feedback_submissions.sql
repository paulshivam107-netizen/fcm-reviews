-- Collect general product feedback from public users.
-- Stored as pending for manual triage.

CREATE TABLE IF NOT EXISTS public.user_feedback_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL
    CHECK (category IN ('review_feedback', 'general_feedback', 'improvement_suggestion')),
  message TEXT NOT NULL
    CHECK (char_length(btrim(message)) BETWEEN 12 AND 1200),
  contact TEXT
    CHECK (contact IS NULL OR char_length(btrim(contact)) BETWEEN 2 AND 32),
  submission_fingerprint TEXT NOT NULL,
  submitted_from_ip INET,
  user_agent TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reviewed', 'resolved')),
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_feedback_submissions_status_created
  ON public.user_feedback_submissions (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_feedback_submissions_fingerprint_created
  ON public.user_feedback_submissions (submission_fingerprint, created_at DESC);

ALTER TABLE public.user_feedback_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_feedback_submissions_service_role_all
  ON public.user_feedback_submissions;

CREATE POLICY user_feedback_submissions_service_role_all
  ON public.user_feedback_submissions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
