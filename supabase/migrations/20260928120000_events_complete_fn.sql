-- Once activated, an event never went back to inactive -- nothing existed to
-- actually end a conference. events_complete() is the mirror of
-- events_activate() (20260917100000_event_reps_and_activation_guard.sql):
-- in one transaction it flips is_active off and clears current_event_id for
-- every profile still linked to this event, so every rep who was working it
-- lands back in the "not linked to an event" state and gets routed through
-- Setup again next time, instead of staying silently linked to a conference
-- that's over. Staff-gated (admin/solutionsSuccess) at the edge-function
-- layer (events-complete), same as events_activate.
create or replace function public.events_complete(p_event_id uuid) returns public.events
language plpgsql
set search_path = public
as $$
declare
  v_event public.events;
begin
  -- Locks the row for the duration of the transaction, same defensive shape
  -- as events_activate's advisory lock -- there's no concurrent-completion
  -- race to actually close here (completing twice is a no-op either way),
  -- but this keeps the "does it exist" check and the update atomic against
  -- a concurrent delete.
  select * into v_event from public.events where id = p_event_id for update;
  if not found then
    raise exception 'No event with id %.', p_event_id using errcode = 'CKH01';
  end if;

  update public.events set is_active = false where id = p_event_id;
  update public.profiles set current_event_id = null where current_event_id = p_event_id;

  select * into v_event from public.events where id = p_event_id;
  return v_event;
end;
$$;
