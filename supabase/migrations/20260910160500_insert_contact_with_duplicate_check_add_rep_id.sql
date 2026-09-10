-- Threads the new rep_id column (previous migration) through
-- insert_contact_with_duplicate_check's payload -> column mapping, same as
-- qr_channel before it.
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
  order by created_at
  limit 1;

  insert into public.contacts (
    event_id, source, qr_channel, rep_id, first_name, last_name, email, phone, title, state,
    school_district_id, school_district_name_raw, school_id, school_name_raw,
    extraction_confidence, match_status, review_status,
    local_duplicate_of_contact_id, source_image_path, source_image_hash,
    cropped_image_path, source_message_id
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
    (payload->>'source_message_id')::uuid
  )
  returning * into v_row;

  return v_row;
end;
$$;
