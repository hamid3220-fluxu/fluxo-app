-- Server-only token bundle reader for Email Edge Function.
-- Never grant this function to anon or authenticated users.

create or replace function public.read_email_token_bundle(target_account uuid)
returns table(
  access_token text,
  refresh_token text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;

  return query
  select
    access_secret.decrypted_secret,
    refresh_secret.decrypted_secret,
    eas.expires_at
  from public.email_account_secrets eas
  join vault.decrypted_secrets access_secret
    on access_secret.id = eas.access_token_secret_id
  left join vault.decrypted_secrets refresh_secret
    on refresh_secret.id = eas.refresh_token_secret_id
  where eas.account_id = target_account;
end
$$;

revoke all on function public.read_email_token_bundle(uuid) from public;
revoke all on function public.read_email_token_bundle(uuid) from anon;
revoke all on function public.read_email_token_bundle(uuid) from authenticated;
grant execute on function public.read_email_token_bundle(uuid) to service_role;
