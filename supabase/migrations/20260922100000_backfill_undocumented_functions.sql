-- Backfills migration history for seven stored functions that are live in
-- production and actively called by deployed code, but have no
-- corresponding file anywhere in supabase/migrations/ — found during the
-- n8n migration's research phase (2026-09-21/22) while pulling function
-- signatures needed to port local-agent's poll loops. (Started at five;
-- expired_media/mark_media_purged were added once the n8n
-- pipeline-purge-expired-media workflow needed their exact signature and
-- the same gap turned up there too.)
--
-- This migration changes NOTHING about current behavior: every body below
-- was pulled verbatim via `pg_get_functiondef` against the live project and
-- is byte-for-byte what's already deployed. It exists purely to close a
-- repo-history gap (this project's committed migration history was
-- incomplete relative to the deployed schema) — applying it is a no-op
-- against the running system, same as re-running CREATE OR REPLACE with an
-- identical body always is.
--
-- claim_contacts_needing_intent(): called by local-agent's intentLoop
-- (agent.mjs) via RPC. Note this is a plain read-only SELECT (STABLE), not a
-- row-locking claim like claim_pending_contacts below — concurrency safety
-- for the intent pipeline comes entirely from the write-back's optimistic
-- WHERE clause (contact_intent_is_manual=false AND interaction_notes=<snapshot>),
-- not from this function.
create or replace function public.claim_contacts_needing_intent(p_limit integer DEFAULT 5)
 returns TABLE(id uuid, interaction_notes text, contact_intent_classified_notes text)
 language sql
 stable
 set search_path to 'public'
as $function$
  select c.id, c.interaction_notes, c.contact_intent_classified_notes
  from public.contacts c
  where c.contact_intent_is_manual = false
    and c.interaction_notes is not null
    and c.interaction_notes <> ''
    and c.interaction_notes is distinct from c.contact_intent_classified_notes
  order by c.created_at
  limit greatest(p_limit, 1);
$function$;

-- export_reserve()/export_confirm()/export_release_stale(): the two-phase
-- export-batch mechanism referenced in migrations/README.md's "Superseded
-- comments" section (which says these replaced export_and_mark_synced()) but
-- whose own defining migration was never committed. Called from
-- supabase/functions/export-csv and export-confirm.
create or replace function public.export_reserve(p_user_id uuid)
 returns export_batches
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_ids uuid[];
  v_batch public.export_batches;
begin
  with to_sync as (
    select c.id
    from public.contacts c
    where c.review_status = 'approved'
      and c.synced_at is null
      -- Not already sitting in another unconfirmed batch: two exporters in
      -- the same minute must not both be handed the same leads.
      and not exists (
        select 1 from public.export_batches b
        where b.confirmed_at is null and c.id = any(b.contact_ids)
      )
    order by c.created_at
    for update
  )
  select array_agg(id) into v_ids from to_sync;

  insert into public.export_batches (created_by, contact_ids)
  values (p_user_id, coalesce(v_ids, '{}'::uuid[]))
  returning * into v_batch;

  return v_batch;
end;
$function$;

create or replace function public.export_confirm(p_batch_id uuid)
 returns integer
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_ids uuid[];
  v_count int;
begin
  update public.export_batches
  set confirmed_at = now()
  where id = p_batch_id and confirmed_at is null
  returning contact_ids into v_ids;

  if v_ids is null then return 0; end if;

  update public.contacts set synced_at = now()
  where id = any(v_ids) and synced_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

create or replace function public.export_release_stale(p_stale_minutes integer DEFAULT 30)
 returns integer
 language sql
 set search_path to 'public'
as $function$
  with released as (
    delete from public.export_batches
    where confirmed_at is null
      and created_at < now() - (p_stale_minutes || ' minutes')::interval
    returning 1
  ) select count(*)::int from released;
$function$;

-- check_submission_rate(): the public kiosk/QR intake form's (contacts-create)
-- IP-hash rate limiter, backed by public_submission_log.
create or replace function public.check_submission_rate(p_ip_hash text, p_max integer, p_window_minutes integer)
 returns boolean
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_count int;
begin
  -- Opportunistic prune; this table is never read for anything but the
  -- window below, so nothing needs the history.
  delete from public.public_submission_log where created_at < now() - interval '24 hours';

  select count(*) into v_count
  from public.public_submission_log
  where ip_hash = p_ip_hash
    and created_at > now() - (p_window_minutes || ' minutes')::interval;

  if v_count >= p_max then
    return false;
  end if;

  insert into public.public_submission_log (ip_hash) values (p_ip_hash);
  return true;
end;
$function$;

-- expired_media()/mark_media_purged(): the daily retention purge
-- (local-agent/purge-expired-media.mjs, currently manual/cron-only) reads
-- eligible rows then clears storage_path once the object is actually
-- deleted from Storage — this is what the n8n
-- pipeline-purge-expired-media workflow calls directly. bucket is derived
-- from kind by the caller (photo -> contact-photos, audio -> voice-memos,
-- same mapping supabase/functions/twilio-webhook/index.ts uses), not
-- stored on the row itself.
create or replace function public.expired_media(p_retention_days integer DEFAULT 90, p_limit integer DEFAULT 500)
 returns TABLE(id uuid, kind text, storage_path text, received_at timestamptz)
 language sql
 stable
 set search_path to 'public'
as $function$
  select m.id, m.kind, m.storage_path, m.received_at
  from public.inbound_messages m
  where m.storage_path is not null
    and m.received_at < now() - make_interval(days => greatest(p_retention_days, 1))
  order by m.received_at
  limit greatest(p_limit, 1);
$function$;

create or replace function public.mark_media_purged(p_ids uuid[])
 returns integer
 language plpgsql
 set search_path to 'public'
as $function$
declare v_count int;
begin
  update public.inbound_messages
  set storage_path = null
  where id = any(p_ids) and storage_path is not null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;
