-- Voice memo actions in Contacts: Assign, Create contacts, Retry matching, Delete.
--
-- Assign, Retry (OCR / transcription) and Delete already existed behind the old
-- amber panel. Two things were missing:
--
--   1. "Create contacts" from a memo, started by a person. contacts-from-voice-memo
--      is service-role only (the local agent calls it after attribution decides a
--      transcript names someone), so a rep had no way to say "this memo is about
--      someone new, make them". The transcript goes through the same extraction a
--      pasted note does (note_submissions -> extract-note-contacts ->
--      contacts-from-note), so no new LLM path and no new credential. The memo is
--      what the submission came from, hence source_message_id: contacts-from-note
--      reads it to file the people as source='voice_memo' (not 'note') and to move
--      the memo out of the Contacts list once someone has actually been created.
--
--   2. A memo being worked on by a person must not also be worked on by the
--      automatic retry sweep. claim_unlinked_audio_messages would otherwise pick
--      the same memo up mid-extraction and attribute it again, so the same person
--      could be created twice (once per path). The unique index on
--      (source_message_id, lower(first_name), lower(last_name)) stops an identical
--      duplicate; this stops the race producing two *different* rows.
--
-- on delete set null, not cascade: deleting a memo must never delete the contacts
-- the extraction already produced, and contacts.source_message_id uses the same rule.
alter table public.note_submissions
  add column source_message_id uuid references public.inbound_messages(id) on delete set null;

-- The two reads that matter: "is something in flight for this memo" (every list
-- load, every claim) and "how many times has a person already tried" (the cap).
create index note_submissions_source_message_idx
  on public.note_submissions (source_message_id, status)
  where source_message_id is not null;

comment on column public.note_submissions.source_message_id is
  'Set when a person asked for the contacts in a voice memo (Contacts -> Create contacts). contacts-from-note then files each person as source=voice_memo against this memo, and marks the memo contact_created once the first one exists. Null for a pasted or texted note.';

-- Same function as 20260922110000_voice_memo_link_state_and_ocr_retry.sql with one
-- more condition: skip a memo that has a create-contacts submission in flight.
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
    select m.id from public.inbound_messages m
    where m.kind = 'audio'
      and m.link_status = 'unlinked'
      and m.link_attempts < max_attempts
      and (m.last_link_attempt_at is null or m.last_link_attempt_at < now() - (retry_delay_minutes || ' minutes')::interval)
      and not exists (
        select 1 from public.note_submissions ns
        where ns.source_message_id = m.id
          and ns.status in ('pending_extraction', 'processing')
      )
    order by m.received_at
    limit claim_limit
    for update of m skip locked
  )
  returning *;
$function$;
