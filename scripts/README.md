# Reddit Batch Pipeline (Middleman)

This script is the async middle layer:

1. Pulls Reddit comments from configured subreddits.
2. Sends comments to OpenAI or Gemini for structured extraction.
3. Writes normalized rows into Supabase.
4. Refreshes `public.mv_player_sentiment_summary`.

## Files

- `scripts/reddit_batch_pipeline.mjs`
- `scripts/reddit_batch_pipeline.env.example`
- `scripts/data/active_cards.sample.json`

## Prerequisites

1. Apply Supabase migrations, including:
   - `supabase/migrations/20260220214000_reddit_batch_pipeline.sql`
   - `supabase/migrations/20260220220500_reddit_pipeline_rpc.sql`
   - `supabase/migrations/20260221001000_pipeline_budget_controls.sql`
2. Node.js 20+
3. `SUPABASE_SERVICE_ROLE_KEY` available for backend execution.

## Configure

Create an env file from the example and fill values:

```bash
cp scripts/reddit_batch_pipeline.env.example .env.reddit
```

Set at minimum:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `LLM_PROVIDER` + provider API key
- `REQUIRE_BUDGET_GUARDS=true` (recommended)

Optional but recommended:

- `CARD_CATALOG_FILE=scripts/data/active_cards.sample.json` (replace with your real active cards file)
- `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET`
- Tune monthly caps/rates in `public.pipeline_budget_limits`

## Budget guard behavior

- The script checks budget caps before every Reddit request and every LLM call.
- Spend is tracked per month in `public.pipeline_budget_events`.
- Caps are configured in `public.pipeline_budget_limits` for:
  - `llm_total`
  - `openai`
  - `gemini`
  - `reddit_api`
- If a cap is hit, the run is marked `partial` and stops further expensive calls.

## Run

Dry run (no DB writes):

```bash
set -a; source .env.reddit; set +a
DRY_RUN=true node scripts/reddit_batch_pipeline.mjs
```

Production run:

```bash
set -a; source .env.reddit; set +a
node scripts/reddit_batch_pipeline.mjs
```

## Cron (example)

Every 2 days at 03:15:

```cron
15 3 */2 * * cd /Users/shivampaul/Documents/fcm-reviews && /bin/zsh -lc 'set -a; source .env.reddit; set +a; node scripts/reddit_batch_pipeline.mjs >> /tmp/fcmo-reddit-pipeline.log 2>&1'
```
