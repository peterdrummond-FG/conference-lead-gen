-- Stage 20 — one reusable QR per rep instead of one per (event, rep). The
-- slide's URL now encodes only the rep's own identity (rep_slug); which
-- conference a scan's contacts land in is resolved server-side from
-- profiles.current_event_id at submission time, not from the URL (see
-- contacts-create/index.ts and routes.ts's `connect/:repSlug`).
--
-- rep_slug is derived from the rep's first name at creation time
-- (profiles-create/index.ts) and, unlike name, is enforced unique -- two reps
-- sharing a first name would otherwise silently collide on the same QR link
-- (profiles.name has never had a uniqueness constraint). Nullable: only
-- sales reps hand out a QR, so only sales reps get one.
alter table public.profiles add column rep_slug text unique;

-- Backfill existing sales reps so a slug already exists before
-- profiles-create starts generating one for new accounts. Same
-- insert-and-retry-on-collision shape events_activate() uses
-- (20260917100000_event_reps_and_activation_guard.sql) rather than
-- check-then-insert -- this only has to guard a backfilled slug against one a
-- concurrent profiles-create insert produces in the same instant, but the
-- pattern is cheap to reuse and keeps the two call sites' collision handling
-- identical.
do $$
declare
  v_row record;
  v_base text;
  v_slug text;
  v_suffix int;
begin
  for v_row in select id, name from public.profiles where role = 'sales' and rep_slug is null loop
    v_base := lower(regexp_replace(split_part(v_row.name, ' ', 1), '[^a-zA-Z0-9]+', '', 'g'));
    if v_base = '' then
      v_base := 'rep';
    end if;
    v_suffix := 0;
    loop
      v_slug := case when v_suffix = 0 then v_base else v_base || v_suffix end;
      begin
        update public.profiles set rep_slug = v_slug where id = v_row.id;
        exit;
      exception when unique_violation then
        v_suffix := v_suffix + 1;
      end;
    end loop;
  end loop;
end $$;
