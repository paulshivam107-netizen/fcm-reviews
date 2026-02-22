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
- `NEXT_PUBLIC_ENABLE_AD_SLOTS` (`false` by default; enable UI ad placeholders when ready)

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
- Ad-slot placeholders (top, in-feed, footer) toggleable via env flag
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
