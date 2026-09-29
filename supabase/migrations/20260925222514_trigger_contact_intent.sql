-- APPLIED 2026-09-25. Apply at cutover of pipeline-contact-intent (needs
-- 00_notify_n8n_function.sql first). Webhook path: ckh-contact-intent.
--
-- Fires when a contact's notes are new or changed and a classification is
-- actually owed -- the same condition pipeline-contact-intent's Needs
-- Classification filter re-checks after re-reading the row. UPDATE OF
-- interaction_notes only: the pipeline's own write (contact_intent and
-- contact_intent_classified_notes) doesn't touch interaction_notes, so it can't
-- re-fire this. A voice-memo excerpt appended to the notes does, which is what
-- gets the new text classified.
create trigger contacts_notify_n8n_contact_intent
  after insert or update of interaction_notes on public.contacts
  for each row
  when (new.contact_intent_is_manual = false
        and coalesce(new.interaction_notes, '') <> ''
        and new.interaction_notes is distinct from new.contact_intent_classified_notes)
  execute function public.notify_n8n('ckh-contact-intent');
