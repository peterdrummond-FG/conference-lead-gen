-- Research fills in a missing district (Peter, 2026-10-06: "school still needs a
-- district, but if that's all the rep has, the research skill should fill in the
-- district by looking up the school and the state").
--
-- research-contact now returns resolvedDistrict { name, evidenceUrl, confidence } for
-- a contact who gave a school and NO district (SKILL.md step 5b; null otherwise, and
-- null rather than a guess). The skill never writes anything (CLAUDE.md rule 2): the
-- pipeline passes it to finalize_contact_match, which is where a match result is
-- already written atomically and only while the row is still 'pending'. The new write
-- lives there so it inherits both guarantees:
--   * a reviewer's edit while research ran wins (the row left 'pending' -> nothing is
--     written, including this);
--   * it is GUARDED: it applies only if the lead still has no district of any kind at
--     write time (no school_district_id and no typed district), and it has a school
--     (a typed one: school_id can't exist without a district). A district a person
--     gave is never overwritten, and the row is locked (FOR UPDATE) before the check.
--
-- What is stored:
--   * the resolved name matches (same state, normalised) exactly ONE row of OUR
--     school_districts -> school_district_id; and if the typed school then matches
--     exactly one of that district's schools -> school_id too (school_name_raw
--     cleared, as when a person picks one). Anything ambiguous or absent is not
--     guessed: no match -> the district stays raw text.
--   * no match in our table -> school_district_name_raw = the resolved name.
--   * contacts.district_lookup records that it was looked up and from where
--     ({name, evidenceUrl, confidence, mappedToOurList, at}); the editor shows that
--     it was filled in by a lookup, with the source, so a rep can see it isn't
--     something the attendee said. A line is also added to notes (the Zoho
--     Description carries notes), so Sales sees it too.
--   * only confidence high or medium, a name without control characters and an
--     http(s) evidence address are accepted here too: the schema checks the same,
--     but this is the last gate before a lead a person will rely on.
--
-- Nothing here approves anything. A looked-up district behaves like any other lead:
-- it lands in needs_review and a person confirms it (migration 20261007110000).
--
-- Signature: three NEW trailing parameters, all defaulting to null, so a caller that
-- doesn't know about them (the local-agent today, the n8n pipeline until it is
-- redeployed) keeps working unchanged. Adding parameters with `create or replace` would
-- leave BOTH signatures live and a 19-argument call ambiguous (PGRST203), so the old
-- one is dropped in the same transaction.
--
-- Grants: the old function was executable by anon and authenticated (the Supabase
-- default). It runs as the caller, so RLS on contacts stopped them, but nothing
-- public has any business calling it. Only service_role (n8n, local-agent) does.

alter table public.contacts add column district_lookup jsonb;

