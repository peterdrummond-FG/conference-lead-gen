# Zoho reference data

Moved here from `backend/Data/Seed/` when the .NET project was removed
(2026-09-14; the code is in git history at `ebd5bba`). These are the source files that populated `school_districts`,
`schools` and `campaigns`; both tables are already loaded in the live project
(5,969 districts / 13,780 schools as of 2026-10-12), so these are kept for
re-seeding a fresh environment and for diffing against Zoho, not for routine
use.

The loaders that consumed them (`SeedSchoolAccounts.cs`, `SyncCampaigns.cs`)
went with the .NET project. If campaign sync is needed again, reimplement it
as a short Node script against `@supabase/supabase-js` (see
`scripts/retention/purge-expired-media.mjs` for how a script here talks to Supabase) rather than
resurrecting an 8.6k-LOC project for one JSON loader.
