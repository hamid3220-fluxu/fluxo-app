-- Personal notifications and the daily plan ("day plan").
--
-- * notification_preferences: one row per user — which channels and which
--   kinds of notification they want, plus when (and in which language) their
--   daily plan is generated.
-- * notifications: the in-app inbox (the bell). Rows are created by the
--   triggers below and by the notifications-dispatch edge function; users can
--   only read their own rows and mark them read.
-- * day_plans: one generated plan per user per local day.
-- * A pg_cron job calls notifications-dispatch every five minutes. Its shared
--   secret is generated here and kept in Vault, so nothing has to be copied
--   by hand and no secret is committed to git.
--
-- Safe to re-run.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- Preferences
-- ---------------------------------------------------------------------------
create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel_in_app boolean not null default true,
  channel_email boolean not null default true,
  channel_push boolean not null default false,
  channel_whatsapp boolean not null default false,
  whatsapp_phone text,
  notify_event_reminders boolean not null default true,
  notify_task_due boolean not null default true,
  notify_task_assigned boolean not null default true,
  notify_new_messages boolean not null default true,
  notify_agent_actions boolean not null default true,
  day_plan_enabled boolean not null default true,
  day_plan_time time not null default '08:00',
  day_plan_language text not null default 'en' check (day_plan_language in ('en', 'pt', 'fa')),
  timezone text not null default 'Europe/Lisbon',
  last_day_plan_date date,
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

drop policy if exists "Users read own notification preferences" on public.notification_preferences;
create policy "Users read own notification preferences"
on public.notification_preferences for select to authenticated
using (user_id = auth.uid());

drop policy if exists "Users create own notification preferences" on public.notification_preferences;
create policy "Users create own notification preferences"
on public.notification_preferences for insert to authenticated
with check (user_id = auth.uid() and organization_id = public.current_active_organization_id());

drop policy if exists "Users update own notification preferences" on public.notification_preferences;
create policy "Users update own notification preferences"
on public.notification_preferences for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid() and organization_id = public.current_active_organization_id());

-- ---------------------------------------------------------------------------
-- Notifications (in-app inbox)
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in (
    'day_plan', 'event_reminder', 'task_due', 'task_assigned', 'new_message', 'agent_action'
  )),
  title text not null,
  body text,
  link_type text check (link_type in ('task', 'event', 'communication', 'agent', 'dashboard')),
  link_id uuid,
  dedupe_key text not null,
  read_at timestamptz,
  -- Per-channel delivery outcome, e.g. {"email": "sent", "whatsapp": "skipped"}.
  delivery jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;

drop policy if exists "Users read own notifications" on public.notifications;
create policy "Users read own notifications"
on public.notifications for select to authenticated
using (user_id = auth.uid());

drop policy if exists "Users mark own notifications read" on public.notifications;
create policy "Users mark own notifications read"
on public.notifications for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Users may only flip read_at; everything else is written by the server.
revoke insert, update, delete on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ---------------------------------------------------------------------------
-- Day plans
-- ---------------------------------------------------------------------------
create table if not exists public.day_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_date date not null,
  content text not null,
  provider text,
  created_at timestamptz not null default now(),
  unique (user_id, plan_date)
);

alter table public.day_plans enable row level security;

drop policy if exists "Users read own day plans" on public.day_plans;
create policy "Users read own day plans"
on public.day_plans for select to authenticated
using (user_id = auth.uid());

