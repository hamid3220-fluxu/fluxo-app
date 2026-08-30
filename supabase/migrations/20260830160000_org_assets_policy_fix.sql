-- Rewrite org-assets storage policies to match the exact proven pattern
-- from documents.sql (text comparison against profiles.organization_id)
-- instead of casting the path segment to uuid, which is a needless extra
-- failure mode versus the pattern already working in production.
drop policy if exists "Admins can upload organisation assets" on storage.objects;
create policy "Admins can upload organisation assets" on storage.objects for insert to authenticated
with check (
  bucket_id = 'org-assets'
  and (storage.foldername(name))[1] = (
    select p.organization_id::text from public.profiles p
    where p.id = auth.uid() and p.status = 'active' and lower(p.role) in ('admin', 'administrator')
  )
);

drop policy if exists "Admins can update organisation assets" on storage.objects;
create policy "Admins can update organisation assets" on storage.objects for update to authenticated
using (
  bucket_id = 'org-assets'
  and (storage.foldername(name))[1] = (
    select p.organization_id::text from public.profiles p
    where p.id = auth.uid() and p.status = 'active' and lower(p.role) in ('admin', 'administrator')
  )
);

drop policy if exists "Admins can delete organisation assets" on storage.objects;
create policy "Admins can delete organisation assets" on storage.objects for delete to authenticated
using (
  bucket_id = 'org-assets'
  and (storage.foldername(name))[1] = (
    select p.organization_id::text from public.profiles p
    where p.id = auth.uid() and p.status = 'active' and lower(p.role) in ('admin', 'administrator')
  )
);
