-- A "needs a conference" queue for public intake submissions that used to be
-- thrown away.
--
-- contacts-create answered 404/409 and kept nothing when an attendee scanned a
-- valid QR but we couldn't say which conference it belonged to: a rep with no
-- conference chosen, a rep account that no longer exists, a printed per-event QR
-- for a conference that has ended, a call with no QR and nobody signed in, and a
-- signed-in Kiosk tab whose conference is missing or ended. The attendee saw an
-- error and their details were gone. contacts.event_id is NOT NULL and that rule
-- runs through Review, duplicate checks, matching and export, so it is
-- deliberately NOT loosened. These rows wait here instead, holding the same
-- validated form fields, until Solutions Success chooses a conference. Only then
-- does a contact exist (and with it matching and the n8n trigger), so a public
-- request can never start expensive work by landing here.
--
-- Service role only: RLS is on with no policies, and the table grants to anon and
-- authenticated are revoked as well. Every read and write goes through an Edge
-- Function (unassigned-list/-assign/-discard, or contacts-create's insert).
--
-- This is attendee PII, so rows are purged after 90 days, matching the media
-- retention default (audit S12, local-agent/purge-expired-media.mjs). Unlike
-- that script, which an operator runs by hand, this one is scheduled in the
-- database (pg_cron, daily) so the promise doesn't depend on anyone remembering.

create table public.unassigned_submissions (
  id uuid primary key default gen_random_uuid(),

  -- The validated form, same fields and limits contacts-create enforces.
  first_name text not null check (char_length(first_name) between 1 and 100),
  last_name text not null check (char_length(last_name) between 1 and 100),
  email text check (char_length(email) <= 320),
  phone text check (char_length(phone) <= 40),
  title text check (char_length(title) <= 200),
  state text check (char_length(state) <= 60),
  school_district_id uuid references public.school_districts(id) on delete set null,
  school_district_name_raw text check (char_length(school_district_name_raw) <= 200),
  school_id uuid references public.schools(id) on delete set null,
  school_name_raw text check (char_length(school_name_raw) <= 200),
  qr_channel text check (qr_channel in ('booth', 'session')),

  -- Why it is waiting. event_unknown is not one of the five cases that were
  -- briefed: it is a printed QR whose slug matches no conference at all (a typo
  -- or a tampered link). Dropping those would be the same loss, and "No QR
  -- details" would be a false description of a row that does carry a slug.
  reason text not null check (reason in (
    'rep_no_conference', 'rep_not_found', 'event_ended', 'event_unknown', 'no_qr', 'caller_no_conference'
  )),
  -- Only ever a rep we actually know: a sales profile found by repSlug, the
  -- signed-in sales caller, or a repId re-validated against event_reps for the
  -- ended event. Never a client-supplied id taken at its word.
  rep_id uuid references public.profiles(id) on delete set null,
  -- The ended conference a per-event QR pointed at, for the plain-words reason.
  event_hint_id uuid references public.events(id) on delete set null,
  -- Raw, for audit only (capped; they came from a public request).
  rep_slug text check (char_length(rep_slug) <= 100),
  event_slug text check (char_length(event_slug) <= 100),
  -- Hashed network id, for the per-network cap below. Same salted hash the
  -- rate limiter uses; purged with the row.
  ip_hash text,

  status text not null default 'pending' check (status in ('pending', 'assigned', 'discarded')),
  assigned_contact_id uuid references public.contacts(id) on delete set null,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.unassigned_submissions enable row level security;
revoke all on table public.unassigned_submissions from anon, authenticated;

create index unassigned_submissions_pending_idx on public.unassigned_submissions (created_at) where status = 'pending';
create index unassigned_submissions_ip_idx on public.unassigned_submissions (ip_hash, created_at);

-- Public insert, bounded. check_submission_rate already limits requests per
-- network per window; this adds a ceiling on what can pile up. Both caps fail
-- closed (null -> contacts-create answers 429 with its existing wording):
--   * p_ip_cap rows from one network in 24h. Conference wifi is one NAT, so this
--     is generous; the 10-minute rate limit is what stops a burst.
--   * p_total_cap pending rows overall, so no amount of distinct networks can
--     grow the table without bound.
-- One advisory lock serialises the count-then-insert so two requests can't both
-- squeeze under the cap.
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
    school_district_id, school_district_name_raw, school_id, school_name_raw, qr_channel,
    reason, rep_id, event_hint_id, rep_slug, event_slug, ip_hash
  ) values (
    p->>'first_name', p->>'last_name', p->>'email', p->>'phone', p->>'title', p->>'state',
    (p->>'school_district_id')::uuid, p->>'school_district_name_raw', (p->>'school_id')::uuid, p->>'school_name_raw',
    p->>'qr_channel',
    p->>'reason', (p->>'rep_id')::uuid, (p->>'event_hint_id')::uuid, p->>'rep_slug', p->>'event_slug', p_ip_hash
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Assign: turn one waiting submission into a real lead in a chosen conference.
-- It runs in ONE transaction, with the row locked first, instead of the
-- claim / work / confirm dance other loops here use (docs/ENGINEERING-LESSONS.md
-- 8 and 9): everything it touches is in this database, so the contact insert
-- and the status flip commit or roll back together. A crash can't leave a
-- contact with a still-pending row (a duplicate on retry) or a row marked
-- assigned with no contact, and two people pressing Choose conference at once
-- serialise on the lock, so the second sees 'assigned' and is refused.
--
-- It re-asserts everything the caller sent: the conference must be live NOW (it
-- may have ended while the dialog was open) and a rep, if given, must be a sales
-- profile. The contact goes through insert_contact_with_duplicate_check, the
-- same path contacts-create uses, so the duplicate check and the n8n match
-- trigger behave exactly as for a normal scan. Errors carry SQLSTATE CKH01
-- (message is safe to show) or CKH02 (not found).
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

-- Discard: junk (mainly "no QR details" from a stranger). Only a pending row.
create or replace function public.discard_unassigned_submission(p_id uuid, p_user uuid)
returns boolean
language plpgsql
set search_path = public
as $$
begin
  update public.unassigned_submissions
     set status = 'discarded', resolved_by = p_user, resolved_at = now()
   where id = p_id and status = 'pending';
  return found;
end;
$$;

-- Retention: delete every row older than p_days whatever its status. A filed
-- row's PII already lives on the contact; a pending or discarded one has outlived
-- any reason to keep it.
create or replace function public.purge_unassigned_submissions(p_days integer default 90)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if p_days is null or p_days < 1 then
    raise exception 'p_days must be at least 1' using errcode = 'CKH01';
  end if;
  delete from public.unassigned_submissions where created_at < now() - make_interval(days => p_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.queue_unassigned_submission(jsonb, text, integer, integer) from public, anon, authenticated;
revoke all on function public.assign_unassigned_submission(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.discard_unassigned_submission(uuid, uuid) from public, anon, authenticated;
revoke all on function public.purge_unassigned_submissions(integer) from public, anon, authenticated;
grant execute on function public.queue_unassigned_submission(jsonb, text, integer, integer) to service_role;
grant execute on function public.assign_unassigned_submission(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.discard_unassigned_submission(uuid, uuid) to service_role;
grant execute on function public.purge_unassigned_submissions(integer) to service_role;

select cron.schedule(
  'purge-unassigned-submissions',
  '15 3 * * *',
  $cron$select public.purge_unassigned_submissions(90)$cron$
);
