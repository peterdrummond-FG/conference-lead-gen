# n8n rebuild (built, NOT live)

The n8n replacement for `local-agent/` and `watcher/`. Everything described
here exists on `workflow.flippengroup.com`, **inactive**. `local-agent` and
`watcher` remain the system of record until each pipeline has passed shadow
testing and been cut over (`cutover-migrations/README.md`).

Design rationale lives in the plan of record
(`~/.claude/plans/n8n-rework-migration.md`). This file describes what was
built and the rules it depends on.

## What exists

| Workflow | n8n id | Source |
|---|---|---|
| skill-extract-note-contacts | `QSxeSjcQaEtnw5LI` | generated |
| skill-attribute-voice-memo | `k1LFHrmVYBqDV4bT` | generated |
| skill-research-contact | `llARky9YWlgXdU5z` | generated |
| skill-match-contact | `qTr3bwVAAYBdHHyq` | generated |
| skill-process-cards | `fiHwr67Yn3jH5JRj` | generated |
| pipeline-note-extraction | `vZU7o9pk5JLmJdzT` | `pipelines/` |
| pipeline-voice-transcription | `byHCYGrFpc4LCLQq` | `pipelines/` |
| pipeline-process-cards-sms | `YfY73SMTSAkUjLL6` | `pipelines/` |
| pipeline-match-contact | `lTgZMxZMmzPjvkSH` | `pipelines/` |
| error-alert-email | `WMyujD4QbMKZwozf` | `pipelines/` |

Plus the `n8n_config` data table (`GwOKrjqFHDaGzH8q`), which holds
`ZOHO_MCP_URL`.

| Path | What it is |
|---|---|
| `schemas/` | JSON Schema output contracts, one per skill, and the encoding rules (`schemas/README.md`). |
| `scripts/build-skill-workflow.mjs` | Generates each `skill-*` workflow from `.claude/skills/<skill>/SKILL.md` and its schema. |
| `pipelines/` | Workflow SDK source for the pipelines and the error workflow, kept in step with what's deployed. |
| `scripts/check-n8n-credential-scopes.mjs` | Credential-policy audit (see below). |
| `cutover-migrations/` | SQL that switches pipelines on. Not applied yet. |
| `workflows/`, `infra/` | The archived first build (commit `32c457f`). Kept as a record only; nothing there runs. |

## Shape

- **Skill workflows** do one model call. An Agent node pairs with a Structured
  Output Parser holding the skill's schema, and returns `{success, data}` or
  `{success: false, errorKind: 'transient' | 'permanent', message}`. They hold
  only the Anthropic credential. Each one can be called only by its own
  pipeline (`callerPolicy`).
- **Pipelines** own everything else: triggers, claims, database writes, Storage,
  and Edge Function calls. Each has two triggers. A header-authenticated
  Database Webhook is the fast path. A 5-minute schedule backstop catches
  anything the webhook missed and runs the reconcile sweeps.
- **error-alert-email** sends a plain-text email for any production failure
  (Fail Loudly nodes and unhandled node errors).

## Rules the pipelines depend on

These are the local-agent rules, carried over. See `CLAUDE.md`.

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
   credential.** Enforced by `scripts/check-n8n-credential-scopes.mjs`. Run it
   against an export of the live workflows before any cutover:

   ```bash
   node n8n/scripts/check-n8n-credential-scopes.mjs <dir-of-exported-workflow-json>
   ```

6. **Anything a second system produced is re-validated at the boundary.**
   Storage paths are checked against twilio-webhook's own key pattern, the
   transcription name prompt only accepts name-shaped strings, and excerpt and field
   lengths are bounded in both the schema and the database.

## Changing things

- **A skill:** edit its `SKILL.md` or schema, run
  `node n8n/scripts/build-skill-workflow.mjs <skill>`, then update the
  existing workflow **in place**. Pipelines reference skills by workflow id, so
  deleting and recreating a skill breaks them.
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

## Before activating anything

- `ZOHO_MCP_URL` row in `n8n_config`, holding the real endpoint URL (32-hex key
  in the path). Without a usable one, match-contact no longer stops: it falls
  back to the local Accounts copy (see "Match without Zoho" below). A masked
  value such as `.../mcp/redacted-.../message` counts as unusable. The first
  post-cutover contacts hit exactly that: Zoho answered "APIKey parsing
  Exception", the failure was classed permanent, and all three attempts were
  spent.
- "Supabase DB Webhook Secret" credential (`cutover-migrations/README.md`).
- "Alert SMTP" credential and addresses on error-alert-email. Then publish it
  and set it as every workflow's error workflow. n8n refuses to set an
  unpublished error workflow.
- Publish the skill workflows (they have no external trigger, and the plan
  allows it). The build found n8n refuses an unpublished sub-workflow more
  than one manual hop deep. Production calls haven't been tested, so publish
  first, then confirm the first live run.
- Voice memos: transcription is OpenAI `gpt-4o-transcribe`, after an ffmpeg
  conversion on the n8n host (phones send AMR, which OpenAI rejects). Before
  `pipeline-voice-transcription` can run, the n8n admin needs to do what
  `ffmpeg-admin-package/README.md` says: install ffmpeg, unblock Execute Command
  (`NODES_EXCLUDE`), and, if the first test memo fails with a file-access
  error, add `/tmp/ckh-voice` to `N8N_RESTRICT_FILE_ACCESS_TO` (n8n limits the
  Read/Write Files node to its own folder by default; this is unconfirmed on
  your instance). Then create an **"OpenAI account 2"** credential. The
  pipeline in git is rewired for this but not yet pushed to n8n: the instance
  rejects the Execute Command node until it is unblocked, so republish the
  workflow after that. Then run the probe once (`2TVbxDKQGFqzIQDT`), apply
  `cutover-migrations/30_trigger_voice_transcription.sql`, activate the
  workflow and stop the local agent's voice loop (empty `AGENT_LOOPS`).
  Attendees' voice memos go to OpenAI; confirm that is acceptable first.
- Shadow-test the two writes that were deliberately never exercised live:
  process-cards' crop upload to Storage, and its `contacts-from-ocr` POST.

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

The local path can only answer the Account half of the question. Zoho Contacts
and Deals are not copied, so it never returns `existing_contact`, never sets an
active-opportunity flag, and caps confidence at `medium`, which keeps every row
it produces in front of a reviewer, as every lead is now (nothing auto-confirms). Those limits are
enforced in the `Enforce Local Limits` Code node, not just requested in the
prompt; the same node rejects any Account id that was not in the list it was
given. Its `notes` always open with a line saying Contacts and Deals were not
checked, and it carries through to the CSV export.

Known gaps in the copy: Accounts Zoho tags with the wrong state (South Central
Service Cooperative is tagged Arkansas) still miss, exactly as they do in Zoho;
88 districts have no `zoho_account_id` and are never offered; and one district
row stores its state as `MN` rather than `Minnesota`, so a lookup by full state
name will not see it.
