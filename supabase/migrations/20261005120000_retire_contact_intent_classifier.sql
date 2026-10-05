-- Retires the hot/warm/cold "heat" classifier (2026-10-05). Review's Heat
-- control and "Hot first" sort were replaced by a Source filter and sort, so
-- nothing reads contact_intent any more.
--
-- Drops what ran the classifier:
--   * contacts_notify_n8n_contact_intent (20260925222514) -- fired the n8n
--     pipeline-contact-intent webhook whenever interaction_notes changed.
--   * claim_contacts_needing_intent / set_contact_intent_if_current -- the
--     claim and optimistic-write RPCs for that pipeline and for local-agent's
--     intentLoop (both deleted in the same change).
--
-- Deliberately KEEPS the columns (contact_intent, contact_intent_is_manual,
-- contact_intent_classified_notes) and their ~17 existing values: nothing
-- downstream uses them (export-csv never read them), a dropped column cannot be
-- brought back, and keeping them costs nothing. insert_contact_with_duplicate_check
-- still maps a contact_intent key from its payload; no caller sends one, so it
-- stays null. If the columns are ever dropped, recreate that function first.
drop trigger if exists contacts_notify_n8n_contact_intent on public.contacts;
drop function if exists public.claim_contacts_needing_intent(integer);
drop function if exists public.set_contact_intent_if_current(uuid, text, text);
