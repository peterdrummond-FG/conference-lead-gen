-- The prior migration's `revoke all ... from public` didn't cover anon/
-- authenticated, which get EXECUTE on new public-schema functions via this
-- project's default privileges. verify_cron_secret has no legitimate caller
-- but the session-notifications Edge Function's own service-role client, so
-- lock it down explicitly instead of relying on the PUBLIC revoke.
revoke execute on function public.verify_cron_secret(text) from anon, authenticated;
