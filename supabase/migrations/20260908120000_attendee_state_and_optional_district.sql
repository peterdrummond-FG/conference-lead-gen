-- Conferences aren't state-specific for lead geography (attendees fly in from
-- anywhere), so the state/district/campus picker moves entirely onto the
-- intake form and is attendee-driven. events.city goes away; events.state is
-- kept as "conference location" — required at activation, but used only as a
-- fallback signal when resolving card-photo (OCR) contacts, never to gate the
-- intake form's own state/district search.
alter table public.events drop column city;

-- District/campus are no longer forced, and a typed value that doesn't match
-- an existing row is kept as plain text instead of silently becoming a new
-- permanent row (that free-text "add new" path, with zero validation, is how
-- the junk cleaned up below got in).
alter table public.contacts
  alter column school_district_id drop not null,
  add column state text,
  add column school_district_name_raw text,
  add column school_name_raw text;

-- events_activate() no longer takes/produces a city; the folder code is
-- derived from the event name instead (simpler to memorize than a
-- city-plus-date code, and doesn't depend on a field that no longer exists).
drop function if exists public.events_activate(text, text, text, text);

create function public.events_activate(
  p_zoho_campaign_id text,
  p_name text,
  p_state text
) returns public.events
language plpgsql
as $$
declare
  v_base text;
  v_folder_code text;
  v_suffix int := 0;
  v_event public.events;
begin
  update public.events set is_active = false where is_active;

  v_base := lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_folder_code := v_base;
  while exists (select 1 from public.events where folder_code = v_folder_code) loop
    v_suffix := v_suffix + 1;
    v_folder_code := v_base || '-' || v_suffix;
  end loop;

  insert into public.events (zoho_campaign_id, name, state, activated_at, is_active, folder_code)
  values (p_zoho_campaign_id, p_name, p_state, now(), true, v_folder_code)
  returning * into v_event;

  return v_event;
end;
$$;

-- One-time cleanup of junk school_districts/schools rows created via the old
-- free-text "add new" flow (district was a required field with no escape
-- hatch, so non-district attendees typed their employer instead) and via the
-- OCR pipeline's "(none provided on card)" placeholder hack, both confirmed
-- against production data 2026-09-08 and both replaced by this migration.
-- "South Central Service Cooperative" (several spelling variants) is
-- deliberately left alone — a real regional org, not junk, and deduping it is
-- a separate judgment call.
update public.contacts
  set school_district_id = null,
      school_district_name_raw = case school_district_id
        when '33f75a84-939f-47ef-9188-c47ce0f34f9a' then 'Capturing Kids'' Hearts'
        when '4c8cf369-be99-4bcc-af46-e933391f70a1' then 'Department of Public Safety - Community Affairs'
        when '69e0e776-b61e-4c0c-8d84-b0ee4706db60' then 'Texas A&M Univ.'
        else school_district_name_raw
      end
where school_district_id in (
  '1709119d-130a-4f10-ade0-814810be1822', -- (none provided on card), California
  'b830be25-73ef-4457-9ff1-3d23353ee701', -- (none provided on card), Minnesota
  '33f75a84-939f-47ef-9188-c47ce0f34f9a', -- Capturing Kids' Hearts
  '4c8cf369-be99-4bcc-af46-e933391f70a1', -- Department of Public Safety - Community Affairs
  '69e0e776-b61e-4c0c-8d84-b0ee4706db60'  -- Texas A&M Univ.
);

update public.contacts
  set school_id = null,
      school_name_raw = 'New Dominion School'
where school_id = 'a0044ae2-8da9-4196-b17c-f42cc995a219';

delete from public.schools where id = 'a0044ae2-8da9-4196-b17c-f42cc995a219';

delete from public.school_districts where id in (
  '1709119d-130a-4f10-ade0-814810be1822', -- (none provided on card), California
  'b830be25-73ef-4457-9ff1-3d23353ee701', -- (none provided on card), Minnesota
  '33f75a84-939f-47ef-9188-c47ce0f34f9a', -- Capturing Kids' Hearts
  '4c8cf369-be99-4bcc-af46-e933391f70a1', -- Department of Public Safety - Community Affairs
  '69e0e776-b61e-4c0c-8d84-b0ee4706db60', -- Texas A&M Univ.
  'a379dab6-011c-4e4e-8c5e-5499a3646f94'  -- 'lk', unreferenced garbage
);
