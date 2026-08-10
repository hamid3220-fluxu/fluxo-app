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

MVP sync is on demand when Messages/Settings opens. Webhooks and scheduled sync can be added later. Test OAuth state expiry/reuse, disconnect, revoked consent, duplicate message IDs, exact client-email matching, send, and attachment-to-Documents after credentials are configured.
