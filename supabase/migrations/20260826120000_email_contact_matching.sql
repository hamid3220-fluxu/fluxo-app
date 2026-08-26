-- Link Gmail imports to an existing Contact when no unique Client matches.
-- This wrapper keeps the existing email import function unchanged for sending.

create or replace function public.upsert_email_message_communication_with_contact(
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
  target_contact_id uuid,
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
  imported_communication_id uuid;
  imported_email_message_id uuid;
  imported_created boolean;
begin
  select imported.communication_id, imported.email_message_id, imported.created
  into imported_communication_id, imported_email_message_id, imported_created
  from public.upsert_email_message_communication(
    target_account,
    target_provider_message_id,
    target_provider_thread_id,
    target_internet_message_id,
    target_direction,
    target_subject,
    target_body,
    target_sender_name,
    target_sender_address,
    target_recipient_name,
    target_recipient_address,
    target_cc,
    target_bcc,
    target_headers,
    target_occurred_at,
    target_status,
    target_is_important,
    target_client_id,
    target_matter_id
  ) imported;

  if target_contact_id is not null then
    update public.communications communication
    set contact_id = target_contact_id
    where communication.id = imported_communication_id
      and communication.contact_id is null;
  end if;

  return query
  select imported_communication_id, imported_email_message_id, imported_created;
end
$$;

revoke all on function public.upsert_email_message_communication_with_contact(
  uuid, text, text, text, text, text, text, text, text, text, text,
  text[], text[], jsonb, timestamptz, text, boolean, uuid, uuid, uuid
) from public, anon, authenticated;

grant execute on function public.upsert_email_message_communication_with_contact(
  uuid, text, text, text, text, text, text, text, text, text, text,
  text[], text[], jsonb, timestamptz, text, boolean, uuid, uuid, uuid
) to service_role;

comment on function public.upsert_email_message_communication_with_contact(
  uuid, text, text, text, text, text, text, text, text, text, text,
  text[], text[], jsonb, timestamptz, text, boolean, uuid, uuid, uuid
) is 'Service-role-only atomic Gmail import with optional existing Contact linkage.';
