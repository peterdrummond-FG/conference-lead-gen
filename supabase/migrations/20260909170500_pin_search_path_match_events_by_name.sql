-- Pins search_path on match_events_by_name (flagged by Supabase's linter as
-- function_search_path_mutable), matching 20260908133000_pin_search_path_new_fns.sql's
-- treatment of other recently-added functions.
alter function public.match_events_by_name(text, int, real) set search_path = public;
