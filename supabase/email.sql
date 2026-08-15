-- FLUXO Email integration metadata. Tokens remain in Vault and server-only tables.
create extension if not exists supabase_vault with schema vault;

create table if not exists public.email_accounts (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade, provider text not null check(provider in('google','microsoft')),
 connected_email text, provider_account_id text, status text not null default 'not_connected' check(status in('not_configured','not_connected','connecting','connected','token_expired','permission_revoked','sync_error')),
 last_sync_at timestamptz, sync_cursor text, last_error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,provider)
);
create table if not exists public.email_account_secrets (
 account_id uuid primary key references public.email_accounts(id) on delete cascade, access_token_secret_id uuid not null, refresh_token_secret_id uuid, expires_at timestamptz, updated_at timestamptz not null default now()
);
create table if not exists public.email_oauth_states (
 state_hash text primary key, organization_id uuid not null references public.organizations(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade,
 provider text not null check(provider in('google','microsoft')), redirect_uri text not null, expires_at timestamptz not null default(now()+interval '10 minutes'), used_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.email_messages (
 id uuid primary key default gen_random_uuid(), communication_id uuid not null references public.communications(id) on delete cascade,
 account_id uuid not null references public.email_accounts(id) on delete cascade, organization_id uuid not null references public.organizations(id) on delete cascade,
 provider_message_id text not null, provider_thread_id text, internet_message_id text, cc text[] not null default '{}', bcc text[] not null default '{}', headers jsonb not null default '{}', sync_status text not null default 'synced' check(sync_status in('pending','synced','error')), created_at timestamptz not null default now(), unique(account_id,provider_message_id)
);
create table if not exists public.email_attachments (
 id uuid primary key default gen_random_uuid(), email_message_id uuid not null references public.email_messages(id) on delete cascade,
 provider_attachment_id text not null, filename text not null, mime_type text, file_size bigint, document_id uuid references public.documents(id) on delete set null, created_at timestamptz not null default now(), unique(email_message_id,provider_attachment_id)
);
create index if not exists email_accounts_org_user_idx on public.email_accounts(organization_id,user_id);
create index if not exists email_messages_org_created_idx on public.email_messages(organization_id,created_at desc);
create index if not exists email_messages_account_thread_idx on public.email_messages(account_id,provider_thread_id) where provider_thread_id is not null;
create index if not exists email_messages_account_internet_id_idx on public.email_messages(account_id,internet_message_id) where internet_message_id is not null;

create or replace function public.validate_email_account_org() returns trigger language plpgsql security definer set search_path=pg_catalog set row_security=off as $$ begin
 if not exists(select 1 from public.profiles p where p.id=new.user_id and p.organization_id=new.organization_id and p.status='active') then raise exception 'Email account user must be active in organization'; end if; return new; end $$;
revoke all on function public.validate_email_account_org() from public;
drop trigger if exists email_accounts_validate_org on public.email_accounts;
create trigger email_accounts_validate_org before insert or update on public.email_accounts for each row execute function public.validate_email_account_org();
create or replace function public.set_email_updated_at() returns trigger language plpgsql security invoker set search_path=pg_catalog as $$ begin new.updated_at=now();return new;end $$;
revoke all on function public.set_email_updated_at() from public;
drop trigger if exists email_accounts_set_updated_at on public.email_accounts;
create trigger email_accounts_set_updated_at before update on public.email_accounts for each row execute function public.set_email_updated_at();

alter table public.email_accounts enable row level security; alter table public.email_account_secrets enable row level security; alter table public.email_oauth_states enable row level security; alter table public.email_messages enable row level security; alter table public.email_attachments enable row level security;
drop policy if exists "Users read own email accounts" on public.email_accounts; create policy "Users read own email accounts" on public.email_accounts for select to authenticated using(user_id=auth.uid() and organization_id=public.current_active_organization_id());
drop policy if exists "Users update own email accounts" on public.email_accounts;
drop policy if exists "Organization reads email message links" on public.email_messages; create policy "Organization reads email message links" on public.email_messages for select to authenticated using(organization_id=public.current_active_organization_id());
drop policy if exists "Organization reads email attachments" on public.email_attachments; create policy "Organization reads email attachments" on public.email_attachments for select to authenticated using(exists(select 1 from public.email_messages m where m.id=email_message_id and m.organization_id=public.current_active_organization_id()));

-- Only service-role Edge Functions receive grants for token/state and provider mapping writes.
revoke all on public.email_account_secrets,public.email_oauth_states from public,anon,authenticated;
revoke all on vault.secrets,vault.decrypted_secrets from public,anon,authenticated;
revoke insert,update,delete on public.email_accounts from anon,authenticated;
grant select on public.email_accounts,public.email_messages,public.email_attachments to authenticated;

create or replace function public.store_email_account_tokens(target_account uuid,access_token text,refresh_token text,token_expires_at timestamptz)
returns void language plpgsql security definer set search_path=pg_catalog set row_security=off as $$
declare access_id uuid; refresh_id uuid;
begin
 if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
 select access_token_secret_id,refresh_token_secret_id into access_id,refresh_id from public.email_account_secrets where account_id=target_account;
 if access_id is null then access_id:=vault.create_secret(access_token,'email-access-'||target_account); else perform vault.update_secret(access_id,access_token); end if;
 if refresh_token is not null then if refresh_id is null then refresh_id:=vault.create_secret(refresh_token,'email-refresh-'||target_account); else perform vault.update_secret(refresh_id,refresh_token); end if; end if;
 insert into public.email_account_secrets(account_id,access_token_secret_id,refresh_token_secret_id,expires_at) values(target_account,access_id,refresh_id,token_expires_at)
 on conflict(account_id) do update set access_token_secret_id=excluded.access_token_secret_id,refresh_token_secret_id=coalesce(excluded.refresh_token_secret_id,email_account_secrets.refresh_token_secret_id),expires_at=excluded.expires_at,updated_at=now();
end $$;
revoke all on function public.store_email_account_tokens(uuid,text,text,timestamptz) from public;
grant execute on function public.store_email_account_tokens(uuid,text,text,timestamptz) to service_role;
create or replace function public.read_email_access_token(target_account uuid) returns text language plpgsql security definer set search_path=pg_catalog set row_security=off as $$declare result text;begin if auth.role()<>'service_role' then raise exception 'Service role required';end if;select decrypted_secret into result from vault.decrypted_secrets s join public.email_account_secrets eas on eas.access_token_secret_id=s.id where eas.account_id=target_account;return result;end$$;
revoke all on function public.read_email_access_token(uuid) from public;
grant execute on function public.read_email_access_token(uuid) to service_role;

create or replace function public.delete_email_account_tokens(target_account uuid)
returns void language plpgsql security definer set search_path=pg_catalog set row_security=off as $$
declare access_id uuid; refresh_id uuid;
begin
 if auth.role()<>'service_role' then raise exception 'Service role required'; end if;
 select access_token_secret_id,refresh_token_secret_id into access_id,refresh_id from public.email_account_secrets where account_id=target_account for update;
 delete from public.email_account_secrets where account_id=target_account;
 delete from vault.secrets where id=access_id or id=refresh_id;
 update public.email_accounts set status='not_connected',connected_email=null,sync_cursor=null,last_error=null where id=target_account;
end $$;
revoke all on function public.delete_email_account_tokens(uuid) from public;
grant execute on function public.delete_email_account_tokens(uuid) to service_role;

-- Atomic provider-message link/import. The advisory lock and existing unique
-- key prevent Gmail polling from duplicating a communication created by send.
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
returns table(communication_id uuid,email_message_id uuid,created boolean)
language plpgsql security definer set search_path=pg_catalog set row_security=off as $$
declare account_row public.email_accounts%rowtype; existing_communication_id uuid; existing_email_message_id uuid; inserted_communication_id uuid; inserted_email_message_id uuid; matter_client_id uuid;
begin
 if auth.role()<>'service_role' then raise exception 'Service role required'; end if;
 if coalesce(trim(target_provider_message_id),'')='' then raise exception 'Provider message ID is required'; end if;
 if target_direction not in('inbound','outbound') then raise exception 'Invalid email direction'; end if;
 if target_status not in('unread','read','replied','archived') then raise exception 'Invalid communication status'; end if;
 select account.* into account_row from public.email_accounts account where account.id=target_account and account.provider in('google','microsoft') and account.status in('connected','sync_error');
 if not found then raise exception 'Connected email account not found'; end if;
 if not exists(select 1 from public.profiles profile where profile.id=account_row.user_id and profile.organization_id=account_row.organization_id and profile.status='active') then raise exception 'Email account owner is not active'; end if;
 if target_client_id is not null and not exists(select 1 from public.clients client where client.id=target_client_id and client.organization_id=account_row.organization_id) then raise exception 'Email client must belong to the account organization'; end if;
 if target_matter_id is not null then
  select matter.client_id into matter_client_id from public.matters matter where matter.id=target_matter_id and matter.organization_id=account_row.organization_id;
  if not found then raise exception 'Email matter must belong to the account organization'; end if;
  if target_client_id is not null and matter_client_id<>target_client_id then raise exception 'Email matter must belong to the selected client'; end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(target_account::text||':'||target_provider_message_id,0));
 select message.communication_id,message.id into existing_communication_id,existing_email_message_id from public.email_messages message where message.account_id=target_account and message.provider_message_id=target_provider_message_id for update;
 if found then
  update public.email_messages message set provider_thread_id=coalesce(target_provider_thread_id,message.provider_thread_id),internet_message_id=coalesce(target_internet_message_id,message.internet_message_id),cc=coalesce(target_cc,message.cc),bcc=coalesce(target_bcc,message.bcc),headers=message.headers||coalesce(target_headers,'{}'::jsonb),sync_status='synced' where message.id=existing_email_message_id;
  if target_client_id is not null then update public.communications communication set client_id=target_client_id where communication.id=existing_communication_id and communication.client_id is null and communication.matter_id is null; end if;
  return query select existing_communication_id,existing_email_message_id,false; return;
 end if;
 insert into public.communications(organization_id,created_by,client_id,matter_id,communication_type,direction,subject,body,sender_name,sender_address,recipient_name,recipient_address,occurred_at,status,is_important)
 values(account_row.organization_id,account_row.user_id,target_client_id,target_matter_id,'email',target_direction,nullif(target_subject,''),nullif(target_body,''),nullif(target_sender_name,''),nullif(target_sender_address,''),nullif(target_recipient_name,''),nullif(target_recipient_address,''),target_occurred_at,target_status,coalesce(target_is_important,false)) returning id into inserted_communication_id;
 insert into public.email_messages(communication_id,account_id,organization_id,provider_message_id,provider_thread_id,internet_message_id,cc,bcc,headers,sync_status)
 values(inserted_communication_id,target_account,account_row.organization_id,target_provider_message_id,target_provider_thread_id,target_internet_message_id,coalesce(target_cc,'{}'::text[]),coalesce(target_bcc,'{}'::text[]),coalesce(target_headers,'{}'::jsonb),'synced') returning id into inserted_email_message_id;
 return query select inserted_communication_id,inserted_email_message_id,true;
end$$;
revoke all on function public.upsert_email_message_communication(uuid,text,text,text,text,text,text,text,text,text,text,text[],text[],jsonb,timestamptz,text,boolean,uuid,uuid) from public,anon,authenticated;
grant execute on function public.upsert_email_message_communication(uuid,text,text,text,text,text,text,text,text,text,text,text[],text[],jsonb,timestamptz,text,boolean,uuid,uuid) to service_role;
