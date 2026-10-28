-- FLUXO — Matter Billing: Fees, Time Entries, Expenses, Payments
-- Run this in Supabase SQL Editor

-- ─── 1. Matter Fees (agreed fee arrangements) ───────────────────────────────
create table if not exists public.matter_fees (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  matter_id       uuid not null references public.matters(id) on delete cascade,
  fee_type        text not null default 'fixed' check (fee_type in (
                    'fixed','hourly','contingency','retainer','hybrid'
                  )),
  amount          numeric(14,2) not null default 0,
  currency        text not null default 'EUR',
  hourly_rate     numeric(10,2),          -- used when fee_type = 'hourly'
  contingency_pct numeric(5,2),           -- used when fee_type = 'contingency'
  description     text,
  agreed_at       date,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists matter_fees_matter_idx on public.matter_fees(matter_id);
create index if not exists matter_fees_org_idx   on public.matter_fees(organization_id);

alter table public.matter_fees enable row level security;

drop policy if exists "Active members only matter fees" on public.matter_fees;
create policy "Active members only matter fees" on public.matter_fees
  as restrictive for all to authenticated
  using   (organization_id = public.current_active_organization_id())
  with check (organization_id = public.current_active_organization_id());

drop policy if exists "Members can manage matter fees" on public.matter_fees;
create policy "Members can manage matter fees" on public.matter_fees
  for all to authenticated
  using   (organization_id = public.current_active_organization_id())
  with check (organization_id = public.current_active_organization_id());


-- ─── 2. Time Entries ────────────────────────────────────────────────────────
create table if not exists public.matter_time_entries (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  matter_id       uuid not null references public.matters(id) on delete cascade,
  entry_date      date not null default current_date,
  duration_min    integer not null default 0,   -- minutes worked
  description     text not null,
  hourly_rate     numeric(10,2) not null default 0,
  amount          numeric(14,2) generated always as (
                    round((duration_min::numeric / 60) * hourly_rate, 2)
                  ) stored,
  billed          boolean not null default false,
  lawyer_id       uuid references public.profiles(id),
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists matter_time_matter_idx on public.matter_time_entries(matter_id);
create index if not exists matter_time_org_idx   on public.matter_time_entries(organization_id);

alter table public.matter_time_entries enable row level security;

drop policy if exists "Active members only time entries" on public.matter_time_entries;
create policy "Active members only time entries" on public.matter_time_entries
  as restrictive for all to authenticated
  using   (organization_id = public.current_active_organization_id())
  with check (organization_id = public.current_active_organization_id());

drop policy if exists "Members can manage time entries" on public.matter_time_entries;
create policy "Members can manage time entries" on public.matter_time_entries
  for all to authenticated
  using   (organization_id = public.current_active_organization_id())
  with check (organization_id = public.current_active_organization_id());


-- ─── 3. Expenses ────────────────────────────────────────────────────────────
create table if not exists public.matter_expenses (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  matter_id       uuid not null references public.matters(id) on delete cascade,
  expense_date    date not null default current_date,
  category        text not null default 'other' check (category in (
                    'court_fees','travel','translation','expert','postage',
                    'copies','notary','registration','bail','other'
                  )),
  description     text not null,
  amount          numeric(14,2) not null default 0,
  currency        text not null default 'EUR',
  receipt_url     text,
  reimbursable    boolean not null default true,
  billed          boolean not null default false,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists matter_expenses_matter_idx on public.matter_expenses(matter_id);
create index if not exists matter_expenses_org_idx   on public.matter_expenses(organization_id);

alter table public.matter_expenses enable row level security;

drop policy if exists "Active members only expenses" on public.matter_expenses;
create policy "Active members only expenses" on public.matter_expenses
  as restrictive for all to authenticated
  using   (organization_id = public.current_active_organization_id())
  with check (organization_id = public.current_active_organization_id());

drop policy if exists "Members can manage expenses" on public.matter_expenses;
create policy "Members can manage expenses" on public.matter_expenses
  for all to authenticated
  using   (organization_id = public.current_active_organization_id())
  with check (organization_id = public.current_active_organization_id());


-- ─── 4. Payments ────────────────────────────────────────────────────────────
create table if not exists public.matter_payments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  matter_id       uuid not null references public.matters(id) on delete cascade,
  payment_date    date not null default current_date,
  payment_type    text not null default 'payment' check (payment_type in (
                    'advance','payment','refund'
                  )),
  amount          numeric(14,2) not null default 0,
  currency        text not null default 'EUR',
  method          text default 'bank_transfer' check (method in (
                    'bank_transfer','cash','check','mbway','other'
                  )),
  reference       text,
  notes           text,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists matter_payments_matter_idx on public.matter_payments(matter_id);
create index if not exists matter_payments_org_idx   on public.matter_payments(organization_id);

alter table public.matter_payments enable row level security;

drop policy if exists "Active members only payments" on public.matter_payments;
create policy "Active members only payments" on public.matter_payments
  as restrictive for all to authenticated
  using   (organization_id = public.current_active_organization_id())
  with check (organization_id = public.current_active_organization_id());

drop policy if exists "Members can manage payments" on public.matter_payments;
create policy "Members can manage payments" on public.matter_payments
  for all to authenticated
  using   (organization_id = public.current_active_organization_id())
  with check (organization_id = public.current_active_organization_id());
