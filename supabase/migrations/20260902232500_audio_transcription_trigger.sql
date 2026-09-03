create extension if not exists pg_net;

-- Fires transcribe-voice-memo immediately on insert of an audio message —
-- no reason to wait on the local agent's poll cycle since this step has no
-- claude -p dependency. Uses the project's anon key (safe to embed — it's
-- meant to be public/embeddable) as the bearer token for the Edge
-- Function's gateway JWT check; the function's own claim-then-mark-
-- processing update is the real guard against a duplicate/replayed call.
create or replace function public.trigger_transcribe_voice_memo()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.kind = 'audio' and new.status = 'pending_transcription' then
    perform net.http_post(
      url := 'https://yrvppufkerbjpvrxniot.supabase.co/functions/v1/transcribe-voice-memo',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlydnBwdWZrZXJianB2cnhuaW90Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzODA4NzYsImV4cCI6MjEwMzk1Njg3Nn0.PZADuNtJi-N9wq95t-nolGblWaYVKCLeB9q5-V8e394'
      ),
      body := jsonb_build_object('inboundMessageId', new.id)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists inbound_messages_audio_insert on public.inbound_messages;
create trigger inbound_messages_audio_insert
after insert on public.inbound_messages
for each row execute function public.trigger_transcribe_voice_memo();
