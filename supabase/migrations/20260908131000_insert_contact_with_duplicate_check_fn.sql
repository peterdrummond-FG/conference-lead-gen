-- Closes a check-then-insert race in the within/cross-event duplicate check:
-- contacts-create and contacts-from-ocr used to run findLocalDuplicate's
-- SELECT, then insert the new row separately -- two near-simultaneous
-- submissions for the same person could both run the SELECT before either
-- INSERT committed, so neither row would get local_duplicate_of_contact_id
-- set. An advisory lock keyed on the normalized name pair serializes
-- concurrent inserts for the same person before the duplicate lookup runs,
-- so the lookup always sees any insert that's already in flight for that
-- same name.
--
-- Takes the insertable columns as a single JSONB payload rather than a long
-- positional argument list, since contacts-create and contacts-from-ocr each
-- populate a different subset of the same contacts columns.
create or replace function public.insert_contact_with_duplicate_check(payload jsonb)
returns public.contacts
language plpgsql
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
  order by created_at
  limit 1;

  insert into public.contacts (
    event_id, source, first_name, last_name, email, phone, title, state,
    school_district_id, school_district_name_raw, school_id, school_name_raw,
    extraction_confidence, match_status, review_status,
    local_duplicate_of_contact_id, source_image_path, source_image_hash,
    cropped_image_path, source_message_id
  )
  values (
    (payload->>'event_id')::uuid,
    payload->>'source',
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
    (payload->>'source_message_id')::uuid
  )
  returning * into v_row;

  return v_row;
end;
$$;
