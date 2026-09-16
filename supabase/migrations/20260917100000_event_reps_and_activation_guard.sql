-- Stage 19 — two independent fixes bundled together because both touch
-- events_activate()/the events table, found during a rework of how reps get
-- credited for leads.
--
-- Part 1: events.booth_rep_id/session_rep_id (single-slot FKs to profiles.id
-- — the earlier standalone `reps` table was already retired in
-- 20260911100500_repoint_rep_fks_to_profiles.sql) assumed exactly one rep
-- per channel per event. Reps now get their own per-event QR code instead of
-- a shared booth/session one, so arbitrarily many reps can work one event —
-- replaced with a many-to-many join table. Booth vs. session becomes a
-- visitor-self-reported field on the intake form itself (contacts.qr_channel
-- keeps its existing values/meaning as a data field, just no longer tied to
-- which physical QR was scanned or to any rep).
create table public.event_reps (
  event_id uuid not null references public.events(id) on delete cascade,
  rep_id uuid not null references public.profiles(id) on delete cascade,
  linked_at timestamptz not null default now(),
  primary key (event_id, rep_id)
);
alter table public.event_reps enable row level security;

alter table public.events drop column booth_rep_id;
alter table public.events drop column session_rep_id;

-- Part 2: events_activate() had two bugs. (a) Nothing stopped two concurrent
-- activations of the SAME zoho_campaign_id both succeeding, producing two
-- simultaneous active events for one real conference with leads silently
-- split across them. (b) folder_code/slug generation was check-then-insert
-- (`while exists(...) loop`) -- a TOCTOU race where two concurrent
-- activations generating the same candidate code could both pass the
-- `exists` check and then collide inside the insert, surfacing a raw
-- Postgres constraint-violation string to a non-technical admin
-- (events-activate/index.ts used to forward error.message verbatim).
--
-- Fixed the same way insert_contact_with_duplicate_check already handles an
-- analogous race (20260908131000_insert_contact_with_duplicate_check_fn.sql):
-- an advisory lock keyed on the thing being deduplicated, held for the
-- transaction. The code-generation loop is rewritten as insert-and-retry-on-
-- collision (closes the race instead of narrowing it), disambiguated by
-- constraint name so the new campaign-uniqueness violation below is never
-- misread as "just try the next suffix". A custom SQLSTATE ('CKH01') marks
-- an exception as user-facing -- supabase-js surfaces it as error.code,
-- distinct from error.message, so the edge function doesn't need to parse a
-- string prefix to decide what's safe to show a non-technical user.
create unique index events_active_campaign_uniq on public.events (zoho_campaign_id) where is_active;

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
  v_slug_base text := '';
  v_event public.events;
  v_existing public.events;
  v_budget constant int := 9;
  v_slug_word_cap constant int := 16;
  v_stopwords constant text[] := array['the','of','and','a','an','in','on','for'];
  v_folder_code text;
  v_slug text;
  v_suffix int;
  v_attempt int;
  v_constraint text;
begin
  -- Serializes concurrent activation attempts for the SAME campaign so the
  -- existing-active check below can't race itself. Different campaigns never
  -- contend (multiple conferences run concurrently by design).
  perform pg_advisory_xact_lock(hashtextextended(p_zoho_campaign_id, 0));

  select * into v_existing from public.events
    where zoho_campaign_id = p_zoho_campaign_id and is_active
    limit 1;
  if found then
    raise exception 'This conference is already active as "%" (activated %).',
      v_existing.name, to_char(v_existing.activated_at, 'Mon DD HH12:MI AM')
      using errcode = 'CKH01';
  end if;

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

  -- Insert-and-retry-on-collision rather than check-then-insert (see header
  -- comment). GET STACKED DIAGNOSTICS tells a folder_code/slug collision
  -- (retry with the next suffix) apart from the new campaign-uniqueness
  -- violation above (re-raised as-is -- looping here would just burn 50
  -- attempts retrying an insert that will never succeed for this campaign).
  v_suffix := 0;
  v_attempt := 0;
  loop
    v_attempt := v_attempt + 1;
    v_folder_code := case when v_suffix = 0 then v_base else v_base || v_suffix end;
    v_slug := case when v_suffix = 0 then v_slug_base else v_slug_base || '-' || v_suffix end;
    begin
      insert into public.events (zoho_campaign_id, name, state, activated_at, is_active, folder_code, slug)
      values (p_zoho_campaign_id, p_name, p_state, now(), true, v_folder_code, v_slug)
      returning * into v_event;
      return v_event;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint not in ('events_folder_code_idx', 'events_slug_idx') then
        raise;
      end if;
      v_suffix := v_suffix + 1;
      if v_attempt >= 50 then
        raise exception 'Could not generate a unique event code after % attempts — try again.', v_attempt
          using errcode = 'CKH01';
      end if;
    end;
  end loop;
end;
$$;
