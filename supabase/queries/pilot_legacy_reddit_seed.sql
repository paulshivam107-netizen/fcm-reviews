-- Pilot recovery seed: restores legacy Reddit-derived review set used during pre-pilot local testing.
-- Safe to rerun (idempotent for reviews by player+note).
-- Generated from /lib/local-mock-data.ts on 2026-02-24T04:05:03.539Z.

begin;

create temp table tmp_legacy_reviews (
  player_name text not null,
  base_ovr smallint not null,
  base_position text not null,
  program_promo text not null,
  sentiment_score numeric(4,2) not null,
  played_position text not null,
  mentioned_rank_text text,
  pros text[] not null default '{}'::text[],
  cons text[] not null default '{}'::text[],
  note text,
  submitted_username text,
  submitted_username_type text,
  submitted_at timestamptz not null,
  source_platform text not null default 'user',
  status text not null default 'approved'
) on commit drop;

insert into tmp_legacy_reviews (
  player_name,
  base_ovr,
  base_position,
  program_promo,
  sentiment_score,
  played_position,
  mentioned_rank_text,
  pros,
  cons,
  note,
  submitted_username,
  submitted_username_type,
  submitted_at,
  source_platform,
  status
)
values
  (
    'Harry Kewell',
    113,
    'LW',
    'Glorious Era',
    9.00,
    'LW',
    'gold',
    ARRAY['Pace', 'Dribbling', 'Finishing']::text[],
    ARRAY['Weak Foot', 'Physical']::text[],
    'Demo seed review: 113+5 with training 30. Recommended as super-sub cutting in from RW/RM. Very high pace and dribbling, strong right-foot finesse, weak 3* WF, and stamina drops around 70-80''.',
    'demo_reddit_user',
    'reddit',
    '2026-02-20T19:00:00.000Z',
    'user',
    'approved'
  ),
  (
    'Michael Essien',
    116,
    'CDM',
    'Icon',
    3.20,
    'CDM',
    NULL,
    ARRAY[]::text[],
    ARRAY['Workrate', 'Physical', 'Dribbling']::text[],
    'From Reddit screenshot: CDM with high-high workrate tends to be out of position in key defensive moments, overall stats felt underwhelming, and 3* skill moves are not useful if used as CM. Conclusion: among the weakest 116 Icon options.',
    NULL,
    NULL,
    '2026-02-21T01:10:00.000Z',
    'user',
    'approved'
  ),
  (
    'John Barnes',
    115,
    'LW',
    'Icon',
    2.60,
    'LW',
    NULL,
    ARRAY[]::text[],
    ARRAY['Finishing', 'Pace', 'Dribbling']::text[],
    'From Reddit screenshot: user said Barnes missed too many easy chances, pace did not match the listed 200, and they replaced him with better options like Hazard/Ribery.',
    NULL,
    NULL,
    '2026-02-21T01:20:00.000Z',
    'user',
    'approved'
  ),
  (
    'John Barnes',
    115,
    'LW',
    'Icon',
    2.90,
    'LW',
    NULL,
    ARRAY[]::text[],
    ARRAY['Dribbling', 'Passing', 'Finishing']::text[],
    'From Reddit screenshot (SelhurstShark): described the card as a major disappointment with poor handling, pass receiving, weak shooting (including outside-foot attempts), and pace not matching stats.',
    'SelhurstShark',
    'reddit',
    '2026-02-21T01:20:00.000Z',
    'user',
    'approved'
  ),
  (
    'Andrea Pirlo',
    120,
    'CM',
    'Icon',
    8.60,
    'CM',
    NULL,
    ARRAY['Passing', 'Long Shots', 'Positioning']::text[],
    ARRAY['Dribbling', 'Weak Foot', 'Pace']::text[],
    'From Reddit screenshot: reviewer packed Pirlo early and rated him highly for passing (10/10), defense (9/10), shooting (9/10), and overall control as a deep playmaker. Weak points called out were average dribbling (7/10), some pace issues versus very speedy full-backs, and weak foot as a liability.',
    NULL,
    NULL,
    '2026-02-21T01:30:00.000Z',
    'user',
    'approved'
  ),
  (
    'Lionel Messi',
    117,
    'RW',
    'TOTY',
    9.70,
    'CAM',
    NULL,
    ARRAY['Dribbling', 'Passing', 'Finishing']::text[],
    ARRAY[]::text[],
    'From screenshot: reviewer said 117 Messi feels incredible, very smooth on joystick, elite dribbling, strong passing/progression, dependable finishing, and performs very well in both CAM and RW roles. Strong recommendation.',
    NULL,
    NULL,
    '2026-02-21T01:40:00.000Z',
    'user',
    'approved'
  ),
  (
    'Cristiano Ronaldo',
    117,
    'ST',
    'TOTY',
    9.60,
    'RW',
    NULL,
    ARRAY['Positioning', 'Pace', 'Physical']::text[],
    ARRAY[]::text[],
    'From Reddit screenshot: user packed 117 Ronaldo and used him as winger; called him fantastic with elite positioning, almost non-existent weak-foot issues, monster-level pace, and strong physicality.',
    NULL,
    NULL,
    '2026-02-21T01:50:00.000Z',
    'user',
    'approved'
  ),
  (
    'Ruud Gullit',
    117,
    'CM',
    'Icon',
    9.30,
    'CM',
    NULL,
    ARRAY['Physical', 'Positioning', 'Passing']::text[],
    ARRAY[]::text[],
    'From Reddit screenshot (PotentialBee5701): reviewer said Gullit is everywhere, extremely hard to dribble past, behaves like a moving wall, and makes smart transition runs to score. Called him an excellent card.',
    'PotentialBee5701',
    'reddit',
    '2026-02-21T01:50:00.000Z',
    'user',
    'approved'
  ),
  (
    'Cristiano Ronaldo',
    117,
    'ST',
    'TOTY',
    9.70,
    'ST',
    NULL,
    ARRAY['Finishing', 'Pace', 'Physical']::text[],
    ARRAY[]::text[],
    'From Reddit screenshot (PotentialBee5701): described CR7 as having lethal elastico, scoring from nearly anywhere, and being insanely fast and strong.',
    'PotentialBee5701',
    'reddit',
    '2026-02-21T01:50:00.000Z',
    'user',
    'approved'
  ),
  (
    'Ruud Gullit',
    117,
    'CM',
    'Icon',
    8.80,
    'CDM',
    NULL,
    ARRAY['Defending', 'Passing', 'Positioning']::text[],
    ARRAY['Finishing']::text[],
    'From second Gullit screenshot: user advised not to play him at striker, but rated him highly in midfield/CDM for defending and crucial passes to attackers.',
    NULL,
    NULL,
    '2026-02-21T01:50:00.000Z',
    'user',
    'approved'
  ),
  (
    'Gabriel',
    115,
    'CB',
    'UTOTY',
    8.80,
    'CB',
    NULL,
    ARRAY['Positioning', 'Physical', 'Finishing']::text[],
    ARRAY[]::text[],
    'From Reddit screenshot: user said 115 Gabriel is great for them, consistently scores from corners, and defends solidly.',
    NULL,
    NULL,
    '2026-02-21T02:00:00.000Z',
    'user',
    'approved'
  ),
  (
    'Raul',
    115,
    'ST',
    'Glorious Eras',
    9.80,
    'ST',
    NULL,
    ARRAY['Pace', 'Dribbling', 'Finishing']::text[],
    ARRAY[]::text[],
    'From screenshot text: Signature Raul is described as one of the most OP strikers, effective across ST/LW/RW/CAM, extremely quick and agile, very sticky close control, and elite finishing. Reviewer highlighted overpowered long shots and unmatched curve shots with very high dependability.',
    NULL,
    NULL,
    '2026-02-21T02:10:00.000Z',
    'user',
    'approved'
  ),
  (
    'Yaya Toure',
    120,
    'CM',
    'Its In The Game',
    9.50,
    'CDM',
    NULL,
    ARRAY['Physical', 'Passing', 'Long Shots']::text[],
    ARRAY['Dribbling']::text[],
    'From user text: Yaya is a midfield tank and has been dominant alongside Gullit/Vieira. Outstanding at quickly engaging opponents and winning the ball, can run full 90 minutes, and has ST-like shooting. Reviewer plays him at CDM and rates him 9.5/10, with dribbling as the clear weakness.',
    NULL,
    NULL,
    '2026-02-21T02:20:00.000Z',
    'user',
    'approved'
  ),
  (
    'Gianluca Zambrotta',
    115,
    'RB',
    'Icon',
    9.80,
    'RB',
    NULL,
    ARRAY['Positioning', 'Physical', 'Pace']::text[],
    ARRAY['Workrate']::text[],
    'From user text: 115 Zambrotta is described as top-tier defensively, strong at both LB and RB, and reliable in stopping wingers. Main drawback mentioned is occasional forward rushing/position loss due to high-high work rate. Overall rated 9.8/10.',
    NULL,
    NULL,
    '2026-02-21T02:30:00.000Z',
    'user',
    'approved'
  ),
  (
    'Patrick Vieira',
    115,
    'CDM',
    'Anniversary',
    10.00,
    'CDM',
    NULL,
    ARRAY['Physical', 'Dribbling', 'Finishing']::text[],
    ARRAY['Workrate']::text[],
    'From user text: 115 Vieira is the reviewer''s all-time favorite and still irreplaceable in H2H. Described as everything strong about Yaya with added quality, including usable dribbling for a midfielder, elite CDM presence, fast forward surges, and strong heading/corner finishing. Rated 11/10 by reviewer.',
    NULL,
    NULL,
    '2026-02-21T02:40:00.000Z',
    'user',
    'approved'
  ),
  (
    'Lilian Thuram',
    113,
    'RB',
    'Icon',
    9.90,
    'RB',
    NULL,
    ARRAY['Pace', 'Positioning', 'Physical']::text[],
    ARRAY[]::text[],
    'From user text: 113 Thuram is called the best RB for the reviewer, similar impact to Zambrotta with superior recovery runs back to RB even after moving high. Very quick, matches pace of top attackers like Vini/Mbappe, and rarely gets beaten unless facing an elite dribbler. Rated 9.9/10.',
    NULL,
    NULL,
    '2026-02-21T02:45:00.000Z',
    'user',
    'approved'
  ),
  (
    'Ruud Gullit',
    113,
    'CM',
    'Icon',
    9.80,
    'CM',
    NULL,
    ARRAY['Finishing', 'Defending', 'Dribbling']::text[],
    ARRAY[]::text[],
    'From user text: 113 Gullit described as naturally overpowered regardless of stats, elite at shooting, heading, defending, and dribbling, with constant all-pitch presence around the ball.',
    NULL,
    NULL,
    '2026-02-21T02:45:00.000Z',
    'user',
    'approved'
  );

