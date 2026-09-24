-- Closes the one gap the 2026-09-22 voice-memo/OCR-retry migration
-- (20260922110000_voice_memo_link_state_and_ocr_retry.sql) left open, found
-- while designing the n8n migration's Twilio-reliability workflows (see the
-- migration plan, "Twilio reliability" item 2 and "Reconciliation & purge
-- jobs").
--
-- reconcile_retryable_failed_inbound_messages requires storage_path is not
-- null -- it only resurrects a failure *after* a successful Twilio media
-- download. A failure of the download itself (supabase/functions/
-- twilio-webhook/index.ts, the two `catch` blocks around the photo and audio
-- fetch calls, ~lines 704-763) leaves storage_path null forever and never
-- sets error_class, so that row is invisible to every retry mechanism that
-- exists today -- a dead end, exactly like OCR retry was before that
-- migration.
--
-- Unlike an OCR/transcription failure (which can be a genuine terminal
-- condition, e.g. "no legible card in this photo"), a failed *download* has
-- no terminal case worth distinguishing: Twilio still has the media, and
-- re-fetching it is always worth trying again up to a bound. That's why this
-- claim function needs no error_class filter the way
-- reconcile_retryable_failed_inbound_messages does -- every status='failed'
-- row with no storage_path is, by definition, a failed-download row.
--
-- download_attempts/last_download_attempt_at are kept separate from
-- processing_attempts/last_processing_attempt_at (rather than reusing them)
-- because they count a different stage: a row can exhaust download attempts
-- without ever reaching OCR/transcription at all, and reusing one counter
-- for both would make "processing_attempts=3" ambiguous about which stage
-- actually failed three times.
--
-- Schema-only, same convention as the migration it follows: this adds
-- columns and one new function that nothing calls yet. The n8n
-- pipeline-failed-media-retry workflow (re-fetch via Twilio's
-- GET /Messages/{MessageSid}/Media.json using the already-stored
-- twilio_message_sid, since twilio-webhook never persists the raw per-media
-- MediaUrl) is what actually calls this, built once a Twilio credential
-- exists for n8n (see the plan's Stage 0 notes -- stubbed, not fully built,
-- until then).
alter table public.inbound_messages
  add column download_attempts int not null default 0,
  add column last_download_attempt_at timestamptz;

comment on column public.inbound_messages.download_attempts is
  'Counts retry attempts at re-downloading media from Twilio after status=failed with storage_path still null -- see claim_undownloaded_media. Distinct from processing_attempts, which counts OCR/transcription attempts after a successful download.';

-- Mirrors claim_unlinked_audio_messages: atomically claims failed-download
-- rows still eligible for another attempt and bumps their attempt/cooldown
-- state in the same statement, so two callers (or two overlapping n8n
-- executions) can never double-claim the same row. Returns the claimed rows
-- (including twilio_message_sid) for the caller to actually act on -- unlike
-- reconcile_retryable_failed_inbound_messages, this can't just flip status
-- back to pending itself, since the bytes still need to be re-fetched from
-- Twilio first.
create or replace function public.claim_undownloaded_media(
  max_attempts integer,
  retry_delay_minutes integer,
  claim_limit integer
)
returns setof public.inbound_messages
language sql
set search_path to 'public'
as $function$
  update public.inbound_messages
  set download_attempts = download_attempts + 1,
      last_download_attempt_at = now()
  where id in (
    select id from public.inbound_messages
    where status = 'failed'
      and storage_path is null
      and kind in ('photo', 'audio')
      and download_attempts < max_attempts
      and (last_download_attempt_at is null or last_download_attempt_at < now() - (retry_delay_minutes || ' minutes')::interval)
    order by received_at
    limit claim_limit
    for update skip locked
  )
  returning *;
$function$;

-- Same reasoning as inbound_messages_unlinked_audio_idx /
-- inbound_messages_retryable_failed_idx: this is meant to run on a scheduled
-- sweep against a table that only grows.
create index inbound_messages_undownloaded_media_idx
  on public.inbound_messages (download_attempts, last_download_attempt_at)
  where status = 'failed' and storage_path is null;
