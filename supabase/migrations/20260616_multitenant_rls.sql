-- GEO Growth OS phase 1: agency tenancy, portal access, progress fields, hard-isolation RLS.

create table if not exists public.agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  created_at timestamptz not null default now()
);

create table if not exists public.agency_members (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  unique (agency_id, user_id)
);

create table if not exists public.client_portal_members (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (client_id, user_id)
);

alter table public.clients add column if not exists agency_id uuid references public.agencies(id) on delete cascade;
alter table public.geo_queries add column if not exists agency_id uuid references public.agencies(id) on delete cascade;
alter table public.geo_runs add column if not exists agency_id uuid references public.agencies(id) on delete cascade;
alter table public.geo_answers add column if not exists agency_id uuid references public.agencies(id) on delete cascade;
alter table public.geo_insights add column if not exists agency_id uuid references public.agencies(id) on delete cascade;
alter table public.content_tasks add column if not exists agency_id uuid references public.agencies(id) on delete cascade;

alter table public.geo_runs add column if not exists total_queries integer not null default 0;
alter table public.geo_runs add column if not exists processed_queries integer not null default 0;

insert into public.agencies (name, slug)
values ('Default Agency', 'default')
on conflict (slug) do nothing;

update public.clients
set agency_id = (select id from public.agencies where slug = 'default')
where agency_id is null;

update public.geo_queries q
set agency_id = c.agency_id
from public.clients c
where q.client_id = c.id and q.agency_id is null;

update public.geo_runs r
set agency_id = c.agency_id
from public.clients c
where r.client_id = c.id and r.agency_id is null;

update public.geo_answers a
set agency_id = c.agency_id
from public.clients c
where a.client_id = c.id and a.agency_id is null;

update public.geo_insights i
set agency_id = c.agency_id
from public.clients c
where i.client_id = c.id and i.agency_id is null;

update public.content_tasks t
set agency_id = c.agency_id
from public.clients c
where t.client_id = c.id and t.agency_id is null;

alter table public.clients alter column agency_id set not null;
alter table public.geo_queries alter column agency_id set not null;
alter table public.geo_runs alter column agency_id set not null;
alter table public.geo_answers alter column agency_id set not null;
alter table public.geo_insights alter column agency_id set not null;
alter table public.content_tasks alter column agency_id set not null;

create index if not exists idx_clients_agency on public.clients(agency_id);
create index if not exists idx_geo_queries_agency on public.geo_queries(agency_id);
create index if not exists idx_geo_runs_agency on public.geo_runs(agency_id);
create index if not exists idx_geo_answers_agency on public.geo_answers(agency_id);
create index if not exists idx_geo_insights_agency on public.geo_insights(agency_id);
create index if not exists idx_content_tasks_agency on public.content_tasks(agency_id);
create index if not exists idx_agency_members_user on public.agency_members(user_id);
create index if not exists idx_agency_members_agency on public.agency_members(agency_id);
create index if not exists idx_portal_members_user on public.client_portal_members(user_id);
create index if not exists idx_portal_members_client on public.client_portal_members(client_id);

create schema if not exists app_private;

create or replace function app_private.current_agency_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select agency_id from public.agency_members where user_id = auth.uid();
$$;

create or replace function app_private.current_portal_client_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select client_id from public.client_portal_members where user_id = auth.uid();
$$;

grant usage on schema public to authenticated;
grant usage on schema app_private to authenticated;
grant select, insert, update, delete on table public.agencies to authenticated;
grant select, insert, update, delete on table public.agency_members to authenticated;
grant select, insert, update, delete on table public.client_portal_members to authenticated;
grant execute on function app_private.current_agency_ids() to authenticated;
grant execute on function app_private.current_portal_client_ids() to authenticated;

alter table public.agencies enable row level security;
alter table public.agency_members enable row level security;
alter table public.client_portal_members enable row level security;
alter table public.clients enable row level security;
alter table public.user_profiles enable row level security;
alter table public.geo_queries enable row level security;
alter table public.geo_runs enable row level security;
alter table public.geo_answers enable row level security;
alter table public.geo_insights enable row level security;
alter table public.content_tasks enable row level security;

