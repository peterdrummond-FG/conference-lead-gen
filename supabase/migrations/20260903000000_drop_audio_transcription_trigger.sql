-- Stage 14 revised: transcription moved from a Supabase Edge Function
-- (triggered via pg_net on insert) to a fully local Whisper step in
-- local-agent/agent.mjs's transcriptionLoop, matching the same
-- keep-it-local reasoning already applied to research-contact/
-- match-contact/process-cards. The trigger/function are no longer
-- needed; transcribe-voice-memo's source stays in the repo for
-- reference but nothing invokes it now.
drop trigger if exists inbound_messages_audio_insert on public.inbound_messages;
drop function if exists public.trigger_transcribe_voice_memo();
