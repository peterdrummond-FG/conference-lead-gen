# ffmpeg for n8n: what the n8n admin needs to do

**For:** whoever runs `workflow.flippengroup.com`.
**Why:** CKH voice memos arrive as **AMR** audio (all 27 so far; it's what
phones send over SMS/MMS). OpenAI's transcription API doesn't accept AMR, so n8n
must convert each memo to M4A with **ffmpeg** before transcribing it. Today this
runs on a staff Mac, and the goal is to move it onto the n8n server.

Two changes are needed. Where they go (VM, container, Kubernetes, and so on)
is up to you.

## 1. Install ffmpeg where n8n runs workflows

- **Where:** on the machine or container that runs the n8n process. If n8n
  runs in **queue mode** (`EXECUTIONS_MODE=queue`), install it on **every
  worker**, because workflows execute there, not on the main instance.
- **Which build:** any standard ffmpeg (distro package or static build) works.
  It needs the **AMR-NB/AMR-WB decoders** and the **AAC encoder**, which are
  built into ffmpeg itself, so there are no extra codec libraries to add.
- **Path:** `ffmpeg` must be on the `PATH` of the user n8n runs as.

## 2. Enable n8n's Execute Command node

Since n8n 2.0, the Execute Command node is blocked by default. Unblock it with
the `NODES_EXCLUDE` environment variable, then restart n8n (and any workers):

```
NODES_EXCLUDE=["n8n-nodes-base.localFileTrigger"]
```

This removes Execute Command from the blocklist and keeps Local File Trigger
blocked. If you already set a custom `NODES_EXCLUDE`, just remove
`"n8n-nodes-base.executeCommand"` from it. n8n's docs:
<https://docs.n8n.io/deploy/host-n8n/configure-n8n/security/block-specific-nodes.md>

Leave everything else as it is:
- Keep the **n8n version** unchanged as part of this change.
- The **Read/Write Files from Disk** node is already available. Keep it
  available: the workflow uses it to hand the audio file to ffmpeg.
- The workflow writes scratch files under **`/tmp/ckh-voice/`** and deletes
  them after each memo. The n8n user just needs `/tmp` to be writable, which is
  the normal default.

## How to check it worked

On each machine or container that runs n8n workflows, as the n8n user:

```bash
ffmpeg -hide_banner -decoders | grep -E ' amrnb | amrwb '   # expect both lines
ffmpeg -hide_banner -encoders | grep ' aac '                # expect one line
```

In the n8n editor, adding a node and searching **"Execute Command"** should now
find it. Tell the CKH team when it's done; they'll wire the voice pipeline to
it and run a test memo.

## Security trade-off (please read before enabling)

Execute Command runs shell commands **as the n8n user, inside n8n's
environment**. That environment holds n8n's stored credentials and its own
config and secrets. n8n blocks the node by default for exactly this reason:
once it's enabled, **anyone who can create or edit workflows on this instance
can run commands on the server**, not just the CKH workflow.

How CKH keeps its own use narrow:
- One fixed command (shown below). The only variable parts are file paths
  built from a database UUID that the workflow validates against a strict
  pattern first. No text from a memo, a rep or an attendee ever reaches the
  shell.
- Bounded: 15-minute audio cap, mono 16 kHz output, scratch files deleted
  after use.

What only you can control: **who can edit workflows on this instance.** Keep
that list short while Execute Command is enabled.

The command CKH runs, where `<id>` is a validated UUID:

```bash
ffmpeg -nostdin -hide_banner -loglevel error -y -t 900 \
  -i /tmp/ckh-voice/<id>.amr -ac 1 -ar 16000 -c:a aac -b:a 32k \
  /tmp/ckh-voice/<id>.m4a
```

## Appendix: if n8n runs as a Docker container

Tested on 2026-09-25: it builds on `n8nio/n8n` 2.40.7 (Alpine 3.24), installs
ffmpeg 8.1.2 with the AMR decoders and AAC encoder, and the `node` user can
write to `/tmp`. The current official image has no `apk` package manager, so
the Dockerfile copies it back in from a matching Alpine image; that's n8n's own
documented method. See [`Dockerfile`](Dockerfile), and set `N8N_VERSION` to
the tag you run today:

```bash
docker build --build-arg N8N_VERSION=<your current tag> -t <your-registry>/n8n-ffmpeg:<tag> n8n/ffmpeg
```

Then run that image instead of `n8nio/n8n`, with the `NODES_EXCLUDE` value
above, on the main instance and all workers.
