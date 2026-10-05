-- One conference everywhere: a rep's app conference (profiles.current_event_id)
-- and their phone's conference (phone_event_bindings.event_id) were two
-- unconnected pointers, each with its own writers.
--
--   * twilio-webhook bound the phone (text SETUP, pick a conference) and never
--     touched the profile. A rep who only texted had a linked phone and no app
--     conference, so their QR answered 409 and Setup said "choose a conference".
--     Live on 2026-10-05: two of five reps with a phone were in exactly that state.
--   * profiles-set-current-event, profiles-assign-current-event and
--     events-activate changed the profile and never the phone, so when Solutions
--     Success moved a rep to a new conference their texted cards kept landing in
--     the old one until they texted SETUP again.
--
-- These two functions are the only place the rule lives; every writer calls one.
-- Service role only, like the other writers' helpers.

-- App -> phone. Sets the conference on the profile and, if that profile's phone
-- is ALREADY bound, moves that binding with it.
--
-- UPDATE only, never insert. A binding row is what makes session-notifications
-- text a number unprompted (the contact-received confirmations).
-- A phone that has never texted SETUP has not opted in, and a row created here
-- would message someone who never agreed to be messaged. The A2P campaign was
-- rejected four times over consent; the only thing that may create a binding is
-- the person texting us.
--
-- last_activity_at is deliberately NOT touched (it bounds session-notifications'
-- contact-received confirmation sweep to phones active in the last 2 hours): a
-- move made in the app is not activity on the phone, and refreshing it would
-- start texting a phone that has been quiet. (expiry_notified_at is unused since
-- 2026-10-05, see the README.)
--
-- The binding only follows to an ACTIVE event (so it can't be pointed at a
-- finished conference), and only when it actually changes (re-picking the same
-- conference must not reset the confirmation watermark).
--
-- Clearing the profile (p_event_id null, e.g. Admin's "not at a conference")
-- DELETES that phone's binding. Removing a binding raises no consent issue (it
-- only stops texts), and leaving it would keep filing the rep's cards under the
-- conference they were just taken out of. Their next SETUP links them again.
-- events_complete() does not touch bindings; twilio-webhook re-checks
-- events.is_active whenever a bound phone files something instead.
create or replace function public.profile_set_current_event(p_profile_id uuid, p_event_id uuid)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_phone text;
  v_moved integer := 0;
begin
  update public.profiles p
     set current_event_id = p_event_id
   where p.id = p_profile_id
  returning p.phone_number into v_phone;
  if not found then
    raise exception 'No profile with id %.', p_profile_id using errcode = 'CKH01';
  end if;

  if p_event_id is not null and v_phone is not null
     and exists (select 1 from public.events e where e.id = p_event_id and e.is_active) then
    update public.phone_event_bindings b
       set event_id = p_event_id,
           updated_at = now(),
           -- Same reset every other bind does: a stale watermark from the old
           -- conference must not skip confirming this one's first contacts.
           contacts_confirmed_through = now()
     where b.phone_number = v_phone
       and b.event_id is distinct from p_event_id;
    get diagnostics v_moved = row_count;
  elsif p_event_id is null and v_phone is not null then
    delete from public.phone_event_bindings b where b.phone_number = v_phone;
    get diagnostics v_moved = row_count;
  end if;

  -- whether a phone binding moved (or was removed) with the profile
  return v_moved > 0;
end;
$$;

-- Phone -> app. Called by twilio-webhook right after it binds a phone: points
-- the profile that owns that number at the same conference. profiles.phone_number
-- is unique, so "exactly one profile" is the schema's guarantee; no match (a
-- number nobody has on file) is simply false and the phone stays bound alone.
-- Re-asserts is_active here rather than trusting the caller. Returns whether a
-- profile was linked.
create or replace function public.profile_link_event_by_phone(p_phone text, p_event_id uuid)
returns boolean
language plpgsql
set search_path = public
as $$
begin
  if p_phone is null or p_phone = '' or p_event_id is null then
    return false;
  end if;
  if not exists (select 1 from public.events e where e.id = p_event_id and e.is_active) then
    return false;
  end if;
  update public.profiles p
     set current_event_id = p_event_id
   where p.phone_number = p_phone
     and p.current_event_id is distinct from p_event_id;
  -- true when a profile now points at the event, whether or not this call changed it
  return exists (select 1 from public.profiles p where p.phone_number = p_phone and p.current_event_id = p_event_id);
end;
$$;

revoke all on function public.profile_set_current_event(uuid, uuid) from public, anon, authenticated;
revoke all on function public.profile_link_event_by_phone(text, uuid) from public, anon, authenticated;
grant execute on function public.profile_set_current_event(uuid, uuid) to service_role;
grant execute on function public.profile_link_event_by_phone(text, uuid) to service_role;
