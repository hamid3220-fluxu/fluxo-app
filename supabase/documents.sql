-- FLUXO Documents module: private metadata, versions, and Storage policies.
-- Review and execute this complete file in Supabase SQL Editor before using Documents.

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  title text not null check (length(trim(title)) > 0),
  original_filename text not null check (length(trim(original_filename)) > 0),
  description text,
  category text not null default 'other' check (category in ('contract','court_document','identification','correspondence','invoice','evidence','power_of_attorney','legal_opinion','application','certificate','internal','other')),
  storage_bucket text not null default 'documents' check (storage_bucket = 'documents'),
  storage_path text not null,
  mime_type text not null,
  file_extension text,
  file_size bigint not null check (file_size >= 0),
  client_id uuid references public.clients(id) on delete restrict,
  matter_id uuid references public.matters(id) on delete restrict,
  status text not null default 'active' check (status in ('active','archived')),
  document_date date,
  tags text[] not null default '{}',
  current_version integer not null default 1 check (current_version > 0),
  processing_status text not null default 'not_requested' check (processing_status in ('not_requested','pending','processing','completed','failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);

create table if not exists public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  storage_bucket text not null default 'documents' check (storage_bucket = 'documents'),
  storage_path text not null,
  original_filename text not null check (length(trim(original_filename)) > 0),
  mime_type text not null,
  file_extension text,
  file_size bigint not null check (file_size >= 0),
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (document_id, version_number),
  unique (storage_bucket, storage_path)
);

create index if not exists documents_organization_created_idx on public.documents (organization_id, created_at desc);
create index if not exists documents_client_idx on public.documents (organization_id, client_id) where client_id is not null;
create index if not exists documents_matter_idx on public.documents (organization_id, matter_id) where matter_id is not null;
create index if not exists documents_category_idx on public.documents (organization_id, category);
create index if not exists documents_status_idx on public.documents (organization_id, status);
create index if not exists document_versions_document_idx on public.document_versions (document_id, version_number desc);

create or replace function public.validate_document_relationships()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  matter_client uuid;
begin
  if new.storage_path not like (new.organization_id::text || '/documents/' || new.id::text || '/%') then
    raise exception 'Document storage path is invalid';
  end if;
  if not exists (select 1 from public.profiles p where p.id = new.uploaded_by and p.organization_id = new.organization_id) then
    raise exception 'Document uploader must belong to the same organization';
  end if;
  if new.client_id is not null and not exists (select 1 from public.clients c where c.id = new.client_id and c.organization_id = new.organization_id) then
    raise exception 'Document client must belong to the same organization';
  end if;
  if new.matter_id is not null then
    select m.client_id into matter_client from public.matters m where m.id = new.matter_id and m.organization_id = new.organization_id;
    if not found then raise exception 'Document matter must belong to the same organization'; end if;
    if new.client_id is null then new.client_id := matter_client; end if;
    if matter_client is distinct from new.client_id then raise exception 'Document matter must belong to the selected client'; end if;
  end if;
  return new;
end;
$$;

create or replace function public.protect_document_ownership()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.organization_id is distinct from old.organization_id or new.uploaded_by is distinct from old.uploaded_by then
    raise exception 'Document organization and uploader cannot be changed';
  end if;
  return new;
end;
$$;

create or replace function public.validate_document_version()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.documents d where d.id = new.document_id and d.organization_id = new.organization_id) then
    raise exception 'Document version must belong to the document organization';
  end if;
  if new.storage_path not like (new.organization_id::text || '/documents/' || new.document_id::text || '/' || new.version_number::text || '/%') then
    raise exception 'Document version storage path is invalid';
  end if;
  if not exists (select 1 from public.profiles p where p.id = new.uploaded_by and p.organization_id = new.organization_id) then
    raise exception 'Version uploader must belong to the same organization';
  end if;
  return new;
end;
$$;

create or replace function public.set_documents_updated_at()
returns trigger language plpgsql security invoker set search_path = public as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists documents_validate_relationships on public.documents;
create trigger documents_validate_relationships before insert or update on public.documents for each row execute function public.validate_document_relationships();
drop trigger if exists documents_protect_ownership on public.documents;
create trigger documents_protect_ownership before update on public.documents for each row execute function public.protect_document_ownership();
drop trigger if exists documents_set_updated_at on public.documents;
create trigger documents_set_updated_at before update on public.documents for each row execute function public.set_documents_updated_at();
drop trigger if exists document_versions_validate on public.document_versions;
create trigger document_versions_validate before insert or update on public.document_versions for each row execute function public.validate_document_version();

alter table public.documents enable row level security;
alter table public.document_versions enable row level security;

drop policy if exists "Organization members can read documents" on public.documents;
create policy "Organization members can read documents" on public.documents for select to authenticated using (organization_id = (select organization_id from public.profiles where id = auth.uid()));
drop policy if exists "Organization members can create documents" on public.documents;
create policy "Organization members can create documents" on public.documents for insert to authenticated with check (organization_id = (select organization_id from public.profiles where id = auth.uid()) and uploaded_by = auth.uid());
drop policy if exists "Organization members can update documents" on public.documents;
create policy "Organization members can update documents" on public.documents for update to authenticated using (organization_id = (select organization_id from public.profiles where id = auth.uid())) with check (organization_id = (select organization_id from public.profiles where id = auth.uid()));
drop policy if exists "Organization members can delete documents" on public.documents;
create policy "Organization members can delete documents" on public.documents for delete to authenticated using (organization_id = (select organization_id from public.profiles where id = auth.uid()));

drop policy if exists "Organization members can read document versions" on public.document_versions;
create policy "Organization members can read document versions" on public.document_versions for select to authenticated using (organization_id = (select organization_id from public.profiles where id = auth.uid()));
drop policy if exists "Organization members can create document versions" on public.document_versions;
create policy "Organization members can create document versions" on public.document_versions for insert to authenticated with check (organization_id = (select organization_id from public.profiles where id = auth.uid()) and uploaded_by = auth.uid());
drop policy if exists "Organization members can delete document versions" on public.document_versions;
create policy "Organization members can delete document versions" on public.document_versions for delete to authenticated using (organization_id = (select organization_id from public.profiles where id = auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 52428800)
on conflict (id) do update set public = false;

drop policy if exists "Organization members can read document files" on storage.objects;
create policy "Organization members can read document files" on storage.objects for select to authenticated
using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select organization_id::text from public.profiles where id = auth.uid()));
drop policy if exists "Organization members can upload document files" on storage.objects;
create policy "Organization members can upload document files" on storage.objects for insert to authenticated
with check (bucket_id = 'documents' and (storage.foldername(name))[1] = (select organization_id::text from public.profiles where id = auth.uid()));
drop policy if exists "Organization members can delete document files" on storage.objects;
create policy "Organization members can delete document files" on storage.objects for delete to authenticated
using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select organization_id::text from public.profiles where id = auth.uid()));
