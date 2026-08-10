-- FLUXO team foundation. Review before running in Supabase SQL Editor.
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists status text not null default 'active';
alter table public.profiles add column if not exists joined_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

do $$ begin
  if not exists (select 1 from pg_constraint where conname='profiles_team_status_check') then
    alter table public.profiles add constraint profiles_team_status_check check (status in ('active','inactive'));
  end if;
end $$;

create table if not exists public.team_invitations (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null, role text not null check (role in ('admin','lawyer','staff')), status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  invited_by uuid not null references public.profiles(id) on delete restrict, expires_at timestamptz not null default (now()+interval '7 days'), accepted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists team_invitations_pending_email_idx on public.team_invitations(organization_id,lower(email)) where status='pending';

alter table public.matters add column if not exists responsible_user_id uuid references public.profiles(id) on delete set null;
create index if not exists matters_responsible_user_idx on public.matters(organization_id,responsible_user_id) where responsible_user_id is not null;

-- This function is the non-recursive authorization boundary for all active-member RLS.
-- It runs as the migration owner, reads exactly one profile row, and is not executable by PUBLIC.
create or replace function public.current_active_organization_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog
set row_security = off
as $$
  select p.organization_id
  from public.profiles p
  where p.id = auth.uid()
    and p.status = 'active'
  limit 1
$$;
revoke all on function public.current_active_organization_id() from public;
grant execute on function public.current_active_organization_id() to authenticated;

create or replace function public.is_organization_admin(target_organization uuid)
returns boolean language sql stable security definer set search_path=pg_catalog set row_security=off as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.organization_id=target_organization and p.status='active' and lower(p.role) in ('admin','administrator'));
$$;
revoke all on function public.is_organization_admin(uuid) from public;
grant execute on function public.is_organization_admin(uuid) to authenticated;

create or replace function public.validate_team_assignments()
returns trigger language plpgsql security definer set search_path=pg_catalog set row_security=off as $$
begin
  if new.responsible_user_id is not null and not exists(select 1 from public.profiles p where p.id=new.responsible_user_id and p.organization_id=new.organization_id and p.status='active') then raise exception 'Responsible user must be an active organization member'; end if;
  return new;
end $$;
revoke all on function public.validate_team_assignments() from public;
drop trigger if exists matters_validate_team_assignment on public.matters;
create trigger matters_validate_team_assignment before insert or update on public.matters for each row execute function public.validate_team_assignments();

create or replace function public.validate_task_active_assignee()
returns trigger language plpgsql security definer set search_path=pg_catalog set row_security=off as $$
begin
  if new.assigned_to is not null and not exists(select 1 from public.profiles p where p.id=new.assigned_to and p.organization_id=new.organization_id and p.status='active') then raise exception 'Task assignee must be an active organization member'; end if;
  return new;
end $$;
revoke all on function public.validate_task_active_assignee() from public;
drop trigger if exists tasks_validate_active_assignee on public.tasks;
create trigger tasks_validate_active_assignee before insert or update of assigned_to,organization_id on public.tasks for each row execute function public.validate_task_active_assignee();

create or replace function public.protect_team_profile_fields()
returns trigger language plpgsql security definer set search_path=pg_catalog set row_security=off as $$
begin
  if auth.uid()=old.id and (new.role is distinct from old.role or new.status is distinct from old.status) then raise exception 'Administrators cannot change their own role or status'; end if;
  if auth.uid() is not null and (new.organization_id is distinct from old.organization_id or new.role is distinct from old.role or new.status is distinct from old.status) and not public.is_organization_admin(old.organization_id) then raise exception 'Only an organization admin can change membership fields'; end if;
  new.updated_at=now(); return new;
end $$;
revoke all on function public.protect_team_profile_fields() from public;
drop trigger if exists profiles_protect_team_fields on public.profiles;
create trigger profiles_protect_team_fields before update on public.profiles for each row execute function public.protect_team_profile_fields();

alter table public.team_invitations enable row level security;
drop policy if exists "Admins can read team invitations" on public.team_invitations;
create policy "Admins can read team invitations" on public.team_invitations for select to authenticated using(public.is_organization_admin(organization_id));
drop policy if exists "Admins can create team invitations" on public.team_invitations;
create policy "Admins can create team invitations" on public.team_invitations for insert to authenticated with check(public.is_organization_admin(organization_id) and invited_by=auth.uid());
drop policy if exists "Admins can update team invitations" on public.team_invitations;
create policy "Admins can update team invitations" on public.team_invitations for update to authenticated using(public.is_organization_admin(organization_id)) with check(public.is_organization_admin(organization_id));

