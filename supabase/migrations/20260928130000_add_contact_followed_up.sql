-- Follow-up tracking: a rep-set boolean recording whether they've already
-- followed up with this lead post-conference. Defaults to false — nothing
-- marks existing contacts as followed up by omission. Set directly from the
-- Review card (collapsed summary or expanded view, any tab) via
-- contacts-patch, and carried through to the Zoho export CSV as its own
-- "Follow Up Done" column (export-csv) so a rep doesn't have to
-- cross-reference two systems to know who they've already called. No
-- corresponding Zoho field is mapped yet — this just gives Zoho import the
-- column to map once one is chosen.
alter table public.contacts
  add column followed_up boolean not null default false;
