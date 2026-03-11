create table if not exists public.admin_runtime_settings (
  key text primary key,
  value_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.admin_runtime_settings enable row level security;

drop policy if exists "service role manages admin runtime settings" on public.admin_runtime_settings;
create policy "service role manages admin runtime settings"
on public.admin_runtime_settings
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop trigger if exists set_admin_runtime_settings_updated_at on public.admin_runtime_settings;
create trigger set_admin_runtime_settings_updated_at
before update on public.admin_runtime_settings
for each row execute function public.set_updated_at();

insert into public.admin_runtime_settings (key, value_json)
values (
  'reddit_imports',
  jsonb_build_object(
    'currentMaxBaseOvr', 117,
    'maxRankOvrBoost', 5
  )
)
on conflict (key) do nothing;
