-- APPLIED 2026-10-19 (version 20261019172232) through the Supabase MCP tools.
-- Voice memos get a second, playable copy (2026-10-19).
--
-- What broke: a texted memo is stored exactly as Twilio sent it, AMR-NB
-- (`audio/amr`), and the app's play button signed that file for an <audio>
-- element. Chrome and Firefox cannot decode AMR (`canPlayType('audio/amr')` is
-- empty), so every memo showed "Couldn't play this recording." The pipeline
-- already converts the AMR to MP3 for transcription and threw the MP3 away.
--
-- Now the pipeline keeps it: `playback_path` is the MP3 in the voice-memos bucket.
-- `storage_path` stays the original AMR (retries and the relink sweep re-read it).
--
-- The path is pinned to the row's own id, so nothing can point the signing function
-- (inbound-messages-audio) at some other object in the bucket.
alter table public.inbound_messages
  add column if not exists playback_path text;

alter table public.inbound_messages
  add constraint inbound_messages_playback_path_is_own_mp3
  check (playback_path is null or playback_path = 'sms/' || id::text || '.mp3');

-- Retention: the MP3 is the same recording, so it must go on the same day as the AMR.
-- expired_media()'s return type changes, which `create or replace` cannot do.
drop function public.expired_media(integer, integer);

create function public.expired_media(p_retention_days integer default 90, p_limit integer default 500)
 returns table(id uuid, kind text, storage_path text, playback_path text, received_at timestamptz)
 language sql
 stable
 set search_path to 'public'
as $function$
  select m.id, m.kind, m.storage_path, m.playback_path, m.received_at
  from public.inbound_messages m
  where (m.storage_path is not null or m.playback_path is not null)
    and m.received_at < now() - make_interval(days => greatest(p_retention_days, 1))
  order by m.received_at
  limit greatest(p_limit, 1);
$function$;

create or replace function public.mark_media_purged(p_ids uuid[])
 returns integer
 language plpgsql
 set search_path to 'public'
as $function$
declare v_count int;
begin
  update public.inbound_messages
  set storage_path = null,
      playback_path = null
  where id = any(p_ids) and (storage_path is not null or playback_path is not null);
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

-- Found while recreating these: both were executable by anon and authenticated
-- (Postgres grants EXECUTE to PUBLIC on a new function), and PostgREST exposes them. Anyone
-- with the public key could list every media path past retention, or null a row's
-- storage_path so the purge never deleted the file. Only the purge script
-- (service role) calls them.
revoke execute on function public.expired_media(integer, integer) from public, anon, authenticated;
revoke execute on function public.mark_media_purged(uuid[]) from public, anon, authenticated;
grant execute on function public.expired_media(integer, integer) to service_role;
grant execute on function public.mark_media_purged(uuid[]) to service_role;
