-- Search a player review with rank input as either number or color.
-- Accepted rank inputs: 1/Base, 2/Blue, 3/Purple, 4/Red, 5/Gold.
-- 'White' is also treated as Base for backward compatibility.
--
-- Replace values in params CTE (or bind parameters from app code).

WITH params AS (
  SELECT
    'Stoichkov'::TEXT AS player_name_input,
    '3'::TEXT AS rank_input
),
resolved AS (
  SELECT
    lower(btrim(player_name_input)) AS player_name_normalized,
    NULLIF(btrim(rank_input), '') AS rank_input_clean,
    public.normalize_rank(NULLIF(btrim(rank_input), '')) AS rank_tier
  FROM params
)
SELECT
  pc.id,
  pc.player_name,
  pc.card_version,
  pc.base_position,
  pc.current_ovr,
  pc.rank,
  pc.rank_label,
  pc.rank_tier
FROM public.player_cards pc
CROSS JOIN resolved r
WHERE pc.user_id = auth.uid()
  AND lower(pc.player_name) = r.player_name_normalized
  AND (
    r.rank_input_clean IS NULL
    OR pc.rank_tier = r.rank_tier
  )
ORDER BY pc.current_ovr DESC, pc.created_at DESC;
