-- Kiosk PIN: nobody has one until they choose it.
--
-- profiles.kiosk_pin was NOT NULL DEFAULT '1234' (20260914130000_kiosk_pin_per_user.sql).
-- Every account therefore always "had" a PIN, `me` reported hasKioskPin = true for
-- everyone, and the app's first-time "Set PIN" prompt could never appear, so accounts
-- stayed on the default. This makes the column nullable with no default and clears every
-- PIN still equal to the old default; each person is asked to choose one the next time
-- they press Lock. A PIN anyone actually chose is left alone.
--
-- The kiosk lock is a display mode on one device, not a security boundary (see CLAUDE.md,
-- "Lock kiosk"); this only makes the prompt and the PIN status true.
--
-- Effect on a device that is locked when this runs: its unlock needs a PIN, and the
-- cleared account has none, so it cannot be unlocked from that screen. Apply this when no
-- Kiosk tablet is locked, or clear that browser's site data to get past it.
alter table public.profiles alter column kiosk_pin drop not null;
alter table public.profiles alter column kiosk_pin drop default;
update public.profiles set kiosk_pin = null where kiosk_pin = '1234';
comment on column public.profiles.kiosk_pin is
  'The account''s own kiosk lock PIN, in plain text (a display-mode lock, not a security boundary). NULL until the person chooses one; the app then prompts. kiosk-set-code refuses 1234.';
