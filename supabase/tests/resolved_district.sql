-- Tests for finalize_contact_match's guarded district write (migration
-- 20261007120000_resolved_district.sql). Run against the real functions and tables in a
-- transaction that always rolls back, so nothing is left behind. This file holds the
-- test; to run it, send it to the database as one script (the Supabase MCP execute_sql
-- tool, or psql). It ends by raising 'ALL PASSED ...', which is success; any other
-- error message is a failed assertion. To check the test before the migration is
-- applied, send the migration's SQL first in the same script.
--
-- What it proves: the lookup maps to OUR district and school when exactly one matches;
-- falls back to raw text otherwise; NEVER overwrites a district that is there; is
-- refused for low confidence, a bad address or name, or a lead with no school; writes
-- nothing when the row is no longer pending; leaves the old 19-argument call working;
-- and never approves the lead.

create function pg_temp.mk(p_school text, p_district_raw text default null, p_state text default 'Zzland')
returns public.contacts language sql as $$
  select * from public.insert_contact_with_duplicate_check(jsonb_build_object(
    'event_id', (select id from public.events limit 1), 'source', 'form',
    'first_name', 'ZZ' || gen_random_uuid()::text, 'last_name', 'Probe', 'email', 'zz@example.invalid',
    'state', p_state, 'school_name_raw', p_school, 'school_district_name_raw', p_district_raw));
$$;

create function pg_temp.fin(p_id uuid, p_name text, p_url text, p_conf text)
returns public.contacts language sql as $$
  select * from public.finalize_contact_match(
    p_id, 'new_account', 'high', null, null, null, null, null, 'za1', 'ZZ Account', 'district', false, null, null,
    'match notes', null, 'high', true, true, p_name, p_url, p_conf);
$$;

do $$
declare
  d_sun uuid; d_dup1 uuid; d_dup2 uuid; s_ruleville uuid;
  c public.contacts; r public.contacts; passed int := 0;
  url text := 'https://www.sunflower.k12.ms.us/schools';
  procedure_note text;
