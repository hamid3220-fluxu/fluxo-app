-- WhatsApp Business Cloud API foundation for FLUXO.
-- This migration does not connect or modify a WhatsApp number.
create extension if not exists pgcrypto;
create extension if not exists supabase_vault with schema vault;

alter table public.communications
  add column if not exists contact_id uuid references public.contacts(id) on delete set null;

alter table public.communications
  drop constraint if exists communications_status_check;
alter table public.communications
  add constraint communications_status_check check (
    status in ('unread', 'sent', 'delivered', 'read', 'replied', 'failed', 'archived')
  );

create index if not exists communications_contact_idx
  on public.communications (contact_id);

create or replace function public.validate_communication_relationships()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  linked_client uuid;
  converted_client uuid;
begin
  if new.client_id is not null and not exists (
    select 1 from public.clients c
    where c.id = new.client_id and c.organization_id = new.organization_id
  ) then
    raise exception 'Communication client must belong to the same organization';
  end if;

  if new.contact_id is not null then
    select c.converted_client_id into converted_client
    from public.contacts c
    where c.id = new.contact_id
      and c.organization_id = new.organization_id
      and c.deleted_at is null;
    if not found then
      raise exception 'Communication contact must be active in the same organization';
    end if;
    if converted_client is not null
       and new.client_id is not null
       and converted_client <> new.client_id then
      raise exception 'Communication contact and client do not match';
    end if;
  end if;

  if new.matter_id is not null then
    select m.client_id into linked_client
    from public.matters m
    where m.id = new.matter_id and m.organization_id = new.organization_id;
    if not found then
      raise exception 'Communication matter must belong to the same organization';
    end if;
    if new.client_id is not null and linked_client <> new.client_id then
      raise exception 'Communication matter must belong to the selected client';
    end if;
  end if;

  return new;
end;
$$;

create table if not exists public.whatsapp_integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  waba_id text not null,
  phone_number_id text not null unique,
  display_phone_number text,
  verified_name text,
  connection_mode text not null default 'coexistence' check (
    connection_mode in ('coexistence', 'cloud_api')
  ),
  status text not null default 'pending' check (
    status in ('pending', 'connected', 'disconnected', 'permission_revoked', 'error')
  ),
  connected_by uuid not null references public.profiles(id) on delete restrict,
  webhook_subscribed_at timestamptz,
  last_message_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, waba_id, phone_number_id)
);

create table if not exists public.whatsapp_integration_secrets (
  integration_id uuid primary key references public.whatsapp_integrations(id) on delete cascade,
  access_token_secret_id uuid not null,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  integration_id uuid not null references public.whatsapp_integrations(id) on delete cascade,
  communication_id uuid not null references public.communications(id) on delete cascade,
  provider_message_id text not null,
  provider_conversation_id text,
  reply_to_provider_message_id text,
  sender_wa_id text,
  recipient_wa_id text,
  message_type text not null,
  status text not null check (
    status in ('received', 'sent', 'delivered', 'read', 'failed')
  ),
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_id, provider_message_id)
);

create index if not exists whatsapp_integrations_org_idx
  on public.whatsapp_integrations (organization_id, status);
create index if not exists whatsapp_messages_org_created_idx
  on public.whatsapp_messages (organization_id, created_at desc);
create index if not exists whatsapp_messages_communication_idx
  on public.whatsapp_messages (communication_id);

create or replace function public.validate_whatsapp_integration_org()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = new.connected_by
      and p.organization_id = new.organization_id
      and p.status = 'active'
  ) then
    raise exception 'WhatsApp connector must be active in the organization';
  end if;
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function public.validate_whatsapp_integration_org() from public;

drop trigger if exists whatsapp_integrations_validate_org
  on public.whatsapp_integrations;
create trigger whatsapp_integrations_validate_org
before insert or update on public.whatsapp_integrations
for each row execute function public.validate_whatsapp_integration_org();

create or replace function public.validate_whatsapp_message_org()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
begin
  if not exists (
    select 1
    from public.whatsapp_integrations integration
    join public.communications communication
      on communication.id = new.communication_id
    where integration.id = new.integration_id
      and integration.organization_id = new.organization_id
      and communication.organization_id = new.organization_id
      and communication.communication_type = 'whatsapp'
  ) then
    raise exception 'WhatsApp message must stay inside one organization';
  end if;
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function public.validate_whatsapp_message_org() from public;

drop trigger if exists whatsapp_messages_validate_org
  on public.whatsapp_messages;
create trigger whatsapp_messages_validate_org
before insert or update on public.whatsapp_messages
for each row execute function public.validate_whatsapp_message_org();

