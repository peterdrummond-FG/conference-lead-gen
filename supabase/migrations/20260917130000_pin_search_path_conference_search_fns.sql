-- Same class of issue 20260909200202_pin_search_path_match_events_by_name.sql
-- already fixed once for this function's predecessor: a function with no
-- search_path pinned resolves unqualified names against whatever search_path
-- the calling session happens to have, not necessarily public -- the
-- Supabase linter flags this as function_search_path_mutable. Backporting
-- the fix to both new functions from
-- 20260917110000_sms_setup_finds_new_conferences.sql rather than leaving it
-- as a fresh instance of the same class of bug.
alter function public.conference_date_from_name(text) set search_path = public;
alter function public.match_conferences_by_name(text, int, real) set search_path = public;
