-- FC Mobile Opinion Tracker: Squad Performance module
-- Supabase-ready schema, indexes, triggers, and RLS policies.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- Shared trigger to keep updated_at columns current.
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ============================================================
-- Rank normalization helpers.
-- Supports rank search input by both tier number and color.
-- 1=Base, 2=Blue, 3=Purple, 4=Red, 5=Gold
-- ============================================================
CREATE OR REPLACE FUNCTION public.normalize_rank(rank_value TEXT)
RETURNS SMALLINT
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE
    WHEN rank_value IS NULL THEN NULL
    WHEN lower(btrim(rank_value)) IN ('1', 'base', 'white') THEN 1
    WHEN lower(btrim(rank_value)) IN ('2', 'blue') THEN 2
    WHEN lower(btrim(rank_value)) IN ('3', 'purple') THEN 3
    WHEN lower(btrim(rank_value)) IN ('4', 'red') THEN 4
    WHEN lower(btrim(rank_value)) IN ('5', 'gold') THEN 5
    ELSE NULL
  END::SMALLINT;
$$;

CREATE OR REPLACE FUNCTION public.rank_tier_label(rank_tier SMALLINT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE rank_tier
    WHEN 1 THEN 'Base'
    WHEN 2 THEN 'Blue'
    WHEN 3 THEN 'Purple'
    WHEN 4 THEN 'Red'
    WHEN 5 THEN 'Gold'
    ELSE NULL
  END;
$$;

-- ============================================================
-- USERS / PROFILE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- PLAYER CARDS (Inventory)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.player_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  player_name TEXT NOT NULL,
  card_version TEXT,

  base_position TEXT NOT NULL,

  base_ovr SMALLINT NOT NULL CHECK (base_ovr BETWEEN 1 AND 99),
  current_ovr SMALLINT NOT NULL CHECK (current_ovr BETWEEN 1 AND 99),
  training_level SMALLINT NOT NULL DEFAULT 0 CHECK (training_level >= 0),
  rank TEXT NOT NULL DEFAULT 'Base',
  rank_tier SMALLINT GENERATED ALWAYS AS (public.normalize_rank(rank)) STORED,
  rank_label TEXT GENERATED ALWAYS AS (
    public.rank_tier_label(public.normalize_rank(rank))
  ) STORED,

  acquisition_cost BIGINT,
  acquisition_date DATE,
  acquisition_method TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT player_cards_rank_valid CHECK (public.normalize_rank(rank) IS NOT NULL)
);

-- ============================================================
-- TACTICAL SETUPS (Reusable templates)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tactical_setups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  formation TEXT NOT NULL,
  tactical_style TEXT,
  notes TEXT,

  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- LINEUPS (Match-specific lineup instance)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.lineups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tactical_setup_id UUID REFERENCES public.tactical_setups(id) ON DELETE SET NULL,

  name TEXT,
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- MATCH LOGS (One row per game)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.match_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  lineup_id UUID UNIQUE REFERENCES public.lineups(id) ON DELETE SET NULL,

  played_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  match_type TEXT NOT NULL,

  goals_scored SMALLINT NOT NULL DEFAULT 0 CHECK (goals_scored >= 0),
  goals_conceded SMALLINT NOT NULL DEFAULT 0 CHECK (goals_conceded >= 0),
  result TEXT GENERATED ALWAYS AS (
    CASE
      WHEN goals_scored > goals_conceded THEN 'W'
      WHEN goals_scored < goals_conceded THEN 'L'
      ELSE 'D'
    END
  ) STORED,

  squad_feel_rating SMALLINT CHECK (squad_feel_rating BETWEEN 1 AND 10),
  fluidity_rating SMALLINT CHECK (fluidity_rating BETWEEN 1 AND 10),

  ping_ms SMALLINT CHECK (ping_ms > 0),
  connection_quality TEXT CHECK (connection_quality IN ('Excellent', 'Good', 'Fair', 'Poor')),

  opponent_ovr_est SMALLINT CHECK (opponent_ovr_est BETWEEN 1 AND 99),

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- LINEUP SLOTS (Bridge table)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.lineup_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lineup_id UUID NOT NULL REFERENCES public.lineups(id) ON DELETE CASCADE,
  player_card_id UUID NOT NULL REFERENCES public.player_cards(id) ON DELETE RESTRICT,

  played_position TEXT NOT NULL,
  base_position_snapshot TEXT NOT NULL,

  is_out_of_position BOOLEAN GENERATED ALWAYS AS (
    played_position <> base_position_snapshot
  ) STORED,

  is_starter BOOLEAN NOT NULL DEFAULT TRUE,
  ovr_snapshot SMALLINT NOT NULL CHECK (ovr_snapshot BETWEEN 1 AND 99),

  UNIQUE (lineup_id, player_card_id)
);

