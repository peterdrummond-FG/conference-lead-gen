# ffmpeg-service (Vercel project `audio-convert-ffmpeg`)

One Vercel function that converts a voice memo from AMR to M4A, so the n8n
voice pipeline (`pipeline-voice-transcription`) can send it to OpenAI. Phones
send AMR; OpenAI rejects it. The n8n host has no ffmpeg and its admin couldn't
add one, so conversion runs here instead. Stateless: bytes in, bytes out,
nothing stored or logged.

`POST /api/convert` with the raw AMR bytes and `Authorization: Bearer <key>`.
Returns `audio/mp4` (200), or a JSON error: 401 bad key, 405 not POST, 413 over
4 MB, 415 not AMR, 502 ffmpeg failed, 500 key not configured (fails closed).

## Deploy (a separate Vercel project, not the frontend)

The frontend project has an SPA catch-all rewrite and CSP headers; keep this out
of it.

Deployed: `https://audio-convert-ffmpeg.vercel.app/api/convert` (team FG Tech,
project `audio-convert-ffmpeg`, named generically so other pilots can reuse it).
The key is in the macOS Keychain as `FFMPEG_SERVICE_KEY`
(`security find-generic-password -a "$USER" -s FFMPEG_SERVICE_KEY -w`). Redeploy
with `vercel deploy --prod --scope fg-tech` from this folder.

To recreate it:

1. Vercel → Add New Project → import this repo → **Root Directory:
   `n8n/ffmpeg-service`**. Framework preset: Other.
2. Environment variable `FFMPEG_SERVICE_KEY` = a long random string
   (`openssl rand -hex 32`). Production scope.
3. Deploy. Note the URL.

## Test it before anything depends on it

```bash
# 1. Auth is enforced (expect 401)
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<host>/api/convert

# 2. Convert a real memo (expect 200 and a playable memo.m4a)
curl -s -X POST https://<host>/api/convert \
  -H "Authorization: Bearer $FFMPEG_SERVICE_KEY" \
  --data-binary @memo.amr -o memo.m4a -w '%{http_code}\n'
```

Local: `npm install && npm test` (runs the real handler with the bundled ffmpeg).

## Limits and what to watch

- 4 MB in / 4.4 MB out (Vercel's 4.5 MB body cap). A memo is capped at 15 min,
  about 1.4 MB as AMR and 3.6 MB as M4A.
- The ffmpeg binary comes from `ffmpeg-static` and is bundled by
  `includeFiles` in `vercel.json`. If a deploy answers 502 "ENOENT", that
  bundle step failed.
- Not connected to n8n yet. Wiring is `pipeline-voice-transcription`'s
  `Convert Audio` node and the `FFmpeg Service Key` credential.
