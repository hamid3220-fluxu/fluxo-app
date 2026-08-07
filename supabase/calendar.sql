-- FLUXO Calendar and external-calendar synchronization foundation.
-- Review and run this migration manually in Supabase.
create extension if not exists pgcrypto;

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  title text not null check (length(trim(title)) > 0),
  description text,
  event_type text not null default 'meeting' check (event_type in ('meeting','court','deadline','call','reminder','appointment','other')),
  starts_at timestamptz,
  ends_at timestamptz,
  all_day_start date,
  all_day_end date,
  all_day boolean not null default false,
  timezone text not null check (length(trim(timezone)) > 0),
  location text,
  client_id uuid references public.clients(id) on delete set null,
  matter_id uuid references public.matters(id) on delete set null,
  status text not null default 'scheduled' check (status in ('scheduled','completed','cancelled')),
  reminder_enabled boolean not null default false,
  reminder_minutes_before integer check (reminder_minutes_before is null or reminder_minutes_before >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_events_time_shape check (
    (all_day and all_day_start is not null and all_day_end is not null and starts_at is null and ends_at is null and all_day_end >= all_day_start)
    or
    (not all_day and starts_at is not null and ends_at is not null and all_day_start is null and all_day_end is null and ends_at > starts_at)
  ),
  constraint calendar_events_reminder_shape check (
    (reminder_enabled and reminder_minutes_before is not null)
    or
    (not reminder_enabled and reminder_minutes_before is null)
  )
);

create index if not exists calendar_events_owner_start_idx on public.calendar_events (owner_id, starts_at);
create index if not exists calendar_events_owner_all_day_idx on public.calendar_events (owner_id, all_day_start);
create index if not exists calendar_events_organization_idx on public.calendar_events (organization_id);
create index if not exists calendar_events_client_idx on public.calendar_events (client_id);
create index if not exists calendar_events_matter_idx on public.calendar_events (matter_id);

create or replace function public.set_calendar_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.validate_calendar_event_relationships()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  linked_matter_client uuid;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = new.owner_id and p.organization_id = new.organization_id
  ) then
    raise exception 'Calendar event owner must belong to the organization';
  end if;

  if new.client_id is not null and not exists (
    select 1 from public.clients c
    where c.id = new.client_id and c.organization_id = new.organization_id
  ) then
    raise exception 'Calendar event client must belong to the organization';
  end if;

  if new.matter_id is not null then
    select m.client_id into linked_matter_client
    from public.matters m
    where m.id = new.matter_id and m.organization_id = new.organization_id;
    if not found then raise exception 'Calendar event matter must belong to the organization'; end if;
    if new.client_id is not null and linked_matter_client <> new.client_id then
      raise exception 'Calendar event matter must belong to the selected client';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.protect_calendar_event_ownership()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'Calendar event organization cannot be changed';
  end if;
  if new.owner_id is distinct from old.owner_id then
    raise exception 'Calendar event owner cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists calendar_events_validate_relationships on public.calendar_events;
create trigger calendar_events_validate_relationships
before insert or update on public.calendar_events
for each row execute function public.validate_calendar_event_relationships();

drop trigger if exists calendar_events_protect_ownership on public.calendar_events;
create trigger calendar_events_protect_ownership
before update on public.calendar_events
for each row execute function public.protect_calendar_event_ownership();

drop trigger if exists calendar_events_set_updated_at on public.calendar_events;
create trigger calendar_events_set_updated_at
before update on public.calendar_events
for each row execute function public.set_calendar_updated_at();

alter table public.calendar_events enable row level security;
drop policy if exists "Users can read their calendar events" on public.calendar_events;
create policy "Users can read their calendar events" on public.calendar_events for select to authenticated
using (owner_id = auth.uid() and organization_id = (select organization_id from public.profiles where id = auth.uid()));
drop policy if exists "Users can create their calendar events" on public.calendar_events;
create policy "Users can create their calendar events" on public.calendar_events for insert to authenticated
with check (owner_id = auth.uid() and organization_id = (select organization_id from public.profiles where id = auth.uid()));
drop policy if exists "Users can update their calendar events" on public.calendar_events;
create policy "Users can update their calendar events" on public.calendar_events for update to authenticated
using (owner_id = auth.uid() and organization_id = (select organization_id from public.profiles where id = auth.uid()))
with check (owner_id = auth.uid() and organization_id = (select organization_id from public.profiles where id = auth.uid()));
drop policy if exists "Users can delete their calendar events" on public.calendar_events;
create policy "Users can delete their calendar events" on public.calendar_events for delete to authenticated
using (owner_id = auth.uid() and organization_id = (select organization_id from public.profiles where id = auth.uid()));

