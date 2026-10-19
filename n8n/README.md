# n8n: the pipelines and the skill workflows

Everything that reads a card photo, transcribes a voice memo, splits a pasted note
into people, researches a contact or matches it against Zoho runs here, as n8n
workflows. This replaced the local Mac agent and card watcher, which were retired
on 2026-10-08. The workflows are live. The sections below say what each one is,
how the database starts it, what the n8n host has to provide, and how to change
or roll back each part.

**Two hostnames (set up by the n8n admin, 2026-10-08).** The editor is at
`workflow.flippencodes.com`, behind Cloudflare Access (sign-in required). Webhooks
stay on `workflow.flippengroup.com/webhook/`, which is where the database's
`notify_n8n()` posts. Never point `notify_n8n` at the editor host: Access would
answer with a login redirect and every pipeline trigger would stop.

The n8n instance is run by the n8n admin, not by this team. Anything that changes
a workflow, a credential, the community node or the host is a request to them.

Design history and the reasoning behind the shape live in
`MASS_Alliance_Pilot_App_Architecture.md` (historical) and `docs/ARCHITECTURE.md`
(current).

## What exists

State below is as last checked on 2026-10-08.

| Workflow | n8n id | Source | State |
|---|---|---|---|
| skill-extract-note-contacts | `QSxeSjcQaEtnw5LI` | generated | published |
| skill-attribute-voice-memo | `k1LFHrmVYBqDV4bT` | generated | published |
| skill-research-contact | `llARky9YWlgXdU5z` | generated | published |
| skill-match-contact | `qTr3bwVAAYBdHHyq` | generated | published |
| skill-process-cards | `fiHwr67Yn3jH5JRj` | generated | published |
| pipeline-note-extraction | `vZU7o9pk5JLmJdzT` | `pipelines/pipeline-note-extraction.ts` | published |
| pipeline-voice-transcription (v3, live) | `YSXgBGZQg6x2oDeZ` | `pipelines/pipeline-voice-transcription-v3.ts` | published |
| pipeline-voice-transcription v2 (standby) | `kYKg80yktf4QKljI` | `pipelines/pipeline-voice-transcription.ts` | inactive, rollback target |
| pipeline-process-cards-sms | `YfY73SMTSAkUjLL6` | `pipelines/pipeline-process-cards-sms.ts` | published |
| pipeline-match-contact | `lTgZMxZMmzPjvkSH` | `pipelines/pipeline-match-contact.ts` | published |
| error-alert-email | `WMyujD4QbMKZwozf` | `pipelines/error-alert-email.ts` | **inactive** (see "Not done yet") |

Plus the `n8n_config` data table (`GwOKrjqFHDaGzH8q`), which holds `ZOHO_MCP_URL`.
Treat that value as a secret.

| Path | What it is |
|---|---|
| `schemas/` | JSON Schema output contracts, one per skill, and the encoding rules (`schemas/README.md`). |
| `scripts/build-skill-workflow.mjs` | Generates each `skill-*` workflow from `.claude/skills/<skill>/SKILL.md` and its schema. |
| `pipelines/` | Workflow SDK source for the pipelines and the error workflow, kept in step with what is deployed. |
| `scripts/check-n8n-credential-scopes.mjs` | Credential-policy audit (see Rule 5 below). |
| `ffmpeg-service/` | The Vercel function behind the v2 voice pipeline. Standby only. |

## Shape

