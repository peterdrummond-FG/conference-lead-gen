-- Stage 20.1 — a rep picking a not-yet-active campaign whose state we
-- couldn't parse from its name used to be a dead end (told to use the web
-- Setup page instead). Now they can just text the state back, so the
-- conversation needs a third step to wait for that reply.
alter table public.conference_setup_sessions drop constraint conference_setup_sessions_step_check;
alter table public.conference_setup_sessions add constraint conference_setup_sessions_step_check
  check (step in ('awaiting_name', 'awaiting_selection', 'awaiting_state'));
