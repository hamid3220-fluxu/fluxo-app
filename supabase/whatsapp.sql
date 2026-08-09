-- Official Meta WhatsApp Business Cloud API foundation.
create extension if not exists supabase_vault with schema vault;
create table if not exists public.whatsapp_integrations (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null unique references public.organizations(id) on delete cascade,owner_user_id uuid not null references public.profiles(id) on delete restrict,
 provider text not null default 'meta_whatsapp' check(provider='meta_whatsapp'),business_account_id text,phone_number_id text unique,display_phone_number text,
 status text not null default 'not_configured' check(status in('not_configured','connected','error')),webhook_status text not null default 'not_configured' check(webhook_status in('not_configured','verified','error')),
 last_event_at timestamptz,last_error text,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.whatsapp_integration_secrets(integration_id uuid primary key references public.whatsapp_integrations(id) on delete cascade,access_token_secret_id uuid not null,updated_at timestamptz not null default now());
create table if not exists public.whatsapp_messages(
 id uuid primary key default gen_random_uuid(),communication_id uuid not null references public.communications(id) on delete cascade,integration_id uuid not null references public.whatsapp_integrations(id) on delete cascade,
 organization_id uuid not null references public.organizations(id) on delete cascade,provider_message_id text not null,direction text not null check(direction in('inbound','outbound')),
 delivery_status text,media_type text,provider_media_id text,document_id uuid references public.documents(id) on delete set null,created_at timestamptz not null default now(),unique(integration_id,provider_message_id)
);
create table if not exists public.whatsapp_webhook_events(event_key text primary key,integration_id uuid references public.whatsapp_integrations(id) on delete cascade,received_at timestamptz not null default now());
create table if not exists public.whatsapp_templates(id uuid primary key default gen_random_uuid(),integration_id uuid not null references public.whatsapp_integrations(id) on delete cascade,provider_template_name text not null,language_code text not null,status text not null default 'approved' check(status in('approved','paused','disabled')),created_at timestamptz not null default now(),unique(integration_id,provider_template_name,language_code));
create index if not exists whatsapp_messages_org_created_idx on public.whatsapp_messages(organization_id,created_at desc);
create or replace function public.set_whatsapp_updated_at()returns trigger language plpgsql security invoker set search_path=public as $$begin new.updated_at=now();return new;end$$;
drop trigger if exists whatsapp_integrations_set_updated_at on public.whatsapp_integrations;create trigger whatsapp_integrations_set_updated_at before update on public.whatsapp_integrations for each row execute function public.set_whatsapp_updated_at();
alter table public.whatsapp_integrations enable row level security;alter table public.whatsapp_integration_secrets enable row level security;alter table public.whatsapp_messages enable row level security;alter table public.whatsapp_webhook_events enable row level security;alter table public.whatsapp_templates enable row level security;
drop policy if exists "Organization reads WhatsApp integration" on public.whatsapp_integrations;create policy "Organization reads WhatsApp integration" on public.whatsapp_integrations for select to authenticated using(organization_id=(select organization_id from public.profiles where id=auth.uid()));
drop policy if exists "Organization reads WhatsApp messages" on public.whatsapp_messages;create policy "Organization reads WhatsApp messages" on public.whatsapp_messages for select to authenticated using(organization_id=(select organization_id from public.profiles where id=auth.uid()));
drop policy if exists "Organization reads approved WhatsApp templates" on public.whatsapp_templates;create policy "Organization reads approved WhatsApp templates" on public.whatsapp_templates for select to authenticated using(exists(select 1 from public.whatsapp_integrations i where i.id=integration_id and i.organization_id=(select organization_id from public.profiles where id=auth.uid())));
revoke all on public.whatsapp_integration_secrets,public.whatsapp_webhook_events from anon,authenticated;

create or replace function public.read_whatsapp_access_token(target_integration uuid)returns text language plpgsql security definer set search_path=public,vault as $$declare result text;begin if auth.role()<>'service_role' then raise exception 'Service role required';end if;select decrypted_secret into result from vault.decrypted_secrets s join public.whatsapp_integration_secrets wis on wis.access_token_secret_id=s.id where wis.integration_id=target_integration;return result;end$$;
revoke all on function public.read_whatsapp_access_token(uuid) from public;grant execute on function public.read_whatsapp_access_token(uuid) to service_role;
