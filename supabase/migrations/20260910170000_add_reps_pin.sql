-- A rep's own PIN, chosen by themself when they add themselves to the
-- roster (Setup page) -- lets them switch the "Signed in as" picker to
-- their own name and see only their own leads in Review. Stored the same
-- way as today's shared app_settings.staff_pin (plain text, timing-safe
-- compare) -- this is not a real per-user auth boundary yet, just carries
-- the value forward for when that's built. Nullable: a rep can be added to
-- the roster (e.g. for channel assignment/attribution) before they've set
-- one.
alter table public.reps add column pin text;
