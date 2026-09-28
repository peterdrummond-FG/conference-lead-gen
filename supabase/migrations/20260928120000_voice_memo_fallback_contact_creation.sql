-- Voice-memo fallback contact creation.
--
-- attribute-voice-memo only ever matches a transcript against contacts
-- already captured (by card or directory photo) at the same event by the
-- same rep. A memo about someone never photographed at all had no candidate
-- to attach to and, after LINK_MAX_ATTEMPTS retries, could only ever land on
-- 'no_candidate_found' with nothing but a raw transcript for a human to work
-- from. Now, at a lower attempt threshold, the skill is additionally asked
-- whether the transcript alone (a name plus a school/district/title) is
-- enough to create a contact outright -- see linkTranscriptToContacts in
-- local-agent/agent.mjs and contacts-from-voice-memo.
--
-- Three changes:
--   1. contacts.source gains 'voice_memo' (a contact created this way, not
--      from any photo or pasted note).
--   2. inbound_messages.link_status gains 'contact_created', distinct from
--      'linked' (which means "attached to an *existing* candidate") --
--      inbound-messages-unresolved-list already allowlists just
--      ('unlinked', 'no_candidate_found'), so this new value is excluded
--      from that view with no query change.
--   3. A partial unique index so contacts-from-voice-memo's retry/crash path
--      can dedupe by inbound_messages id the way contacts-from-ocr dedupes by
--      source_image_hash. Scoped to source='voice_memo' only -- unlike a
--      card/directory photo (which can produce several contacts from one
--      photo message), a single voice memo's fallback can only ever produce
--      at most one contact, so this can't collide with the existing
--      multi-contact-per-photo case.
--
-- Dropping and recreating each CHECK under its same name, not as separate
-- statements, so there's never a moment with no CHECK on either column --
-- same convention as 20260921173000_allow_directory_photo_contact_source.sql.
alter table public.contacts drop constraint contacts_source_check;
alter table public.contacts add constraint contacts_source_check
  check (source = any (array['form', 'card_photo', 'directory_photo', 'note', 'voice_memo']));

alter table public.inbound_messages drop constraint inbound_messages_link_status_check;
alter table public.inbound_messages add constraint inbound_messages_link_status_check
  check (link_status in ('unlinked', 'linked', 'no_candidate_found', 'contact_created'));

comment on column public.inbound_messages.link_status is
  'Audio only. unlinked = still eligible for another attribution attempt; linked = at least one existing contact has this memo''s content attached; contact_created = no existing candidate matched, but the transcript alone had enough info to create a new voice_memo-sourced contact (see contacts-from-voice-memo); no_candidate_found = exhausted link_attempts without either outcome, needs a human via Review''s unmatched-memos list.';

create unique index contacts_voice_memo_source_message_id_idx
  on public.contacts (source_message_id)
  where source = 'voice_memo';
