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

create or replace function public.is_organization_admin(target_organization uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.organization_id=target_organization and p.status='active' and lower(p.role) in ('admin','administrator'));
$$;
revoke all on function public.is_organization_admin(uuid) from public;
grant execute on function public.is_organization_admin(uuid) to authenticated;

create or replace function public.validate_team_assignments()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.responsible_user_id is not null and not exists(select 1 from public.profiles p where p.id=new.responsible_user_id and p.organization_id=new.organization_id and p.status='active') then raise exception 'Responsible user must be an active organization member'; end if;
  return new;
end $$;
drop trigger if exists matters_validate_team_assignment on public.matters;
create trigger matters_validate_team_assignment before insert or update on public.matters for each row execute function public.validate_team_assignments();

create or replace function public.validate_task_active_assignee()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.assigned_to is not null and not exists(select 1 from public.profiles p where p.id=new.assigned_to and p.organization_id=new.organization_id and p.status='active') then raise exception 'Task assignee must be an active organization member'; end if;
  return new;
end $$;
drop trigger if exists tasks_validate_active_assignee on public.tasks;
create trigger tasks_validate_active_assignee before insert or update of assigned_to,organization_id on public.tasks for each row execute function public.validate_task_active_assignee();

create or replace function public.protect_team_profile_fields()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is not null and (new.organization_id is distinct from old.organization_id or new.role is distinct from old.role or new.status is distinct from old.status) and not public.is_organization_admin(old.organization_id) then raise exception 'Only an organization admin can change membership fields'; end if;
  new.updated_at=now(); return new;
end $$;
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
drop policy if exists "Organization members can read team profiles" on public.profiles;
create policy "Organization members can read team profiles" on public.profiles for select to authenticated using(organization_id=(select organization_id from public.profiles where id=auth.uid()));
drop policy if exists "Admins can update team profiles" on public.profiles;
create policy "Admins can update team profiles" on public.profiles for update to authenticated using(public.is_organization_admin(organization_id)) with check(public.is_organization_admin(organization_id));
