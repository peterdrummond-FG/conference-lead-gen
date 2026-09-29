-- APPLIED 2026-09-25. Apply at cutover of pipeline-note-extraction (needs
-- 00_notify_n8n_function.sql first). Webhook path: ckh-note-extraction.
--
-- INSERT only. A note put back in the queue (transient failure, or
-- reconcile_stale_note_submissions) is deliberately left to the 5-minute
-- backstop rather than re-fired at once -- an immediate retry during an API
-- outage would just fail again.
create trigger note_submissions_notify_n8n
  after insert on public.note_submissions
  for each row
  when (new.status = 'pending_extraction')
  execute function public.notify_n8n('ckh-note-extraction');
