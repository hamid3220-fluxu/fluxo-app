-- Internal communication records. Run manually after review.
create extension if not exists pgcrypto;

create table if not exists public.communications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid references public.clients(id) on delete set null,
  matter_id uuid references public.matters(id) on delete set null,
  communication_type text not null check (communication_type in ('email','whatsapp','phone_call','meeting','internal_note','other')),
  direction text not null check (direction in ('inbound','outbound','internal')),
  subject text,
  body text,
  sender_name text,
  sender_address text,
  recipient_name text,
  recipient_address text,
  occurred_at timestamptz not null default now(),
  status text not null default 'unread' check (status in ('unread','read','replied','archived')),
  is_important boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint communications_content_required check (length(trim(coalesce(subject,''))) > 0 or length(trim(coalesce(body,''))) > 0),
  constraint communications_internal_direction check (communication_type <> 'internal_note' or direction = 'internal')
);

alter table public.communications
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists communications_org_occurred_idx on public.communications (organization_id, occurred_at desc);
create index if not exists communications_client_idx on public.communications (client_id);
create index if not exists communications_matter_idx on public.communications (matter_id);
create index if not exists communications_status_idx on public.communications (organization_id, status);
create index if not exists communications_type_idx on public.communications (organization_id, communication_type);
create index if not exists communications_important_idx on public.communications (organization_id, is_important) where is_important;

create or replace function public.set_updated_at() returns trigger language plpgsql security invoker set search_path=public as $$ begin new.updated_at=now(); return new; end; $$;

create or replace function public.validate_communication_relationships()
returns trigger language plpgsql security definer set search_path=public as $$
declare linked_client uuid;
begin
  if new.client_id is not null and not exists (select 1 from public.clients c where c.id=new.client_id and c.organization_id=new.organization_id) then raise exception 'Communication client must belong to the same organization'; end if;
  if new.matter_id is not null then
    select m.client_id into linked_client from public.matters m where m.id=new.matter_id and m.organization_id=new.organization_id;
    if not found then raise exception 'Communication matter must belong to the same organization'; end if;
    if new.client_id is not null and linked_client <> new.client_id then raise exception 'Communication matter must belong to the selected client'; end if;
  end if;
  return new;
end; $$;

drop trigger if exists communications_validate_relationships on public.communications;
create trigger communications_validate_relationships before insert or update on public.communications for each row execute function public.validate_communication_relationships();
drop trigger if exists communications_set_updated_at on public.communications;
create trigger communications_set_updated_at before update on public.communications for each row execute function public.set_updated_at();

create or replace function public.protect_communication_ownership()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'Communication organization cannot be changed';
  end if;

  if new.created_by is distinct from old.created_by then
    raise exception 'Communication creator cannot be changed';
  end if;

  return new;
end;
$$;

drop trigger if exists communications_protect_ownership
  on public.communications;

create trigger communications_protect_ownership
before update on public.communications
for each row
execute function public.protect_communication_ownership();

alter table public.communications enable row level security;
drop policy if exists "Organization members can read communications" on public.communications;
create policy "Organization members can read communications" on public.communications for select to authenticated using (organization_id=(select organization_id from public.profiles where id=auth.uid()));
drop policy if exists "Organization members can create communications" on public.communications;
create policy "Organization members can create communications" on public.communications for insert to authenticated with check (organization_id=(select organization_id from public.profiles where id=auth.uid()) and created_by=auth.uid());
drop policy if exists "Organization members can update communications" on public.communications;
create policy "Organization members can update communications" on public.communications for update to authenticated using (organization_id=(select organization_id from public.profiles where id=auth.uid())) with check (organization_id=(select organization_id from public.profiles where id=auth.uid()));

drop policy if exists "Active organization members can delete communications" on public.communications;
create policy "Active organization members can delete communications" on public.communications for delete to authenticated using (organization_id=(select organization_id from public.profiles where id=auth.uid() and status='active'));
