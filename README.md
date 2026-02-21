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
- `ADMIN_API_TOKEN` (required for moderation API/UI access)
- `REVIEW_FINGERPRINT_SALT` (used to hash anonymous submitter fingerprint)
- `REVIEW_AUTO_APPROVE` (`false` by default; set `true` only if moderation is skipped)
- `REVIEW_CAPTCHA_REQUIRED` (`true` in production recommended)
- `TURNSTILE_SECRET_KEY` + `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (Cloudflare Turnstile)
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
  - approve/reject pending submissions via `ADMIN_API_TOKEN`
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

## Local mock mode

Set `USE_LOCAL_MOCK_DATA=true` to bypass Supabase reads/writes during local UI testing.

Seeded demo content includes:

- multiple Reddit-sourced review seeds for cards you provided

Search behavior:

- `113 messi` => strict `OVR = 113`, name filtered
- `113` => strict `OVR = 113` and returns all matching cards (all positions)
- `messi` => name filtered only
