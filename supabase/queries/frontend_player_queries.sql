-- Frontend query templates for FC Mobile Opinion Tracker
-- Reads from public.mv_player_sentiment_summary only.

-- ============================================================
-- 0) Refresh after each batch write (backend/cron)
-- ============================================================
-- REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_player_sentiment_summary;

-- ============================================================
-- 1) Latest players + reviews (home screen)
-- ============================================================
SELECT
  player_id,
  player_name,
  base_ovr,
  base_position,
  program_promo,
  mention_count,
  avg_sentiment_score,
  top_pros,
  top_cons,
  last_processed_at
FROM public.mv_player_sentiment_summary
WHERE mention_count > 0
ORDER BY last_processed_at DESC NULLS LAST, mention_count DESC, avg_sentiment_score DESC
LIMIT 30;

-- ============================================================
-- 2) Search players with strict OVR if present
-- Examples:
--   'messi'      -> fuzzy search by name
--   '113 messi'  -> strict OVR=113 + fuzzy name search
-- ============================================================
WITH params AS (
  SELECT
    '113 messi'::TEXT AS query_text,
    20::INTEGER AS page_size,
    0::INTEGER AS page_offset
),
parsed AS (
  SELECT
    lower(btrim(query_text)) AS raw_query,
    CASE
      WHEN lower(btrim(query_text)) ~ '^[0-9]{2,3}[[:space:]]+' THEN
        substring(lower(btrim(query_text)) FROM '^([0-9]{2,3})')::SMALLINT
      ELSE NULL
    END AS requested_ovr,
    CASE
      WHEN lower(btrim(query_text)) ~ '^[0-9]{2,3}[[:space:]]+' THEN
        btrim(regexp_replace(lower(btrim(query_text)), '^[0-9]{2,3}[[:space:]]+', ''))
      ELSE lower(btrim(query_text))
    END AS name_query,
    page_size,
    page_offset
  FROM params
)
SELECT
  m.player_id,
  m.player_name,
  m.base_ovr,
  m.base_position,
  m.program_promo,
  m.mention_count,
  m.avg_sentiment_score,
  m.top_pros,
  m.top_cons,
  m.last_processed_at
FROM public.mv_player_sentiment_summary m
CROSS JOIN parsed p
WHERE m.mention_count > 0
  AND (p.requested_ovr IS NULL OR m.base_ovr = p.requested_ovr)
  AND (
    p.name_query = ''
    OR lower(m.player_name) ILIKE '%' || p.name_query || '%'
    OR lower(m.player_name) % p.name_query
  )
ORDER BY
  CASE
    WHEN lower(m.player_name) = p.name_query THEN 0
    WHEN lower(m.player_name) LIKE p.name_query || '%' THEN 1
    ELSE 2
  END,
  similarity(lower(m.player_name), p.name_query) DESC NULLS LAST,
  m.mention_count DESC,
  m.avg_sentiment_score DESC
LIMIT (SELECT page_size FROM parsed)
OFFSET (SELECT page_offset FROM parsed);

-- ============================================================
-- 3) Top players by position (minimum mentions = 10)
-- ============================================================
WITH params AS (
  SELECT
    'ST'::TEXT AS position_filter,
    10::INTEGER AS min_mentions
)
SELECT
  player_id,
  player_name,
  base_ovr,
  base_position,
  program_promo,
  mention_count,
  avg_sentiment_score,
  top_pros,
  top_cons,
  last_processed_at
FROM public.mv_player_sentiment_summary
WHERE base_position = (SELECT position_filter FROM params)
  AND mention_count >= (SELECT min_mentions FROM params)
ORDER BY avg_sentiment_score DESC NULLS LAST, mention_count DESC, base_ovr DESC
LIMIT 50;