-- ============================================================
-- PLAYER MATCH STATS (1:1 with lineup slot)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.player_match_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lineup_slot_id UUID NOT NULL UNIQUE REFERENCES public.lineup_slots(id) ON DELETE CASCADE,

  goals SMALLINT NOT NULL DEFAULT 0 CHECK (goals >= 0),
  assists SMALLINT NOT NULL DEFAULT 0 CHECK (assists >= 0),
  key_passes SMALLINT CHECK (key_passes >= 0),
  shots_on_target SMALLINT CHECK (shots_on_target >= 0),

  player_feel_rating SMALLINT CHECK (player_feel_rating BETWEEN 1 AND 10),
  performance_notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Ownership integrity checks across linked entities.
-- ============================================================
CREATE OR REPLACE FUNCTION public.ensure_match_log_lineup_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  lineup_owner UUID;
BEGIN
  IF NEW.lineup_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT l.user_id INTO lineup_owner
  FROM public.lineups l
  WHERE l.id = NEW.lineup_id;

  IF lineup_owner IS NULL THEN
    RETURN NEW;
  END IF;

  IF lineup_owner <> NEW.user_id THEN
    RAISE EXCEPTION 'lineup_id % belongs to another user', NEW.lineup_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_match_logs_validate_owner
BEFORE INSERT OR UPDATE OF user_id, lineup_id
ON public.match_logs
FOR EACH ROW
EXECUTE FUNCTION public.ensure_match_log_lineup_owner();

CREATE OR REPLACE FUNCTION public.ensure_lineup_slot_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  lineup_owner UUID;
  card_owner UUID;
BEGIN
  SELECT l.user_id INTO lineup_owner
  FROM public.lineups l
  WHERE l.id = NEW.lineup_id;

  SELECT pc.user_id INTO card_owner
  FROM public.player_cards pc
  WHERE pc.id = NEW.player_card_id;

  IF lineup_owner IS NULL OR card_owner IS NULL THEN
    RETURN NEW;
  END IF;

  IF lineup_owner <> card_owner THEN
    RAISE EXCEPTION 'lineup_id % and player_card_id % are owned by different users',
      NEW.lineup_id,
      NEW.player_card_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_lineup_slots_validate_owner
BEFORE INSERT OR UPDATE OF lineup_id, player_card_id
ON public.lineup_slots
FOR EACH ROW
EXECUTE FUNCTION public.ensure_lineup_slot_owner();

-- ============================================================
-- updated_at triggers
-- ============================================================
CREATE TRIGGER trg_player_cards_set_updated_at
BEFORE UPDATE ON public.player_cards
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_tactical_setups_set_updated_at
BEFORE UPDATE ON public.tactical_setups
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_lineups_set_updated_at
BEFORE UPDATE ON public.lineups
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- Query optimization indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_lineup_slots_card_oop
  ON public.lineup_slots (player_card_id, is_out_of_position);

CREATE INDEX IF NOT EXISTS idx_lineup_slots_lineup
  ON public.lineup_slots (lineup_id);

CREATE INDEX IF NOT EXISTS idx_match_logs_user_type_date
  ON public.match_logs (user_id, match_type, played_at DESC);

CREATE INDEX IF NOT EXISTS idx_player_match_stats_slot
  ON public.player_match_stats (lineup_slot_id);

CREATE INDEX IF NOT EXISTS idx_player_cards_user_position
  ON public.player_cards (user_id, base_position);

CREATE INDEX IF NOT EXISTS idx_player_cards_user_name_rank_lookup
  ON public.player_cards (user_id, lower(player_name), rank_tier);

CREATE INDEX IF NOT EXISTS idx_lineups_user_created
  ON public.lineups (user_id, created_at DESC);

