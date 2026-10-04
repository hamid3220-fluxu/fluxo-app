-- Day plans can now cover one day (today or tomorrow) or the next seven days.
-- A week plan is stored under its first day with period = 'week'. Safe to re-run.

alter table public.day_plans
  add column if not exists period text not null default 'day';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'day_plans_period_check') then
    alter table public.day_plans add constraint day_plans_period_check check (period in ('day', 'week'));
  end if;
  if exists (select 1 from pg_constraint where conname = 'day_plans_user_id_plan_date_key') then
    alter table public.day_plans drop constraint day_plans_user_id_plan_date_key;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'day_plans_user_date_period_key') then
    alter table public.day_plans add constraint day_plans_user_date_period_key unique (user_id, plan_date, period);
  end if;
end;
$$;
