-- Enables proactive outbound SMS on a timer: a 60-minute inactivity
-- reminder nudging the rep to re-send their event's folder code, and a
-- "N contacts received" confirmation once a batch of card photos/voice
-- memos has finished processing. Twilio's webhook only ever replies to an
-- inbound text; nothing in this project runs without one until pg_cron.
create extension if not exists pg_cron;

alter table phone_event_bindings
  add column last_activity_at timestamptz not null default now(),
  add column expiry_notified_at timestamptz,
  add column contacts_confirmed_through timestamptz not null default now();

comment on column phone_event_bindings.last_activity_at is
  'Touched by twilio-webhook on every inbound request from this phone (text or media). Drives the 60-minute inactivity reminder in session-notifications.';
comment on column phone_event_bindings.expiry_notified_at is
  'Set once the inactivity reminder has fired for the current idle stretch; cleared by twilio-webhook the moment new activity arrives so the next idle stretch can fire again.';
comment on column phone_event_bindings.contacts_confirmed_through is
  'High-water mark: contacts created from photo/audio messages received up to this time have already been confirmed by SMS. Advances in session-notifications.';

-- Backfill so deploying this doesn't immediately treat every already-bound
-- phone as having just gone idle.
update phone_event_bindings
set last_activity_at = greatest(bound_at, updated_at),
    contacts_confirmed_through = now();

-- Shared secret pg_cron uses to authenticate its own call into the
-- session-notifications Edge Function, which otherwise has no legitimate
-- caller and must stay closed to the public internet. Generated here so
-- the raw value never has to leave the database; verify_cron_secret below
-- lets the Edge Function check it via the same service-role Postgres
-- access it already has for every other table, instead of a separately
-- managed environment secret.
select vault.create_secret(
  encode(gen_random_bytes(32), 'hex'),
  'cron_dispatch_secret',
  'Shared secret between pg_cron and the session-notifications Edge Function'
);

create or replace function public.verify_cron_secret(candidate text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'cron_dispatch_secret' and decrypted_secret = candidate
  );
$$;

revoke all on function public.verify_cron_secret(text) from public;
grant execute on function public.verify_cron_secret(text) to service_role;

select cron.schedule(
  'session-notifications-dispatch',
  '* * * * *',
  $cron$
  select net.http_post(
    url := 'https://yrvppufkerbjpvrxniot.supabase.co/functions/v1/session-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_dispatch_secret')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
