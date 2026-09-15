-- events_activate() slugified the WHOLE campaign name with no length cap, so
-- a normal (non-test) conference name -- "MASA/MnASE Educational
-- Leadership: Piecing Together the Future" is a real one already in this
-- table -- produced a QR fallback URL nobody could actually type. A slug
-- only ever needs to be one short, recognizable word (e.g. "peter" for
-- "Peter Test Conference", "hrmi" for the HRMI West conference) -- the
-- first non-stopword word in the name, lowercased, letters only. Collisions
-- get a numeric suffix, same as folder_code already does.
create or replace function public.events_activate(
  p_zoho_campaign_id text,
  p_name text,
  p_state text
) returns public.events
language plpgsql
set search_path = public
as $$
declare
  v_words text[];
  v_word text;
  v_base text := '';
  v_folder_code text;
  v_slug_base text := '';
  v_slug text;
  v_suffix int := 0;
  v_event public.events;
  v_budget constant int := 9;
  v_slug_word_cap constant int := 16;
  v_stopwords constant text[] := array['the','of','and','a','an','in','on','for'];
begin
  v_words := regexp_split_to_array(lower(regexp_replace(p_name, '[^a-zA-Z]+', ' ', 'g')), '\s+');

  foreach v_word in array v_words loop
    if v_word = '' or v_word = any(v_stopwords) then
      continue;
    end if;
    if length(v_base) = 0 and length(v_word) > v_budget then
      v_base := left(v_word, v_budget);
      exit;
    elsif length(v_base) + length(v_word) <= v_budget then
      v_base := v_base || v_word;
    else
      exit;
    end if;
  end loop;

  if v_base = '' then
    v_base := 'event';
  end if;

  v_folder_code := v_base;
  while exists (select 1 from public.events where folder_code = v_folder_code) loop
    v_suffix := v_suffix + 1;
    v_folder_code := v_base || v_suffix;
  end loop;

  foreach v_word in array v_words loop
    if v_word = '' or v_word = any(v_stopwords) then
      continue;
    end if;
    v_slug_base := left(v_word, v_slug_word_cap);
    exit;
  end loop;

  if v_slug_base = '' then
    v_slug_base := 'event';
  end if;
  v_slug := v_slug_base;
  v_suffix := 0;
  while exists (select 1 from public.events where slug = v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := v_slug_base || '-' || v_suffix;
  end loop;

  insert into public.events (zoho_campaign_id, name, state, activated_at, is_active, folder_code, slug)
  values (p_zoho_campaign_id, p_name, p_state, now(), true, v_folder_code, v_slug)
  returning * into v_event;

  return v_event;
end;
$$;

-- Regenerate slugs for currently-active events only -- their QR codes are
-- the ones actually in use today (this is what turns "Peter Test
-- Conference"'s already-long ckhconnect.vercel.app/connect/peter-test-
-- conference-2933c1-session into .../connect/peter-session). Historical/
-- inactive events keep their original (longer) slug rather than having any
-- already-printed QR code for them silently start 404ing.
do $$
declare
  v_event record;
  v_words text[];
  v_word text;
  v_slug_base text;
  v_slug text;
  v_suffix int;
  v_slug_word_cap constant int := 16;
  v_stopwords constant text[] := array['the','of','and','a','an','in','on','for'];
begin
  for v_event in select id, name from public.events where is_active loop
    v_words := regexp_split_to_array(lower(regexp_replace(v_event.name, '[^a-zA-Z]+', ' ', 'g')), '\s+');
    v_slug_base := '';
    foreach v_word in array v_words loop
      if v_word = '' or v_word = any(v_stopwords) then
        continue;
      end if;
      v_slug_base := left(v_word, v_slug_word_cap);
      exit;
    end loop;
    if v_slug_base = '' then
      v_slug_base := 'event';
    end if;
    v_slug := v_slug_base;
    v_suffix := 0;
    while exists (select 1 from public.events where slug = v_slug and id != v_event.id) loop
      v_suffix := v_suffix + 1;
      v_slug := v_slug_base || '-' || v_suffix;
    end loop;
    update public.events set slug = v_slug where id = v_event.id;
  end loop;
end $$;
