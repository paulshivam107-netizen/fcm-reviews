-- Budget controls for the Reddit -> LLM pipeline.
-- Stores monthly caps and per-call cost events.

CREATE TABLE IF NOT EXISTS public.pipeline_budget_limits (
  scope TEXT PRIMARY KEY
    CHECK (scope IN ('llm_total', 'openai', 'gemini', 'reddit_api')),
  monthly_cap_usd NUMERIC(14, 6) NOT NULL CHECK (monthly_cap_usd >= 0),
  input_cost_per_1k NUMERIC(14, 6) NOT NULL DEFAULT 0 CHECK (input_cost_per_1k >= 0),
  output_cost_per_1k NUMERIC(14, 6) NOT NULL DEFAULT 0 CHECK (output_cost_per_1k >= 0),
  request_cost_usd NUMERIC(14, 6) NOT NULL DEFAULT 0 CHECK (request_cost_usd >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_pipeline_budget_limits_set_updated_at ON public.pipeline_budget_limits;

CREATE TRIGGER trg_pipeline_budget_limits_set_updated_at
BEFORE UPDATE ON public.pipeline_budget_limits
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.pipeline_budget_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL
    CHECK (scope IN ('llm_total', 'openai', 'gemini', 'reddit_api')),
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('llm_completion', 'reddit_request', 'manual_adjustment')),
  estimated_cost_usd NUMERIC(14, 6) NOT NULL CHECK (estimated_cost_usd >= 0),
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  requests INTEGER NOT NULL DEFAULT 1 CHECK (requests > 0),
  metadata JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_budget_events_scope_occurred_at
  ON public.pipeline_budget_events (scope, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_pipeline_budget_events_provider_occurred_at
  ON public.pipeline_budget_events (provider, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.get_pipeline_monthly_spend(month_start TIMESTAMPTZ DEFAULT date_trunc('month', NOW()))
RETURNS TABLE(scope TEXT, total_cost_usd NUMERIC)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT
      date_trunc('month', month_start) AS start_at,
      date_trunc('month', month_start) + INTERVAL '1 month' AS end_at
  ),
  scopes AS (
    SELECT unnest(ARRAY['llm_total', 'openai', 'gemini', 'reddit_api'])::TEXT AS scope
  )
  SELECT
    s.scope,
    COALESCE(SUM(e.estimated_cost_usd), 0)::NUMERIC
  FROM scopes s
  LEFT JOIN public.pipeline_budget_events e
    ON e.scope = s.scope
   AND e.occurred_at >= (SELECT start_at FROM bounds)
   AND e.occurred_at <  (SELECT end_at FROM bounds)
  GROUP BY s.scope
  ORDER BY s.scope;
$$;

REVOKE ALL ON FUNCTION public.get_pipeline_monthly_spend(TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pipeline_monthly_spend(TIMESTAMPTZ) TO service_role;

INSERT INTO public.pipeline_budget_limits (
  scope,
  monthly_cap_usd,
  input_cost_per_1k,
  output_cost_per_1k,
  request_cost_usd,
  is_active,
  notes
)
VALUES
  ('llm_total', 25.000000, 0,        0,        0,        TRUE, 'Combined cap across OpenAI + Gemini'),
  ('openai',    25.000000, 0.000150, 0.000600, 0,        TRUE, 'Default fallback rates; adjust to active model pricing'),
  ('gemini',    25.000000, 0.000150, 0.000600, 0,        TRUE, 'Default fallback rates; adjust to active model pricing'),
  ('reddit_api',10.000000, 0,        0,        0.000240, TRUE, 'Assumes 0.24 USD / 1000 API calls')
ON CONFLICT (scope) DO NOTHING;