- **Skill workflows** do one model call. An Agent node pairs with a Structured
  Output Parser holding the skill's schema, and returns `{success, data}` or
  `{success: false, errorKind: 'transient' | 'permanent', message}`. They hold
  only the Anthropic credential. Each one can be called only by its own
  pipeline (n8n's `callerPolicy` workflow setting).
- **Pipelines** own everything else: triggers, claims, database writes, Storage,
  and Edge Function calls. Each has two triggers. A header-authenticated
  Database Webhook is the fast path. A 5-minute schedule backstop catches
  anything the webhook missed and runs the reconcile sweeps.
- **error-alert-email** sends a plain-text email for any production failure
  (Fail Loudly nodes and unhandled node errors). It is built but not switched on.

## How the database starts a pipeline

A trigger on a table calls the stored function `notify_n8n()`, which posts the row
id to the pipeline's webhook path. Four triggers exist, all enabled:

| Trigger | Table | Pipeline | Webhook path |
|---|---|---|---|
| `contacts_notify_n8n_match` | `contacts` | pipeline-match-contact | `ckh-match-contact` |
| `inbound_messages_notify_n8n_cards` | `inbound_messages` (photos) | pipeline-process-cards-sms | `ckh-process-cards-sms` |
| `inbound_messages_notify_n8n_voice` | `inbound_messages` (audio) | pipeline-voice-transcription | `ckh-voice-transcription` |
| `note_submissions_notify_n8n` | `note_submissions` | pipeline-note-extraction | `ckh-note-extraction` |

They come from `20260925221629_notify_n8n_function.sql` (the function), the
`trigger_note_extraction`, `trigger_match_contact` and `trigger_process_cards_sms`
migrations of 2026-09-25, and `20261008163919_trigger_voice_transcription_n8n.sql`.
(A fifth trigger, for a "contact intent" classifier, was retired on 2026-10-05.)

**The shared secret.** `notify_n8n()` sends the header `x-ckh-webhook-secret`. Its
value is the Supabase Vault secret `n8n_webhook_secret`; n8n checks it with the
Header Auth credential **"Supabase DB Webhook Secret"**, attached to each
pipeline's webhook trigger node. If the two ever differ, webhooks answer 403 and
the pipelines fall back to their 5-minute backstop (rows are still caught, up to
five minutes late). To read the current value when creating or rotating the
credential:

```sql
select decrypted_secret from vault.decrypted_secrets where name = 'n8n_webhook_secret';
```

**Switching one pipeline's trigger off.** Dropping its trigger stops the fast path
(`drop trigger contacts_notify_n8n_match on public.contacts;`, and so on).
Deactivating only the workflow also stops it, but the webhook then answers 404 and
the backstop no longer runs, while `pg_net` keeps logging a failed request every
time a row changes. Activate a workflow before applying its trigger, never the
other way round.

## What the n8n host must provide

- The community node `n8n-nodes-ffmpeg-audio`, installed by the admin. The live
  voice pipeline (v3) needs it. Without it, voice memos fail transiently and wait.
- Five credentials, by these names: **Anthropic account 2** (the five skills),
  **Supabase account** (the pipelines; service role), **Supabase DB Webhook
  Secret**, **OpenAI account 2** (voice transcription only), and **FFmpeg Service
  Key** (the v2 standby only). A sixth, **Alert SMTP**, is needed for
  error-alert-email and does not exist yet.
- The `n8n_config` data table with a `ZOHO_MCP_URL` row (see "Match without Zoho").
- Webhooks reachable at `workflow.flippengroup.com/webhook/` (see the hostname note).

## Rules the pipelines depend on

These began as the rules of the retired local agent and were carried over. See
`CLAUDE.md`.

1. **Only a UUID-validated id is taken from a webhook.** The row is re-read
   with the pipeline's own credential, and its eligibility is re-checked before
   anything is claimed.
2. **Claim before slow work, and re-assert the claim on every write after it.**
   Claims are optimistic updates (`WHERE status = 'pending…' AND attempts = <read
   value>`). Later writes repeat the claim's values in their `WHERE`, so a
   duplicate trigger or a run that lost its claim writes nothing. This was
   verified per pipeline on scratch tables: exactly one duplicate wins.
3. **Model output is untrusted until validated.** The parser enforces the
   schema. A failure is permanent: the row keeps its spent attempt, and the run
   fails loudly with nothing written. Blank strings become null before they are
   persisted (`schemas/README.md`).
4. **Transient does not burn an attempt.** For match-contact, the claim spends
   `match_attempts` and a transient failure refunds it with a conditional
   update. Notes, voice and cards are sent back to their queue with a bounded
   retry count.
5. **Skills never hold write credentials. Pipelines never hold the model
   credential.** Enforced by `scripts/check-n8n-credential-scopes.mjs`, which is
   not run in CI because it needs an export of the live workflows. Run it after
   any workflow or credential change, against an export of every workflow (every
   `skill-`, `pipeline-` and `error-` workflow in the export needs an entry in the
   script's `WORKFLOW_CREDENTIAL_POLICY`; add one first when you add a workflow or
   a credential):

   ```bash
   node n8n/scripts/check-n8n-credential-scopes.mjs <dir-of-exported-workflow-json>
   ```

6. **Anything a second system produced is re-validated at the boundary.**
   Storage paths are checked against twilio-webhook's own key pattern, the
   transcription name prompt only accepts name-shaped strings, and excerpt and field
   lengths are bounded in both the schema and the database.

## Changing things

- **A skill:** edit its `SKILL.md` body or its schema, run
  `node n8n/scripts/build-skill-workflow.mjs <skill>`, then update the existing
  workflow **in place** and republish. Pipelines reference skills by workflow id,
  so deleting and recreating a skill breaks them. Two settings are made in n8n by
  hand and are not produced by the generator, so check them after any update: the
  workflow's `callerPolicy` (which pipelines may call it) and its execution
  timeout. Then run the credential audit above. Editing only a SKILL.md's
  frontmatter (the lines between the first two `---`) changes nothing live: the
  generator strips it.
- **A pipeline:** edit it in n8n or through the SDK, then update its file in
  `pipelines/` to match. Validate SDK code with the n8n MCP `validate_workflow`
  before every create or update. The validator rejects helper functions,
  `.join()` and `Object.assign` in SDK code. Inside Code-node strings, it also
  rejects a `%` or an unpaired apostrophe.
- **n8n quirks found while building:** HTTP Request with a text response and
  full response puts the text in `json.data`, not `json.body`. The Crypto hash
  node drops the item's binary. Edit Image `information` replaces the JSON and
  re-encodes the image. A node with two incoming IF branches runs once per
  branch, so use a Merge (append) before any "tally everything" step.

## The voice pipeline: live version and rollback

Voice memos are transcribed by OpenAI (the built-in node) after an AMR to MP3
conversion: phones send AMR, which OpenAI rejects.

- **Live (v3):** `pipeline-voice-transcription`, id `YSXgBGZQg6x2oDeZ`, source
  `pipelines/pipeline-voice-transcription-v3.ts`, live since 2026-10-08. It converts
  with the `n8n-nodes-ffmpeg-audio` community node, so it needs no credential, no
  external service and no files on the host. The node's `m4a` output fails ("Output
  format m4a is not available"), hence MP3, and it returns the file in binary
  property `data`. Since 2026-10-19 it also **keeps that MP3** (browsers cannot play
  the stored AMR): a side branch after transcription uploads it to
  `voice-memos/sms/<id>.mp3` and records `inbound_messages.playback_path`. v2 does
  the same with the M4A its converter returns (`voice-memos/sms/<id>.m4a`), so a
  rollback keeps new memos playable too.
- **Standby (v2):** id `kYKg80yktf4QKljI`, source
  `pipelines/pipeline-voice-transcription.ts`. It converts through the Vercel function
  in `ffmpeg-service/` (`https://audio-convert-ffmpeg.vercel.app/api/convert`) and
  returns M4A in binary property `audio`. The two pipelines are otherwise identical.

**Rolling back to v2:**

1. Unpublish v3.
2. Publish v2. Both listen on the webhook path `ckh-voice-transcription`, so never
   have both active; the database trigger posts to that path either way, so no SQL
   changes.
3. `skill-attribute-voice-memo` already allows both pipelines to call it
   (`callerPolicy`), so nothing to change there.
4. Confirm the Vercel project `audio-convert-ffmpeg` is up and its
   `FFMPEG_SERVICE_KEY` environment variable equals the n8n credential **FFmpeg
   Service Key**. (The key is also saved in the macOS Keychain item of the same name.)
5. Run the credential audit; the standby workflow's n8n name differs from the
   policy's name for it, so update the policy entry first if the audit complains.
6. Update the health routine's prompt with the live workflow id
   (`docs/ARCHITECTURE.md`, "Daily health check").

A memo in flight during the switch is safe: every write re-asserts its claim, and a
memo left mid-processing is reclaimed by `reconcile_stale_inbound_messages` after 30
minutes.

Voice memo audio goes to OpenAI; card photos, transcripts and notes go to Anthropic.
`docs/DATA-RETENTION.md` lists what is held and for how long.

## Not done yet

- **Failure alerting is not switched on.** `error-alert-email` is built but
  inactive: it needs an "Alert SMTP" credential and addresses, then to be published
  and set as every workflow's error workflow (n8n refuses to set an unpublished
  error workflow). Until then a Fail Loudly node or an unhandled node error
  notifies nobody; a stopped pipeline shows up as rows stuck pending.
