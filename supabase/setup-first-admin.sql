-- ============================================================
-- FLUXO — First-Time Setup Script
-- Run this in Supabase → SQL Editor AFTER creating your first
-- user through Authentication → Users → Add user.
-- Replace the values in the section below before running.
-- ============================================================

-- ——————————————————————————————————————————
-- EDIT THESE VALUES BEFORE RUNNING
-- ——————————————————————————————————————————
do $$
declare
  v_org_name   text    := 'Your Law Firm Name';   -- Change this
  v_user_email text    := 'your@email.com';        -- Change this (must match the Auth user)
  v_full_name  text    := 'Your Name';             -- Change this
  -- ——————————————————————————————————————————
  v_user_id    uuid;
  v_org_id     uuid;
begin

  -- 1. Find the Auth user
  select id into v_user_id
  from auth.users
  where email = v_user_email
  limit 1;

  if v_user_id is null then
    raise exception 'User not found: %. Create the user in Auth → Users first.', v_user_email;
  end if;

  raise notice 'Found user: % → %', v_user_email, v_user_id;

  -- 2. Create the organization (or reuse existing)
  insert into public.organizations (id, name, created_at, updated_at)
  values (gen_random_uuid(), v_org_name, now(), now())
  on conflict do nothing
  returning id into v_org_id;

  if v_org_id is null then
    -- Already exists — find it
    select id into v_org_id
    from public.organizations
    where name = v_org_name
    limit 1;
  end if;

  raise notice 'Organization: % → %', v_org_name, v_org_id;

  -- 3. Upsert the profile row (links the Auth user to the organization)
  insert into public.profiles (id, organization_id, full_name, email, role, status, joined_at, created_at, updated_at)
  values (v_user_id, v_org_id, v_full_name, v_user_email, 'admin', 'active', now(), now(), now())
  on conflict (id) do update
    set organization_id = excluded.organization_id,
        full_name       = excluded.full_name,
        email           = excluded.email,
        role            = 'admin',
        status          = 'active',
        updated_at      = now();

  raise notice 'Profile upserted for user: %', v_full_name;
  raise notice '✅ Setup complete. You can now sign in to FLUXO with %', v_user_email;

end $$;

-- ——————————————————————————————————————————
-- Verification: run this to confirm everything is correct
-- ——————————————————————————————————————————
select
  u.email,
  p.full_name,
  p.role,
  p.status,
  o.name as organization_name
from auth.users u
join public.profiles p on p.id = u.id
join public.organizations o on o.id = p.organization_id
order by u.email;
