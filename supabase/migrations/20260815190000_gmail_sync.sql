-- Atomic, provider-neutral email import/link operation used by Gmail polling
-- and the existing post-send path. Gmail OAuth tokens remain in Vault.

create index if not exists email_messages_account_thread_idx
  on public.email_messages (account_id, provider_thread_id)
  where provider_thread_id is not null;

create index if not exists email_messages_account_internet_id_idx
  on public.email_messages (account_id, internet_message_id)
  where internet_message_id is not null;

create or replace function public.upsert_email_message_communication(
  target_account uuid,
  target_provider_message_id text,
  target_provider_thread_id text,
  target_internet_message_id text,
  target_direction text,
  target_subject text,
  target_body text,
  target_sender_name text,
  target_sender_address text,
  target_recipient_name text,
  target_recipient_address text,
  target_cc text[],
  target_bcc text[],
  target_headers jsonb,
  target_occurred_at timestamptz,
  target_status text,
  target_is_important boolean,
  target_client_id uuid,
  target_matter_id uuid
)
returns table(
  communication_id uuid,
  email_message_id uuid,
  created boolean
)
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  account_row public.email_accounts%rowtype;
  existing_communication_id uuid;
  existing_email_message_id uuid;
  inserted_communication_id uuid;
  inserted_email_message_id uuid;
  matter_client_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;

  if coalesce(trim(target_provider_message_id), '') = '' then
    raise exception 'Provider message ID is required';
  end if;

  if target_direction not in ('inbound', 'outbound') then
    raise exception 'Invalid email direction';
  end if;

  if target_status not in ('unread', 'read', 'replied', 'archived') then
    raise exception 'Invalid communication status';
  end if;

  select account.*
  into account_row
  from public.email_accounts account
  where account.id = target_account
    and account.provider in ('google', 'microsoft')
    and account.status in ('connected', 'sync_error');

  if not found then
    raise exception 'Connected email account not found';
  end if;

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = account_row.user_id
      and profile.organization_id = account_row.organization_id
      and profile.status = 'active'
  ) then
    raise exception 'Email account owner is not active';
  end if;

  if target_client_id is not null and not exists (
    select 1
    from public.clients client
    where client.id = target_client_id
      and client.organization_id = account_row.organization_id
  ) then
    raise exception 'Email client must belong to the account organization';
  end if;

  if target_matter_id is not null then
    select matter.client_id
    into matter_client_id
    from public.matters matter
    where matter.id = target_matter_id
      and matter.organization_id = account_row.organization_id;

    if not found then
      raise exception 'Email matter must belong to the account organization';
    end if;

    if target_client_id is not null and matter_client_id <> target_client_id then
      raise exception 'Email matter must belong to the selected client';
    end if;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(target_account::text || ':' || target_provider_message_id, 0)
  );

  select message.communication_id, message.id
  into existing_communication_id, existing_email_message_id
  from public.email_messages message
  where message.account_id = target_account
    and message.provider_message_id = target_provider_message_id
  for update;

  if found then
    update public.email_messages message
    set provider_thread_id = coalesce(target_provider_thread_id, message.provider_thread_id),
        internet_message_id = coalesce(target_internet_message_id, message.internet_message_id),
        cc = coalesce(target_cc, message.cc),
        bcc = coalesce(target_bcc, message.bcc),
        headers = message.headers || coalesce(target_headers, '{}'::jsonb),
        sync_status = 'synced'
    where message.id = existing_email_message_id;

    if target_client_id is not null then
      update public.communications communication
      set client_id = target_client_id
      where communication.id = existing_communication_id
        and communication.client_id is null
        and communication.matter_id is null;
    end if;

    return query
    select existing_communication_id, existing_email_message_id, false;
    return;
  end if;

  insert into public.communications (
    organization_id,
    created_by,
    client_id,
    matter_id,
    communication_type,
    direction,
    subject,
    body,
    sender_name,
    sender_address,
    recipient_name,
    recipient_address,
    occurred_at,
    status,
    is_important
  ) values (
    account_row.organization_id,
    account_row.user_id,
    target_client_id,
    target_matter_id,
    'email',
    target_direction,
    nullif(target_subject, ''),
    nullif(target_body, ''),
    nullif(target_sender_name, ''),
    nullif(target_sender_address, ''),
    nullif(target_recipient_name, ''),
    nullif(target_recipient_address, ''),
    target_occurred_at,
    target_status,
    coalesce(target_is_important, false)
  )
  returning id into inserted_communication_id;

  insert into public.email_messages (
    communication_id,
    account_id,
    organization_id,
    provider_message_id,
    provider_thread_id,
    internet_message_id,
    cc,
    bcc,
    headers,
    sync_status
  ) values (
    inserted_communication_id,
    target_account,
    account_row.organization_id,
    target_provider_message_id,
    target_provider_thread_id,
    target_internet_message_id,
    coalesce(target_cc, '{}'::text[]),
    coalesce(target_bcc, '{}'::text[]),
    coalesce(target_headers, '{}'::jsonb),
    'synced'
  )
  returning id into inserted_email_message_id;

  return query
  select inserted_communication_id, inserted_email_message_id, true;
end
$$;

revoke all on function public.upsert_email_message_communication(
  uuid, text, text, text, text, text, text, text, text, text, text,
  text[], text[], jsonb, timestamptz, text, boolean, uuid, uuid
) from public;
revoke all on function public.upsert_email_message_communication(
  uuid, text, text, text, text, text, text, text, text, text, text,
  text[], text[], jsonb, timestamptz, text, boolean, uuid, uuid
) from anon;
revoke all on function public.upsert_email_message_communication(
  uuid, text, text, text, text, text, text, text, text, text, text,
  text[], text[], jsonb, timestamptz, text, boolean, uuid, uuid
) from authenticated;
grant execute on function public.upsert_email_message_communication(
  uuid, text, text, text, text, text, text, text, text, text, text,
  text[], text[], jsonb, timestamptz, text, boolean, uuid, uuid
) to service_role;

comment on function public.upsert_email_message_communication(
  uuid, text, text, text, text, text, text, text, text, text, text,
  text[], text[], jsonb, timestamptz, text, boolean, uuid, uuid
) is 'Service-role-only atomic email communication import and provider-ID deduplication.';
