-- Firm contact details (Settings → Organisation), used on the letterhead of
-- AI-drafted documents. Written only through the org-settings edge function
-- (admins). Safe to re-run.

alter table public.organizations
  add column if not exists address text,
  add column if not exists postal_code text,
  add column if not exists city text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists nif text,
  add column if not exists website text;
