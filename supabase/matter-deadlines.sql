-- FLUXO — Matter Procedural Deadlines
-- Run this in Supabase SQL Editor before deploying the updated index.html

create table if not exists public.matter_deadlines (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  matter_id       uuid not null references public.matters(id) on delete cascade,
  title           text not null,
  deadline_type   text not null default 'procedural' check (deadline_type in (
                    'procedural','statutory','court','filing','response','hearing','appeal','other'
                  )),
  due_date        date not null,
  status          text not null default 'pending' check (status in (
                    'pending','confirmed','completed','missed','waived'
                  )),
  confirmed_by    uuid references public.profiles(id),
  confirmed_at    timestamptz,
  notes           text,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists matter_deadlines_matter_idx on public.matter_deadlines(matter_id);
create index if not exists matter_deadlines_org_idx   on public.matter_deadlines(organization_id);
create index if not exists matter_deadlines_due_idx   on public.matter_deadlines(due_date);

-- RLS
alter table public.matter_deadlines enable row level security;

drop policy if exists "Active members only matter deadlines" on public.matter_deadlines;
create policy "Active members only matter deadlines" on public.matter_deadlines
  as restrictive for all to authenticated
  using   (organization_id = public.current_active_organization_id())
  with check (organization_id = public.current_active_organization_id());

drop policy if exists "Members can manage matter deadlines" on public.matter_deadlines;
create policy "Members can manage matter deadlines" on public.matter_deadlines
  for all to authenticated
  using   (organization_id = public.current_active_organization_id())
  with check (organization_id = public.current_active_organization_id());
