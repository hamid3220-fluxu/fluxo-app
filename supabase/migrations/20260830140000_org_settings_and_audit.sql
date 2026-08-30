-- Organisation branding (name/logo), per-org notification & data-retention
-- settings (storage only, no delivery/enforcement engine yet), and a real
-- audit log driven by a generic trigger on the core business tables.

-- ---------------------------------------------------------------------------
-- Organisation branding
-- ---------------------------------------------------------------------------
alter table public.organizations
  add column if not exists name text,
  add column if not exists logo_url text;

insert into storage.buckets (id, name, public, file_size_limit)
values ('org-assets', 'org-assets', true, 5242880)
on conflict (id) do update
set public = true,
    file_size_limit = 5242880;

drop policy if exists "Admins can upload organisation assets" on storage.objects;
create policy "Admins can upload organisation assets" on storage.objects for insert to authenticated
with check (
  bucket_id = 'org-assets'
  and public.is_organization_admin(((storage.foldername(name))[1])::uuid)
);
drop policy if exists "Admins can update organisation assets" on storage.objects;
create policy "Admins can update organisation assets" on storage.objects for update to authenticated
using (
  bucket_id = 'org-assets'
  and public.is_organization_admin(((storage.foldername(name))[1])::uuid)
);
drop policy if exists "Admins can delete organisation assets" on storage.objects;
create policy "Admins can delete organisation assets" on storage.objects for delete to authenticated
using (
  bucket_id = 'org-assets'
  and public.is_organization_admin(((storage.foldername(name))[1])::uuid)
);

-- ---------------------------------------------------------------------------
-- Notifications & data retention (storage only — see index.html copy)
-- ---------------------------------------------------------------------------
create table if not exists public.organization_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  notify_email boolean not null default true,
  notify_push boolean not null default false,
  notify_whatsapp boolean not null default false,
  data_retention_years integer,
  data_retention_notes text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.organization_settings enable row level security;

drop policy if exists "Active members read organization settings" on public.organization_settings;
create policy "Active members read organization settings"
on public.organization_settings for select to authenticated
using (organization_id = public.current_active_organization_id());

drop policy if exists "Admins write organization settings" on public.organization_settings;
create policy "Admins write organization settings"
on public.organization_settings for all to authenticated
using (public.is_organization_admin(organization_id))
with check (public.is_organization_admin(organization_id));

-- ---------------------------------------------------------------------------
-- Audit logs
-- ---------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('create', 'update', 'delete')),
  entity_type text not null,
  entity_id uuid,
  entity_label text,
  changes jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_org_created_idx
  on public.audit_logs (organization_id, created_at desc);

alter table public.audit_logs enable row level security;

drop policy if exists "Admins read audit logs" on public.audit_logs;
create policy "Admins read audit logs"
on public.audit_logs for select to authenticated
using (public.is_organization_admin(organization_id));

revoke insert, update, delete on public.audit_logs from authenticated, anon;

create or replace function public.log_audit_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  old_row jsonb;
  new_row jsonb;
  target_org uuid;
  target_id uuid;
  label text;
  diff jsonb := '{}'::jsonb;
  key text;
begin
  if TG_OP = 'DELETE' then
    old_row := to_jsonb(OLD);
    target_org := (old_row->>'organization_id')::uuid;
    target_id := (old_row->>'id')::uuid;
    label := coalesce(old_row->>'title', old_row->>'full_name', old_row->>'subject');
    insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, entity_label, changes)
    values (target_org, auth.uid(), 'delete', TG_TABLE_NAME, target_id, label, old_row);
    return OLD;
  end if;

  new_row := to_jsonb(NEW);
  target_org := (new_row->>'organization_id')::uuid;
  target_id := (new_row->>'id')::uuid;
  label := coalesce(new_row->>'title', new_row->>'full_name', new_row->>'subject');

  if TG_OP = 'INSERT' then
    insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, entity_label, changes)
    values (target_org, auth.uid(), 'create', TG_TABLE_NAME, target_id, label, new_row);
    return NEW;
  end if;

  old_row := to_jsonb(OLD);
  for key in select jsonb_object_keys(new_row) loop
    if key in ('updated_at') then
      continue;
    end if;
    if (old_row->key) is distinct from (new_row->key) then
      diff := diff || jsonb_build_object(key, jsonb_build_object('old', old_row->key, 'new', new_row->key));
    end if;
  end loop;

  if diff = '{}'::jsonb then
    return NEW;
  end if;

  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, entity_label, changes)
  values (target_org, auth.uid(), 'update', TG_TABLE_NAME, target_id, label, diff);
  return NEW;
end;
$$;
revoke all on function public.log_audit_event() from public;

do $$
declare
  audited_table text;
begin
  foreach audited_table in array array['tasks', 'matters', 'clients', 'contacts', 'calendar_events', 'communications', 'documents']
  loop
    execute format('drop trigger if exists audit_log_%1$s on public.%1$s', audited_table);
    execute format(
      'create trigger audit_log_%1$s after insert or update or delete on public.%1$s for each row execute function public.log_audit_event()',
      audited_table
    );
  end loop;
end;
$$;
