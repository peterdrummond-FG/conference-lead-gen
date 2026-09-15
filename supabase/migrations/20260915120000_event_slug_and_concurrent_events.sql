-- Up to six reps can be at six different conferences on the same day, so
-- "exactly one active event system-wide" (events_one_active_idx, from
-- 20260902203000_initial_schema.sql) no longer matches reality. The old
-- booth/session QR URLs (/booth, /session) carried no event identifier at
-- all and relied on there being exactly one is_active row to resolve
-- against -- with several reps live at once that resolves to whichever
-- event someone else most recently activated, silently mis-attributing
-- every other rep's leads. See supabase/migrations/README.md.
--
-- The fix: every event gets a short, typeable slug, and the booth/session
-- QR now encodes it (/connect/<slug>-booth, /connect/<slug>-session -- see
-- frontend/src/router/routes.ts), so contacts-create and notes-submit
-- resolve the *specific* event a QR points at instead of guessing at "the"
-- active one. is_active still means "accepting submissions," but is no
-- longer exclusive -- see the companion change to events_activate() below.

alter table public.events add column slug text;

-- Backfill: slugify the name and always suffix a short id fragment, so
-- uniqueness never depends on reasoning about name collisions across the
-- (small) set of historical rows. Slugs minted going forward by
-- events_activate() are cleaner (no id suffix) since it can check for and
-- avoid collisions at insert time.
update public.events
set slug = regexp_replace(lower(trim(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'))), '(^-+|-+$)', '', 'g')
           || '-' || substr(id::text, 1, 6)
where slug is null;

alter table public.events alter column slug set not null;
create unique index events_slug_idx on public.events (slug);

drop index if exists public.events_one_active_idx;

-- Concurrent conferences mean activating a new event must not deactivate
-- any other, and each gets its own slug (deduplicated the same way
-- folder_code already is). Signature (3 args, no p_city) and the
-- short-word folder-code algorithm are carried over unchanged from the
-- currently-deployed 20260909160000_shorter_folder_codes.sql -- events.city
-- was dropped back in 20260908120000, and a `create or replace` with a
-- different argument list creates a second overloaded function instead of
-- replacing this one (see README.md's "Watch out for"), so the signature
-- has to match exactly. Also pins search_path while this function is being
-- touched anyway, per that same README note.
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
  v_slug_base text;
  v_slug text;
  v_suffix int := 0;
  v_event public.events;
  v_budget constant int := 9;
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

  v_slug_base := regexp_replace(lower(trim(regexp_replace(p_name, '[^a-zA-Z0-9]+', '-', 'g'))), '(^-+|-+$)', '', 'g');
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
