-- Notifications in the reader's language (Portuguese by default).
--
-- * notification_preferences.language: the interface language the user picked
--   (synced by the app). Portuguese unless they chose English.
-- * create_notification() writes the title/body in that language, so the bell
--   and push messages match the interface.
-- * New users' daily plans default to Portuguese too.
-- Safe to re-run.

alter table public.notification_preferences
  add column if not exists language text not null default 'pt';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notification_preferences_language_check') then
    alter table public.notification_preferences
      add constraint notification_preferences_language_check check (language in ('pt', 'en'));
  end if;
end;
$$;

alter table public.notification_preferences alter column day_plan_language set default 'pt';

-- Translates the fixed English parts of FLUXO's notification texts.
create or replace function public.localize_notification_text(value text, target_language text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when value is null or target_language <> 'pt' then value
    when value = 'AI suggestion waiting for approval' then 'Sugestão da IA a aguardar aprovação'
    when value like 'New task: %' then 'Nova tarefa: ' || substr(value, 11)
    when value like 'Reminder: %' then 'Lembrete: ' || substr(value, 11)
    when value like 'Due soon: %' then 'Prazo a aproximar-se: ' || substr(value, 11)
    when value like 'Your plan for %' then 'O seu plano para ' || substr(value, 15)
    when value like 'Email from %' then 'Email de ' || substr(value, 12)
    when value like 'WhatsApp from %' then 'WhatsApp de ' || substr(value, 15)
    when value like 'Starts at %' then 'Começa às ' || substr(value, 11)
    when value like 'Due at %' then 'Prazo às ' || substr(value, 8)
    when value like 'Due %' then 'Prazo ' || substr(value, 5)
    else value
  end;
$$;

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
  reader_language text := 'pt';
begin
  if target_user is null then return; end if;
  select * into prefs from public.notification_preferences where user_id = target_user;
  if found then
    if target_kind = 'event_reminder' and not prefs.notify_event_reminders then return; end if;
    if target_kind = 'task_due' and not prefs.notify_task_due then return; end if;
    if target_kind = 'task_assigned' and not prefs.notify_task_assigned then return; end if;
    if target_kind = 'new_message' and not prefs.notify_new_messages then return; end if;
    if target_kind = 'agent_action' and not prefs.notify_agent_actions then return; end if;
    reader_language := prefs.language;
  end if;
  insert into public.notifications (
    organization_id, user_id, kind, title, body, link_type, link_id, dedupe_key
  ) values (
    target_organization, target_user, target_kind,
    left(public.localize_notification_text(target_title, reader_language), 200),
    left(case when target_kind = 'day_plan' then target_body
              else public.localize_notification_text(target_body, reader_language) end, 2000),
    target_link_type, target_link_id, target_dedupe_key
  )
  on conflict (user_id, dedupe_key) do nothing;
end;
$$;
revoke all on function public.create_notification(uuid, uuid, text, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.create_notification(uuid, uuid, text, text, text, text, uuid, text) to service_role;

-- Task-assigned notifications: numeric date format that reads the same in both languages.
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
    case when new.due_date is not null then 'Due ' || to_char(new.due_date, 'DD/MM/YYYY') else null end,
    'task', new.id, 'task_assigned:' || new.id || ':' || new.assigned_to
  );
  return new;
end;
$$;
revoke all on function public.notify_task_assigned() from public;
