# Email integration setup

Dependency: merge/run Team first, then `supabase/email.sql`.

Deploy `email-integration`. Set Edge Function secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SITE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, and optionally `MICROSOFT_TENANT_ID=common`.

Google Cloud: enable Gmail API; add `${SUPABASE_URL}/functions/v1/email-integration/callback/google`; scopes are `openid email` plus Gmail readonly/send/modify. Microsoft Entra: add `${SUPABASE_URL}/functions/v1/email-integration/callback/microsoft`; delegated permissions are `openid email offline_access User.Read Mail.ReadWrite Mail.Send`.

Tokens must be written/read only by the Edge Function using Supabase Vault. The supplied function deliberately reports `not_configured` until provider credentials and Vault token helper RPCs are configured. Do not expose tokens in `email_accounts` or browser code.

MVP sync is on demand when Messages/Settings opens. Webhooks and scheduled sync can be added later. Test OAuth state expiry/reuse, disconnect, revoked consent, duplicate message IDs, exact client-email matching, send, and attachment-to-Documents after credentials are configured.
