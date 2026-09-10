-- Contact Intent ("heat indicator"): optional hot/warm/cold read on how a
-- conversation with this person went. Defaults to null/none — nothing marks
-- every contact as cold by omission. A rep can set it directly on the review
-- card; local-agent's intentLoop also auto-classifies it from
-- interaction_notes (voice-memo text) whenever that text changes, but only
-- while contact_intent_is_manual is false — a rep's own choice always wins
-- and is never silently overwritten by a later auto pass. Explicitly
-- clearing the value back to null (via contacts-patch) resets
-- contact_intent_is_manual to false too, handing control back to auto
-- classification instead of leaving it stuck manual-and-empty forever.
--
-- contact_intent_classified_notes snapshots the exact interaction_notes text
-- last fed to the classifier (there's no updated_at on contacts to diff
-- against) — intentLoop only re-classifies when current interaction_notes
-- differs from this snapshot.
alter table public.contacts
  add column contact_intent text check (contact_intent in ('hot','warm','cold')),
  add column contact_intent_is_manual boolean not null default false,
  add column contact_intent_classified_notes text;
