-- APPLIED 2026-09-25 at n8n cutover, before the per-pipeline trigger files in
-- n8n/cutover-migrations/ (see its README.md).
--
-- Database Webhooks for the n8n pipelines, done as plain triggers + pg_net so
-- every part is in a migration: the shared secret, the payload shape and the
-- WHEN clause that decides which rows fire.
--
-- Payload is the row id only ({type, table, record: {id}}). Every pipeline
-- UUID-validates that id, re-reads the row with its own credential and
-- re-checks its eligibility before claiming it -- nothing else in the payload
-- is trusted, so nothing else is sent. It also means no contact data leaves the
-- database through this path.
--
-- The secret is generated here and never leaves the database except when an
-- operator copies it into n8n's "Supabase DB Webhook Secret" credential
-- (Header Auth, name x-ckh-webhook-secret) -- same pattern as
-- cron_dispatch_secret in 20260914190000_session_reminders_and_confirmations.sql.
select vault.create_secret(
  encode(gen_random_bytes(32), 'hex'),
  'n8n_webhook_secret',
  'Shared secret the n8n pipeline webhooks check (Header Auth x-ckh-webhook-secret)'
);

-- TG_ARGV[0] is the n8n webhook path. net.http_post only enqueues the request
-- (pg_net sends it asynchronously), so a slow or down n8n never blocks or
-- fails the insert/update that fired it; the pipelines' 5-minute backstops
-- pick up anything a lost request missed.
create or replace function public.notify_n8n()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform net.http_post(
    url := 'https://workflow.flippengroup.com/webhook/' || tg_argv[0],
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-ckh-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'n8n_webhook_secret')
    ),
    body := jsonb_build_object(
      'type', tg_op,
      'table', tg_table_name,
      'record', jsonb_build_object('id', new.id)
    )
  );
  return new;
end;
$function$;

revoke all on function public.notify_n8n() from public, anon, authenticated;
