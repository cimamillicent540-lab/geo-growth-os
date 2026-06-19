-- Adds per-run execution steps for GEO worker observability.

create table if not exists public.geo_run_steps (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  run_id uuid not null references public.geo_runs(id) on delete cascade,
  query_id uuid references public.geo_queries(id) on delete set null,
  step_type text not null,
  status text not null default 'completed' check (status in ('pending','running','completed','failed','skipped')),
  title text not null,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_geo_run_steps_agency on public.geo_run_steps(agency_id);
create index if not exists idx_geo_run_steps_run on public.geo_run_steps(run_id, created_at);
create index if not exists idx_geo_run_steps_client on public.geo_run_steps(client_id);
create index if not exists idx_geo_run_steps_query on public.geo_run_steps(query_id);

grant select, insert, update, delete on table public.geo_run_steps to authenticated;

alter table public.geo_run_steps enable row level security;

drop policy if exists agency_rw_geo_run_steps on public.geo_run_steps;
create policy agency_rw_geo_run_steps on public.geo_run_steps
for all to authenticated
using (agency_id in (select app_private.current_agency_ids()))
with check (agency_id in (select app_private.current_agency_ids()));