create or replace function public.match_whatsapp_phone(
  target_organization uuid,
  target_phone text
)
returns table (contact_id uuid, client_id uuid, match_type text)
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  normalized text;
  matched_contact uuid;
  converted_client uuid;
  matching_clients uuid[];
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;

  normalized := public.normalize_contact_phone(target_phone);
  if normalized is null then
    return query select null::uuid, null::uuid, 'unmatched'::text;
    return;
  end if;

  select c.id, c.converted_client_id
  into matched_contact, converted_client
  from public.contacts c
  where c.organization_id = target_organization
    and c.normalized_phone = normalized
    and c.deleted_at is null
  limit 1;

  if matched_contact is not null then
    return query select matched_contact, converted_client, 'contact'::text;
    return;
  end if;

  select array_agg(c.id order by c.created_at)
  into matching_clients
  from public.clients c
  where c.organization_id = target_organization
    and public.normalize_contact_phone(c.phone) = normalized;

  if coalesce(cardinality(matching_clients), 0) = 1 then
    return query select null::uuid, matching_clients[1], 'client'::text;
  else
    return query select null::uuid, null::uuid, 'unmatched'::text;
  end if;
end;
$$;
revoke all on function public.match_whatsapp_phone(uuid, text) from public;
grant execute on function public.match_whatsapp_phone(uuid, text) to service_role;

create or replace function public.upsert_whatsapp_message_communication(
  target_integration uuid,
  target_provider_message_id text,
  target_direction text,
  target_body text,
  target_sender_name text,
  target_sender_phone text,
  target_recipient_phone text,
  target_message_type text,
  target_occurred_at timestamptz,
  target_metadata jsonb
)
returns table (communication_id uuid, inserted boolean)
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  integration_record public.whatsapp_integrations%rowtype;
  matched_contact uuid;
  matched_client uuid;
  matched_kind text;
  inserted_communication uuid;
  party_phone text;
  initial_communication_status text;
  initial_provider_status text;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  if target_direction not in ('inbound', 'outbound') then raise exception 'Invalid direction'; end if;
  if nullif(btrim(target_provider_message_id), '') is null then
    raise exception 'Provider message ID is required';
  end if;
  if nullif(btrim(target_body), '') is null then raise exception 'Message body is required'; end if;

  select * into integration_record
  from public.whatsapp_integrations integration
  where integration.id = target_integration and integration.status = 'connected';
  if not found then raise exception 'Connected WhatsApp integration not found'; end if;

  party_phone := case when target_direction = 'inbound'
    then target_sender_phone else target_recipient_phone end;
  select matched.contact_id, matched.client_id, matched.match_type
  into matched_contact, matched_client, matched_kind
  from public.match_whatsapp_phone(integration_record.organization_id, party_phone) matched;

  initial_communication_status := case when target_direction = 'inbound' then 'unread' else 'sent' end;
  initial_provider_status := case when target_direction = 'inbound' then 'received' else 'sent' end;

  begin
    insert into public.communications (
      organization_id, created_by, contact_id, client_id, communication_type,
      direction, subject, body, sender_name, sender_address, recipient_address,
      occurred_at, status, metadata
    ) values (
      integration_record.organization_id,
      integration_record.connected_by,
      matched_contact,
      matched_client,
      'whatsapp',
      target_direction,
      case when target_sender_name is not null and target_direction = 'inbound'
        then 'WhatsApp message from ' || target_sender_name
        else 'WhatsApp message' end,
      target_body,
      target_sender_name,
      target_sender_phone,
      target_recipient_phone,
      coalesce(target_occurred_at, now()),
      initial_communication_status,
      coalesce(target_metadata, '{}'::jsonb) || jsonb_build_object(
        'provider', 'whatsapp',
        'provider_message_id', target_provider_message_id,
        'message_type', target_message_type,
        'match_type', matched_kind
      )
    ) returning id into inserted_communication;

    insert into public.whatsapp_messages (
      organization_id, integration_id, communication_id, provider_message_id,
      provider_conversation_id, reply_to_provider_message_id,
      sender_wa_id, recipient_wa_id, message_type, status, metadata
    ) values (
      integration_record.organization_id,
      integration_record.id,
      inserted_communication,
      target_provider_message_id,
      target_metadata ->> 'conversation_id',
      target_metadata ->> 'reply_to_provider_message_id',
      public.normalize_contact_phone(target_sender_phone),
      public.normalize_contact_phone(target_recipient_phone),
      target_message_type,
      initial_provider_status,
      coalesce(target_metadata, '{}'::jsonb)
    );

    update public.whatsapp_integrations
    set last_message_at = now(), last_error = null
    where id = integration_record.id;

    return query select inserted_communication, true;
    return;
  exception when unique_violation then
    return query
      select message.communication_id, false
      from public.whatsapp_messages message
      where message.integration_id = integration_record.id
        and message.provider_message_id = target_provider_message_id;
    return;
  end;
