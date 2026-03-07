# FC Mobile Reviews Web

Mobile-first Next.js frontend for public FC Mobile player sentiment.

## Stack

- Next.js (App Router)
- TypeScript
- Tailwind CSS
- Server-side API routes to Supabase (`/api/players`, `/api/reviews`)

## Run

1. Install dependencies:

```bash
npm install
```

2. Configure env:

```bash
cp .env.example .env.local
```

Set:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (preferred for server API route)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (optional fallback)
- `ADMIN_ALLOWLIST_EMAILS` (comma-separated admin emails)
- `ADMIN_SESSION_SECRET` (server-only secret for signed admin session cookies)
- `REVIEW_FINGERPRINT_SALT` (used to hash anonymous submitter fingerprint)
- `REVIEW_AUTO_APPROVE` (`false` by default; set `true` only if moderation is skipped)
- `REVIEW_CAPTCHA_REQUIRED` (`true` in production recommended)
- `TURNSTILE_SECRET_KEY` + `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (Cloudflare Turnstile)
- `CRON_SECRET` (protects internal maintenance endpoints)
- `USE_LOCAL_MOCK_DATA` (`true` to run with local seeded data for UI testing)
- `USE_LOCAL_MOCK_FALLBACK` (`true` to fall back to local mock cards when Supabase times out/fails)
- `NEXT_PUBLIC_ENABLE_AD_SLOTS` (`false` by default; render ad placeholders for UI preview)
- `ADS_ENABLED` (`false` by default; hard gate for live ad serving)
- `AD_PROVIDER` (`none` or `adsense`; defaults to `none`)
- `ADSENSE_CLIENT_ID` (`ca-pub-...`; required when `AD_PROVIDER=adsense` and live ads enabled)
- `ADSENSE_SLOT_TOP_BANNER` (AdSense slot id for top banner)
- `ADSENSE_SLOT_IN_FEED` (AdSense slot id for in-feed unit)
- `ADSENSE_SLOT_FOOTER_STICKY` (AdSense slot id for footer unit)
- `NEXT_PUBLIC_GSC_VERIFICATION` (optional Google Search Console verification token)

3. Start dev server:

```bash
npm run dev
```

## UI implemented

- Hero heading line
- Search bar
- Horizontal pill tabs:
  - Attacker
  - Midfielder
  - Defender
  - Goalkeeper
- Spaced player card list with:
  - name
  - OVR
  - position
  - sentiment out of 10
- Add review flow:
  - pending moderation by default
  - optional username attribution (`reddit` or `in-game`)
  - 5 submissions max per 24h per submitter fingerprint
  - Turnstile captcha + honeypot trap
  - near-duplicate review detection for same player
- Moderation console:
  - `/admin/moderation`
  - admin login via Supabase email/password
  - server-side allowlist + signed admin session cookie
- Player admin console:
  - `/admin/players`
  - edit card metadata (`name`, `base OVR`, `base position`, `event/program`)
  - soft-delete/archive cards from public listing
  - archive stale cards (default: no update in 30 days)
- Card insight panel:
  - aggregate sentiment/pros/cons
  - latest review feed (Reddit + approved user submissions)
- Ad runtime config endpoint (`GET /api/ads/config`) for dark-launch ad controls
- Ad slots (top, in-feed, footer) with live serving gate + preview placeholders
- SEO crawl pages:
  - `/top/attacker`
  - `/top/midfielder`
  - `/top/defender`
  - `/top/goalkeeper`
  - `/feed.xml` (latest approved reviews RSS)
- Legal pages:
  - `/terms`
  - `/privacy`
  - disclaimer shown in footer

## Data contract

The frontend reads from `public.mv_player_sentiment_summary` via `GET /api/players`.

Review submissions write to `public.user_review_submissions` via `POST /api/reviews`.

Latest review feed reads from `public.player_sentiment_mentions` and approved
`public.user_review_submissions` via `GET /api/player-reviews`.

Basic product analytics are recorded via `POST /api/track` into
`public.app_event_logs` (searches, card opens, submissions, moderation actions).

Ad configuration is served via `GET /api/ads/config`, sourced from server env vars.

## SEO operations

- Technical SEO is now wired:
  - canonical metadata
  - robots + sitemap
  - FAQ structured data on home
  - top-position crawl pages
  - RSS feed at `/feed.xml`
  - `ugc nofollow` on user-submitted source links
- Use `/docs/seo-launch-checklist.md` as the week-by-week launch checklist.

## Production recovery runbook

When pilot data is missing after a new deploy or project reset:

1. Run `/supabase/queries/pilot_legacy_reddit_seed.sql` in Supabase SQL Editor.
2. Verify approved review coverage:
   - `select status, count(*) from public.user_review_submissions group by status order by status;`
   - `select base_position, count(*) from public.mv_player_sentiment_summary where mention_count > 0 or avg_sentiment_score is not null group by base_position order by count(*) desc;`
3. Hard refresh the web app and recheck all four tabs.

Card correction rule (to avoid the old Raul/Pirlo issue):

1. If wrong card has mentions and correct card already exists: use admin `MERGE`.
2. If correct card does not exist: edit the single card directly.
3. Never delete a card with mentions.

## Automatic stale-card archival

- Internal endpoint: `POST /api/internal/maintenance/archive-stale`
- Auth: `Authorization: Bearer <CRON_SECRET>`
- Body: `{ "days": 30 }` (optional, default `30`)
- Scheduled workflow: `.github/workflows/archive-stale-players.yml` (daily)
  - Set GitHub secrets:
    - `APP_BASE_URL` (deployed base URL, no trailing slash)
    - `CRON_SECRET` (must match runtime env var)

## Local mock mode

Set `USE_LOCAL_MOCK_DATA=true` to bypass Supabase reads/writes during local UI testing.

Seeded demo content includes:

- multiple Reddit-sourced review seeds for cards you provided

Search behavior:

- `113 messi` => strict `OVR = 113`, name filtered
- `113` => strict `OVR = 113` and returns all matching cards (all positions)
- `messi` => name filtered only

## Ad dark launch

Enable backend config and keep ads off:

- `ADS_ENABLED=false`
- `AD_PROVIDER=none`

Preview placeholder containers without serving ads:

- `NEXT_PUBLIC_ENABLE_AD_SLOTS=true`

Enable live AdSense later:

- `ADS_ENABLED=true`
- `AD_PROVIDER=adsense`
- `ADSENSE_CLIENT_ID=ca-pub-...`
- `ADSENSE_SLOT_TOP_BANNER=...`
- `ADSENSE_SLOT_IN_FEED=...`
- `ADSENSE_SLOT_FOOTER_STICKY=...`

Also update `/public/ads.txt` with your real publisher line before going live.

## Git workflow guardrails

Always keep `main` clean and synced with `origin/main`:

1. Never commit directly on `main`.
2. Start every task branch from `origin/main`.
3. Merge only via PR.

One-time local setup (already recommended for this repo):

```bash
git config --local pull.ff only
git config --local fetch.prune true
git config --local pull.rebase false
```

Daily commands:

```bash
# Sync local main safely (auto-backs up local-only main commits)
npm run git:sync-main

# Create a new task branch from origin/main
npm run git:start-task -- fix-player-search
```

Script behavior:

- `git:sync-main`:
  - requires a clean working tree
  - fetches remote with prune
  - if local `main` has extra commits, creates `backup-main-local-<timestamp>`
  - realigns `main` to `origin/main`
- `git:start-task`:
  - runs `git:sync-main`
  - creates `codex/<task-name>` from `origin/main`
