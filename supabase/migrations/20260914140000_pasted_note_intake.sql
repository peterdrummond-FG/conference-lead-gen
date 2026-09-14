-- Stage 17 — a rep pastes a whole typed note (often covering several
-- people) into the app and hits send; extract-note-contacts turns it into
-- one contact row per person.
--
-- Deliberately NOT folded into inbound_messages: that table is Twilio-shaped
-- (twilio_message_sid not null unique, from_phone/to_phone not null,
-- media_content_type, storage_path, transcript) and a web paste has none of
-- those. Forcing one through it would mean a synthetic 'web-<uuid>' SID and
-- two not-null phone columns filled with placeholders. Separate table, same
-- claim-then-mark-processing mechanics the SMS loops already use.
--
-- SMS was considered as the intake channel first and rejected: over ~160
-- chars (70 with a single smart quote, which pasted phone notes are full of)
-- the handset segments the message, Twilio does not guarantee reassembly,
-- and segments can arrive as separate webhooks out of order with nothing in
-- the payload identifying which piece is which. A multi-contact note is
-- always past that threshold, so the channel can't carry this reliably at
-- all. SMS keeps doing what it's good at (card photos, voice memos, a short
-- one-off note) — see twilio-webhook/index.ts.

create table public.note_submissions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete restrict,
  -- Who pasted it. Their *role* decides whether the resulting contacts get
  -- credited to a rep (contacts.rep_id) — resolved server-side in
  -- contacts-from-note, not stored twice here.
  submitted_by uuid not null references public.profiles(id) on delete restrict,
  body text not null,
  status text not null default 'pending_extraction'
    check (status in ('pending_extraction', 'processing', 'completed', 'failed')),
  -- Short human-readable lines for anything the skill saw but deliberately
  -- didn't turn into a contact (e.g. a mention with no name attached), shown
  -- back to the rep on the paste page so a silent drop is never invisible.
  skipped text[],
  error text,
  attempts int not null default 0,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index note_submissions_pending_idx
  on public.note_submissions (status, created_at)
  where status = 'pending_extraction';
create index note_submissions_submitted_by_idx
  on public.note_submissions (submitted_by, created_at desc);

alter table public.note_submissions enable row level security;

-- Lets the review card show the original pasted text next to the extracted
-- fields, the same way a card-photo contact shows its photo.
alter table public.contacts
  add column source_note_id uuid references public.note_submissions(id) on delete set null;

create index contacts_source_note_id_idx
  on public.contacts (source_note_id)
  where source_note_id is not null;

alter table public.contacts drop constraint contacts_source_check;
alter table public.contacts add constraint contacts_source_check
  check (source in ('form', 'card_photo', 'note'));

-- Threads source_note_id through the payload -> column mapping, same as
-- rep_id and qr_channel before it. Otherwise unchanged from
-- 20260910160500_insert_contact_with_duplicate_check_add_rep_id.sql.
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
    cropped_image_path, source_message_id, source_note_id, interaction_notes
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
    payload->>'interaction_notes'
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- Same purpose as reconcile_stale_inbound_messages: reset any row a crashed
-- run left stuck at 'processing' so the next startup picks it back up,
-- instead of it sitting stuck until a manual SQL fix. Unlike that function,
-- there's only one kind of row here, so the target state is unconditional.
create function public.reconcile_stale_note_submissions(stale_minutes int)
returns setof public.note_submissions
language sql
set search_path = public
as $$
  update public.note_submissions
  set status = 'pending_extraction',
      claimed_at = null
  where status = 'processing'
    and claimed_at is not null
    and claimed_at < now() - (stale_minutes || ' minutes')::interval
  returning *;
$$;
