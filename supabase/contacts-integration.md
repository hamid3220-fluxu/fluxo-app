# Google Contacts integration setup

This module imports Google Contacts into FLUXO Contacts. It never writes to Google.

## Required configuration

1. Apply `supabase/contacts.sql` after the existing FLUXO schema.
2. Enable the Google People API in the same Google Cloud project used for OAuth.
3. Add this authorized redirect URI to the Google OAuth web client:

   `https://jhbpgdpllwligclpalsj.supabase.co/functions/v1/google-contacts-integration/callback`

4. Configure these Edge Function secrets if they are not already present:

   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `SITE_URL`

5. Deploy the function with gateway JWT verification disabled because Google redirects to the callback without a FLUXO Authorization header:

   `supabase functions deploy google-contacts-integration --no-verify-jwt`

   Or use this project configuration:

   ```toml
   [functions.google-contacts-integration]
   verify_jwt = false
   ```

This does not make import actions public. The callback requires a random, SHA-256-hashed, single-use OAuth state that expires after 10 minutes. Every non-callback action still requires a valid Supabase user JWT and an active FLUXO profile.

## Permission and behavior

- OAuth scope: `https://www.googleapis.com/auth/contacts.readonly`
- Google API method: `people.connections.list` (`GET` only)
- Imported fields: display name, primary email, primary phone, primary company
- Existing FLUXO contacts are matched by normalized email or phone.
- Re-importing the same Google resource does not create another contact.
- Conflicting matches are skipped for manual review.
- Import never creates a Client. Conversion only happens after a user presses **Convert to client**.