drop policy if exists clients_select on public.clients;
drop policy if exists clients_insert on public.clients;
drop policy if exists clients_update on public.clients;
drop policy if exists clients_delete on public.clients;
drop policy if exists profiles_select on public.user_profiles;
drop policy if exists profiles_write_admin on public.user_profiles;
drop policy if exists geo_queries_select on public.geo_queries;
drop policy if exists geo_queries_write on public.geo_queries;
drop policy if exists geo_runs_select on public.geo_runs;
drop policy if exists geo_runs_write on public.geo_runs;
drop policy if exists geo_answers_select on public.geo_answers;
drop policy if exists geo_answers_write on public.geo_answers;
drop policy if exists geo_insights_select on public.geo_insights;
drop policy if exists geo_insights_write on public.geo_insights;
drop policy if exists content_tasks_select on public.content_tasks;
drop policy if exists content_tasks_write on public.content_tasks;

drop policy if exists agency_self_read on public.agencies;
create policy agency_self_read on public.agencies
for select to authenticated
using (id in (select app_private.current_agency_ids()));

drop policy if exists agency_members_self_read on public.agency_members;
create policy agency_members_self_read on public.agency_members
for select to authenticated
using (user_id = auth.uid() or agency_id in (select app_private.current_agency_ids()));

drop policy if exists portal_members_self_read on public.client_portal_members;
create policy portal_members_self_read on public.client_portal_members
for select to authenticated
using (user_id = auth.uid() or client_id in (select app_private.current_portal_client_ids()));

drop policy if exists profiles_self_read on public.user_profiles;
create policy profiles_self_read on public.user_profiles
for select to authenticated
using (user_id = auth.uid());

drop policy if exists agency_rw_clients on public.clients;
create policy agency_rw_clients on public.clients
for all to authenticated
using (agency_id in (select app_private.current_agency_ids()))
with check (agency_id in (select app_private.current_agency_ids()));

drop policy if exists portal_read_clients on public.clients;
create policy portal_read_clients on public.clients
for select to authenticated
using (id in (select app_private.current_portal_client_ids()));

drop policy if exists agency_rw_geo_queries on public.geo_queries;
create policy agency_rw_geo_queries on public.geo_queries
for all to authenticated
using (agency_id in (select app_private.current_agency_ids()))
with check (agency_id in (select app_private.current_agency_ids()));

drop policy if exists agency_rw_geo_runs on public.geo_runs;
create policy agency_rw_geo_runs on public.geo_runs
for all to authenticated
using (agency_id in (select app_private.current_agency_ids()))
with check (agency_id in (select app_private.current_agency_ids()));

drop policy if exists agency_rw_geo_answers on public.geo_answers;
create policy agency_rw_geo_answers on public.geo_answers
for all to authenticated
using (agency_id in (select app_private.current_agency_ids()))
with check (agency_id in (select app_private.current_agency_ids()));

drop policy if exists agency_rw_geo_insights on public.geo_insights;
create policy agency_rw_geo_insights on public.geo_insights
for all to authenticated
using (agency_id in (select app_private.current_agency_ids()))
with check (agency_id in (select app_private.current_agency_ids()));

drop policy if exists agency_rw_content_tasks on public.content_tasks;
create policy agency_rw_content_tasks on public.content_tasks
for all to authenticated
using (agency_id in (select app_private.current_agency_ids()))
with check (agency_id in (select app_private.current_agency_ids()));

drop policy if exists portal_read_runs on public.geo_runs;
create policy portal_read_runs on public.geo_runs
for select to authenticated
using (client_id in (select app_private.current_portal_client_ids()));

drop policy if exists portal_read_insights on public.geo_insights;
create policy portal_read_insights on public.geo_insights
for select to authenticated
using (client_id in (select app_private.current_portal_client_ids()));

drop policy if exists portal_read_answers on public.geo_answers;
create policy portal_read_answers on public.geo_answers
for select to authenticated
using (client_id in (select app_private.current_portal_client_ids()));

drop policy if exists portal_read_content_tasks on public.content_tasks;
create policy portal_read_content_tasks on public.content_tasks
for select to authenticated
using (client_id in (select app_private.current_portal_client_ids()));
