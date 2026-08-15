# Email integration setup

Dependency: merge/run Team first, then `supabase/email.sql`.

Deploy `email-integration` with gateway JWT verification disabled because Google and Microsoft redirect directly to its callback URLs without a FLUXO Authorization header:

```bash
supabase functions deploy email-integration --no-verify-jwt
```

The equivalent project configuration is:

```toml
[functions.email-integration]
verify_jwt = false
```

This does not make application actions public. The callback is protected by a cryptographically random, SHA-256-hashed, single-use OAuth state that expires after 10 minutes. Every non-callback action (`connect`, `send`, `disconnect`, and `sync`) still requires an Authorization header, validates its user JWT with Supabase Auth, and requires an active FLUXO profile.

Set `SITE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, and optionally `MICROSOFT_TENANT_ID=common`. Hosted Edge Functions can use the automatically provided `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS`, and `SUPABASE_SECRET_KEYS`; local/single-key environments can use `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`. The function retains fallback compatibility with `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.

Google Cloud: enable Gmail API; add `${SUPABASE_URL}/functions/v1/email-integration/callback/google`; scopes are `openid email` plus Gmail readonly/send/modify. Microsoft Entra: add `${SUPABASE_URL}/functions/v1/email-integration/callback/microsoft`; delegated permissions are `openid email offline_access User.Read Mail.ReadWrite Mail.Send`.

Tokens must be written, read, and deleted only by the Edge Function using Supabase Vault. Disconnect removes the account's access/refresh secrets and private token metadata while retaining the email account row and historical Communications. The supplied function deliberately reports `not_configured` until provider credentials and Vault token helper RPCs are configured. Do not expose tokens in `email_accounts` or browser code.

## Gmail polling sync

`email-sync` imports incoming and sent Gmail messages. It uses the existing
`email_accounts.sync_cursor` for Gmail `historyId`, starts with the most recent
30 days (up to 250 messages), and then uses incremental Gmail history. These
defaults can be adjusted with `GMAIL_SYNC_INITIAL_DAYS` (1-90),
`GMAIL_SYNC_INITIAL_MAX_MESSAGES` (1-500), and `GMAIL_SYNC_ACCOUNT_LIMIT`
(1-50).

Opening Communications triggers a throttled sync for the signed-in user's own
Google account. Periodic all-account execution uses `EMAIL_SYNC_SECRET`; this
secret must exist only in Edge Function secrets and Postgres Vault. The function
must be deployed with gateway JWT verification disabled because the Cron request
uses the dedicated secret header. User-triggered requests still validate the
Supabase Auth JWT inside the function.

```bash
supabase link --project-ref jhbpgdpllwligclpalsj
supabase db push
supabase functions deploy email-integration --no-verify-jwt
supabase secrets set EMAIL_SYNC_SECRET="<generate-a-long-random-value>"
supabase functions deploy email-sync --no-verify-jwt
```

Apply this order exactly: migration first, then the existing send function so
all post-send writes use atomic provider-ID deduplication, then the sync worker.
Only after those steps should the frontend change be released through the normal
Vercel workflow.

The repository did not previously configure `pg_cron`/`pg_net`. After reviewing
the migration and deploying the function, enable Supabase Cron and `pg_net`, then
store the project URL and the same random sync secret in Vault:

```sql
select vault.create_secret(
  'https://jhbpgdpllwligclpalsj.supabase.co',
  'gmail_sync_project_url'
);

select vault.create_secret(
  '<same-long-random-value>',
  'gmail_sync_secret'
);

select cron.schedule(
  'fluxo-gmail-sync-every-five-minutes',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'gmail_sync_project_url'
      limit 1
    ) || '/functions/v1/email-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-email-sync-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'gmail_sync_secret'
        limit 1
      )
    ),
    body := '{"mode":"all"}'::jsonb,
    timeout_milliseconds := 300000
  ) as request_id;
  $$
);
```

The current Google OAuth request already includes `gmail.readonly`,
`gmail.modify`, and `gmail.send`; Gmail sync adds no new OAuth scope and does not
require existing accounts to reconnect. Attachments store metadata only. Gmail
attachment bytes are not downloaded and remote HTML or tracking images are
never rendered.

The service-role-only `upsert_email_message_communication` RPC serializes work
by `(account_id, provider_message_id)`. Both the Gmail sync worker and the
existing send path use it, so a FLUXO-sent message and a concurrent polling run
resolve to one Communication and one `email_messages` row.

Test OAuth state expiry/reuse, disconnect, revoked consent, duplicate provider
message IDs, exact client-email matching, send, incremental history expiry, and
attachment metadata after credentials are configured.
