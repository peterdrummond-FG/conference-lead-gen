-- Repoints the three FKs that pointed at reps.id (the throwaway
-- name/phone/PIN roster from earlier today) at profiles.id instead, then
-- drops reps outright. Column names, qr_channel, and the booth/session
-- channel-attribution logic in contacts-create/contacts-from-ocr are
-- otherwise untouched -- only the referenced table changes.
--
-- Any existing rep_id/booth_rep_id/session_rep_id values point at the old
-- reps.id, which cannot exist in the brand-new profiles table (always
-- seeded fresh from real auth.users accounts created after this
-- migration) -- the new FK constraints below would fail to validate
-- otherwise. In practice this only ever clears assignments made against
-- the short-lived reps table this migration retires.
update public.events set booth_rep_id = null, session_rep_id = null where booth_rep_id is not null or session_rep_id is not null;
update public.contacts set rep_id = null where rep_id is not null;

alter table public.events drop constraint events_booth_rep_id_fkey;
alter table public.events drop constraint events_session_rep_id_fkey;
alter table public.contacts drop constraint contacts_rep_id_fkey;

alter table public.events
  add constraint events_booth_rep_id_fkey foreign key (booth_rep_id) references public.profiles(id) on delete set null,
  add constraint events_session_rep_id_fkey foreign key (session_rep_id) references public.profiles(id) on delete set null;
alter table public.contacts
  add constraint contacts_rep_id_fkey foreign key (rep_id) references public.profiles(id) on delete set null;

drop table public.reps;
