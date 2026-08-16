-- FLUXO Email data reset: destructive database-only cleanup.
-- REVIEW email-data-reset-preview.sql FIRST. Do not run this file until the
-- preview row and counts have been explicitly approved.
--
-- Safety properties:
-- - requires explicit organization and Google account UUIDs plus confirmation;
-- - refuses an organization that has any other email account;
-- - deletes only communications whose communication_type is 'email';
-- - relies on FK cascades for email_messages and email_attachments metadata;
-- - preserves documents, Clients, Matters, Tasks, users, organizations,
--   profiles, non-email Communications, email_accounts, token metadata, and
--   every Vault secret;
-- - never calls Gmail or any other provider API.
--
-- Before execution, pause the Gmail sync cron job, keep Communications closed,
-- and wait for any in-flight sync invocation to finish. Otherwise a concurrent
-- sync can repopulate rows or advance sync_cursor around this transaction.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

do $cleanup$
declare
  -- Replace both UUIDs with the reviewed preview values.
  target_organization_id constant uuid :=
    '00000000-0000-0000-0000-000000000000'::uuid;
  target_email_account_id constant uuid :=
    '00000000-0000-0000-0000-000000000000'::uuid;

  -- Replace this with: RESET FLUXO EMAIL DATA <target_email_account_id>
  confirmation constant text := 'REPLACE_WITH_RESET_CONFIRMATION';

  target_account public.email_accounts%rowtype;
  expected_confirmation text;
  other_account_count bigint;
  inconsistent_link_count bigint;
  email_communication_count bigint;
  email_message_count bigint;
  email_attachment_count bigint;
  non_email_communication_count bigint;
  token_metadata_count bigint;
  access_token_secret_id_before uuid;
  refresh_token_secret_id_before uuid;
  token_expires_at_before timestamptz;
  deleted_communication_count bigint;
  remaining_count bigint;
begin
  if target_organization_id = '00000000-0000-0000-0000-000000000000'::uuid
    or target_email_account_id = '00000000-0000-0000-0000-000000000000'::uuid
  then
    raise exception 'Replace both zero UUID placeholders with previewed values';
  end if;

  expected_confirmation :=
    'RESET FLUXO EMAIL DATA ' || target_email_account_id::text;
  if confirmation <> expected_confirmation then
    raise exception 'Confirmation text does not match the target account';
  end if;

  select account.*
  into target_account
  from public.email_accounts account
  where account.id = target_email_account_id
    and account.organization_id = target_organization_id
    and account.provider = 'google'
    and account.status = 'connected'
    and account.connected_email is not null
  for update;

  if not found then
    raise exception 'Connected Google account does not match both target UUIDs';
  end if;

  select count(*)
  into other_account_count
  from public.email_accounts account
  where account.organization_id = target_organization_id
    and account.id <> target_email_account_id;

  if other_account_count <> 0 then
    raise exception
      'Organization has % other email account(s); use a separately reviewed multi-account cleanup',
      other_account_count;
  end if;

  select count(*)
  into inconsistent_link_count
  from public.email_messages message
  join public.communications communication
    on communication.id = message.communication_id
  where message.account_id = target_email_account_id
    and (
      communication.organization_id <> target_organization_id
      or communication.communication_type <> 'email'
    );

  if inconsistent_link_count <> 0 then
    raise exception
      'Target account has % message link(s) outside the scoped Email Communications',
      inconsistent_link_count;
  end if;

  select count(*)
  into email_communication_count
  from public.communications communication
  where communication.organization_id = target_organization_id
    and communication.communication_type = 'email';

  select count(*)
  into email_message_count
  from public.email_messages message
  join public.communications communication
    on communication.id = message.communication_id
  where communication.organization_id = target_organization_id
    and communication.communication_type = 'email';

  select count(*)
  into email_attachment_count
  from public.email_attachments attachment
  join public.email_messages message on message.id = attachment.email_message_id
  join public.communications communication
    on communication.id = message.communication_id
  where communication.organization_id = target_organization_id
    and communication.communication_type = 'email';

  select count(*)
  into non_email_communication_count
  from public.communications communication
  where communication.organization_id = target_organization_id
    and communication.communication_type <> 'email';

  select count(*)
  into token_metadata_count
  from public.email_account_secrets secret
  where secret.account_id = target_email_account_id;

  if token_metadata_count <> 1 then
    raise exception
      'Expected exactly one untouched token metadata row; found %',
      token_metadata_count;
  end if;

  select
    secret.access_token_secret_id,
    secret.refresh_token_secret_id,
    secret.expires_at
  into
    access_token_secret_id_before,
    refresh_token_secret_id_before,
    token_expires_at_before
  from public.email_account_secrets secret
  where secret.account_id = target_email_account_id;

  delete from public.communications communication
  where communication.organization_id = target_organization_id
    and communication.communication_type = 'email';

  get diagnostics deleted_communication_count = row_count;
  if deleted_communication_count <> email_communication_count then
    raise exception
      'Deleted % Email Communications but previewed %',
      deleted_communication_count,
      email_communication_count;
  end if;

  update public.email_accounts account
  set sync_cursor = null,
      last_sync_at = null,
      last_error = null
  where account.id = target_email_account_id
    and account.organization_id = target_organization_id
    and account.provider = 'google'
    and account.status = 'connected';

  if not found then
    raise exception 'Target Google account was not preserved as connected';
  end if;

  select count(*)
  into remaining_count
  from public.email_messages message
  where message.account_id = target_email_account_id;

  if remaining_count <> 0 then
    raise exception 'Provider message linkage remains after cleanup';
  end if;

  select count(*)
  into remaining_count
  from public.communications communication
  where communication.organization_id = target_organization_id
    and communication.communication_type = 'email';

  if remaining_count <> 0 then
    raise exception 'Email Communications remain after cleanup';
  end if;

  select count(*)
  into remaining_count
  from public.communications communication
  where communication.organization_id = target_organization_id
    and communication.communication_type <> 'email';

  if remaining_count <> non_email_communication_count then
    raise exception 'Non-email Communication count changed during cleanup';
  end if;

  select count(*)
  into remaining_count
  from public.email_account_secrets secret
  where secret.account_id = target_email_account_id;

  if remaining_count <> token_metadata_count then
    raise exception 'Email token metadata changed during cleanup';
  end if;

  if target_account.connected_email is distinct from (
    select account.connected_email
    from public.email_accounts account
    where account.id = target_email_account_id
  ) then
    raise exception 'Connected Gmail address changed during cleanup';
  end if;

  if exists (
    select 1
    from public.email_accounts account
    where account.id = target_email_account_id
      and (
        account.organization_id is distinct from target_account.organization_id
        or account.provider is distinct from target_account.provider
        or account.provider_account_id is distinct from target_account.provider_account_id
        or account.status is distinct from target_account.status
      )
  ) then
    raise exception 'Connected Gmail account configuration changed during cleanup';
  end if;

  if exists (
    select 1
    from public.email_account_secrets secret
    where secret.account_id = target_email_account_id
      and (
        secret.access_token_secret_id is distinct from access_token_secret_id_before
        or secret.refresh_token_secret_id is distinct from refresh_token_secret_id_before
        or secret.expires_at is distinct from token_expires_at_before
      )
  ) then
    raise exception 'Email token metadata values changed during cleanup';
  end if;

  raise notice
    'Removed % Email Communications, % message links, and % attachment metadata rows; preserved % non-email Communications',
    email_communication_count,
    email_message_count,
    email_attachment_count,
    non_email_communication_count;
end
$cleanup$;

commit;
