-- local-agent's photoLoop/transcriptionLoop optimistically claim a row by
-- flipping it to status='processing', but nothing previously reset a row
-- stuck there after a crash (no equivalent of the folder watcher's own
-- .processing/ -> inbox/ reconciliation). claimed_at records when a row
-- entered 'processing' so a startup sweep can tell a genuinely stuck row
-- apart from one still legitimately being worked on.
alter table public.inbound_messages
  add column claimed_at timestamptz;

-- Resets any row left at 'processing' for longer than stale_minutes back to
-- its appropriate pending_* state (derived from kind), so local-agent picks
-- it back up on its next poll instead of it sitting stuck until a manual SQL
-- fix. Called once at local-agent startup -- a restart is exactly when a
-- previous crash's stuck rows need to be found.
create or replace function public.reconcile_stale_inbound_messages(stale_minutes int)
returns setof public.inbound_messages
language sql
as $$
  update public.inbound_messages
  set status = case kind
        when 'photo' then 'pending_ocr'
        when 'audio' then 'pending_transcription'
      end,
      claimed_at = null
  where status = 'processing'
    and claimed_at is not null
    and claimed_at < now() - (stale_minutes || ' minutes')::interval
  returning *;
$$;
