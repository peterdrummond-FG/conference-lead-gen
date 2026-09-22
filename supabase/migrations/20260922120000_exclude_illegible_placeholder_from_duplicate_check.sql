-- process-cards uses the literal name "Illegible"/"Illegible" (never a
-- fabricated name) when a business card or directory-listing entry's name is
-- genuinely unreadable (see .claude/skills/process-cards/SKILL.md's
-- extraction rules) -- this is deliberate, not a bug in that skill.
--
-- But insert_contact_with_duplicate_check matches purely on
-- first_name/last_name equality, so every contact that lands on this
-- placeholder gets flagged as a "possible duplicate" of every other one,
-- regardless of source, event, or whether they're the same person at all --
-- discovered via a batch of directory-photo contacts from the 2026 TOSS
-- Superintendent Study Council event where four unrelated, unidentifiable
-- people all got cross-flagged against each other. docs/ENGINEERING-LESSONS.md
-- already named this exact risk in prose (the "Illegible"/blank-name case)
-- with no code guard -- this migration adds one.
--
-- This only carves out the one literal placeholder pair; any other
-- first/last name match (including two different real people who happen to
-- share a name) is still flagged exactly as before.
create or replace function public.insert_contact_with_duplicate_check(payload jsonb)
returns public.contacts
language plpgsql
set search_path = public
as $$
declare
  v_first text := payload->>'first_name';
  v_last text := payload->>'last_name';
  v_dup_id uuid;
  v_row public.contacts;
begin
  perform pg_advisory_xact_lock(hashtextextended(lower(trim(v_first)) || '|' || lower(trim(v_last)), 0));

  select id into v_dup_id
  from public.contacts
  where first_name ilike trim(v_first)
    and last_name ilike trim(v_last)
    and not (lower(trim(v_first)) = 'illegible' and lower(trim(v_last)) = 'illegible')
  order by created_at
  limit 1;

  insert into public.contacts (
    event_id, source, qr_channel, rep_id, first_name, last_name, email, phone, title, state,
    school_district_id, school_district_name_raw, school_id, school_name_raw,
    extraction_confidence, match_status, review_status,
    local_duplicate_of_contact_id, source_image_path, source_image_hash,
    cropped_image_path, source_message_id, source_note_id, interaction_notes,
    contact_intent
  )
  values (
    (payload->>'event_id')::uuid,
    payload->>'source',
    payload->>'qr_channel',
    (payload->>'rep_id')::uuid,
    v_first,
    v_last,
    payload->>'email',
    payload->>'phone',
    payload->>'title',
    payload->>'state',
    (payload->>'school_district_id')::uuid,
    payload->>'school_district_name_raw',
    (payload->>'school_id')::uuid,
    payload->>'school_name_raw',
    payload->>'extraction_confidence',
    coalesce(payload->>'match_status', 'pending'),
    coalesce(payload->>'review_status', 'needs_review'),
    v_dup_id,
    payload->>'source_image_path',
    payload->>'source_image_hash',
    payload->>'cropped_image_path',
    (payload->>'source_message_id')::uuid,
    (payload->>'source_note_id')::uuid,
    payload->>'interaction_notes',
    payload->>'contact_intent'
  )
  returning * into v_row;

  return v_row;
end;
$$;
