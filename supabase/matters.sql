-- Review and run this migration manually in Supabase.
create extension if not exists pgcrypto;

create table if not exists public.matters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  client_id uuid not null references public.clients(id) on delete restrict,
  title text not null check (length(trim(title)) > 0),
  reference_number text,
  legal_area text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'on_hold', 'closed')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  description text,
  opened_at date not null default current_date,
  closed_at date,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint matters_closed_date_consistency check (status <> 'closed' or closed_at is not null)
);

-- Assumes profiles.id references auth.users.id and profiles.organization_id uses uuid.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'matters_organization_id_fkey') then
    alter table public.matters add constraint matters_organization_id_fkey
      foreign key (organization_id) references public.organizations(id) on delete restrict;
  end if;
end $$;

create index if not exists matters_organization_id_idx on public.matters (organization_id);
create index if not exists matters_client_id_idx on public.matters (client_id);
create index if not exists matters_status_idx on public.matters (organization_id, status);
create index if not exists matters_opened_at_idx on public.matters (organization_id, opened_at desc);
create unique index if not exists matters_reference_per_org_uidx
  on public.matters (organization_id, reference_number)
  where reference_number is not null;

create or replace function public.set_updated_at()
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

drop trigger if exists matters_set_updated_at on public.matters;
create trigger matters_set_updated_at
before update on public.matters
for each row execute function public.set_updated_at();

alter table public.matters enable row level security;

drop policy if exists "Organization members can read matters" on public.matters;
create policy "Organization members can read matters"
on public.matters for select to authenticated
using (organization_id = (select organization_id from public.profiles where id = auth.uid()));

drop policy if exists "Organization members can create matters" on public.matters;
create policy "Organization members can create matters"
on public.matters for insert to authenticated
with check (
  organization_id = (select organization_id from public.profiles where id = auth.uid())
  and created_by = auth.uid()
  and exists (
    select 1 from public.clients c
    where c.id = matters.client_id and c.organization_id = matters.organization_id
  )
);

drop policy if exists "Organization members can update matters" on public.matters;
create policy "Organization members can update matters"
on public.matters for update to authenticated
using (organization_id = (select organization_id from public.profiles where id = auth.uid()))
with check (
  organization_id = (select organization_id from public.profiles where id = auth.uid())
  and exists (
    select 1 from public.clients c
    where c.id = matters.client_id and c.organization_id = matters.organization_id
  )
);
