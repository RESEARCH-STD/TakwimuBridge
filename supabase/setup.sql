-- TakwimuBridge cloud sync — run once in your Supabase project
-- (Dashboard → SQL Editor → New query → paste → Run). Safe to re-run.
--
-- One row per project: the project document the browser keeps, with its
-- transcripts (sources) in their own column so the frequent small edits
-- (coding a passage) don't re-upload every transcript. Row-level security
-- means a signed-in researcher can only ever read or change their own
-- rows; signed-out visitors can't read anything.

create table if not exists public.projects (
  owner_id   uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id         text        not null,
  title      text        not null default '',
  data       jsonb       not null default '{}'::jsonb,   -- everything except the transcripts
  sources    jsonb       not null default '[]'::jsonb,   -- the transcripts
  deleted    boolean     not null default false,         -- kept so deletions reach the user's other computers
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

-- The database stamps every insert/update. The app treats this stamp as the
-- project's version: an upload only applies if the stored version is the one
-- the browser last saw, so edits made on two computers are never silently
-- overwritten (the app keeps both instead).
create or replace function public.projects_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists projects_touch_updated_at on public.projects;
create trigger projects_touch_updated_at
  before insert or update on public.projects
  for each row execute function public.projects_touch_updated_at();

alter table public.projects enable row level security;

drop policy if exists "Researchers read their own projects" on public.projects;
create policy "Researchers read their own projects" on public.projects
  for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "Researchers add their own projects" on public.projects;
create policy "Researchers add their own projects" on public.projects
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists "Researchers update their own projects" on public.projects;
create policy "Researchers update their own projects" on public.projects
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "Researchers delete their own projects" on public.projects;
create policy "Researchers delete their own projects" on public.projects
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on public.projects from anon;
grant select, insert, update, delete on public.projects to authenticated;