end;
$$;
revoke all on function public.upsert_whatsapp_message_communication(
  uuid, text, text, text, text, text, text, text, timestamptz, jsonb
) from public;
grant execute on function public.upsert_whatsapp_message_communication(
  uuid, text, text, text, text, text, text, text, timestamptz, jsonb
) to service_role;

create or replace function public.apply_whatsapp_message_status(
  target_integration uuid,
  target_provider_message_id text,
  target_status text,
  target_conversation_id text,
  target_error jsonb
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  message_record public.whatsapp_messages%rowtype;
  next_status text;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  if target_status not in ('sent', 'delivered', 'read', 'failed') then return false; end if;

  select message.* into message_record
  from public.whatsapp_messages message
  where message.integration_id = target_integration
    and message.provider_message_id = target_provider_message_id
  for update;
  if not found then return false; end if;

  next_status := message_record.status;
  if target_status = 'read' and message_record.status in ('sent', 'delivered') then
    next_status := 'read';
  elsif target_status = 'delivered' and message_record.status = 'sent' then
    next_status := 'delivered';
  elsif target_status = 'failed' and message_record.status = 'sent' then
    next_status := 'failed';
  elsif target_status = 'sent' and message_record.status = 'sent' then
    next_status := 'sent';
  end if;

  update public.whatsapp_messages
  set status = next_status,
      provider_conversation_id = coalesce(target_conversation_id, provider_conversation_id),
      error_code = target_error ->> 'code',
      error_message = coalesce(target_error ->> 'message', target_error ->> 'title'),
      metadata = metadata || case when target_error is null
        then '{}'::jsonb else jsonb_build_object('last_error', target_error) end
  where id = message_record.id;

  update public.communications
  set status = case when status = 'archived' then status else next_status end
  where id = message_record.communication_id;

  return true;
end;
$$;
revoke all on function public.apply_whatsapp_message_status(
  uuid, text, text, text, jsonb
) from public;
grant execute on function public.apply_whatsapp_message_status(
  uuid, text, text, text, jsonb
) to service_role;

create or replace function public.store_whatsapp_integration_token(
  target_integration uuid,
  access_token text,
  token_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  secret_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  if nullif(access_token, '') is null then raise exception 'Access token is required'; end if;

  select access_token_secret_id into secret_id
  from public.whatsapp_integration_secrets
  where integration_id = target_integration
  for update;

  if secret_id is null then
    secret_id := vault.create_secret(access_token, 'whatsapp-access-' || target_integration);
  else
    perform vault.update_secret(secret_id, access_token);
  end if;

  insert into public.whatsapp_integration_secrets (
    integration_id, access_token_secret_id, expires_at
  ) values (
    target_integration, secret_id, token_expires_at
  )
  on conflict (integration_id) do update
  set access_token_secret_id = excluded.access_token_secret_id,
      expires_at = excluded.expires_at,
      updated_at = now();
end;
$$;
revoke all on function public.store_whatsapp_integration_token(uuid, text, timestamptz)
  from public;
grant execute on function public.store_whatsapp_integration_token(uuid, text, timestamptz)
  to service_role;

create or replace function public.read_whatsapp_integration_token(target_integration uuid)
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
    'access_token', decrypted.decrypted_secret,
    'expires_at', secrets.expires_at
  ) into result
  from public.whatsapp_integration_secrets secrets
  join vault.decrypted_secrets decrypted
    on decrypted.id = secrets.access_token_secret_id
  where secrets.integration_id = target_integration;
  return result;
end;
$$;
revoke all on function public.read_whatsapp_integration_token(uuid) from public;
grant execute on function public.read_whatsapp_integration_token(uuid) to service_role;

alter table public.whatsapp_integrations enable row level security;
alter table public.whatsapp_integration_secrets enable row level security;
alter table public.whatsapp_messages enable row level security;

drop policy if exists "Active members read WhatsApp integrations"
  on public.whatsapp_integrations;
create policy "Active members read WhatsApp integrations"
on public.whatsapp_integrations for select to authenticated
using (organization_id = public.current_active_organization_id());

drop policy if exists "Active members read WhatsApp messages"
  on public.whatsapp_messages;
create policy "Active members read WhatsApp messages"
on public.whatsapp_messages for select to authenticated
using (organization_id = public.current_active_organization_id());

revoke all on public.whatsapp_integration_secrets from public, anon, authenticated;
revoke insert, update, delete on public.whatsapp_integrations, public.whatsapp_messages
  from anon, authenticated;
grant select on public.whatsapp_integrations, public.whatsapp_messages to authenticated;
