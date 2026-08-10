# Team setup

1. Review and run `supabase/team-users.sql`.
2. Deploy `invite-team-user` and `accept-team-invitation`; set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `SITE_URL` as Edge Function secrets.
3. Configure the Supabase Auth redirect allow-list with `${SITE_URL}`. Invitation delivery uses Supabase Auth email templates/SMTP.
4. Existing profile roles such as `Administrator` remain supported; new invitations use `admin`, `lawyer`, or `staff`.
5. Verify with two non-production test accounts that only admins can invite/deactivate and that inactive users are excluded from new assignments.

The migration installs a non-recursive `current_active_organization_id()` authorization helper and mandatory RESTRICTIVE RLS gates across Profiles, Organizations, Clients, Matters, Tasks, Communications, Calendar, Documents, document versions, and the private Documents Storage bucket. It assumes the Calendar and Documents migrations already exist, matching the required merge order. Existing `Administrator` and `admin` role values are both recognized.
