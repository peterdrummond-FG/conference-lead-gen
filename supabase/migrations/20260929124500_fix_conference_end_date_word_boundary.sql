-- Fix for 20260929123000: conference_end_date_from_name() never parsed a range.
--
-- Its regex ended in `\b`, but in PostgreSQL's regex dialect `\b` is a
-- BACKSPACE character, not a word boundary (the boundary is `\y`). So the match
-- always failed, every multi-day conference fell through to "one day", and
-- "2026 09.30-10.02" was treated as ending 09.30. Caught by running the parser
-- over all 578 dated campaign names and counting parsed ranges -- 0, with 441
-- names that plainly contain one -- not by reading the function.
--
-- The migration that introduced it is applied, so this replaces the function
-- instead of editing that file (migrations are append-only).
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
  -- \y is the word boundary in Postgres ARE syntax (\b is backspace).
  v_parts := regexp_match(p_name, '^\d{4}\s+\d{2}\.\d{2}\s*-\s*(?:(\d{2})\.)?(\d{2})\y');
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
