-- FLUXO — Matter Parties
-- Run this in Supabase SQL Editor before deploying the updated index.html

create table if not exists public.matter_parties (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  matter_id       uuid not null references public.matters(id) on delete cascade,
  name            text not null,
  role            text not null check (role in ('plaintiff','defendant','witness','counterparty','third_party','other')),
  party_type      text not null default 'individual' check (party_type in ('individual','company')),
  email           text,
  phone           text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists matter_parties_matter_idx on public.matter_parties(matter_id);
create index if not exists matter_parties_org_idx on public.matter_parties(organization_id);

-- RLS
alter table public.matter_parties enable row level security;

drop policy if exists "Active members only matter parties" on public.matter_parties;
create policy "Active members only matter parties" on public.matter_parties as restrictive for all to authenticated
  using(organization_id = public.current_active_organization_id())
  with check(organization_id = public.current_active_organization_id());

drop policy if exists "Members can manage matter parties" on public.matter_parties;
create policy "Members can manage matter parties" on public.matter_parties for all to authenticated
  using(organization_id = public.current_active_organization_id())
  with check(organization_id = public.current_active_organization_id());
