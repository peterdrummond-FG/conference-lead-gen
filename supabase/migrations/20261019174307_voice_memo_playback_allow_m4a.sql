-- APPLIED 2026-10-19 (version 20261019174307) through the Supabase MCP tools.
-- The playback copy may be M4A as well as MP3 (2026-10-19).
--
-- Why: the live pipeline (v3) converts AMR to MP3 with a community node, but the
-- standby (v2, rollback target) converts through the Vercel ffmpeg service, which
-- returns M4A (AAC). Browsers play both. A rollback to v2 must not leave new memos
-- without a playable copy, and the first version of this CHECK only allowed .mp3.
--
-- Still pinned to the row's own id: only the extension may vary, so nothing can
-- point inbound-messages-audio at another object in the bucket.
alter table public.inbound_messages
  drop constraint inbound_messages_playback_path_is_own_mp3;

alter table public.inbound_messages
  add constraint inbound_messages_playback_path_is_own_copy
  check (playback_path is null
         or playback_path in ('sms/' || id::text || '.mp3', 'sms/' || id::text || '.m4a'));
