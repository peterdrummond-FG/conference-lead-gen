-- events_activate()'s folder code was a full slugify of the campaign name
-- (e.g. "2026-hrmi-west-carlsbad-ca-june" — 32 chars), which reps have to
-- read off a slide and type into a text message. Rebuild it as a short,
-- whole-word-where-possible code capped at 9 characters (never derived from
-- digits, so no false sense of precision from a truncated year): greedily
-- pack whichever leading words of the name fit the budget, falling back to
-- truncating the first word only if it alone exceeds the budget. The full
-- event name is already shown right above the code in SetupPage.vue, so the
-- code itself only has to be short and easy to text, not self-descriptive.
drop function if exists public.events_activate(text, text, text);

create function public.events_activate(
  p_zoho_campaign_id text,
  p_name text,
  p_state text
) returns public.events
language plpgsql
as $$
declare
  v_words text[];
  v_word text;
  v_base text := '';
  v_folder_code text;
  v_suffix int := 0;
  v_event public.events;
  v_budget constant int := 9;
  v_stopwords constant text[] := array['the','of','and','a','an','in','on','for'];
begin
  update public.events set is_active = false where is_active;

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

  insert into public.events (zoho_campaign_id, name, state, activated_at, is_active, folder_code)
  values (p_zoho_campaign_id, p_name, p_state, now(), true, v_folder_code)
  returning * into v_event;

  return v_event;
end;
$$;

-- Today's already-active event was created under the old algorithm; bring it
-- in line so the running SetupPage/SMS instructions match the new function.
update public.events
  set folder_code = 'hrmiwest'
  where id = 'f15c74ab-3615-41f6-8b83-7384832a3168' and folder_code = '2026-hrmi-west-carlsbad-ca-june';
