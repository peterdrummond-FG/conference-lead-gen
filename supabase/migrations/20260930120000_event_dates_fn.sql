-- Dates for live events, for Setup's "Ended 2 days ago" chip and the
-- "Sep 30 to Oct 2" line under a joined conference.
--
-- An event carries no dates of its own: the only source is the campaign name
-- ("2026 09.30-10.02 (IL) ..."), which conference_date_from_name() and
-- conference_end_date_from_name() already parse for the conference picker.
-- This wraps those two so events-list-active reads them from the same parser the
-- picker uses, rather than a second copy in TypeScript that could drift (the
-- end-date parser once silently parsed zero of 441 real names -- see
-- 20260929124500).
--
-- Service role only, like the Edge Functions that call it: nothing here is meant
-- to be reachable straight from PostgREST.
create or replace function public.event_dates(p_event_ids uuid[])
returns table (id uuid, starts_on date, ends_on date)
language sql
stable
set search_path = public
as $$
  select e.id,
         public.conference_date_from_name(e.name),
         public.conference_end_date_from_name(e.name)
  from public.events e
  where e.id = any(p_event_ids);
$$;

revoke all on function public.event_dates(uuid[]) from public, anon, authenticated;
grant execute on function public.event_dates(uuid[]) to service_role;
