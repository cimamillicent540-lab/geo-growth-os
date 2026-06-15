create extension if not exists "pgcrypto";

create schema if not exists app_private;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  website text not null,
  industry text not null,
  target_country text not null,
  target_language text not null,
  description text,
  main_products text,
  competitors text[] not null default '{}',
  compliance_notes text,
  owner_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'client' check (role in ('admin','strategist','client')),
  client_id uuid references public.clients(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.geo_queries (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  query_text text not null,
  language text not null,
  country text not null,
  intent_type text not null check (intent_type in ('brand','category','competitor','trust','conversion','comparison')),
  funnel_stage text not null default 'consideration',
  priority integer not null default 3 check (priority between 1 and 5),
  created_at timestamptz not null default now()
);

create table if not exists public.geo_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  run_name text not null,
  status text not null default 'pending' check (status in ('pending','running','completed','failed')),
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  error_message text,
  share_token text not null default encode(gen_random_bytes(24), 'hex') unique,
  created_at timestamptz not null default now()
);

create table if not exists public.geo_answers (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.geo_runs(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  query_id uuid references public.geo_queries(id) on delete set null,
  model_provider text not null,
  model_name text not null,
  answer_text text not null,
  brand_mentioned boolean not null default false,
  brand_position integer,
  competitors_mentioned text[] not null default '{}',
  sentiment text not null default 'neutral' check (sentiment in ('positive','neutral','negative','mixed')),
  recommendation_status text not null default 'not_mentioned' check (recommendation_status in ('recommended','mentioned_only','not_mentioned','competitor_recommended')),
  citations jsonb not null default '[]'::jsonb,
  content_gap text,
  risk_notes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.geo_insights (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  run_id uuid not null unique references public.geo_runs(id) on delete cascade,
  visibility_score numeric not null default 0,
  mention_rate numeric not null default 0,
  recommendation_rate numeric not null default 0,
  competitor_summary jsonb not null default '[]'::jsonb,
  sentiment_summary jsonb not null default '{}'::jsonb,
  content_gaps jsonb not null default '[]'::jsonb,
  action_plan jsonb not null default '[]'::jsonb,
  risk_notes jsonb not null default '[]'::jsonb,
  executive_summary text,
  created_at timestamptz not null default now()
);

create table if not exists public.content_tasks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  run_id uuid references public.geo_runs(id) on delete set null,
  title text not null,
  content_type text not null check (content_type in ('faq','comparison_page','blog','landing_page','third_party_review','reddit_quora_answer','ad_creative_angle')),
  target_query text,
  priority integer not null default 3 check (priority between 1 and 5),
  status text not null default 'todo' check (status in ('todo','in_progress','done','skipped')),
  assigned_to text,
  brief text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at
before update on public.clients
for each row execute function public.set_updated_at();

drop trigger if exists content_tasks_set_updated_at on public.content_tasks;
create trigger content_tasks_set_updated_at
before update on public.content_tasks
for each row execute function public.set_updated_at();

create or replace function app_private.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.user_profiles where user_id = auth.uid() limit 1;
$$;

create or replace function app_private.current_profile_client_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select client_id from public.user_profiles where user_id = auth.uid() limit 1;
$$;

create or replace function app_private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(app_private.current_profile_role() = 'admin', false);
$$;

create or replace function app_private.is_operator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(app_private.current_profile_role() in ('admin','strategist'), false);
$$;

grant usage on schema app_private to authenticated;
grant execute on all functions in schema app_private to authenticated;

alter table public.clients enable row level security;
alter table public.user_profiles enable row level security;
alter table public.geo_queries enable row level security;
alter table public.geo_runs enable row level security;
alter table public.geo_answers enable row level security;
alter table public.geo_insights enable row level security;
alter table public.content_tasks enable row level security;

grant select, insert, update, delete on table public.clients to authenticated;
grant select, insert, update, delete on table public.user_profiles to authenticated;
grant select, insert, update, delete on table public.geo_queries to authenticated;
grant select, insert, update, delete on table public.geo_runs to authenticated;
grant select, insert, update, delete on table public.geo_answers to authenticated;
grant select, insert, update, delete on table public.geo_insights to authenticated;
grant select, insert, update, delete on table public.content_tasks to authenticated;

drop policy if exists clients_select on public.clients;
create policy clients_select on public.clients
for select to authenticated
using (
  app_private.is_operator()
  or id = app_private.current_profile_client_id()
);

drop policy if exists clients_insert on public.clients;
create policy clients_insert on public.clients
for insert to authenticated
with check (app_private.is_admin());

drop policy if exists clients_update on public.clients;
create policy clients_update on public.clients
for update to authenticated
using (app_private.is_admin())
with check (app_private.is_admin());

drop policy if exists clients_delete on public.clients;
create policy clients_delete on public.clients
for delete to authenticated
using (app_private.is_admin());

drop policy if exists profiles_select on public.user_profiles;
create policy profiles_select on public.user_profiles
for select to authenticated
using (user_id = auth.uid() or app_private.is_admin());

drop policy if exists profiles_write_admin on public.user_profiles;
create policy profiles_write_admin on public.user_profiles
for all to authenticated
using (app_private.is_admin())
with check (app_private.is_admin());

drop policy if exists geo_queries_select on public.geo_queries;
create policy geo_queries_select on public.geo_queries
for select to authenticated
using (
  app_private.is_operator()
  or client_id = app_private.current_profile_client_id()
);

drop policy if exists geo_queries_write on public.geo_queries;
create policy geo_queries_write on public.geo_queries
for all to authenticated
using (app_private.is_operator())
with check (app_private.is_operator());

drop policy if exists geo_runs_select on public.geo_runs;
create policy geo_runs_select on public.geo_runs
for select to authenticated
using (
  app_private.is_operator()
  or client_id = app_private.current_profile_client_id()
);

drop policy if exists geo_runs_write on public.geo_runs;
create policy geo_runs_write on public.geo_runs
for all to authenticated
using (app_private.is_operator())
with check (app_private.is_operator());

drop policy if exists geo_answers_select on public.geo_answers;
create policy geo_answers_select on public.geo_answers
for select to authenticated
using (
  app_private.is_operator()
  or client_id = app_private.current_profile_client_id()
);

drop policy if exists geo_answers_write on public.geo_answers;
create policy geo_answers_write on public.geo_answers
for all to authenticated
using (app_private.is_operator())
with check (app_private.is_operator());

drop policy if exists geo_insights_select on public.geo_insights;
create policy geo_insights_select on public.geo_insights
for select to authenticated
using (
  app_private.is_operator()
  or client_id = app_private.current_profile_client_id()
);

drop policy if exists geo_insights_write on public.geo_insights;
create policy geo_insights_write on public.geo_insights
for all to authenticated
using (app_private.is_operator())
with check (app_private.is_operator());

drop policy if exists content_tasks_select on public.content_tasks;
create policy content_tasks_select on public.content_tasks
for select to authenticated
using (
  app_private.is_operator()
  or client_id = app_private.current_profile_client_id()
);

drop policy if exists content_tasks_write on public.content_tasks;
create policy content_tasks_write on public.content_tasks
for all to authenticated
using (app_private.is_operator())
with check (app_private.is_operator());

create index if not exists idx_clients_owner on public.clients(owner_user_id);
create index if not exists idx_profiles_user on public.user_profiles(user_id);
create index if not exists idx_profiles_client on public.user_profiles(client_id);
create index if not exists idx_geo_queries_client on public.geo_queries(client_id);
create index if not exists idx_geo_runs_client on public.geo_runs(client_id);
create index if not exists idx_geo_runs_share_token on public.geo_runs(share_token);
create index if not exists idx_geo_answers_run on public.geo_answers(run_id);
create index if not exists idx_geo_answers_client on public.geo_answers(client_id);
create index if not exists idx_geo_insights_run on public.geo_insights(run_id);
create index if not exists idx_content_tasks_client on public.content_tasks(client_id);
create index if not exists idx_content_tasks_run on public.content_tasks(run_id);
