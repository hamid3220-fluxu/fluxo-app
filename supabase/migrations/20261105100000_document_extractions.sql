-- Data read from client documents (ID card, passport, residence permit…).
--
-- Flow: a document is uploaded (by the firm, or by the client in the portal),
-- the fluxo-ai edge function reads it with a vision model and stores the
-- result here as 'pending_review'. A lawyer checks and corrects the fields and
-- confirms them; confirmed values are copied onto the client record, where
-- they are kept for later use (drafted documents, expiry reminders, forms).
-- Nothing is written to the client record without a lawyer confirming it.
-- Safe to re-run.

-- Identity data kept on the client record.
alter table public.clients
  add column if not exists nif text,
  add column if not exists date_of_birth date,
  add column if not exists place_of_birth text,
  add column if not exists nationality text,
  add column if not exists sex text,
  add column if not exists address text,
  add column if not exists id_document_type text,
  add column if not exists id_document_number text,
  add column if not exists id_document_country text,
  add column if not exists id_document_issue_date date,
  add column if not exists id_document_expiry date,
  -- Deliberately no foreign key: a second documents↔clients relationship makes
  -- PostgREST embeds such as documents?select=clients(...) ambiguous (PGRST201).
  add column if not exists identity_source_document_id uuid,
  add column if not exists identity_updated_at timestamptz;
alter table public.clients drop constraint if exists clients_identity_source_document_id_fkey;

create table if not exists public.document_extractions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  document_type text not null default 'other',
  -- Everything read from the document, e.g. {"full_name": "...", "date_of_birth": "1990-01-31", ...}.
  fields jsonb not null default '{}'::jsonb,
  -- What the model could not read or was unsure about.
  warnings text[] not null default '{}',
  status text not null default 'pending_review' check (status in ('pending_review', 'confirmed', 'rejected')),
  model text,
  source text not null default 'firm' check (source in ('firm', 'portal')),
  created_by uuid references public.profiles(id) on delete set null,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id)
);

create index if not exists document_extractions_client_idx
  on public.document_extractions (organization_id, client_id, created_at desc);
create index if not exists document_extractions_pending_idx
  on public.document_extractions (organization_id, created_at desc) where status = 'pending_review';

create or replace function public.set_document_extractions_updated_at()
returns trigger language plpgsql security invoker set search_path = public as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists document_extractions_set_updated_at on public.document_extractions;
create trigger document_extractions_set_updated_at before update on public.document_extractions
  for each row execute function public.set_document_extractions_updated_at();

alter table public.document_extractions enable row level security;

-- Firm staff read and review. Rows are created by the edge function (service role).
drop policy if exists "Organization members can read document extractions" on public.document_extractions;
create policy "Organization members can read document extractions" on public.document_extractions
  for select to authenticated using (organization_id = public.current_active_organization_id());
drop policy if exists "Organization members can review document extractions" on public.document_extractions;
create policy "Organization members can review document extractions" on public.document_extractions
  for update to authenticated
  using (organization_id = public.current_active_organization_id())
  with check (organization_id = public.current_active_organization_id());
drop policy if exists "Organization members can delete document extractions" on public.document_extractions;
create policy "Organization members can delete document extractions" on public.document_extractions
  for delete to authenticated using (organization_id = public.current_active_organization_id());

-- Portal clients never see extraction rows (they hold the firm's review state).
drop policy if exists "Portal clients have no access" on public.document_extractions;
create policy "Portal clients have no access" on public.document_extractions as restrictive for all to authenticated
  using (not public.is_portal_client()) with check (not public.is_portal_client());
