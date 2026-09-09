-- Stage 16 — SMS-driven conference setup. A rep can text "setup a new
-- conference" instead of needing to know/read off the folder_code, get
-- typo-tolerant suggestions from events.name, and confirm by number.
-- Reuses phone_event_bindings for the actual bind (see
-- 20260902231500_twilio_intake_schema.sql) — this only adds the fuzzy-match
-- lookup and the per-phone conversation state needed to get there.

create extension if not exists pg_trgm;

create index events_name_trgm_idx on public.events using gin (name gin_trgm_ops);

-- Ranked fuzzy matches for a rep-typed conference name. Threshold/limit are
-- function defaults rather than edge-function constants so they can be
-- tuned with a plain CREATE OR REPLACE, no redeploy required.
create function public.match_events_by_name(
  p_query text,
  p_limit int default 5,
  p_min_similarity real default 0.15
) returns table (id uuid, name text, state text, sim real)
language sql
stable
as $$
  select e.id, e.name, e.state, similarity(e.name, p_query) as sim
  from public.events e
  where similarity(e.name, p_query) >= p_min_similarity
  order by sim desc
  limit p_limit;
$$;

-- One open "setup a new conference" conversation per phone number. Deleted
-- on cancel/completion; treated as stale (and ignored) by the webhook once
-- updated_at is more than 15 minutes old.
create table public.conference_setup_sessions (
  phone_number text primary key,
  step text not null check (step in ('awaiting_name', 'awaiting_selection')),
  candidates jsonb,
  updated_at timestamptz not null default now()
);
alter table public.conference_setup_sessions enable row level security;

alter table public.inbound_messages drop constraint inbound_messages_kind_check;
alter table public.inbound_messages add constraint inbound_messages_kind_check
  check (kind in ('folder_code_bind', 'photo', 'audio', 'unrecognized', 'conference_setup'));
