-- Removes the one school_districts row whose state was 'MN' instead of 'Minnesota'
-- (Peter, 2026-10-06). It was not a mislabelled row but an unused duplicate of the
-- identical Minnesota row, "South Central Service Cooperative": no schools, no leads, no
-- queued scans pointed at it (checked first), and renaming it would have put two
-- identical names in Minnesota's list and made the district lookup treat that name as
-- ambiguous. The Minnesota copy, which one lead uses, is untouched.
--
-- Already run on production on 2026-10-06 as a direct statement (this file is the record,
-- so a rebuilt database matches). The guards make it a no-op anywhere the row is gone or
-- in use.
delete from public.school_districts d
 where d.id = 'd354fcb5-8626-4a6c-afdb-e84ea505cf4a'
   and d.state = 'MN'
   and not exists (select 1 from public.schools s where s.district_id = d.id)
   and not exists (select 1 from public.contacts c where c.school_district_id = d.id)
   and not exists (select 1 from public.unassigned_submissions u where u.school_district_id = d.id);
