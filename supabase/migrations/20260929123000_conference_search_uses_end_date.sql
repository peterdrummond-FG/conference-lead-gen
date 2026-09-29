-- conference_search() now windows on when a conference ENDS, not when it starts.
--
-- 20260929120000 windowed on the start date ("started within 7 days, or later")
-- because conference_date_from_name only parses the start. Run against real
-- data that put "2026 09.22 (MO) MASA Women in Leadership Cohort" -- a one-day
-- event that ended a week earlier -- at the top of the default list, while a
-- start-date window still couldn't say whether a "09.23-25" conference is over.
-- Names carry the end date too ("09.23-25", "09.30-10.02", and the stray-space
-- "01.29- 02.01"), so parse it and ask the question that actually matters: is
-- this conference finished?
--
-- conference_end_date_from_name(): the last day named, falling back to the start
-- date when there's no range or the range doesn't parse (a single-day event, or
-- an odd format -- treated as one day rather than guessed at). A range that
-- would end before it starts is a year wrap ("12.30-01.02") and ends next year.
--
-- conference_search() is dropped and recreated rather than replaced because it
-- gains an ends_on column, and CREATE OR REPLACE can't change a function's
-- result type. It was created moments earlier and has no callers yet.
create or replace function public.conference_end_date_from_name(p_name text)
returns date
language plpgsql
immutable
set search_path = public
as $$
declare
  v_parts text[];
  v_start date;
  v_end date;
  v_year int;
  v_month2 int;
begin
  v_start := public.conference_date_from_name(p_name);
  if v_start is null then
    return null;
  end if;

  -- "YYYY MM.DD-DD" or "YYYY MM.DD-MM.DD", optional spaces around the dash.
  v_parts := regexp_match(p_name, '^\d{4}\s+\d{2}\.\d{2}\s*-\s*(?:(\d{2})\.)?(\d{2})\b');
  if v_parts is null then
    return v_start;
  end if;

  v_year := extract(year from v_start)::int;
  v_month2 := coalesce(v_parts[1]::int, extract(month from v_start)::int);
  v_end := make_date(v_year, v_month2, v_parts[2]::int);
  if v_end < v_start then
    v_end := (v_end + interval '1 year')::date;
  end if;
  return v_end;
exception when others then
  return v_start;
end;
$$;

drop function public.conference_search(text, int, int);

-- Default list = conferences that haven't finished yet, allowing p_days_back
-- days of grace after the last day (a rep is often still adding leads the
-- morning after). A query searches everything; unfinished conferences rank
-- before finished or undated ones.
create function public.conference_search(
  p_query text default '',
  p_days_back int default 1,
  p_limit int default 30
) returns table (
  id uuid,
  zoho_campaign_id text,
  name text,
  starts_on date,
  ends_on date,
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
      public.conference_end_date_from_name(c.name) as ends_on,
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
  select id, zoho_campaign_id, name, starts_on, ends_on, live_event_id, live_state
  from base
  where case
    when (select t from q) = ''
      then ends_on is not null and ends_on >= current_date - greatest(p_days_back, 0)
    else substr_hit or sim >= 0.3
  end
  order by
    (ends_on is not null and ends_on >= current_date - greatest(p_days_back, 0)) desc,
    substr_hit desc,
    coalesce(sim, 0) desc,
    starts_on asc nulls last,
    name asc
  limit least(greatest(p_limit, 1), 50);
$$;
