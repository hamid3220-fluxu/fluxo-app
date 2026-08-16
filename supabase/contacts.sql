-- FLUXO Contacts module and read-only Google Contacts import metadata.
-- Apply after the existing organizations, profiles and clients tables.
create extension if not exists pgcrypto;
create extension if not exists supabase_vault with schema vault;

create or replace function public.normalize_contact_email(value text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select nullif(lower(btrim(value)), '');
$$;

create or replace function public.normalize_contact_phone(value text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select nullif(regexp_replace(value, '[^0-9]', '', 'g'), '');
$$;

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  full_name text not null check (length(btrim(full_name)) > 0),
  email text,
  phone text,
  secondary_phone text,
  company text,
  job_title text,
  website text,
  preferred_language text,
  address_line1 text,
  address_line2 text,
  city text,
  region text,
  postal_code text,
  country text,
  tags text[] not null default '{}',
  notes text,
  source text not null default 'manual' check (source in ('manual', 'google')),
  source_owner_id uuid references public.profiles(id) on delete set null,
  normalized_email text generated always as (public.normalize_contact_email(email)) stored,
  normalized_phone text generated always as (public.normalize_contact_phone(phone)) stored,
  converted_client_id uuid references public.clients(id) on delete set null,
  converted_at timestamptz,
  converted_by uuid references public.profiles(id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contacts_identity_required check (
    normalized_email is not null or normalized_phone is not null
  ),
  constraint contacts_conversion_consistent check (
    (converted_client_id is null and converted_at is null and converted_by is null)
    or
    (converted_client_id is not null and converted_at is not null and converted_by is not null)
  ),
  constraint contacts_soft_delete_consistent check (
    (deleted_at is null and deleted_by is null)
    or
    (deleted_at is not null and deleted_by is not null)
  )
);

create unique index if not exists contacts_org_email_unique
  on public.contacts (organization_id, normalized_email)
  where normalized_email is not null;
create unique index if not exists contacts_org_phone_unique
  on public.contacts (organization_id, normalized_phone)
  where normalized_phone is not null;
create index if not exists contacts_org_name_idx on public.contacts (organization_id, full_name);
create index if not exists contacts_converted_client_idx on public.contacts (converted_client_id)
  where converted_client_id is not null;
create index if not exists contacts_org_visible_idx on public.contacts (organization_id, updated_at desc)
  where deleted_at is null;

create table if not exists public.contact_integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null default 'google' check (provider = 'google'),
  connected_email text,
  provider_account_id text,
  status text not null default 'not_connected' check (
    status in ('not_configured', 'not_connected', 'connected', 'token_expired', 'permission_revoked', 'import_error')
  ),
  last_import_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create table if not exists public.contact_integration_secrets (
  integration_id uuid primary key references public.contact_integrations(id) on delete cascade,
  access_token_secret_id uuid not null,
  refresh_token_secret_id uuid,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.contact_oauth_states (
  state_hash text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null default 'google' check (provider = 'google'),
  redirect_uri text not null,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.contact_import_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  integration_id uuid not null references public.contact_integrations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  provider_resource_name text not null,
  provider_etag text,
  imported_at timestamptz not null default now(),
  unique (integration_id, provider_resource_name)
);

create index if not exists contact_integrations_org_user_idx
  on public.contact_integrations (organization_id, user_id);
create index if not exists contact_import_links_org_contact_idx
  on public.contact_import_links (organization_id, contact_id);

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

drop trigger if exists contacts_validate_relationships on public.contacts;
create trigger contacts_validate_relationships
before insert or update on public.contacts
for each row execute function public.validate_contact_relationships();

create or replace function public.protect_contact_ownership()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'Contact organization cannot be changed';
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'Contact creator cannot be changed';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists contacts_protect_ownership on public.contacts;
create trigger contacts_protect_ownership
before update on public.contacts
for each row execute function public.protect_contact_ownership();

create or replace function public.validate_contact_integration_org()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = new.user_id
      and p.organization_id = new.organization_id
      and p.status = 'active'
  ) then
    raise exception 'Contact integration user must be active in the organization';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_contact_integration_org() from public;

drop trigger if exists contact_integrations_validate_org on public.contact_integrations;
create trigger contact_integrations_validate_org
before insert or update on public.contact_integrations
for each row execute function public.validate_contact_integration_org();

create or replace function public.validate_contact_import_link_org()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
begin
  if not exists (
    select 1
    from public.contact_integrations integration
    join public.contacts contact on contact.id = new.contact_id
    where integration.id = new.integration_id
      and integration.organization_id = new.organization_id
      and contact.organization_id = new.organization_id
  ) then
    raise exception 'Contact import link must stay inside one organization';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_contact_import_link_org() from public;

drop trigger if exists contact_import_links_validate_org on public.contact_import_links;
create trigger contact_import_links_validate_org
before insert or update on public.contact_import_links
for each row execute function public.validate_contact_import_link_org();

create or replace function public.touch_contact_integration()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists contact_integrations_touch on public.contact_integrations;
create trigger contact_integrations_touch
before update on public.contact_integrations
for each row execute function public.touch_contact_integration();

create or replace function public.convert_contact_to_client(target_contact uuid)
returns table (client_id uuid, client_created boolean)
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  contact_record public.contacts%rowtype;
  active_organization uuid;
  matching_client uuid;
  email_client uuid;
  phone_client uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select p.organization_id into active_organization
  from public.profiles p
  where p.id = auth.uid() and p.status = 'active';

  if active_organization is null then
    raise exception 'Active organization required';
  end if;

  select * into contact_record
  from public.contacts c
  where c.id = target_contact and c.organization_id = active_organization
  for update;

  if not found then
    raise exception 'Contact not found';
  end if;

  if contact_record.converted_client_id is not null then
    return query select contact_record.converted_client_id, false;
    return;
  end if;

  if contact_record.normalized_email is not null then
    select c.id into email_client
    from public.clients c
    where c.organization_id = active_organization
      and public.normalize_contact_email(c.email) = contact_record.normalized_email
    order by c.created_at
    limit 1;
  end if;

  if contact_record.normalized_phone is not null then
    select c.id into phone_client
    from public.clients c
    where c.organization_id = active_organization
      and public.normalize_contact_phone(c.phone) = contact_record.normalized_phone
    order by c.created_at
    limit 1;
  end if;

  if email_client is not null and phone_client is not null and email_client <> phone_client then
    raise exception 'Contact email and phone match different clients';
  end if;

  matching_client := coalesce(email_client, phone_client);

  if matching_client is null then
    insert into public.clients (
      organization_id, full_name, email, phone, language, notes, created_by
    ) values (
      active_organization,
      contact_record.full_name,
      contact_record.email,
      contact_record.phone,
      'Portuguese',
      contact_record.notes,
      auth.uid()
    )
    returning id into matching_client;

    update public.contacts
    set converted_client_id = matching_client,
        converted_at = now(),
        converted_by = auth.uid()
    where id = contact_record.id;

    return query select matching_client, true;
    return;
  end if;

  update public.contacts
  set converted_client_id = matching_client,
      converted_at = now(),
      converted_by = auth.uid()
  where id = contact_record.id;

  return query select matching_client, false;
end;
$$;
revoke all on function public.convert_contact_to_client(uuid) from public;
grant execute on function public.convert_contact_to_client(uuid) to authenticated;

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

create or replace function public.store_contact_integration_tokens(
  target_integration uuid,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  access_id uuid;
  refresh_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;

  select access_token_secret_id, refresh_token_secret_id
  into access_id, refresh_id
  from public.contact_integration_secrets
  where integration_id = target_integration
  for update;

  if access_id is null then
    access_id := vault.create_secret(access_token, 'contact-access-' || target_integration);
  else
    perform vault.update_secret(access_id, access_token);
  end if;

  if refresh_token is not null then
    if refresh_id is null then
      refresh_id := vault.create_secret(refresh_token, 'contact-refresh-' || target_integration);
    else
      perform vault.update_secret(refresh_id, refresh_token);
    end if;
  end if;

  insert into public.contact_integration_secrets (
    integration_id, access_token_secret_id, refresh_token_secret_id, expires_at
  ) values (
    target_integration, access_id, refresh_id, token_expires_at
  )
  on conflict (integration_id) do update
  set access_token_secret_id = excluded.access_token_secret_id,
      refresh_token_secret_id = coalesce(
        excluded.refresh_token_secret_id,
        contact_integration_secrets.refresh_token_secret_id
      ),
      expires_at = excluded.expires_at,
      updated_at = now();
end;
$$;
revoke all on function public.store_contact_integration_tokens(uuid, text, text, timestamptz) from public;
grant execute on function public.store_contact_integration_tokens(uuid, text, text, timestamptz) to service_role;

create or replace function public.read_contact_integration_tokens(target_integration uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  result jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;

  select jsonb_build_object(
    'access_token', access_secret.decrypted_secret,
    'refresh_token', refresh_secret.decrypted_secret,
    'expires_at', secrets.expires_at
  ) into result
  from public.contact_integration_secrets secrets
  join vault.decrypted_secrets access_secret
    on access_secret.id = secrets.access_token_secret_id
  left join vault.decrypted_secrets refresh_secret
    on refresh_secret.id = secrets.refresh_token_secret_id
  where secrets.integration_id = target_integration;

  return result;
end;
$$;
revoke all on function public.read_contact_integration_tokens(uuid) from public;
grant execute on function public.read_contact_integration_tokens(uuid) to service_role;

create or replace function public.delete_contact_integration_tokens(target_integration uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  access_id uuid;
  refresh_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;

  select access_token_secret_id, refresh_token_secret_id
  into access_id, refresh_id
  from public.contact_integration_secrets
  where integration_id = target_integration
  for update;

  delete from public.contact_integration_secrets where integration_id = target_integration;
  delete from vault.secrets where id = access_id or id = refresh_id;
  update public.contact_integrations
  set status = 'not_connected', connected_email = null,
      provider_account_id = null, last_error = null
  where id = target_integration;
end;
$$;
revoke all on function public.delete_contact_integration_tokens(uuid) from public;
grant execute on function public.delete_contact_integration_tokens(uuid) to service_role;

alter table public.contacts enable row level security;
alter table public.contact_integrations enable row level security;
alter table public.contact_integration_secrets enable row level security;
alter table public.contact_oauth_states enable row level security;
alter table public.contact_import_links enable row level security;

drop policy if exists "Active members read organization contacts" on public.contacts;
create policy "Active members read organization contacts"
on public.contacts for select to authenticated
using (organization_id = public.current_active_organization_id());

drop policy if exists "Active members create organization contacts" on public.contacts;
create policy "Active members create organization contacts"
on public.contacts for insert to authenticated
with check (
  organization_id = public.current_active_organization_id()
  and created_by = auth.uid()
  and source = 'manual'
  and source_owner_id is null
  and converted_client_id is null
  and converted_at is null
  and converted_by is null
);

drop policy if exists "Active members update organization contacts" on public.contacts;
create policy "Active members update organization contacts"
on public.contacts for update to authenticated
using (organization_id = public.current_active_organization_id())
with check (organization_id = public.current_active_organization_id());

drop policy if exists "Users read own contact integrations" on public.contact_integrations;
create policy "Users read own contact integrations"
on public.contact_integrations for select to authenticated
using (
  user_id = auth.uid()
  and organization_id = public.current_active_organization_id()
);

drop policy if exists "Active members read contact import links" on public.contact_import_links;
create policy "Active members read contact import links"
on public.contact_import_links for select to authenticated
using (organization_id = public.current_active_organization_id());

revoke all on public.contact_integration_secrets, public.contact_oauth_states
  from public, anon, authenticated;
revoke insert, update, delete on public.contact_integrations, public.contact_import_links
  from anon, authenticated;
revoke all on vault.secrets, vault.decrypted_secrets from public, anon, authenticated;

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
grant select on public.contact_integrations, public.contact_import_links to authenticated;