-- Profiles must remain readable by organization peers for assignees/team display.
alter table public.profiles enable row level security;
drop policy if exists "Organization members can read team profiles" on public.profiles;
create policy "Organization members can read team profiles" on public.profiles for select to authenticated using(organization_id=public.current_active_organization_id());
drop policy if exists "Admins can update team profiles" on public.profiles;
create policy "Admins can update team profiles" on public.profiles for update to authenticated using(public.is_organization_admin(organization_id)) with check(public.is_organization_admin(organization_id));

-- Existing FLUXO policies are permissive. These RESTRICTIVE policies are an
-- additional mandatory gate, so inactive users cannot be authorized by an older policy.
alter table public.organizations enable row level security;
alter table public.clients enable row level security;
alter table public.matters enable row level security;
alter table public.tasks enable row level security;
alter table public.communications enable row level security;
alter table public.calendar_events enable row level security;
alter table public.calendar_integrations enable row level security;
alter table public.calendar_event_syncs enable row level security;
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
drop policy if exists "Active members can read their organization" on public.organizations;
create policy "Active members can read their organization" on public.organizations for select to authenticated using(id=public.current_active_organization_id());
drop policy if exists "Active members only organizations" on public.organizations;
create policy "Active members only organizations" on public.organizations as restrictive for all to authenticated
using(id=public.current_active_organization_id())
with check(id=public.current_active_organization_id());

drop policy if exists "Active members only profiles" on public.profiles;
create policy "Active members only profiles" on public.profiles as restrictive for all to authenticated
using(organization_id=public.current_active_organization_id())
with check(organization_id=public.current_active_organization_id());

drop policy if exists "Active members only clients" on public.clients;
create policy "Active members only clients" on public.clients as restrictive for all to authenticated
using(organization_id=public.current_active_organization_id())
with check(organization_id=public.current_active_organization_id());

drop policy if exists "Active members only matters" on public.matters;
create policy "Active members only matters" on public.matters as restrictive for all to authenticated
using(organization_id=public.current_active_organization_id())
with check(organization_id=public.current_active_organization_id());

drop policy if exists "Active members only tasks" on public.tasks;
create policy "Active members only tasks" on public.tasks as restrictive for all to authenticated
using(organization_id=public.current_active_organization_id())
with check(organization_id=public.current_active_organization_id());

drop policy if exists "Active members only communications" on public.communications;
create policy "Active members only communications" on public.communications as restrictive for all to authenticated
using(organization_id=public.current_active_organization_id())
with check(organization_id=public.current_active_organization_id());

drop policy if exists "Active members only calendar events" on public.calendar_events;
create policy "Active members only calendar events" on public.calendar_events as restrictive for all to authenticated
using(organization_id=public.current_active_organization_id())
with check(organization_id=public.current_active_organization_id());

drop policy if exists "Active members only calendar integrations" on public.calendar_integrations;
create policy "Active members only calendar integrations" on public.calendar_integrations as restrictive for all to authenticated
using(organization_id=public.current_active_organization_id())
with check(organization_id=public.current_active_organization_id());

drop policy if exists "Active members only calendar event syncs" on public.calendar_event_syncs;
create policy "Active members only calendar event syncs" on public.calendar_event_syncs as restrictive for all to authenticated
using(exists(select 1 from public.calendar_events e where e.id=event_id and e.organization_id=public.current_active_organization_id()))
with check(exists(select 1 from public.calendar_events e where e.id=event_id and e.organization_id=public.current_active_organization_id()));

drop policy if exists "Active members only documents" on public.documents;
create policy "Active members only documents" on public.documents as restrictive for all to authenticated
using(organization_id=public.current_active_organization_id())
with check(organization_id=public.current_active_organization_id());

drop policy if exists "Active members only document versions" on public.document_versions;
create policy "Active members only document versions" on public.document_versions as restrictive for all to authenticated
using(organization_id=public.current_active_organization_id())
with check(organization_id=public.current_active_organization_id());

drop policy if exists "Active members only document storage" on storage.objects;
create policy "Active members only document storage" on storage.objects as restrictive for all to authenticated
using(bucket_id <> 'documents' or (storage.foldername(name))[1]=public.current_active_organization_id()::text)
with check(bucket_id <> 'documents' or (storage.foldername(name))[1]=public.current_active_organization_id()::text);
