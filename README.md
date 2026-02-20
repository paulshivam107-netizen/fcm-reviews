# FC Mobile Reviews Web

Mobile-first Next.js frontend for public FC Mobile player sentiment.

## Stack

- Next.js (App Router)
- TypeScript
- Tailwind CSS
- Server-side API route to Supabase (`/api/players`)

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

## Data contract

The frontend reads from `public.mv_player_sentiment_summary` via `GET /api/players`.

Search behavior:

- `113 messi` => strict `OVR = 113`, name filtered
- `messi` => name filtered only
