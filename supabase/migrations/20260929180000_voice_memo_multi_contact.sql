-- A voice memo can now create MORE than one contact.
--
-- 20260928120000_voice_memo_fallback_contact_creation.sql keyed voice_memo
-- contacts on (source_message_id) alone, reasoning that "a single voice memo's
-- fallback can only ever produce at most one contact". That stopped being true
-- on 2026-09-29: a rep's memo named four people, two of whom had cards and two
-- of whom did not. attribute-voice-memo only ever sorted a memo among contacts
-- that already existed, so the two without cards were dropped without a trace
-- and the memo still read "linked". Memos now also create a contact for every
-- person the rep met and described who matches no captured contact (not for a
-- name merely mentioned in relation to a lead; see attribute-voice-memo Step 8,
-- contacts-from-voice-memo, local-agent linkTranscriptToContacts).
--
-- The dedupe key therefore becomes memo + person. It exists so a retry after a
-- crash between "contact created" and "link_status recorded" is a no-op rather
-- than a duplicate, and that is still all it is for: the same memo replayed
-- must not mint the same person twice. Lower-cased so "kaylin"/"Kaylin" from
-- two transcriptions of one memo are the same person.
--
-- New index first, old one dropped second, so uniqueness is never absent.
create unique index if not exists contacts_voice_memo_source_message_person_idx
  on public.contacts (source_message_id, lower(first_name), lower(last_name))
  where source = 'voice_memo';

drop index if exists public.contacts_voice_memo_source_message_id_idx;
