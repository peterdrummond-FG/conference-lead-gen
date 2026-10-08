-- Read-only health check for the intake pipelines. Returns one row per problem
-- class and NOTHING when all is well, so a caller (the daily health routine)
-- can stop after one cheap query. Thresholds assume n8n's own 5-minute backstop
-- is working: anything still pending/processing after 2 hours was not picked up,
-- and a failure that survived the retry sweep (10 x 5 min) is not transient.
-- Failures are only reported inside a 26-hour window so a daily run does not
-- re-report yesterday's. No transcript, name, phone or email is returned: only
-- ids, counts and the pipeline's own error text (capped), so the output is safe
-- to put in a run report or an alert.
create or replace function public.health_check()
returns table (check_name text, severity text, problem_count integer, sample_ids text[], detail text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with stuck_msgs as (
    select id, kind, status from public.inbound_messages
    where kind in ('photo','audio','text_note')
      and status in ('pending_ocr','pending_transcription','processing')
      and coalesce(claimed_at, received_at) < now() - interval '2 hours'
  ), failed_msgs as (
    select id, kind, left(coalesce(error,''), 160) as err, error_class from public.inbound_messages
    where kind in ('photo','audio','text_note')
      and status = 'failed'
      and coalesce(processed_at, last_processing_attempt_at, received_at) > now() - interval '26 hours'
      and coalesce(processed_at, last_processing_attempt_at, received_at) < now() - interval '1 hour'
  ), stalled_link as (
    select id from public.inbound_messages
    where kind = 'audio' and status = 'completed' and link_status = 'unlinked'
      and coalesce(last_link_attempt_at, processed_at, received_at) < now() - interval '2 hours'
  ), stuck_notes as (
    select id from public.note_submissions
    where status in ('pending_extraction','processing')
      and coalesce(claimed_at, created_at) < now() - interval '2 hours'
  ), failed_notes as (
    select id, left(coalesce(error,''), 160) as err from public.note_submissions
    where status = 'failed'
      and coalesce(processed_at, created_at) > now() - interval '26 hours'
      and coalesce(processed_at, created_at) < now() - interval '1 hour'
  ), stuck_match as (
    select id from public.contacts
    where match_status = 'pending'
      and coalesce(last_match_attempt_at, created_at) < now() - interval '2 hours'
  )
  select 'messages_stuck', 'high', count(*)::int, (array_agg(id::text order by id))[1:10],
         string_agg(distinct kind || ':' || status, ', ')
    from stuck_msgs having count(*) > 0
  union all
  select 'messages_failed', 'high', count(*)::int, (array_agg(id::text order by id))[1:10],
         string_agg(distinct kind || ' [' || coalesce(error_class,'?') || '] ' || err, ' | ')
    from failed_msgs having count(*) > 0
  union all
  select 'voice_relink_stalled', 'medium', count(*)::int, (array_agg(id::text order by id))[1:10],
         'completed voice memos still unlinked with no link attempt for 2h+; the relink sweep may not be running'
    from stalled_link having count(*) > 0
  union all
  select 'notes_stuck', 'high', count(*)::int, (array_agg(id::text order by id))[1:10],
         'note_submissions pending or processing for 2h+'
    from stuck_notes having count(*) > 0
  union all
  select 'notes_failed', 'high', count(*)::int, (array_agg(id::text order by id))[1:10],
         string_agg(distinct err, ' | ')
    from failed_notes having count(*) > 0
  union all
  select 'matching_stuck', 'high', count(*)::int, (array_agg(id::text order by id))[1:10],
         'contacts with match_status = pending for 2h+'
    from stuck_match having count(*) > 0;
$$;

revoke all on function public.health_check() from public, anon, authenticated;
grant execute on function public.health_check() to service_role;
