# Add ffmpeg to n8n (CKH voice memos)

**For:** whoever runs `workflow.flippengroup.com`.
**Why:** conference voice memos arrive as AMR audio. OpenAI's transcription API
does not accept AMR, so n8n converts each memo to M4A with ffmpeg first.
ffmpeg is a command-line tool (no service, no port). n8n runs it through its
Execute Command node.

**Footprint:** ~50 MB disk, one CPU core for under a second per memo, a few
tens of MB RAM, no GPU. Scratch files go in `/tmp/ckh-voice/` and are deleted
after each memo.

## What's in this package

| File | Purpose |
|---|---|
| `Dockerfile` | n8n image with ffmpeg added |
| `docker-compose.example.yml` | The two lines to change in your n8n service |
| `verify.sh` | Checks it worked, from inside the container |

## Steps (Docker)

1. **Build the image** on top of the n8n version you run today (find it with
   `docker inspect <n8n-container> --format '{{.Config.Image}}'`):

   ```bash
   docker build --build-arg N8N_VERSION=<current tag> -t <your-registry>/n8n-ffmpeg:<tag> .
   ```

   The build fails on purpose if ffmpeg lacks the AMR decoder or AAC encoder.
   The Dockerfile copies `apk` from `alpine:3.24` because the official n8n image
   has no package manager. If your n8n base uses a different Alpine, change
   `3.24` to match (`docker run --rm --entrypoint cat n8nio/n8n:<tag> /etc/os-release`).
   Tested 2026-09-25 on n8nio/n8n 2.40.7 with ffmpeg 8.1.2.

2. **Run that image instead of `n8nio/n8n`**, on the main instance **and every
   worker** if you use queue mode (`EXECUTIONS_MODE=queue`).

3. **Enable Execute Command.** Since n8n 2.0 it is blocked by default. Set:

   ```
   NODES_EXCLUDE=["n8n-nodes-base.localFileTrigger"]
   ```

   Then restart n8n and any workers. Keep the n8n version and everything else
   unchanged. Read/Write Files from Disk must stay available (it's already on).
   See `docker-compose.example.yml`.

   **Possible extra step:** n8n limits its Read/Write Files node to one folder
   (`~/.n8n-files` by default, controlled by `N8N_RESTRICT_FILE_ACCESS_TO`).
   We haven't confirmed this on your instance. If the first test memo fails
   with a file-access error, add the scratch folder to that variable, keeping
   any value already there (separate folders with `;`):

   ```
   N8N_RESTRICT_FILE_ACCESS_TO=/tmp/ckh-voice
   ```

4. **Verify**, as the n8n user inside the container:

   ```bash
   docker cp verify.sh <n8n-container>:/tmp/verify.sh
   docker exec <n8n-container> sh /tmp/verify.sh
   ```

   Expect `ALL CHECKS PASSED`. In the n8n editor, adding a node and searching
   "Execute Command" should now find it.

5. **Tell the CKH team it's done.** The voice pipeline is already written for
   this setup; they'll add the OpenAI credential, publish it and run a test memo.

## Not using Docker?

Install ffmpeg on the machine that runs n8n (every worker in queue mode) from
your distro package or a static build. It needs the AMR-NB/AMR-WB decoders and
the AAC encoder (both built in) and must be on the n8n user's `PATH`. Then do
step 3 and run `verify.sh`.

## Security trade-off (please read first)

Execute Command runs shell commands **as the n8n user, inside n8n's
environment**, which holds n8n's stored credentials and secrets. n8n blocks it
by default for that reason. Once enabled, **anyone who can create or edit
workflows on this instance can run commands on the server.** Keep the list of
workflow editors short while it's on.

How CKH keeps its own use narrow: one fixed command, with file paths built only
from a database UUID the workflow validates first. No text from a memo, rep or
attendee reaches the shell. Audio is capped at 15 minutes and scratch files are
deleted after use. The command is:

```bash
ffmpeg -nostdin -hide_banner -loglevel error -y -t 900 \
  -i /tmp/ckh-voice/<id>.amr -ac 1 -ar 16000 -c:a aac -b:a 32k \
  /tmp/ckh-voice/<id>.m4a
```