-- Ensure card rows exist and are active.
insert into public.players (
  player_name,
  base_ovr,
  base_position,
  program_promo,
  is_active
)
select distinct
  r.player_name,
  r.base_ovr,
  upper(r.base_position),
  r.program_promo,
  true
from tmp_legacy_reviews r
where not exists (
  select 1
  from public.players p
  where lower(p.player_name) = lower(r.player_name)
    and p.base_ovr = r.base_ovr
    and upper(p.base_position) = upper(r.base_position)
    and lower(p.program_promo) = lower(r.program_promo)
);

update public.players p
set
  is_active = true,
  updated_at = now()
from (
  select distinct player_name, base_ovr, base_position, program_promo
  from tmp_legacy_reviews
) r
where lower(p.player_name) = lower(r.player_name)
  and p.base_ovr = r.base_ovr
  and upper(p.base_position) = upper(r.base_position)
  and lower(p.program_promo) = lower(r.program_promo);

-- Insert approved user reviews if note not already present for the same card.
insert into public.user_review_submissions (
  player_id,
  source_platform,
  submission_fingerprint,
  submitted_from_ip,
  user_agent,
  submitted_username,
  submitted_username_type,
  sentiment_score,
  played_position,
  mentioned_rank_text,
  pros,
  cons,
  note,
  status,
  submitted_at,
  moderated_at,
  moderation_reason
)
select
  p.id,
  r.source_platform,
  'legacy-seed-' || md5(
    concat_ws('|', lower(r.player_name), r.base_ovr::text, upper(r.base_position), lower(r.program_promo), coalesce(r.note, ''), r.submitted_at::text)
  ),
  null,
  'legacy-reddit-seed',
  nullif(btrim(r.submitted_username), ''),
  case
    when nullif(btrim(r.submitted_username), '') is null then null
    else nullif(lower(btrim(r.submitted_username_type)), '')
  end,
  r.sentiment_score,
  upper(r.played_position),
  r.mentioned_rank_text,
  r.pros,
  r.cons,
  r.note,
  'approved',
  r.submitted_at,
  now(),
  'Pilot legacy import from local seed data'
from tmp_legacy_reviews r
join public.players p
  on lower(p.player_name) = lower(r.player_name)
 and p.base_ovr = r.base_ovr
 and upper(p.base_position) = upper(r.base_position)
 and lower(p.program_promo) = lower(r.program_promo)
where not exists (
  select 1
  from public.user_review_submissions urs
  where urs.player_id = p.id
    and coalesce(urs.note, '') = coalesce(r.note, '')
);

select public.refresh_player_sentiment_summary();

-- Quick verification
select status, count(*)
from public.user_review_submissions
group by status
order by status;

select
  player_name,
  base_ovr,
  base_position,
  program_promo,
  mention_count,
  avg_sentiment_score
from public.mv_player_sentiment_summary
where mention_count > 0 or avg_sentiment_score is not null
order by mention_count desc, avg_sentiment_score desc nulls last, player_name asc;

commit;
