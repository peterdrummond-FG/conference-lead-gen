-- The new first-time onboarding (splash, quick start, animated tour, reminder),
-- remembered per account so it follows someone across phones and browsers.
--
-- onboarded_at (20260929190000) is NOT reused and is left as it is: the old
-- welcome tour is gone, and that column's backfill marked every account that
-- existed on 2026-09-29 as done. Peter wants every existing account to see the new
-- onboarding once, so this is a new column family where null means "show the
-- splash"; nothing is backfilled. Only the new column is read for that.
--
--   onboarding_v2_seen_at  null = show the splash. Stamped when the person makes
--                          a choice on it (so closing the tab on the splash shows
--                          it again), and never touched by a replay from the ? button.
--   onboarding_path        which way they went: the quick start or the tour.
--   onboarding_ended_at    when they left it (Close, Text SETUP, or Skip).
--   tour_resume_from       the scene (or sub-scene) they stopped before, so the
--                          reminder can play just the rest. Null when there is
--                          nothing left to see. The values are the ids in
--                          frontend/src/components/tour/tourFlow.ts.
--   onboarding_reminder_shown_at  the one-hour reminder is shown once; this is the mark.
--
-- profiles-complete-onboarding is the only writer (own row only, enum-validated).
alter table public.profiles
  add column onboarding_v2_seen_at timestamptz,
  add column onboarding_path text check (onboarding_path in ('quick', 'tour')),
  add column onboarding_ended_at timestamptz,
  add column tour_resume_from text check (char_length(tour_resume_from) <= 40),
  add column onboarding_reminder_shown_at timestamptz;
