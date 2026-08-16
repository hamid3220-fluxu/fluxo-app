-- Expand FLUXO Contacts and add safe, FLUXO-only soft deletion.
alter table public.contacts
  add column if not exists secondary_phone text,
  add column if not exists job_title text,
  add column if not exists website text,
  add column if not exists preferred_language text,
  add column if not exists address_line1 text,
  add column if not exists address_line2 text,
  add column if not exists city text,
  add column if not exists region text,
  add column if not exists postal_code text,
  add column if not exists country text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'contacts_soft_delete_consistent'
      and conrelid = 'public.contacts'::regclass
  ) then
    alter table public.contacts
      add constraint contacts_soft_delete_consistent check (
        (deleted_at is null and deleted_by is null)
        or
        (deleted_at is not null and deleted_by is not null)
      );
  end if;
end;
$$;

create index if not exists contacts_org_visible_idx
  on public.contacts (organization_id, updated_at desc)
  where deleted_at is null;

create or replace function public.validate_contact_relationships()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = new.created_by
      and p.organization_id = new.organization_id
      and p.status = 'active'
  ) then
    raise exception 'Contact creator must be active in the organization';
  end if;

  if new.source_owner_id is not null and not exists (
    select 1 from public.profiles p
    where p.id = new.source_owner_id and p.organization_id = new.organization_id
  ) then
    raise exception 'Contact source owner must belong to the organization';
  end if;

  if new.converted_client_id is not null and not exists (
    select 1 from public.clients c
    where c.id = new.converted_client_id and c.organization_id = new.organization_id
  ) then
    raise exception 'Converted client must belong to the organization';
  end if;

  if new.deleted_by is not null and not exists (
    select 1 from public.profiles p
    where p.id = new.deleted_by and p.organization_id = new.organization_id
  ) then
    raise exception 'Contact deletion user must belong to the organization';
  end if;

  return new;
end;
$$;
revoke all on function public.validate_contact_relationships() from public;

create or replace function public.delete_contact_from_fluxo(target_contact uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  active_organization uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select p.organization_id into active_organization
  from public.profiles p
  where p.id = auth.uid() and p.status = 'active';

  if active_organization is null then raise exception 'Active organization required'; end if;

  update public.contacts
  set deleted_at = now(), deleted_by = auth.uid()
  where id = target_contact
    and organization_id = active_organization
    and deleted_at is null;

  if not found then raise exception 'Contact not found'; end if;
end;
$$;
revoke all on function public.delete_contact_from_fluxo(uuid) from public;
grant execute on function public.delete_contact_from_fluxo(uuid) to authenticated;

revoke insert, update, delete on public.contacts from anon, authenticated;
grant select on public.contacts to authenticated;
grant insert (
  organization_id, full_name, email, phone, secondary_phone, company, job_title,
  website, preferred_language, address_line1, address_line2, city, region,
  postal_code, country, tags, notes, source, created_by
)
  on public.contacts to authenticated;
grant update (
  full_name, email, phone, secondary_phone, company, job_title, website,
  preferred_language, address_line1, address_line2, city, region, postal_code,
  country, tags, notes
)
  on public.contacts to authenticated;
