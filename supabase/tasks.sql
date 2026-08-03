-- Review and run this migration manually in Supabase.
create extension if not exists pgcrypto;

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid references public.clients(id) on delete set null,
  matter_id uuid references public.matters(id) on delete set null,
  title text not null check (length(trim(title)) > 0),
  description text,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'completed', 'cancelled')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  due_date date,
  due_time time,
  assigned_to uuid references public.profiles(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_completed_consistency check (
    (status = 'completed' and completed_at is not null)
    or
    (status <> 'completed' and completed_at is null)
  )
);

create index if not exists tasks_organization_id_idx on public.tasks (organization_id);
create index if not exists tasks_client_id_idx on public.tasks (client_id);
create index if not exists tasks_matter_id_idx on public.tasks (matter_id);
create index if not exists tasks_assigned_to_idx on public.tasks (assigned_to);
create index if not exists tasks_status_idx on public.tasks (organization_id, status);
create index if not exists tasks_due_date_idx on public.tasks (organization_id, due_date);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.validate_task_relationships()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  linked_matter_client uuid;
begin
  if new.client_id is not null and not exists (
    select 1 from public.clients c where c.id = new.client_id and c.organization_id = new.organization_id
  ) then
    raise exception 'Task client must belong to the same organization';
  end if;

  if new.matter_id is not null then
    select m.client_id into linked_matter_client
    from public.matters m
    where m.id = new.matter_id and m.organization_id = new.organization_id;
    if not found then raise exception 'Task matter must belong to the same organization'; end if;
    if new.client_id is not null and linked_matter_client <> new.client_id then
      raise exception 'Task matter must belong to the selected client';
    end if;
  end if;

  if new.assigned_to is not null and not exists (
    select 1 from public.profiles p where p.id = new.assigned_to and p.organization_id = new.organization_id
  ) then
    raise exception 'Assigned user must belong to the same organization';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_validate_relationships on public.tasks;
create trigger tasks_validate_relationships
before insert or update on public.tasks
for each row execute function public.validate_task_relationships();

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

alter table public.tasks enable row level security;

drop policy if exists "Organization members can read tasks" on public.tasks;
create policy "Organization members can read tasks" on public.tasks
for select to authenticated
using (organization_id = (select organization_id from public.profiles where id = auth.uid()));

drop policy if exists "Organization members can create tasks" on public.tasks;
create policy "Organization members can create tasks" on public.tasks
for insert to authenticated
with check (
  organization_id = (select organization_id from public.profiles where id = auth.uid())
  and created_by = auth.uid()
);

drop policy if exists "Organization members can update tasks" on public.tasks;
create policy "Organization members can update tasks" on public.tasks
for update to authenticated
using (organization_id = (select organization_id from public.profiles where id = auth.uid()))
with check (organization_id = (select organization_id from public.profiles where id = auth.uid()));

-- Delete is intentionally omitted. Task history should be preserved; use cancelled status instead.
