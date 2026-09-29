-- APPLIED 2026-09-25 by hand in the Supabase SQL editor, so it has NO row in
-- supabase_migrations.schema_migrations; this file's timestamp is when it was
-- recorded here, not a recorded version. Verified live via pg_get_triggerdef:
-- identical to the statement below. Webhook path: ckh-process-cards-sms.
--
-- Same shape and reasoning as 30_trigger_voice_transcription.sql: storage_path
-- is set in a second UPDATE after upload, and the WHEN clause is the
-- pipeline's claim condition so its own writes don't re-fire it.
create trigger inbound_messages_notify_n8n_cards
  after insert or update of status, storage_path on public.inbound_messages
  for each row
  when (new.kind = 'photo'
        and new.status = 'pending_ocr'
        and new.storage_path is not null)
  execute function public.notify_n8n('ckh-process-cards-sms');
