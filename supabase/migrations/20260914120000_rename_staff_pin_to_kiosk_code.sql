-- The shared staff PIN's real per-user auth job is done entirely by
-- Supabase Auth now (see the Sept-11 migrations) -- the one thing left
-- that still needs a single shared, memorable secret is unlocking a
-- physical kiosk device out of Intake-only mode (see kiosk-mode-store.ts /
-- kiosk-verify-code). Reusing this column (default '1234', unchanged)
-- keeps that code exactly what everyone already expects, just renamed to
-- match what it actually gates now.
alter table public.app_settings rename column staff_pin to kiosk_code;
