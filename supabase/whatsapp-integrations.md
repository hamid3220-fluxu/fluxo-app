# WhatsApp Business setup

Dependencies: Team → Email → WhatsApp. Run `supabase/whatsapp.sql` only after the earlier migrations.

Use an official Meta Developer App and WhatsApp Business Account. Obtain the WABA ID, `phone_number_id`, display number, app secret, webhook verify token, and a production system-user access token with the minimum WhatsApp permissions.

Deploy `whatsapp-webhook` with JWT verification disabled for Meta callbacks, and deploy `whatsapp-send` normally. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `META_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, and `WHATSAPP_GRAPH_VERSION` (default `v23.0`). Configure the callback as `${SUPABASE_URL}/functions/v1/whatsapp-webhook` and subscribe to `messages`.

Provision `whatsapp_integrations` metadata server-side. Store the access token with `vault.create_secret`, then place only its returned UUID in `whatsapp_integration_secrets`. Never place the token in browser code or the public metadata table.

The webhook verifies Meta's signature, deduplicates events, maps exact normalized E.164-like digits to existing Client phones, and never guesses a Matter. Inbound media remains provider metadata until a user explicitly saves it to private Documents. Test verification, inbound text/media, delivery statuses, duplicate delivery, outbound session messages, and approved-template behavior with Meta test resources before production.