-- Names match without regard to case, accents or punctuation ("St. Mary's ISD" ==
-- "ST MARYS ISD"). The same rule as the pickers' norm() in
-- frontend/src/utils/institutionPicker.ts. Equality only; never LIKE.
create or replace function public.ckh_norm_name(p text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select btrim(regexp_replace(
    regexp_replace(
      translate(lower(coalesce(p, '')), 'áàâäãåéèêëíìîïóòôöõúùûüñç', 'aaaaaaeeeeiiiiooooouuuuenc'),
      '[''’`]', '', 'g'),
    '[^a-z0-9]+', ' ', 'g'))
$$;

-- The district and school of OUR tables that a looked-up district name and a typed
-- school name correspond to. A district only if EXACTLY ONE row in the state matches;
-- a school only if exactly one of that district's schools matches. Otherwise null:
-- never the nearest guess.
create or replace function public.lookup_district_for_school(p_state text, p_district_name text, p_school_name text)
returns table (district_id uuid, school_id uuid)
language plpgsql
stable
set search_path to 'public'
as $$
declare
  v_district uuid;
  v_school uuid;
begin
  if nullif(btrim(coalesce(p_state, '')), '') is null or public.ckh_norm_name(p_district_name) = '' then
    return query select null::uuid, null::uuid;
    return;
  end if;

  if (select count(*) from public.school_districts d
        where d.state = p_state and public.ckh_norm_name(d.name) = public.ckh_norm_name(p_district_name)) = 1 then
    select d.id into v_district from public.school_districts d
      where d.state = p_state and public.ckh_norm_name(d.name) = public.ckh_norm_name(p_district_name);
  end if;

  if v_district is not null and public.ckh_norm_name(p_school_name) <> '' then
    if (select count(*) from public.schools s
          where s.district_id = v_district and public.ckh_norm_name(s.name) = public.ckh_norm_name(p_school_name)) = 1 then
      select s.id into v_school from public.schools s
        where s.district_id = v_district and public.ckh_norm_name(s.name) = public.ckh_norm_name(p_school_name);
    end if;
  end if;

  return query select v_district, v_school;
end;
$$;

drop function public.finalize_contact_match(
  uuid, text, text, text, text, text, text, text, text, text, text, boolean, text, jsonb, text, text, text, boolean, boolean
);

create function public.finalize_contact_match(
  p_contact_id uuid,
  p_match_status text,
  p_match_confidence text,
  p_matched_zoho_contact_id text,
  p_matched_zoho_contact_name text,
  p_matched_zoho_contact_email text,
  p_matched_zoho_contact_phone text,
  p_matched_zoho_contact_title text,
  p_matched_zoho_account_id text,
  p_matched_zoho_account_name text,
  p_matched_zoho_account_level text,
  p_has_active_opportunity boolean,
  p_active_opportunity_name text,
  p_candidate_matches jsonb,
  p_notes text,
  p_glance_summary text,
  p_research_confidence text,
  p_person_verified boolean,
  p_extraction_ok boolean,
  p_resolved_district_name text default null,
  p_resolved_district_evidence_url text default null,
  p_resolved_district_confidence text default null
)
returns public.contacts
language plpgsql
set search_path to 'public'
as $function$
declare
  v_c public.contacts;
  v_apply boolean;
  v_state text;
  v_district uuid;
  v_school uuid;
  v_name text := nullif(btrim(coalesce(p_resolved_district_name, '')), '');
  v_url text := nullif(btrim(coalesce(p_resolved_district_evidence_url, '')), '');
  v_notes text := p_notes;
  v_result public.contacts;
begin
  -- Lock the row and re-read it: everything below is judged on what it holds NOW.
  -- Not pending any more (a reviewer set the match, or another run finished) -> write
  -- nothing, return the all-null row callers read as "superseded".
  select * into v_c from public.contacts where id = p_contact_id and match_status = 'pending' for update;
  if not found then
    return null;
  end if;

  v_apply :=
    v_name is not null
    and length(v_name) between 2 and 200
    and v_name !~ '[[:cntrl:]]'
    and v_url is not null
    and length(v_url) <= 500
    and v_url ~* '^https?://[^[:space:]]+$'
    and p_resolved_district_confidence in ('high', 'medium')
    -- Still no district of any kind, and a typed school to look the district up from.
    and v_c.school_district_id is null
    and nullif(btrim(coalesce(v_c.school_district_name_raw, '')), '') is null
    and nullif(btrim(coalesce(v_c.school_name_raw, '')), '') is not null;

  if v_apply then
    select coalesce(nullif(btrim(v_c.state), ''), e.state) into v_state from public.events e where e.id = v_c.event_id;
    select l.district_id, l.school_id into v_district, v_school
      from public.lookup_district_for_school(v_state, v_name, v_c.school_name_raw) l;
    v_notes := concat_ws(
      E'\n\n', p_notes,
      format('District looked up from the school (none was given): %s. Source: %s (%s confidence).',
             v_name, v_url, p_resolved_district_confidence)
    );
  end if;

  update public.contacts
  set research_confidence = p_research_confidence,
      person_verified = p_person_verified,
      match_status = p_match_status,
      match_confidence = p_match_confidence,
      matched_zoho_contact_id = p_matched_zoho_contact_id,
      matched_zoho_contact_name = p_matched_zoho_contact_name,
      matched_zoho_contact_email = p_matched_zoho_contact_email,
      matched_zoho_contact_phone = p_matched_zoho_contact_phone,
      matched_zoho_contact_title = p_matched_zoho_contact_title,
      matched_zoho_account_id = p_matched_zoho_account_id,
      matched_zoho_account_name = p_matched_zoho_account_name,
      matched_zoho_account_level = p_matched_zoho_account_level,
      has_active_opportunity = p_has_active_opportunity,
      active_opportunity_name = p_active_opportunity_name,
      candidate_matches = p_candidate_matches,
      notes = v_notes,
      glance_summary = p_glance_summary,
      school_district_id = case when v_apply then v_district else school_district_id end,
      school_district_name_raw = case when v_apply then (case when v_district is null then v_name else null end) else school_district_name_raw end,
      school_id = case when v_apply and v_school is not null then v_school else school_id end,
      school_name_raw = case when v_apply and v_school is not null then null else school_name_raw end,
      district_lookup = case when v_apply then jsonb_build_object(
        'name', v_name,
        'evidenceUrl', v_url,
        'confidence', p_resolved_district_confidence,
        'mappedToOurList', v_district is not null,
        'at', now()
      ) else district_lookup end
  where id = p_contact_id
  returning * into v_result;

  return v_result;
end;
$function$;

revoke all on function public.ckh_norm_name(text) from public;
revoke all on function public.lookup_district_for_school(text, text, text) from public, anon, authenticated;
revoke all on function public.finalize_contact_match(
  uuid, text, text, text, text, text, text, text, text, text, text, boolean, text, jsonb, text, text, text, boolean, boolean, text, text, text
) from public, anon, authenticated;
grant execute on function public.ckh_norm_name(text) to anon, authenticated, service_role;
grant execute on function public.lookup_district_for_school(text, text, text) to service_role;
grant execute on function public.finalize_contact_match(
  uuid, text, text, text, text, text, text, text, text, text, text, boolean, text, jsonb, text, text, text, boolean, boolean, text, text, text
) to service_role;