- **`unplacedContacts` is not ported from the old local agent.** The
  `attribute-voice-memo` skill returns people the rep met and spoke about but did
  not photograph; the voice pipeline validates them and then ignores them, so no
  contact is created for them (the attributed contacts are unaffected). The
  database side (`20260929180000_voice_memo_multi_contact.sql`) is ready.
- **The credential audit is not in CI** (see Rule 5).

## Match without Zoho

`skill-match-contact` has two paths, chosen per run by whether `ZOHO_MCP_URL`
is usable (https, not masked):

- **Usable:** the Zoho MCP connector, exactly as designed. Nothing about this
  path changed.
- **Missing or masked:** a second, tool-less Agent classifies against
  `localAccounts`, which `pipeline-match-contact` fetches with its own
  credential (`match_candidate_accounts`, over the `school_districts` /
  `schools` copy of Zoho Accounts) and passes in. The skill session holds only
  the model credential, per the scopes policy.

A masked value such as `.../mcp/redacted-.../message` counts as unusable. The first
live contacts hit exactly that: Zoho answered "APIKey parsing Exception", the
failure was classed permanent, and all three attempts were spent.

The local path can only answer the Account half of the question. Zoho Contacts
and Deals are not copied, so it never returns `existing_contact`, never sets an
active-opportunity flag, and caps confidence at `medium`, which keeps every row
it produces in front of a reviewer, as every lead is now (nothing auto-confirms). Those limits are
enforced in the `Enforce Local Limits` Code node, not just requested in the
prompt; the same node rejects any Account id that was not in the list it was
given. Its `notes` always open with a line saying Contacts and Deals were not
checked, and it carries through to the CSV export.

The copy is incomplete in two ways: Accounts Zoho tags with the wrong state
(South Central Service Cooperative is tagged Arkansas) still miss, exactly as they
do in Zoho, and about 87 districts (as of 2026-10-12) have no `zoho_account_id`
and are never offered.
