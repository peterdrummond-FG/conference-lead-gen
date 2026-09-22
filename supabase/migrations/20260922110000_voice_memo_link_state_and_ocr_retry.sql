-- Fixes two related gaps found diagnosing "voice memos aren't split / some
-- disappear entirely" in Review (2026-09-22, live data: 14 of 33 audio
-- messages had an empty matched_contact_ids despite a successful transcript;
-- several others were force-attached to the wrong contact by a caller-side
-- fallback).
--
-- 1. Audio-memo attribution state lived only in matched_contact_ids (empty
--    or not) plus an in-process Map in agent.mjs for retry cooldown
--    (lastRetryLinkAttemptAt) that's wiped on every restart -- unlike
--    contacts.match_status/match_attempts/last_match_attempt_at, which
--    persist a proper claim/cooldown state machine for the CRM-match
--    pipeline (see claim_pending_contacts). That gap is what let the old
--    "nothing matched -- attach to whichever contact was captured most
--    recently" fallback run: there was no persisted way to tell "genuinely
--    nobody, stop" apart from "just needs another pass once OCR catches
--    up," and no bound other than a fixed 20-minute window from
--    received_at -- which is wrong whenever the real blocker (the mentioned
--    person's card landing as a contact) takes longer than that, for any
--    reason.
--
-- 2. Photo OCR failures (process-cards) have no retry at all today -- a
--    single transient error permanently strands a real business card with
--    status='failed' and nothing ever looks at it again, unlike contacts
--    matching's own claim_pending_contacts cooldown/attempts retry. Seen
--    live: inbound_messages row ba97af88-487d-4ccd-b677-b0e02ff3bf98
--    (2026-09-10) failed with "You've hit your session limit" -- a Claude
--    usage-limit blip, not a bad photo -- and just sat there.
--
-- link_status/link_attempts/last_link_attempt_at mirror
-- contacts.match_status/match_attempts/last_match_attempt_at on purpose --
-- same problem, same proven shape, reused rather than inventing a second
-- pattern. processing_attempts/last_processing_attempt_at/error_class do
-- the same for the OCR/transcription stage that comes before linking.
--
-- This migration is schema-only: it adds columns and two new functions that
-- nothing calls yet. local-agent/agent.mjs is updated in a follow-up change
-- to actually use them (replace the candidates[0]/single-candidate blind
-- attach fallbacks, call claim_unlinked_audio_messages instead of the
-- in-memory-cooldown window sweep, classify failures into error_class and
-- call reconcile_retryable_failed_inbound_messages every tick, and
-- increment processing_attempts on first-time claims too, not just
-- resurrections). Deploying schema ahead of code is safe here: existing
-- code neither reads nor writes any of these columns, so behavior is
-- unchanged until that follow-up lands.
alter table public.inbound_messages
  add column link_status text not null default 'unlinked'
    check (link_status in ('unlinked', 'linked', 'no_candidate_found')),
  add column link_attempts int not null default 0,
  add column last_link_attempt_at timestamptz,
  add column processing_attempts int not null default 0,
  add column last_processing_attempt_at timestamptz,
  add column error_class text check (error_class in ('transient', 'terminal'));

comment on column public.inbound_messages.link_status is
  'Audio only. unlinked = still eligible for another attribution attempt; linked = at least one contact has this memo''s content attached; no_candidate_found = exhausted link_attempts without a match, needs a human via Review''s unmatched-memos list.';
comment on column public.inbound_messages.error_class is
  'Set when status flips to failed. transient = worth auto-retrying (rate limit, timeout, network/storage blip); terminal = the same input will never succeed (e.g. no legible card in photo) -- surfaced as a manual "Retry OCR" action instead of auto-retried.';
comment on column public.inbound_messages.attempts is
  'Superseded by link_attempts (audio linking) and processing_attempts (OCR/transcription) as of 20260922110000_voice_memo_link_state_and_ocr_retry.sql -- left in place per this repo''s append-only migration convention, no longer written by new code.';

-- Backfill: every already-completed audio message that has a match is
-- 'linked'. Rows currently misattached by the old candidates[0] fallback
-- stay at the 'unlinked' default here on purpose -- they need to be
-- re-attributed under the corrected logic (a follow-up step), not silently
-- marked 'linked' by this migration just because some contact_id happens to
-- already be sitting in matched_contact_ids.
update public.inbound_messages
set link_status = 'linked'
where kind = 'audio' and matched_contact_ids is not null and matched_contact_ids <> '{}';

-- Mirrors claim_pending_contacts: atomically claims audio messages still
-- eligible for another attribution attempt and bumps their attempt/cooldown
-- state in the same statement, so two agent processes can never double-claim
-- the same row. Deliberately no received_at window -- a memo stays eligible
-- for max_attempts tries regardless of how long ago it arrived, since the
-- actual blocker (the right contact hasn't landed yet) can resolve
-- arbitrarily late -- a slow multi-card OCR pass, a rep re-sending a failed
-- photo hours later, a directory-page batch processed after the event --
-- not on a fixed clock from when the memo itself came in.
create or replace function public.claim_unlinked_audio_messages(
  max_attempts integer,
  retry_delay_minutes integer,
  claim_limit integer
)
returns setof public.inbound_messages
language sql
set search_path to 'public'
as $function$
  update public.inbound_messages
  set link_attempts = link_attempts + 1,
      last_link_attempt_at = now()
  where id in (
    select id from public.inbound_messages
    where kind = 'audio'
      and link_status = 'unlinked'
      and link_attempts < max_attempts
      and (last_link_attempt_at is null or last_link_attempt_at < now() - (retry_delay_minutes || ' minutes')::interval)
    order by received_at
    limit claim_limit
    for update skip locked
  )
  returning *;
$function$;

-- Companion to reconcile_stale_inbound_messages (which un-sticks a row
-- stuck 'processing' after a crash) -- this un-sticks a row stuck 'failed'
-- after a transient error, the piece OCR never had. Resets it back to its
-- pending_* status so the existing findNextPendingPhotoMessage/
-- findNextPendingAudioMessage + claim flow in agent.mjs picks it back up
-- completely unchanged; a 'terminal' failure is deliberately excluded here
-- and never resurrected automatically -- only a human's explicit "Retry
-- OCR" action (a follow-up change) brings one of those back.
create or replace function public.reconcile_retryable_failed_inbound_messages(
  max_attempts integer,
  retry_delay_minutes integer
)
returns setof public.inbound_messages
language sql
set search_path to 'public'
as $function$
  update public.inbound_messages
  set status = case kind when 'photo' then 'pending_ocr' when 'audio' then 'pending_transcription' end,
      claimed_at = null,
      processing_attempts = processing_attempts + 1,
      last_processing_attempt_at = now(),
      error = null,
      error_class = null
  where id in (
    select id from public.inbound_messages
    where status = 'failed'
      and error_class = 'transient'
      and kind in ('photo', 'audio')
      and storage_path is not null
      and processing_attempts < max_attempts
      and (last_processing_attempt_at is null or last_processing_attempt_at < now() - (retry_delay_minutes || ' minutes')::interval)
    for update skip locked
  )
  returning *;
$function$;

-- Same query shapes the two claim functions above filter on -- kept as
-- partial indexes for the same reason inbound_messages_pending_photo_idx
-- exists: both run on a 20s poll against a table that only grows.
create index inbound_messages_unlinked_audio_idx
  on public.inbound_messages (link_attempts, last_link_attempt_at)
  where kind = 'audio' and link_status = 'unlinked';
create index inbound_messages_retryable_failed_idx
  on public.inbound_messages (processing_attempts, last_processing_attempt_at)
  where status = 'failed' and error_class = 'transient';
