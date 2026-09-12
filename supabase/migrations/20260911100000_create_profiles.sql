-- Real per-user identity, replacing the shared staff PIN + the reps
-- name/phone/PIN roster built earlier today. id is always set explicitly to
-- the matching auth.users.id right after auth.admin.createUser(...) --
-- never a fresh gen_random_uuid() -- so profiles is a 1:1 extension of a
-- real Supabase Auth account, not a standalone roster. email lives only on
-- auth.users; profiles-list/me join to it via the service-role client
-- rather than duplicating it here.
--
-- role is text+check (not a native enum) matching this schema's existing
-- convention (see initial_schema.sql's comment) -- keeps future value
-- additions a plain additive constraint change.
--
-- current_event_id is a sales rep's own "which event am I working right
-- now" pointer -- deliberately decoupled from events.is_active (the single
-- global active event that Setup/Intake still key off of). Nullable and
-- meaningful only for role='sales' (not DB-enforced, since a solutionsSuccess
-- or admin account has no reason to need one, but nothing stops it being
-- set). A rep's full event history doesn't need a separate table -- it's
-- already reconstructable from contacts.rep_id + contacts.event_id.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null check (role in ('admin','solutionsSuccess','sales')),
  phone_number text unique,
  current_event_id uuid references public.events(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
