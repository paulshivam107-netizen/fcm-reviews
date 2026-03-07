# SEO Launch Checklist

Use this checklist to improve discovery and traction after shipping.

## Day 0 (once)

1. Verify ownership in Google Search Console and Bing Webmaster Tools.
2. Submit:
   - `https://<domain>/sitemap.xml`
   - `https://<domain>/feed.xml`
3. Set `NEXT_PUBLIC_SITE_URL` to the final canonical domain (no trailing slash).
4. Set `NEXT_PUBLIC_GSC_VERIFICATION` in Railway after getting your token from Search Console.
5. Confirm `robots.txt` and `sitemap.xml` are reachable in production.

## Day 1 checks

1. Validate top pages:
   - `/top/attacker`
   - `/top/midfielder`
   - `/top/defender`
   - `/top/goalkeeper`
2. Validate player page indexing behavior:
   - cards with approved reviews should be indexable
   - cards without approved reviews should return noindex metadata
3. Validate source links have `rel="ugc nofollow noopener noreferrer"`.

## Weekly rhythm

1. Publish at least 2-3 new approved reviews per position bucket.
2. Check Search Console:
   - indexed pages
   - top queries
   - top pages by clicks/impressions
3. Monitor CTR for branded and non-branded terms.
4. Keep stale/duplicate cards archived or merged from admin tools.
5. Review moderation queue daily to prevent low-quality public pages.

## Content quality guardrails

1. Keep review summaries concise and specific (avoid generic text).
2. Prefer real match context (position used, strengths, weaknesses, score).
3. Keep player/event naming consistent (helps dedupe and ranking).
4. Reject spam or duplicate submissions quickly.

## Technical verification commands

```bash
# check sitemap
curl -sS https://<domain>/sitemap.xml | head

# check RSS feed
curl -sS https://<domain>/feed.xml | head

# check robots
curl -sS https://<domain>/robots.txt
```
