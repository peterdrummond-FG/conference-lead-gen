-- Kiosk unlock moves from one shared code (app_settings.kiosk_code) to a
-- per-user PIN each account sets for themself -- unlocking a kiosk checks
-- the PIN of whoever is actually still logged in underneath the lock (a
-- kiosk lock never signs anyone out), not a code everyone shares.
--
-- app_settings itself is now unused (kiosk_code was its only real column)
-- but is left in place rather than dropped, matching how this project
-- retires things elsewhere (e.g. old edge functions become 410 stubs
-- instead of being deleted) -- nothing reads it anymore.
alter table public.profiles add column kiosk_pin text not null default '1234';
