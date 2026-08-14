-- Structured communication details and organization-scoped deletion.
-- Deleting a communication cascades only to FLUXO email metadata through
-- existing foreign keys; it does not call or delete from Gmail or Microsoft.

alter table public.communications
  add column if not exists metadata jsonb not null default '{}'::jsonb;

drop policy if exists "Active organization members can delete communications"
  on public.communications;

create policy "Active organization members can delete communications"
on public.communications
for delete
to authenticated
using (
  organization_id = (
    select p.organization_id
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
  )
);