revoke insert, update, delete on public.day_plans from anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_notification: the single entry point used by triggers. Respects the
-- recipient's per-kind preferences and ignores duplicates.
-- ---------------------------------------------------------------------------
create or replace function public.create_notification(
  target_user uuid,
  target_organization uuid,
  target_kind text,
  target_title text,
  target_body text,
  target_link_type text,
  target_link_id uuid,
  target_dedupe_key text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  prefs public.notification_preferences;
begin
  if target_user is null then return; end if;
  select * into prefs from public.notification_preferences where user_id = target_user;
  if found then
    if target_kind = 'event_reminder' and not prefs.notify_event_reminders then return; end if;
    if target_kind = 'task_due' and not prefs.notify_task_due then return; end if;
    if target_kind = 'task_assigned' and not prefs.notify_task_assigned then return; end if;
    if target_kind = 'new_message' and not prefs.notify_new_messages then return; end if;
    if target_kind = 'agent_action' and not prefs.notify_agent_actions then return; end if;
  end if;
  insert into public.notifications (
    organization_id, user_id, kind, title, body, link_type, link_id, dedupe_key
  ) values (
    target_organization, target_user, target_kind, left(target_title, 200), left(target_body, 2000),
    target_link_type, target_link_id, target_dedupe_key
  )
  on conflict (user_id, dedupe_key) do nothing;
end;
$$;
revoke all on function public.create_notification(uuid, uuid, text, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.create_notification(uuid, uuid, text, text, text, text, uuid, text) to service_role;

-- Task assigned to someone other than the person assigning it.
create or replace function public.notify_task_assigned()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.assigned_to is null then return new; end if;
  if tg_op = 'UPDATE' and old.assigned_to is not distinct from new.assigned_to then return new; end if;
  if new.assigned_to = coalesce(auth.uid(), new.created_by) then return new; end if;
  perform public.create_notification(
    new.assigned_to, new.organization_id, 'task_assigned',
    'New task: ' || new.title,
    case when new.due_date is not null then 'Due ' || to_char(new.due_date, 'DD Mon YYYY') else null end,
    'task', new.id, 'task_assigned:' || new.id || ':' || new.assigned_to
  );
  return new;
end;
$$;
revoke all on function public.notify_task_assigned() from public;

drop trigger if exists tasks_notify_assigned on public.tasks;
create trigger tasks_notify_assigned
after insert or update of assigned_to on public.tasks
for each row execute function public.notify_task_assigned();

-- Inbound email/WhatsApp: tell the matter's responsible lawyer, or else the
-- person whose mailbox/number received it.
create or replace function public.notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  recipient uuid;
begin
  if new.matter_id is not null then
    select responsible_user_id into recipient from public.matters where id = new.matter_id;
  end if;
  recipient := coalesce(recipient, new.created_by);
  perform public.create_notification(
    recipient, new.organization_id, 'new_message',
    case new.communication_type when 'whatsapp' then 'WhatsApp from ' else 'Email from ' end
      || coalesce(nullif(new.sender_name, ''), new.sender_address, 'unknown sender'),
    coalesce(nullif(new.subject, ''), left(new.body, 160)),
    'communication', new.id, 'new_message:' || new.id
  );
  return new;
end;
$$;
revoke all on function public.notify_new_message() from public;

drop trigger if exists communications_notify_new_message on public.communications;
create trigger communications_notify_new_message
after insert on public.communications
for each row
when (new.direction = 'inbound' and new.communication_type in ('email', 'whatsapp'))
execute function public.notify_new_message();

-- AI actions proposed by automatic triage (no one is watching a chat for
-- those) need a human to approve them.
create or replace function public.notify_agent_action()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status <> 'proposed' or new.conversation_id is not null then return new; end if;
  perform public.create_notification(
    new.proposed_by, new.organization_id, 'agent_action',
    'AI suggestion waiting for approval', new.summary,
    'agent', new.id, 'agent_action:' || new.id
  );
  return new;
end;
$$;
revoke all on function public.notify_agent_action() from public;

drop trigger if exists agent_actions_notify on public.agent_actions;
create trigger agent_actions_notify
after insert on public.agent_actions
for each row execute function public.notify_agent_action();

-- ---------------------------------------------------------------------------
-- Scheduler: notifications-dispatch every five minutes.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'notifications_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'notifications_cron_secret');
  end if;
end;
$$;

-- Lets the edge function check the header the cron job sends.
create or replace function public.read_notifications_cron_secret()
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  result text;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  select decrypted_secret into result from vault.decrypted_secrets where name = 'notifications_cron_secret' limit 1;
  return result;
end;
$$;
revoke all on function public.read_notifications_cron_secret() from public, anon, authenticated;
grant execute on function public.read_notifications_cron_secret() to service_role;

select cron.unschedule('fluxo-notifications-dispatch')
where exists (select 1 from cron.job where jobname = 'fluxo-notifications-dispatch');

select cron.schedule(
  'fluxo-notifications-dispatch',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://jhbpgdpllwligclpalsj.supabase.co/functions/v1/notifications-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-notifications-secret', (
        select decrypted_secret from vault.decrypted_secrets where name = 'notifications_cron_secret' limit 1
      )
    ),
    body := '{"mode":"cron"}'::jsonb,
    timeout_milliseconds := 55000
  );
  $cron$
);
