-- The existing organizations RLS only ever granted select (a RESTRICTIVE
-- "for all" policy narrows permissive policies, it doesn't grant access on
-- its own) — admins had no way to actually update the firm name/logo.
drop policy if exists "Admins update their organization" on public.organizations;
create policy "Admins update their organization" on public.organizations for update to authenticated
using (public.is_organization_admin(id))
with check (public.is_organization_admin(id));
