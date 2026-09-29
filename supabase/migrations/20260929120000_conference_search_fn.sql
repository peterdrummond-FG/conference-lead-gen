-- conference_search(): what the web app's "Start a conference" searches.
--
-- campaigns-list used to be `select * from campaigns order by name desc limit
-- 50` with an ILIKE on top. Every conference name starts "YYYY MM.DD", so
-- sorting by name descending put the furthest-future conferences first and
-- typing "2026" (180 of 683 campaigns) buried this week's conference under
-- December's -- on a phone, where a rep is standing at the booth of a
-- conference that started days ago. It also offered a conference that is
-- already live under the same campaign id, which events_activate then rejected
-- with "already active" after the rep had filled the form in.
--
-- This ranks the way the SMS flow already does (match_conferences_by_name,
-- 20260917110000) and reuses its date parser, but is a separate function
-- because the two answer different questions: SMS picks among a handful of
-- fuzzy matches to a *typed name*; this must also list "what's coming up"
-- with no query at all.
--
--   * Blank query  -> conferences that started within p_days_back days or
--     start later, nearest first. A multi-day conference that began yesterday
--     is still going on, which is why the window reaches back (conference_date_
--     from_name only parses the *start* date). Names with no parseable date are
--     left out of this default list -- can't say when they are -- but remain
--     searchable.
--   * A query      -> substring match on the name, or word_similarity >= 0.3
--     (the same trigram measure the SMS flow uses, with a higher floor since a
--     typed web query is a partial name, not a whole SMS sentence). Current and
--     upcoming conferences rank before past or undated ones, then substring hits
--     before fuzzy ones, then by similarity, then nearest date.
--
-- live_event_id / live_state carry the already-active event for a campaign, so
-- the client offers Join instead of Start rather than letting a rep hit the
-- events_activate duplicate guard. Read-only; nothing here writes.
create or replace function public.conference_search(
  p_query text default '',
  p_days_back int default 7,
  p_limit int default 30
) returns table (
  id uuid,
  zoho_campaign_id text,
  name text,
  starts_on date,
  live_event_id uuid,
  live_state text
)
language sql
stable
set search_path = public
as $$
  with q as (select btrim(coalesce(p_query, '')) as t),
  base as (
    select
      c.id,
      c.zoho_campaign_id,
      c.name,
      public.conference_date_from_name(c.name) as starts_on,
      e.id as live_event_id,
      e.state as live_state,
      case when (select t from q) = '' then null
           else word_similarity((select t from q), c.name) end as sim,
      -- Backslash-escaped so a typed % or _ is literal (same reason
      -- escapeLike exists in the Edge Functions: audit S11).
      ((select t from q) <> '' and c.name ilike
        '%' || replace(replace(replace((select t from q), '\', '\\'), '%', '\%'), '_', '\_') || '%') as substr_hit
    from public.campaigns c
    left join public.events e
      on e.zoho_campaign_id = c.zoho_campaign_id and e.is_active
  )
  select id, zoho_campaign_id, name, starts_on, live_event_id, live_state
  from base
  where case
    when (select t from q) = ''
      then starts_on is not null and starts_on >= current_date - greatest(p_days_back, 0)
    else substr_hit or sim >= 0.3
  end
  order by
    (starts_on is not null and starts_on >= current_date - greatest(p_days_back, 0)) desc,
    substr_hit desc,
    coalesce(sim, 0) desc,
    starts_on asc nulls last,
    name asc
  limit least(greatest(p_limit, 1), 50);
$$;
