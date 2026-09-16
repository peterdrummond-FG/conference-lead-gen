-- Stage 18 — a rep whose phone is already bound to an event can text a
-- short note about one contact ("Jane Smith, principal, jsmith@lincoln...")
-- instead of a folder code or a "setup" command. Before this, that text fell
-- through to the folder-code fallback, failed to match, and got the
-- misleading "doesn't match a known event code" reply — see the fallback
-- branch in twilio-webhook/index.ts.
--
-- Multi-contact notes are still rejected onto the web /notes page:
-- 20260914140000_pasted_note_intake.sql's segmentation reasoning (over
-- ~160 GSM-7 / 70 UCS-2 chars a text can arrive as separate, out-of-order
-- webhooks with nothing identifying which piece is which) applies just as
-- much to one long note, so twilio-webhook only accepts a note that provably
-- fits in a single SMS segment and points anything longer at the notes page.

alter table public.inbound_messages drop constraint inbound_messages_kind_check;
alter table public.inbound_messages add constraint inbound_messages_kind_check
  check (kind in ('folder_code_bind', 'photo', 'audio', 'unrecognized', 'conference_setup', 'text_note'));

-- A web paste always has an authenticated submitted_by (notes-submit runs
-- behind requireUser); an SMS note never does -- Twilio's POST isn't a
-- Supabase-authenticated session -- but always has the sender's number.
-- Exactly one of the two identifies who sent it; contacts-from-note branches
-- on which is set to resolve rep credit (submitted_by's profile role for a
-- web paste, from_phone against profiles.phone_number for an SMS note, same
-- lookup contacts-from-ocr already does for texted-in card photos).
alter table public.note_submissions alter column submitted_by drop not null;
alter table public.note_submissions add column from_phone text;
alter table public.note_submissions add constraint note_submissions_source_check
  check ((submitted_by is not null) <> (from_phone is not null));
