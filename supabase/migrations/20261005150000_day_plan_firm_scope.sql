-- Day plans can be personal ("me") or a firm-wide overview ("firm", admins
-- only — enforced in notifications-dispatch). Safe to re-run.

alter table public.day_plans
  add column if not exists scope text not null default 'me';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'day_plans_scope_check') then
    alter table public.day_plans add constraint day_plans_scope_check check (scope in ('me', 'firm'));
  end if;
  if exists (select 1 from pg_constraint where conname = 'day_plans_user_date_period_key') then
    alter table public.day_plans drop constraint day_plans_user_date_period_key;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'day_plans_user_date_period_scope_key') then
    alter table public.day_plans add constraint day_plans_user_date_period_scope_key unique (user_id, plan_date, period, scope);
  end if;
end;
$$;
