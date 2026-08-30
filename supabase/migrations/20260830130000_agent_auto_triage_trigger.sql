-- Direct pg_net-based trigger for agent-auto-triage, used instead of the
-- Dashboard "Database Webhooks" feature (that feature's supabase_functions
-- schema is unavailable on this project). pg_net is already installed.
--
-- SECURITY: this file is a template — replace <AGENT_TRIAGE_SECRET> below
-- with the real value (same as the AGENT_TRIAGE_SECRET edge function
-- secret) before running. Never commit the real secret in this file; this
-- migration was applied by hand in the SQL Editor with the real value
-- filled in, not via `supabase db push`, precisely to keep it out of git.
create or replace function public.notify_agent_auto_triage()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform net.http_post(
    url := 'https://jhbpgdpllwligclpalsj.supabase.co/functions/v1/agent-auto-triage',
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'communications',
      'schema', 'public',
      'record', to_jsonb(new)
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Agent-Triage-Secret', '<AGENT_TRIAGE_SECRET>'
    ),
    timeout_milliseconds := 5000
  );
  return new;
end;
$$;
revoke all on function public.notify_agent_auto_triage() from public;

drop trigger if exists communications_agent_auto_triage on public.communications;
create trigger communications_agent_auto_triage
after insert on public.communications
for each row
when (new.direction = 'inbound' and new.communication_type in ('email', 'whatsapp'))
execute function public.notify_agent_auto_triage();