begin
  insert into public.school_districts (state, name) values ('Zzland', 'Sunflower County School District') returning id into d_sun;
  insert into public.school_districts (state, name) values ('Zzland', 'Dup District') returning id into d_dup1;
  insert into public.school_districts (state, name) values ('Zzland', 'dup  district') returning id into d_dup2;
  insert into public.schools (district_id, name) values (d_sun, 'Ruleville Central Elementary') returning id into s_ruleville;
  insert into public.schools (district_id, name) values (d_sun, 'Ruleville Middle');

  -- T1: maps to OUR district and school (normalised: case, punctuation); lead stays needs_review.
  c := pg_temp.mk('Ruleville Central Elementary');
  r := pg_temp.fin(c.id, 'sunflower county school district.', url, 'high');
  assert r.school_district_id = d_sun, 'T1 district id';
  assert r.school_id = s_ruleville, 'T1 school id';
  assert r.school_name_raw is null and r.school_district_name_raw is null, 'T1 raw cleared when ids are set';
  assert r.review_status = 'needs_review' and r.auto_approved is not true, 'T1 never approved';
  assert r.match_status = 'new_account' and r.matched_zoho_account_id = 'za1', 'T1 match fields still written';
  assert (r.district_lookup->>'mappedToOurList')::boolean and r.district_lookup->>'evidenceUrl' = url, 'T1 provenance';
  assert r.notes like 'match notes%District looked up from the school%' || url || '%', 'T1 notes say it was looked up';
  passed := passed + 1;

  -- T2: district maps, the typed school isn't one of its schools: school stays typed text.
  c := pg_temp.mk('Grace Lutheran School');
  r := pg_temp.fin(c.id, 'Sunflower County School District', url, 'medium');
  assert r.school_district_id = d_sun and r.school_id is null and r.school_name_raw = 'Grace Lutheran School', 'T2';
  passed := passed + 1;

  -- T3: not in our table: kept as raw text, flagged as not mapped.
  c := pg_temp.mk('Ruleville Central Elementary');
  r := pg_temp.fin(c.id, 'Totally Unknown ISD', url, 'high');
  assert r.school_district_id is null and r.school_district_name_raw = 'Totally Unknown ISD', 'T3 raw';
  assert r.school_name_raw = 'Ruleville Central Elementary', 'T3 school stays typed';
  assert not (r.district_lookup->>'mappedToOurList')::boolean, 'T3 not mapped';
  passed := passed + 1;

  -- T4: two of our districts match the name: ambiguous, so not guessed.
  c := pg_temp.mk('Some School');
  r := pg_temp.fin(c.id, 'Dup District', url, 'high');
  assert r.school_district_id is null and r.school_district_name_raw = 'Dup District', 'T4 ambiguous -> raw';
  passed := passed + 1;

  -- T4b: same name in a different state is not a match.
  c := pg_temp.mk('Ruleville Central Elementary', null, 'Otherland');
  r := pg_temp.fin(c.id, 'Sunflower County School District', url, 'high');
  assert r.school_district_id is null and r.school_district_name_raw = 'Sunflower County School District', 'T4b other state';
  passed := passed + 1;

  -- T5: a district the person typed is NEVER overwritten.
  c := pg_temp.mk('Ruleville Central Elementary', 'Rep Typed ISD');
  r := pg_temp.fin(c.id, 'Sunflower County School District', url, 'high');
  assert r.school_district_name_raw = 'Rep Typed ISD' and r.school_district_id is null, 'T5 typed district kept';
  assert r.district_lookup is null and r.notes = 'match notes', 'T5 no lookup recorded';
  passed := passed + 1;

  -- T5b: a district from our list is NEVER overwritten either.
  c := pg_temp.mk('Ruleville Central Elementary');
  update public.contacts set school_district_id = d_dup1 where id = c.id;
  r := pg_temp.fin(c.id, 'Sunflower County School District', url, 'high');
  assert r.school_district_id = d_dup1 and r.district_lookup is null, 'T5b district id kept';
  passed := passed + 1;

  -- T6: low confidence, T7: bad address / name, T8: no school at all -> not applied.
  c := pg_temp.mk('Ruleville Central Elementary');
  r := pg_temp.fin(c.id, 'Sunflower County School District', url, 'low');
  assert r.school_district_id is null and r.school_district_name_raw is null and r.district_lookup is null, 'T6 low confidence';
  c := pg_temp.mk('Ruleville Central Elementary');
  r := pg_temp.fin(c.id, 'Sunflower County School District', 'javascript:alert(1)', 'high');
  assert r.district_lookup is null, 'T7 non-http address';
  c := pg_temp.mk('Ruleville Central Elementary');
  r := pg_temp.fin(c.id, 'Sunflower' || chr(10) || 'County', url, 'high');
  assert r.district_lookup is null, 'T7 control character in the name';
  c := pg_temp.mk('Ruleville Central Elementary');
  r := pg_temp.fin(c.id, '   ', url, 'high');
  assert r.district_lookup is null, 'T7 blank name';
  c := pg_temp.mk(null);
  r := pg_temp.fin(c.id, 'Sunflower County School District', url, 'high');
  assert r.school_district_id is null and r.school_district_name_raw is null and r.district_lookup is null, 'T8 no school';
  passed := passed + 1;

  -- T9: not pending any more (a reviewer set the match): nothing is written, the all-null row comes back.
  c := pg_temp.mk('Ruleville Central Elementary');
  update public.contacts set match_status = 'new_account', notes = 'reviewer note' where id = c.id;
  r := pg_temp.fin(c.id, 'Sunflower County School District', url, 'high');
  assert r.id is null, 'T9 superseded returns the all-null row';
  assert (select notes from public.contacts where id = c.id) = 'reviewer note'
     and (select school_district_id from public.contacts where id = c.id) is null, 'T9 nothing written';
  passed := passed + 1;

  -- T10: the old 19-argument call (no lookup parameters) still works and touches no district.
  c := pg_temp.mk('Ruleville Central Elementary');
  select * into r from public.finalize_contact_match(
    c.id, 'new_account', 'high', null, null, null, null, null, 'za1', 'ZZ Account', 'district', false, null, null,
    'old caller', null, 'high', true, true);
  assert r.match_status = 'new_account' and r.school_district_id is null and r.district_lookup is null, 'T10 old signature';
  passed := passed + 1;

  -- T11: only service_role may call it.
  assert not has_function_privilege('anon', 'public.finalize_contact_match(uuid,text,text,text,text,text,text,text,text,text,text,boolean,text,jsonb,text,text,text,boolean,boolean,text,text,text)', 'execute'), 'T11 anon';
  assert has_function_privilege('service_role', 'public.finalize_contact_match(uuid,text,text,text,text,text,text,text,text,text,text,boolean,text,jsonb,text,text,text,boolean,boolean,text,text,text)', 'execute'), 'T11 service_role';
  passed := passed + 1;

  -- Normalisation is the pickers' rule.
  assert public.ckh_norm_name('St. Mary''s ISD') = 'st marys isd' and public.ckh_norm_name('  Café   Unified ') = 'cafe unified', 'norm';
  passed := passed + 1;

  raise exception 'ALL PASSED: % groups of assertions', passed;
end $$;
