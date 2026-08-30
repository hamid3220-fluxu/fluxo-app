-- AI Agent foundation for FLUXO.
-- Adds per-organization Claude/OpenAI credential storage (Vault-backed, mirrors
-- whatsapp_integration_secrets), agent conversations/messages, and the
-- agent_actions approval queue. No client-side insert/update/delete grant is
-- given on agent_actions: only service-role edge functions may write it, so
-- the approve/reject gate cannot be bypassed by a direct client call.
create extension if not exists pgcrypto;
create extension if not exists supabase_vault with schema vault;

-- ---------------------------------------------------------------------------
-- Provider credentials (Anthropic / OpenAI API keys, one row per org+provider)
-- ---------------------------------------------------------------------------
create table if not exists public.agent_provider_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('anthropic', 'openai')),
  status text not null default 'not_configured' check (
    status in ('not_configured', 'configured', 'error')
  ),
  last_error text,
  configured_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  unique (organization_id, provider)
);

create table if not exists public.agent_provider_secrets (
  credential_id uuid primary key references public.agent_provider_credentials(id) on delete cascade,
  api_key_secret_id uuid not null,
  updated_at timestamptz not null default now()
);

create or replace function public.store_agent_provider_key(
  target_credential uuid,
  api_key text
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
  if nullif(api_key, '') is null then raise exception 'API key is required'; end if;

  select api_key_secret_id into secret_id
  from public.agent_provider_secrets
  where credential_id = target_credential
  for update;

  if secret_id is null then
    secret_id := vault.create_secret(api_key, 'agent-provider-key-' || target_credential);
  else
    perform vault.update_secret(secret_id, api_key);
  end if;

  insert into public.agent_provider_secrets (
    credential_id, api_key_secret_id
  ) values (
    target_credential, secret_id
  )
  on conflict (credential_id) do update
  set api_key_secret_id = excluded.api_key_secret_id,
      updated_at = now();
end;
$$;
revoke all on function public.store_agent_provider_key(uuid, text) from public;
grant execute on function public.store_agent_provider_key(uuid, text) to service_role;

create or replace function public.read_agent_provider_key(target_credential uuid)
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
  select jsonb_build_object('api_key', decrypted.decrypted_secret) into result
  from public.agent_provider_secrets secrets
  join vault.decrypted_secrets decrypted
    on decrypted.id = secrets.api_key_secret_id
  where secrets.credential_id = target_credential;
  return result;
end;
$$;
revoke all on function public.read_agent_provider_key(uuid) from public;
grant execute on function public.read_agent_provider_key(uuid) to service_role;

alter table public.agent_provider_credentials enable row level security;
alter table public.agent_provider_secrets enable row level security;

drop policy if exists "Active members read agent provider credentials" on public.agent_provider_credentials;
create policy "Active members read agent provider credentials"
on public.agent_provider_credentials for select to authenticated
using (organization_id = public.current_active_organization_id());

revoke all on public.agent_provider_secrets from public, anon, authenticated;
revoke insert, update, delete on public.agent_provider_credentials from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Conversations & messages
-- ---------------------------------------------------------------------------
create table if not exists public.agent_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.agent_conversations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content text,
  tool_calls jsonb,
  provider text check (provider in ('anthropic', 'openai')),
  created_at timestamptz not null default now()
);
create index if not exists agent_messages_conversation_idx
  on public.agent_messages (conversation_id, created_at);

alter table public.agent_conversations enable row level security;
alter table public.agent_messages enable row level security;

drop policy if exists "Active members read agent conversations" on public.agent_conversations;
create policy "Active members read agent conversations"
on public.agent_conversations for select to authenticated
using (organization_id = public.current_active_organization_id());

drop policy if exists "Active members read agent messages" on public.agent_messages;
create policy "Active members read agent messages"
on public.agent_messages for select to authenticated
using (organization_id = public.current_active_organization_id());

-- No insert/update/delete grants: only agent-chat (service role) writes these.
revoke insert, update, delete on public.agent_conversations, public.agent_messages
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Approval queue
-- ---------------------------------------------------------------------------
create table if not exists public.agent_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid references public.agent_conversations(id) on delete set null,
  message_id uuid references public.agent_messages(id) on delete set null,
  action_type text not null check (action_type in (
    'send_email', 'send_whatsapp', 'create_task', 'create_calendar_event',
    'create_contact', 'update_contact', 'create_matter', 'update_matter'
  )),
  payload jsonb not null,
  summary text not null,
  status text not null default 'proposed' check (
    status in ('proposed', 'approved', 'rejected', 'executed', 'failed')
  ),
  proposed_by uuid not null references public.profiles(id) on delete restrict,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  executed_at timestamptz,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_actions_approval_consistent check (
    (status = 'proposed' and approved_by is null and approved_at is null)
    or (status <> 'proposed' and approved_by is not null and approved_at is not null)
  )
);
create index if not exists agent_actions_org_status_idx
  on public.agent_actions (organization_id, status);

alter table public.agent_actions enable row level security;

drop policy if exists "Active members read agent actions" on public.agent_actions;
create policy "Active members read agent actions"
on public.agent_actions for select to authenticated
using (organization_id = public.current_active_organization_id());

-- No insert/update/delete grants: agent-chat proposes (insert), only
-- agent-execute-action transitions status (update) — both service role.
-- This is the structural enforcement of "never send without approval": a
-- client cannot flip status to approved/executed by calling the table
-- directly, only by going through the role-gated edge function.
revoke insert, update, delete on public.agent_actions from anon, authenticated;