-- ============================================================
-- Row Level Security (Supabase)
-- ============================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tactical_setups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lineups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lineup_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_match_stats ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "profiles_select_own"
ON public.profiles
FOR SELECT
USING (id = auth.uid());

CREATE POLICY "profiles_insert_own"
ON public.profiles
FOR INSERT
WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_update_own"
ON public.profiles
FOR UPDATE
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_delete_own"
ON public.profiles
FOR DELETE
USING (id = auth.uid());

-- player_cards
CREATE POLICY "player_cards_select_own"
ON public.player_cards
FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "player_cards_insert_own"
ON public.player_cards
FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "player_cards_update_own"
ON public.player_cards
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "player_cards_delete_own"
ON public.player_cards
FOR DELETE
USING (user_id = auth.uid());

-- tactical_setups
CREATE POLICY "tactical_setups_select_own"
ON public.tactical_setups
FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "tactical_setups_insert_own"
ON public.tactical_setups
FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "tactical_setups_update_own"
ON public.tactical_setups
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "tactical_setups_delete_own"
ON public.tactical_setups
FOR DELETE
USING (user_id = auth.uid());

-- lineups
CREATE POLICY "lineups_select_own"
ON public.lineups
FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "lineups_insert_own"
ON public.lineups
FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "lineups_update_own"
ON public.lineups
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "lineups_delete_own"
ON public.lineups
FOR DELETE
USING (user_id = auth.uid());

-- match_logs
CREATE POLICY "match_logs_select_own"
ON public.match_logs
FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "match_logs_insert_own"
ON public.match_logs
FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "match_logs_update_own"
ON public.match_logs
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "match_logs_delete_own"
ON public.match_logs
FOR DELETE
USING (user_id = auth.uid());

-- lineup_slots
CREATE POLICY "lineup_slots_select_own"
ON public.lineup_slots
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.lineups l
    WHERE l.id = lineup_slots.lineup_id
      AND l.user_id = auth.uid()
  )
);

CREATE POLICY "lineup_slots_insert_own"
ON public.lineup_slots
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.lineups l
    WHERE l.id = lineup_slots.lineup_id
      AND l.user_id = auth.uid()
  )
  AND EXISTS (
    SELECT 1
    FROM public.player_cards pc
    WHERE pc.id = lineup_slots.player_card_id
      AND pc.user_id = auth.uid()
  )
);

CREATE POLICY "lineup_slots_update_own"
ON public.lineup_slots
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.lineups l
    WHERE l.id = lineup_slots.lineup_id
      AND l.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.lineups l
    WHERE l.id = lineup_slots.lineup_id
      AND l.user_id = auth.uid()
  )
  AND EXISTS (
    SELECT 1
    FROM public.player_cards pc
    WHERE pc.id = lineup_slots.player_card_id
      AND pc.user_id = auth.uid()
  )
);

CREATE POLICY "lineup_slots_delete_own"
ON public.lineup_slots
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM public.lineups l
    WHERE l.id = lineup_slots.lineup_id
      AND l.user_id = auth.uid()
  )
);

-- player_match_stats
CREATE POLICY "player_match_stats_select_own"
ON public.player_match_stats
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.lineup_slots ls
    JOIN public.lineups l ON l.id = ls.lineup_id
    WHERE ls.id = player_match_stats.lineup_slot_id
      AND l.user_id = auth.uid()
  )
);

CREATE POLICY "player_match_stats_insert_own"
ON public.player_match_stats
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.lineup_slots ls
    JOIN public.lineups l ON l.id = ls.lineup_id
    WHERE ls.id = player_match_stats.lineup_slot_id
      AND l.user_id = auth.uid()
  )
);

CREATE POLICY "player_match_stats_update_own"
ON public.player_match_stats
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.lineup_slots ls
    JOIN public.lineups l ON l.id = ls.lineup_id
    WHERE ls.id = player_match_stats.lineup_slot_id
      AND l.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.lineup_slots ls
    JOIN public.lineups l ON l.id = ls.lineup_id
    WHERE ls.id = player_match_stats.lineup_slot_id
      AND l.user_id = auth.uid()
  )
);

CREATE POLICY "player_match_stats_delete_own"
ON public.player_match_stats
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM public.lineup_slots ls
    JOIN public.lineups l ON l.id = ls.lineup_id
    WHERE ls.id = player_match_stats.lineup_slot_id
      AND l.user_id = auth.uid()
  )
);
