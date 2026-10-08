-- APPLIED 2026-10-08 (version 20261008163919) at the cutover of pipeline-voice-transcription.
-- Webhook path: ckh-voice-transcription.
--
-- INSERT *and* UPDATE: twilio-webhook inserts the row, uploads the file, then
-- sets storage_path in a second UPDATE, so an INSERT-only trigger always fires
-- before the audio exists. The WHEN clause is the pipeline's own claim
-- condition, so the pipeline's own writes (processing, completed, link state)
-- never fire it; a transient failure resurrected by
-- reconcile_retryable_failed_inbound_messages (status back to
-- pending_transcription, after its cooldown) does, which is the retry.
create trigger inbound_messages_notify_n8n_voice
  after insert or update of status, storage_path on public.inbound_messages
  for each row
  when (new.kind = 'audio'
        and new.status = 'pending_transcription'
        and new.storage_path is not null)
  execute function public.notify_n8n('ckh-voice-transcription');
