create extension if not exists pgcrypto;

create or replace function public.set_row_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  canonical_slug text not null unique,
  primary_position text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.card_versions (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id) on delete cascade,
  dedupe_key text not null unique,
  canonical_player_name text not null,
  version_name text not null,
  version_slug text not null,
  event_name text,
  ovr integer,
  primary_position_snapshot text,
  alt_positions text[] not null default '{}',
  image_url text,
  source_name text not null,
  source_url text not null,
  source_external_id text,
  source_content_hash text not null,
  published_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.card_stats (
  id uuid primary key default gen_random_uuid(),
  card_version_id uuid not null unique references public.card_versions(id) on delete cascade,
  stat_block jsonb not null default '{}'::jsonb,
  source_name text not null,
  source_url text not null,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  card_version_id uuid references public.card_versions(id) on delete set null,
  source_name text not null,
  source_url text not null,
  source_external_id text,
  review_kind text not null check (review_kind in ('editorial', 'community')),
  title text not null,
  body text not null,
  author_name text,
  rating numeric(4,2),
  content_hash text not null unique,
  published_at timestamptz,
  resolution_status text not null default 'unresolved' check (resolution_status in ('matched', 'alias-match', 'fuzzy-match', 'unresolved')),
  resolution_confidence numeric(5,4) not null default 0,
  resolution_metadata jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.review_points (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  point_type text not null check (point_type in ('pro', 'con', 'neutral')),
  point_text text not null,
  point_text_normalized text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (review_id, point_type, point_text_normalized)
);

create table if not exists public.community_mentions (
  id uuid primary key default gen_random_uuid(),
  card_version_id uuid references public.card_versions(id) on delete set null,
  source_platform text not null,
  source_community text,
  source_url text not null,
  source_external_id text,
  title text,
  body text not null,
  author_name text,
  sentiment_score numeric(4,2),
  content_hash text not null unique,
  published_at timestamptz,
  resolution_status text not null default 'unresolved' check (resolution_status in ('matched', 'alias-match', 'fuzzy-match', 'unresolved')),
  resolution_confidence numeric(5,4) not null default 0,
  resolution_metadata jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.price_snapshots (
  id uuid primary key default gen_random_uuid(),
  card_version_id uuid not null references public.card_versions(id) on delete cascade,
  source_name text not null,
  source_url text,
  price_amount bigint not null,
  currency_code text not null default 'coins',
  observed_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (card_version_id, source_name, observed_at)
);

create table if not exists public.source_pages (
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  page_type text not null check (page_type in ('card', 'review', 'community')),
  url text not null,
  url_hash text not null unique,
  source_external_id text,
  last_discovered_at timestamptz,
  last_fetched_at timestamptz,
  last_http_status integer,
  last_content_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.scrape_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  adapter_name text not null,
  page_type text not null check (page_type in ('card', 'review', 'community')),
  status text not null check (status in ('running', 'completed', 'partial', 'failed')),
  started_at timestamptz not null,
  completed_at timestamptz,
  discovered_count integer not null default 0,
  fetched_count integer not null default 0,
  parsed_count integer not null default 0,
  upserted_count integer not null default 0,
  failed_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.scrape_failures (
  id uuid primary key default gen_random_uuid(),
  scrape_run_id uuid not null references public.scrape_runs(id) on delete cascade,
  source_page_id uuid references public.source_pages(id) on delete set null,
  adapter_name text not null,
  page_type text not null check (page_type in ('card', 'review', 'community')),
  stage text not null,
  error_class text not null,
  error_message text not null,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.entity_aliases (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('card', 'card_version', 'player')),
  entity_id uuid not null,
  alias_display text not null,
  alias_normalized text not null,
  confidence numeric(5,4) not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_type, entity_id, alias_normalized)
);

drop trigger if exists cards_set_updated_at on public.cards;
create trigger cards_set_updated_at
before update on public.cards
for each row
execute function public.set_row_updated_at();

drop trigger if exists card_versions_set_updated_at on public.card_versions;
create trigger card_versions_set_updated_at
before update on public.card_versions
for each row
execute function public.set_row_updated_at();

drop trigger if exists card_stats_set_updated_at on public.card_stats;
create trigger card_stats_set_updated_at
before update on public.card_stats
for each row
execute function public.set_row_updated_at();

drop trigger if exists reviews_set_updated_at on public.reviews;
create trigger reviews_set_updated_at
before update on public.reviews
for each row
execute function public.set_row_updated_at();

drop trigger if exists community_mentions_set_updated_at on public.community_mentions;
create trigger community_mentions_set_updated_at
before update on public.community_mentions
for each row
execute function public.set_row_updated_at();

drop trigger if exists source_pages_set_updated_at on public.source_pages;
create trigger source_pages_set_updated_at
before update on public.source_pages
for each row
execute function public.set_row_updated_at();

drop trigger if exists scrape_runs_set_updated_at on public.scrape_runs;
create trigger scrape_runs_set_updated_at
before update on public.scrape_runs
for each row
execute function public.set_row_updated_at();

drop trigger if exists entity_aliases_set_updated_at on public.entity_aliases;
create trigger entity_aliases_set_updated_at
before update on public.entity_aliases
for each row
execute function public.set_row_updated_at();

alter table public.cards enable row level security;
alter table public.card_versions enable row level security;
alter table public.card_stats enable row level security;
alter table public.reviews enable row level security;
alter table public.review_points enable row level security;
alter table public.community_mentions enable row level security;
alter table public.price_snapshots enable row level security;
alter table public.source_pages enable row level security;
alter table public.scrape_runs enable row level security;
alter table public.scrape_failures enable row level security;
alter table public.entity_aliases enable row level security;
