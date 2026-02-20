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
- `REVIEW_FINGERPRINT_SALT` (used to hash anonymous submitter fingerprint)
- `REVIEW_AUTO_APPROVE` (`false` by default; set `true` only if moderation is skipped)

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

## Data contract

The frontend reads from `public.mv_player_sentiment_summary` via `GET /api/players`.

Review submissions write to `public.user_review_submissions` via `POST /api/reviews`.

Search behavior:

- `113 messi` => strict `OVR = 113`, name filtered
- `messi` => name filtered only
