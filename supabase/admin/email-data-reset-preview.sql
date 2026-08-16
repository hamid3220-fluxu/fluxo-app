-- FLUXO Email data reset: read-only preview.
-- Run statement 1 first to identify the exact connected Google account.
-- This file contains SELECT statements only and does not call any provider API.

-- 1. Identify the target. Copy both UUIDs from exactly one reviewed row.
select
  account.id as email_account_id,
  account.organization_id,
  account.connected_email,
  account.provider,
  account.status,
  account.sync_cursor,
  account.last_sync_at,
  account.last_error
from public.email_accounts account
where account.provider = 'google'
  and account.status = 'connected'
  and account.connected_email is not null
order by account.organization_id, account.connected_email;

-- 2. Replace both zero UUIDs with the values selected above, then run this
-- statement separately. A mismatch returns zero rows and never deletes data.
with
params as (
  select
    '00000000-0000-0000-0000-000000000000'::uuid as organization_id,
    '00000000-0000-0000-0000-000000000000'::uuid as email_account_id
),
target_account as (
  select account.*
  from public.email_accounts account
  join params
    on params.organization_id = account.organization_id
   and params.email_account_id = account.id
  where account.provider = 'google'
    and account.status = 'connected'
    and account.connected_email is not null
),
email_communications as (
  select communication.id
  from public.communications communication
  join params on params.organization_id = communication.organization_id
  where communication.communication_type = 'email'
),
email_message_rows as (
  select message.id, message.account_id
  from public.email_messages message
  join email_communications on email_communications.id = message.communication_id
),
non_email_counts as (
  select
    communication.communication_type,
    count(*)::bigint as row_count
  from public.communications communication
  join params on params.organization_id = communication.organization_id
  where communication.communication_type <> 'email'
  group by communication.communication_type
)
select
  target.id as email_account_id,
  target.connected_email,
  target.organization_id,
  target.status,
  target.sync_cursor,
  target.last_sync_at,
  target.last_error,
  (select count(*) from email_communications) as email_communications_to_remove,
  (select count(*) from email_message_rows) as email_messages_to_remove,
  (
    select count(*)
    from public.email_attachments attachment
    join email_message_rows on email_message_rows.id = attachment.email_message_id
  ) as email_attachments_to_remove,
  (
    select count(*)
    from email_message_rows
    where email_message_rows.account_id = target.id
  ) as target_account_message_links,
  (
    select count(*)
    from public.email_messages message
    join public.communications communication
      on communication.id = message.communication_id
    where message.account_id = target.id
      and (
        communication.organization_id <> target.organization_id
        or communication.communication_type <> 'email'
      )
  ) as inconsistent_target_message_links,
  (
    select count(*)
    from public.email_accounts other_account
    where other_account.organization_id = target.organization_id
      and other_account.id <> target.id
  ) as other_email_accounts_in_organization,
  (
    select coalesce(
      jsonb_object_agg(non_email_counts.communication_type, non_email_counts.row_count),
      '{}'::jsonb
    )
    from non_email_counts
  ) as non_email_communications_preserved
from target_account target;
