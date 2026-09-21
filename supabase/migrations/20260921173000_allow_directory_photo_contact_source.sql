-- Adds 'directory_photo' to contacts.source's allowed values.
--
-- process-cards was extended (2026-09-21, TN TOSS conference) to recognise a
-- printed attendee-directory page as a second photo shape alongside a
-- business card -- reps there were photographing roster pages instead of
-- individual cards, and every one failed OCR because process-cards only knew
-- to look for a card. contacts-from-ocr now tags a directory-sourced contact
-- with source='directory_photo' instead of 'card_photo' so a reviewer can
-- tell "the rep spoke to this person" apart from "this came off a roster
-- page" -- but contacts_source_check still only allowed 'form', 'card_photo',
-- 'note', so every directory-page contact's insert failed outright with a
-- constraint violation (discovered live, reprocessing today's stuck photos).
--
-- Dropping and recreating under the same name, not two separate statements,
-- so there's never a moment with no CHECK on this column.
alter table public.contacts drop constraint contacts_source_check;
alter table public.contacts add constraint contacts_source_check
  check (source = any (array['form', 'card_photo', 'directory_photo', 'note']));