-- Metadata only. OAuth access and refresh tokens must be stored server-side
-- (Supabase Vault or another encrypted secret store), never in this table.
create table if not exists public.calendar_integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google','microsoft')),
  connected_account text,
  external_calendar_id text,
  status text not null default 'disconnected' check (status in ('disconnected','connected','error')),
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create index if not exists calendar_integrations_org_user_idx on public.calendar_integrations (organization_id, user_id);
create or replace function public.validate_calendar_integration_ownership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = new.user_id and p.organization_id = new.organization_id
  ) then
    raise exception 'Calendar integration user must belong to the organization';
  end if;
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.user_id is distinct from old.user_id
    or new.provider is distinct from old.provider
  ) then
    raise exception 'Calendar integration ownership cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists calendar_integrations_validate_ownership on public.calendar_integrations;
create trigger calendar_integrations_validate_ownership before insert or update on public.calendar_integrations
for each row execute function public.validate_calendar_integration_ownership();
drop trigger if exists calendar_integrations_set_updated_at on public.calendar_integrations;
create trigger calendar_integrations_set_updated_at before update on public.calendar_integrations
for each row execute function public.set_calendar_updated_at();
alter table public.calendar_integrations enable row level security;
drop policy if exists "Users can read their calendar integrations" on public.calendar_integrations;
create policy "Users can read their calendar integrations" on public.calendar_integrations for select to authenticated
using (user_id = auth.uid() and organization_id = (select organization_id from public.profiles where id = auth.uid()));
-- Inserts, updates and disconnects are intentionally server-only OAuth operations.

create table if not exists public.calendar_event_syncs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.calendar_events(id) on delete cascade,
  integration_id uuid not null references public.calendar_integrations(id) on delete cascade,
  provider text not null check (provider in ('google','microsoft')),
  external_event_id text not null,
  sync_status text not null default 'pending' check (sync_status in ('pending','synced','error','delete_pending')),
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_id, event_id),
  unique (integration_id, external_event_id)
);

create index if not exists calendar_event_syncs_event_idx on public.calendar_event_syncs (event_id);
create or replace function public.validate_calendar_event_sync_relationships()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_owner uuid;
  event_organization uuid;
  integration_user uuid;
  integration_organization uuid;
  integration_provider text;
begin
  select e.owner_id, e.organization_id into event_owner, event_organization
  from public.calendar_events e where e.id = new.event_id;
  if not found then raise exception 'Calendar sync event does not exist'; end if;

  select i.user_id, i.organization_id, i.provider
  into integration_user, integration_organization, integration_provider
  from public.calendar_integrations i where i.id = new.integration_id;
  if not found then raise exception 'Calendar sync integration does not exist'; end if;

  if event_owner <> integration_user or event_organization <> integration_organization or new.provider <> integration_provider then
    raise exception 'Calendar sync event and integration must have the same owner, organization and provider';
  end if;
  if tg_op = 'UPDATE' and (
    new.event_id is distinct from old.event_id
    or new.integration_id is distinct from old.integration_id
    or new.provider is distinct from old.provider
    or new.external_event_id is distinct from old.external_event_id
  ) then
    raise exception 'Calendar sync identity cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists calendar_event_syncs_validate_relationships on public.calendar_event_syncs;
create trigger calendar_event_syncs_validate_relationships before insert or update on public.calendar_event_syncs
for each row execute function public.validate_calendar_event_sync_relationships();
drop trigger if exists calendar_event_syncs_set_updated_at on public.calendar_event_syncs;
create trigger calendar_event_syncs_set_updated_at before update on public.calendar_event_syncs
for each row execute function public.set_calendar_updated_at();
alter table public.calendar_event_syncs enable row level security;
drop policy if exists "Users can read their calendar sync status" on public.calendar_event_syncs;
create policy "Users can read their calendar sync status" on public.calendar_event_syncs for select to authenticated
using (exists (
  select 1 from public.calendar_events e
  where e.id = event_id
    and e.owner_id = auth.uid()
    and e.organization_id = (select organization_id from public.profiles where id = auth.uid())
));
-- Sync rows are intentionally written only by trusted server-side functions.
