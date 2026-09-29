-- First-time welcome tour: remember, per account, that someone has finished (or
-- skipped) it, so it follows them across phones and browsers instead of
-- repeating on every new device.
--
-- Null means "hasn't seen it yet". The backfill below marks every account that
-- exists today as already done: the pilot reps are mid-conference and were
-- never promised a tour, so the first thing they should see after this ships is
-- the app they know. Only accounts created from here on start as null.
alter table public.profiles add column onboarded_at timestamptz;

update public.profiles set onboarded_at = now() where onboarded_at is null;
