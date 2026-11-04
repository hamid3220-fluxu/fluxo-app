-- Portal clients may only see their own data.
--
-- Problem: the firm-wide rules ("organization members can read …") match any
-- active profile in the firm, including portal clients (profiles.role =
-- 'client'). Postgres combines permissive policies with OR, so a client who
-- logged into the portal could read every client, matter, document, message,
-- task and invoice of the firm through the API, and list the firm's files in
-- storage.
--
-- Fix: one RESTRICTIVE policy per table (restrictive policies are ANDed with
-- everything else). Staff are unaffected (the condition starts with
-- "not is_portal_client()"); portal clients are capped to:
--   * matters of their own client record, and those matters' deadlines,
--     fees, expenses and payments
--   * documents of their client or their matters (and those files in storage)
--   * portal messages of their client record
--   * their own profile and staff profiles (for lawyer names)
--   * their firm's name/logo
-- and nothing else. Per-user tables (notifications, preferences, push
-- subscriptions, day plans) are already limited to user_id = auth.uid().
-- Safe to re-run.

create or replace function public.is_portal_client()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
set row_security = off
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'client');
$$;

create or replace function public.portal_client_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog
set row_security = off
as $$
  select p.linked_client_id from public.profiles p where p.id = auth.uid() and p.role = 'client' limit 1;
$$;

-- Matters a portal client may see (bypasses RLS internally, so it can be used
-- inside other tables' policies without recursion).
create or replace function public.portal_client_matter_ids()
returns setof uuid
language sql
stable
security definer
set search_path = pg_catalog
set row_security = off
as $$
  select m.id from public.matters m
  where m.client_id = public.portal_client_id() and public.portal_client_id() is not null;
$$;

create or replace function public.portal_client_document_ids()
returns setof uuid
language sql
stable
security definer
set search_path = pg_catalog
set row_security = off
as $$
  select d.id from public.documents d
  where public.portal_client_id() is not null
    and (d.client_id = public.portal_client_id() or d.matter_id in (select public.portal_client_matter_ids()));
$$;

revoke all on function public.is_portal_client() from public, anon;
revoke all on function public.portal_client_id() from public, anon;
revoke all on function public.portal_client_matter_ids() from public, anon;
revoke all on function public.portal_client_document_ids() from public, anon;
grant execute on function public.is_portal_client() to authenticated;
grant execute on function public.portal_client_id() to authenticated;
grant execute on function public.portal_client_matter_ids() to authenticated;
grant execute on function public.portal_client_document_ids() to authenticated;

do $$
declare
  scoped record;
  blocked text;
  -- Tables a portal client may read, with the rows they may see.
  scoped_tables constant jsonb := jsonb_build_object(
    'matters',          'id in (select public.portal_client_matter_ids())',
    'matter_deadlines', 'matter_id in (select public.portal_client_matter_ids())',
    'matter_fees',      'matter_id in (select public.portal_client_matter_ids())',
    'matter_expenses',  'matter_id in (select public.portal_client_matter_ids())',
    'matter_payments',  'matter_id in (select public.portal_client_matter_ids())',
    'documents',        'id in (select public.portal_client_document_ids())',
    'portal_messages',  'client_id = public.portal_client_id()',
    'profiles',         'id = auth.uid() or coalesce(role, '''') <> ''client''',
    'organizations',    'true'
  );
  -- Everything else that holds firm data: no access for portal clients.
  blocked_tables constant text[] := array[
    'clients', 'tasks', 'communications', 'calendar_events', 'calendar_event_syncs',
    'calendar_integrations', 'document_versions', 'matter_parties', 'matter_time_entries',
    'contacts', 'contact_import_links', 'contact_integrations', 'email_accounts', 'email_messages',
    'email_attachments', 'whatsapp_integrations', 'whatsapp_messages', 'agent_conversations',
    'agent_messages', 'agent_actions', 'agent_provider_credentials', 'organization_settings',
    'audit_logs', 'team_invitations'
  ];
begin
  for scoped in select key as table_name, value #>> '{}' as condition from jsonb_each(scoped_tables) loop
    if to_regclass('public.' || scoped.table_name) is null then continue; end if;
    execute format('drop policy if exists "Portal clients limited to own data" on public.%I', scoped.table_name);
    execute format(
      'create policy "Portal clients limited to own data" on public.%I as restrictive for all to authenticated
         using (not public.is_portal_client() or (%s))
         with check (not public.is_portal_client() or (%s))',
      scoped.table_name, scoped.condition,
      -- Clients may write only their own portal messages.
      case when scoped.table_name = 'portal_messages' then scoped.condition else 'false' end
    );
  end loop;

  foreach blocked in array blocked_tables loop
    if to_regclass('public.' || blocked) is null then continue; end if;
    execute format('drop policy if exists "Portal clients have no access" on public.%I', blocked);
    execute format(
      'create policy "Portal clients have no access" on public.%I as restrictive for all to authenticated
         using (not public.is_portal_client()) with check (not public.is_portal_client())',
      blocked
    );
  end loop;
end;
$$;

-- Files: portal clients may only read files of documents they can see.
drop policy if exists "Portal clients limited to own document files" on storage.objects;
create policy "Portal clients limited to own document files" on storage.objects as restrictive for all to authenticated
using (
  bucket_id <> 'documents'
  or not public.is_portal_client()
  or ((storage.foldername(name))[3] in (select id::text from public.portal_client_document_ids()))
)
with check (bucket_id <> 'documents' or not public.is_portal_client());
