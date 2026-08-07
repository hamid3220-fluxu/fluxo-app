# External calendar configuration

The browser must never receive provider client secrets or refresh tokens. Implement OAuth callbacks and event synchronization in Supabase Edge Functions (or an equivalent trusted server runtime), and store refresh tokens in Supabase Vault or another encrypted server-only secret store.

In Supabase Authentication URL Configuration, keep `https://fluxo.mentedev.pt/` as the production Site URL and add it to the allowed Redirect URLs before enabling either provider.

## Google Calendar

Create a Google Cloud OAuth web application and enable the Google Calendar API. Configure:

- `GOOGLE_CALENDAR_CLIENT_ID`
- `GOOGLE_CALENDAR_CLIENT_SECRET`
- `GOOGLE_CALENDAR_REDIRECT_URI=https://jhbpgdpllwligclpalsj.supabase.co/functions/v1/calendar-google-callback`
- Application return URL: `https://fluxo.mentedev.pt/`
- Minimum scope for two-way event sync: `https://www.googleapis.com/auth/calendar.events`

The connect Edge Function should create OAuth state tied to the signed-in user, use PKCE where supported, exchange the authorization code server-side, store the refresh token securely, and upsert only non-secret account/calendar metadata into `calendar_integrations`.

## Microsoft Outlook / Microsoft 365

Create a Microsoft Entra ID web application and configure:

- `MICROSOFT_CALENDAR_CLIENT_ID`
- `MICROSOFT_CALENDAR_CLIENT_SECRET`
- `MICROSOFT_CALENDAR_TENANT=common` (or the required tenant ID)
- `MICROSOFT_CALENDAR_REDIRECT_URI=https://jhbpgdpllwligclpalsj.supabase.co/functions/v1/calendar-microsoft-callback`
- Application return URL: `https://fluxo.mentedev.pt/`
- Delegated permissions: `openid`, `profile`, `offline_access`, `Calendars.ReadWrite`

The callback must validate OAuth state, exchange the code server-side, store refresh tokens securely, and expose only safe account/calendar metadata to the browser.

## Required server endpoints

The Settings UI expects these authenticated Edge Function routes when provider configuration is enabled:

- `calendar-google-connect`
- `calendar-google-callback`
- `calendar-microsoft-connect`
- `calendar-microsoft-callback`
- `calendar-disconnect`
- `calendar-sync-event`

Event synchronization must upsert using `calendar_event_syncs` so edits update the existing provider event. Deletion should set `delete_pending`, remove/cancel the provider event, and then remove the sync row. Failed operations should retain a safe error summary in `last_error` without sensitive event content or tokens.
