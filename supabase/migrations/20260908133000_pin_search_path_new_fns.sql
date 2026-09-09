-- Pins search_path on the three functions added in this change (flagged by
-- Supabase's linter as function_search_path_mutable) so an unqualified
-- table reference inside them can't be redirected by a search_path set at
-- the calling session/role level.
alter function public.finalize_contact_match(
  uuid, text, text, text, text, text, text, text, text, text, boolean, text, jsonb, text, text, boolean, boolean
) set search_path = public;

alter function public.insert_contact_with_duplicate_check(jsonb) set search_path = public;

alter function public.reconcile_stale_inbound_messages(int) set search_path = public;
