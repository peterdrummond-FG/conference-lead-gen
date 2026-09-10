-- Basic rep roster (no login, no password -- same trust model as the
-- shared staff PIN). phone_number is the join key back to
-- inbound_messages.from_phone (texted-in card photos) and to
-- phone_event_bindings (the existing SMS "text SETUP" flow), so a rep
-- who's already been texting cards in gets their name attached to work
-- they've already done as soon as they're added here.
create table public.reps (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone_number text not null unique,
  created_at timestamptz not null default now()
);
alter table public.reps enable row level security;

-- Which rep is credited for the event's booth vs breakout-session leads --
-- set by a customerSuccess admin from the Setup page. Nullable: an event
-- can run with a channel unassigned, in which case contacts through that
-- channel simply carry no rep_id.
alter table public.events
  add column booth_rep_id uuid references public.reps(id) on delete set null,
  add column session_rep_id uuid references public.reps(id) on delete set null;

-- Which rep gets credit for a given contact -- resolved once at insert time
-- and stored directly rather than re-derived on every read:
-- contacts-create (QR/form submissions) reads it off the active event's
-- booth_rep_id/session_rep_id for the scanned channel; contacts-from-ocr
-- (texted-in cards) resolves it from the sender's phone number.
alter table public.contacts
  add column rep_id uuid references public.reps(id) on delete set null;
