-- Marks the moment a contact was included in an export-csv download.
-- export-csv used to be a stateless, infinitely-repeatable read (filtered
-- on review_status='approved' and a matched Zoho account) with no memory
-- of what had already gone out; this makes a given export a one-time
-- "mark as sent" action (see export_and_mark_synced below) instead, and
-- lets a sales rep's Review page distinguish already-synced past leads
-- from ones still awaiting export.
alter table public.contacts add column synced_at timestamptz;
create index contacts_synced_at_null_idx on public.contacts (synced_at) where synced_at is null;
