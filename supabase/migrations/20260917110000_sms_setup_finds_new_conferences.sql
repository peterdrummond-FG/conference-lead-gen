-- Stage 20 — the SMS "setup a new conference" flow could never actually set
-- up a NEW conference: match_events_by_name only searched public.events,
-- and awaiting_selection only ever ran phone_event_bindings.upsert, never
-- events_activate. A conference Zoho has but nobody has activated on the
-- web Setup page yet (the exact case a rep hits when trying to set up
-- something new) could never be found no matter what they typed — the "no
-- match" reply read like a spelling problem when it was actually "this
-- doesn't exist in our system yet."
--
-- Two more bugs found chasing this down, verified against the live
-- campaigns/events tables before fixing:
-- 1. match_events_by_name had no is_active filter, so it could also surface
--    (and bind a phone to) a retired/inactive event -- confirmed directly:
--    querying "2026 09.28" scored the INACTIVE "AZALAS Member Mixer" (a
--    January conference, Arizona) above the real active Texas event, purely
--    because both names happen to start with "2026".
-- 2. Plain trigram similarity() is a poor fit for short/generic queries
--    (a bare date, an abbreviation, "TX region") -- it scores whole-string
--    overlap, so a shared "2026" prefix inflates unrelated names equally.
--    word_similarity() instead finds the best-matching word-span of the
--    longer name against the short query, which is what a rep is actually
--    doing when they type a fragment of a much longer official name.
--    Verified empirically: re-running the same failing queries through
--    word_similarity against events+campaigns put the actually-intended
--    conference in the #1 slot every time.
--
-- New design: search BOTH already-active events (pick one -> bind, today's
-- behavior) and not-yet-activated campaigns (pick one -> activate, then
-- bind -- new). A campaign already active as an event is excluded from the
-- campaign side so the same real conference doesn't appear twice.

-- Parses the "YYYY MM.DD" date prefix this org's campaign/event names are
-- consistently built from (e.g. "2026 09.28 (TX) Region 19 ESC LEAD
-- Summit") -- used both to filter out a campaign whose conference has
-- already happened (recurring annual campaigns like "OSBA Capital
-- Conference" have one row per year, all tying on relevance to a query like
-- "OSBA") and to break ties toward the soonest upcoming one. A name that
-- doesn't match the convention returns null rather than guessing -- it's
-- then neither filtered out nor deprioritized, since "can't tell" isn't
-- evidence of "stale". plpgsql (not sql) specifically so a malformed date
-- component (caught rarely, but Zoho-sourced text is never fully trusted)
-- can't raise and take the whole search down with it.
create or replace function public.conference_date_from_name(p_name text)
returns date
language plpgsql
immutable
as $$
declare
  v_prefix text;
begin
  v_prefix := substring(p_name from '^(\d{4}\s+\d{2}\.\d{2})');
  if v_prefix is null then
    return null;
  end if;
  return to_date(v_prefix, 'YYYY MM.DD');
exception when others then
  return null;
end;
$$;

create or replace function public.match_conferences_by_name(
  p_query text,
  p_limit int default 5,
  p_min_similarity real default 0.15
) returns table (
  kind text,
  event_id uuid,
  zoho_campaign_id text,
  name text,
  state text,
  sim real
)
language sql
stable
as $$
  select * from (
    select
      'event'::text as kind,
      e.id as event_id,
      e.zoho_campaign_id,
      e.name,
      e.state,
      word_similarity(p_query, e.name) as sim
    from public.events e
    where e.is_active and word_similarity(p_query, e.name) >= p_min_similarity

    union all

    select
      'campaign'::text,
      null::uuid,
      c.zoho_campaign_id,
      c.name,
      null::text,
      word_similarity(p_query, c.name)
    from public.campaigns c
    where word_similarity(p_query, c.name) >= p_min_similarity
      -- Already active under this campaign id: shown via the 'event' arm
      -- above instead, so it isn't offered twice with two different actions.
      and not exists (
        select 1 from public.events e2
        where e2.zoho_campaign_id = c.zoho_campaign_id and e2.is_active
      )
      -- A confidently-parsed past date means this campaign's own conference
      -- already happened -- not a candidate for "set up a new conference"
      -- today. Left in when the date can't be parsed at all, rather than
      -- guessed at.
      and (
        public.conference_date_from_name(c.name) is null
        or public.conference_date_from_name(c.name) >= current_date
      )
  ) matches
  order by sim desc, coalesce(public.conference_date_from_name(name), 'infinity'::date) asc, name asc
  limit p_limit;
$$;

drop function if exists public.match_events_by_name(text, int, real);
