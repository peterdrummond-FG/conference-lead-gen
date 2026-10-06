-- Which door a public form lead came in by (Review's "QR scan" vs "Kiosk" source
-- labels, 2026-10-07).
--
-- contacts-create's three ways in all stored source = 'form' with qr_channel null
-- unless the attendee picked "At the booth" themselves, so Review couldn't say
-- whether a lead came from a rep's own reusable QR, an old per-event QR, or the
-- in-app Kiosk tab. qr_channel can't carry it: that column is the attendee's own
-- answer to "How did you hear about us?" (booth / session) and is exported to Zoho
-- as "Capture Channel" (export-csv's channelLabel), so overloading it would
-- change what Sales receives. This is a separate column and nothing exports it.
--
--   rep_qr    /connect/<repSlug>: a rep's own permanent QR (contacts-create repSlug)
--   event_qr  the older per-event QR (contacts-create eventSlug)
--   kiosk     the in-app Kiosk tab: a signed-in bare call
--   null      form leads from before this column, and a bare call with nobody
--             signed in. Review keeps calling those "Form"; they are not
--             relabelled as something they might not be, and there is no backfill
--             because the old rows carry nothing to backfill from.
--
-- A note's origin (SMS vs Imported note) needs no column: it is read from
-- note_submissions (from_phone set = texted in, submitted_by set = pasted on
-- Import) through contacts.source_note_id, which all 27 existing note leads
-- resolve. contacts-list returns it as noteOrigin.
--
-- The unassigned queue carries the value too, so a scan that waited for a
-- conference keeps its source when Solutions Success files it
-- (assign_unassigned_submission). The three functions below are the live
-- definitions (pg_get_functiondef, 2026-10-06) plus intake_path, nothing else.

alter table public.contacts
  add column intake_path text check (intake_path in ('rep_qr', 'event_qr', 'kiosk'));

alter table public.unassigned_submissions
  add column intake_path text check (intake_path in ('rep_qr', 'event_qr', 'kiosk'));

create or replace function public.insert_contact_with_duplicate_check(payload jsonb)
returns public.contacts
language plpgsql
set search_path to 'public'
as $function$
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
    event_id, source, qr_channel, intake_path, rep_id, first_name, last_name, email, phone, title, state,
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
    payload->>'intake_path',
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
$function$;

create or replace function public.queue_unassigned_submission(p jsonb, p_ip_hash text, p_ip_cap integer, p_total_cap integer)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('unassigned_submissions_cap', 0));

  if (select count(*) from public.unassigned_submissions where status = 'pending') >= p_total_cap then
    return null;
  end if;
  if p_ip_hash is not null and
     (select count(*) from public.unassigned_submissions
        where ip_hash = p_ip_hash and created_at > now() - interval '24 hours') >= p_ip_cap then
    return null;
  end if;

  insert into public.unassigned_submissions (
    first_name, last_name, email, phone, title, state,
    school_district_id, school_district_name_raw, school_id, school_name_raw, qr_channel, intake_path,
    reason, rep_id, event_hint_id, rep_slug, event_slug, ip_hash
  ) values (
    p->>'first_name', p->>'last_name', p->>'email', p->>'phone', p->>'title', p->>'state',
    (p->>'school_district_id')::uuid, p->>'school_district_name_raw', (p->>'school_id')::uuid, p->>'school_name_raw',
    p->>'qr_channel', p->>'intake_path',
    p->>'reason', (p->>'rep_id')::uuid, (p->>'event_hint_id')::uuid, p->>'rep_slug', p->>'event_slug', p_ip_hash
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.assign_unassigned_submission(p_id uuid, p_event_id uuid, p_rep_id uuid, p_user uuid)
returns public.contacts
language plpgsql
set search_path = public
as $$
declare
  v_row public.unassigned_submissions;
  v_contact public.contacts;
begin
  select * into v_row from public.unassigned_submissions where id = p_id for update;
  if not found then
    raise exception 'That scan is no longer in the queue.' using errcode = 'CKH02';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'Someone has already %.', case v_row.status when 'assigned' then 'filed this scan' else 'discarded this scan' end
      using errcode = 'CKH01';
  end if;
  if not exists (select 1 from public.events e where e.id = p_event_id and e.is_active) then
    raise exception 'That conference has ended or doesn''t exist. Choose a live one.' using errcode = 'CKH01';
  end if;
  if p_rep_id is not null and not exists (select 1 from public.profiles p where p.id = p_rep_id and p.role = 'sales') then
    raise exception 'That person isn''t a sales rep.' using errcode = 'CKH01';
  end if;

  select * into v_contact from public.insert_contact_with_duplicate_check(jsonb_build_object(
    'event_id', p_event_id,
    'source', 'form',
    'qr_channel', v_row.qr_channel,
    'intake_path', v_row.intake_path,
    'rep_id', p_rep_id,
    'first_name', v_row.first_name,
    'last_name', v_row.last_name,
    'email', v_row.email,
    'phone', v_row.phone,
    'title', v_row.title,
    'state', v_row.state,
    'school_district_id', v_row.school_district_id,
    'school_district_name_raw', v_row.school_district_name_raw,
    'school_id', v_row.school_id,
    'school_name_raw', v_row.school_name_raw
  ));

  update public.unassigned_submissions
     set status = 'assigned', assigned_contact_id = v_contact.id, resolved_by = p_user, resolved_at = now()
   where id = p_id;

  return v_contact;
end;
$$;

-- create or replace keeps each function's grants, but say so rather than rely on it.
revoke all on function public.queue_unassigned_submission(jsonb, text, integer, integer) from public, anon, authenticated;
revoke all on function public.assign_unassigned_submission(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.queue_unassigned_submission(jsonb, text, integer, integer) to service_role;
grant execute on function public.assign_unassigned_submission(uuid, uuid, uuid, uuid) to service_role;
