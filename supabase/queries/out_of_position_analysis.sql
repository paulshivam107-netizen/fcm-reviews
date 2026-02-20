-- Compare a player's output in-position vs out-of-position.
-- Rank input can be number or color:
-- 1/Base, 2/Blue, 3/Purple, 4/Red, 5/Gold (White maps to Base).
-- Leave rank_input blank to include all ranks for the player name.

WITH params AS (
  SELECT
    'Stoichkov'::TEXT AS player_name_input,
    ''::TEXT AS rank_input
),
resolved AS (
  SELECT
    lower(btrim(player_name_input)) AS player_name_normalized,
    NULLIF(btrim(rank_input), '') AS rank_input_clean,
    public.normalize_rank(NULLIF(btrim(rank_input), '')) AS rank_tier
  FROM params
)

SELECT
  ls.is_out_of_position,
  ls.played_position,
  pc.rank_label,
  pc.rank_tier,
  COUNT(*) AS matches_played,
  ROUND(AVG(pms.goals)::NUMERIC, 2) AS avg_goals,
  ROUND(AVG(pms.assists)::NUMERIC, 2) AS avg_assists,
  ROUND(AVG(pms.player_feel_rating)::NUMERIC, 2) AS avg_feel,
  ROUND(
    COUNT(*) FILTER (WHERE ml.result = 'W')::NUMERIC / COUNT(*) * 100,
    1
  ) AS win_rate_pct
FROM public.lineup_slots ls
JOIN public.player_cards pc
  ON ls.player_card_id = pc.id
CROSS JOIN resolved r
JOIN public.player_match_stats pms
  ON ls.id = pms.lineup_slot_id
JOIN public.lineups lu
  ON ls.lineup_id = lu.id
JOIN public.match_logs ml
  ON ml.lineup_id = lu.id
WHERE lower(pc.player_name) = r.player_name_normalized
  AND (
    r.rank_input_clean IS NULL
    OR pc.rank_tier = r.rank_tier
  )
  AND lu.user_id = auth.uid()
GROUP BY ls.is_out_of_position, ls.played_position, pc.rank_label, pc.rank_tier
ORDER BY ls.is_out_of_position, matches_played DESC;
