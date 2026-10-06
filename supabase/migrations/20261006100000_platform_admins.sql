-- Platform owners: the people who run FLUXO itself (not a law firm's admin).
-- Only they can create new firms (organizations) from Settings → Firms, via
-- the platform-admin edge function. Safe to re-run.

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

-- A signed-in user may only see whether they themselves are a platform owner.
drop policy if exists "Users see their own platform admin row" on public.platform_admins;
create policy "Users see their own platform admin row"
on public.platform_admins for select to authenticated
using (user_id = auth.uid());

revoke insert, update, delete on public.platform_admins from anon, authenticated;

-- FLUXO's owner.
insert into public.platform_admins (user_id)
select id from auth.users where lower(email) = 'hamid3220@gmail.com'
on conflict (user_id) do nothing;
