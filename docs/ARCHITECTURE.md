# CKH Connect — component map

## Components

| Path | What it is |
|---|---|
| `frontend/` | Quasar SPA on Vercel. Talks only to Supabase Edge Functions. |
| `supabase/functions/` | The only server-side API. Service-role clients behind `requireUser()` role checks; RLS is deny-all with zero policies by design. |
| `supabase/migrations/` | Schema + stored functions. Append-only; never edited after the fact. |
| `supabase/seed/` | Zoho reference data (districts/schools/campaigns) for seeding a fresh environment. |
| `local-agent/` | Five poll loops (matching, SMS photo, transcription, intent, note extraction). The only caller of `claude -p`. |
| `watcher/` | Local folder drop → `process-cards` → `contacts-from-ocr`. |
| `.claude/skills/` | The seven skills. |
| `mcp/` | MCP configs for headless skill runs. Only `zoho-readonly.json` today. |
| `scripts/` | Repo guards run in CI, plus `deploy-functions.mjs`. |

## Related docs

| Doc | Covers |
|---|---|
| `../README.md` | What the system does, end to end |
| `../CLAUDE.md` | Load-bearing rules and common commands |
| `ENGINEERING-LESSONS.md` | How to build features here without repeating the Sept 2026 bugs |
| `DATA-RETENTION.md` | What's held about whom, and for how long |
| `../MASS_Alliance_Pilot_App_Architecture.md` | Full design rationale and history |
| `../supabase/migrations/README.md` | Notes on superseded migrations |

## Removed: the .NET backend (Stages 1–7)

The original ASP.NET Core API was fully superseded by Supabase Edge Functions
(Stages 8–15) and removed on 2026-09-14. Recoverable from git history at
`ebd5bba`. Do not resurrect it:

- it had no authentication of any kind after the staff-PIN gate moved
  server-side — seven endpoint groups, all open;
- it ran a *second*, competing matching pipeline against a now-divergent EF
  schema, shelling out to `claude -p --dangerously-skip-permissions` with none
  of the sandboxing below;
- it was the only reason the repo root held Zoho OAuth credentials, next to a
  permission-skipped agent's working directory.

Its CLI tools (`SeedSchoolAccounts`, `SyncCampaigns`, the two backfills) went
with it; the data they loaded is already in the live project and the source
JSON is preserved in `supabase/seed/`.

## Conventions

### Retiring an Edge Function

Removing `supabase/functions/<name>/` is **not** a deletion — the function
stays deployed and callable. In the same change:

1. deploy a 410 stub in its place (see `districts-create` for the shape), and
2. add the slug to `RETIRED` in `scripts/check-deployed-functions.sh`.

`scripts/check-deployed-functions.sh` fails CI if a deployed function is
neither in the repo nor on that list, **and** probes every RETIRED name to
confirm it really answers 410. Both halves matter: `districts-create` and
`schools-create` were "retired" in everyone's mental model for three months
while still serving public unauthenticated INSERTs.

A 410 stub isn't the only option — a retired function with nothing still
referencing its slug (no docs, no monitoring, no client hardcoding the URL)
can be deleted outright via the Management API's
`DELETE /v1/projects/{ref}/functions/{slug}` (needs `SUPABASE_ACCESS_TOKEN`;
no MCP tool covers this, so it's a manual `curl`). Ten such stubs were
deleted this way 2026-09-22 and dropped from `RETIRED`. Keep the stub
instead of deleting when the slug is still referenced somewhere worth
keeping checkable — `transcribe-voice-memo` stays deployed for exactly that
reason (named in this repo's own history docs).

### Invoking a skill

Every `claude -p` call goes through `local-agent/skill-runner.mjs`, which
requires a tool profile in `skill-profiles.mjs` — invoking a skill without one
throws. Profiles are least-privilege: the text-only skills get `Read` and
nothing else.

Three things that are easy to get wrong, all verified 2026-09-14:

- `--strict-mcp-config` **does** exclude every MCP server not named in the
  passed config. This is what keeps Gmail, Drive, Supabase admin and the
  write-capable Zoho CRM connector out of a session reading an OCR'd card.
- `--allowedTools` does **not** restrict built-in tools under
  `--dangerously-skip-permissions`.
- `--disallowedTools` **does**. It is the actual control for built-ins, which
  is why `skill-profiles.mjs` computes a deny list rather than relying on the
  allow list.

Skills never hold credentials. A skill returns JSON; the calling program
(`agent.mjs` / `watch-cards.command`) performs any authenticated write.

### LLM output

Validated against a Zod schema in `local-agent/schemas.mjs` before anything is
persisted. A schema failure is a pipeline failure: the row stays pending for a
human, never half-written.

### Claim-based retry, not a time window

`claim_pending_contacts` (contact matching), `claim_unlinked_audio_messages`
(voice-memo attribution) and `reconcile_retryable_failed_inbound_messages`
(photo OCR / transcription) all share one shape: an atomic
`UPDATE ... WHERE status = 'pending' AND attempts < max AND (cooldown
elapsed) ... RETURNING *`, with the attempt count and cooldown timestamp
persisted on the row itself, not tracked in the calling process. Copy this
shape for any new retry loop rather than inventing a second one — two
concrete failures came from not doing so:

- Voice-memo linking used to gate retry on `received_at >= now() - 20min`
  instead of on the row's own state. That's wrong whenever the real blocker
  (the mentioned person's contact landing) takes longer than 20 minutes for
  any reason — a busy multi-card OCR pass, a rep re-texting a photo that
  failed OCR hours later, a directory-page batch processed after the event.
  A time window can never be sized correctly against a blocker with no bound
  of its own; only the row's real state can.
- Its cooldown lived in an in-memory `Map` (`lastRetryLinkAttemptAt` in
  `agent.mjs`, since removed), which a process restart silently wiped —
  invisible in code review, since nothing about the shape looks wrong until
  you ask "what survives a restart?"

The same audit (2026-09-22) also found photo OCR had **no** retry
mechanism at all — a transient failure (a Claude usage-limit blip, not a
bad photo) permanently stranded the row at `status='failed'` with nothing
ever looking at it again. `reconcile_retryable_failed_inbound_messages`
closes that gap by classifying failures into `error_class`
(`transient`/`terminal`) and only auto-resurrecting the former; a
`terminal` one waits for a human's explicit retry
(`inbound-messages-retry`), same pattern as `contacts-retry-match`.

See `20260922110000_voice_memo_link_state_and_ocr_retry.sql` and
`docs/ENGINEERING-LESSONS.md`'s entry on this incident for the full story,
including why the previous code's "attach to *something* rather than lose
the memo" fallbacks were worse than the problem they tried to solve.

### Human override for what the automated pass leaves alone

`claim_unlinked_audio_messages` retries a memo up to `LINK_MAX_ATTEMPTS`
times against whatever candidates exist *at attempt time* — it can never
close a memo out on its own, because "nobody yet" and "nobody ever" look
identical from inside the loop. Review's unresolved-intake panel
(`inbound-messages-unresolved-list`) surfaces exactly those two closing
moves to a human instead:

- `inbound-messages-assign` — attach the full transcript to a contact the
  reviewer picks by hand (candidates from `inbound-messages-link-candidates`,
  scoped to the same rep + event, but not restricted to
  `VOICE_CANDIDATE_SOURCES` the way the automated pass is — a human has
  already read the transcript and isn't guessing). Same idempotent
  append-to-`interaction_notes` shape as `attachExcerpts` in `agent.mjs`.
- `inbound-messages-delete` — discard a memo nobody will ever be able to
  place. Scoped server-side to `kind='audio' AND link_status IN
  ('unlinked','no_candidate_found')`, the same defense
  `contacts-bulk-delete` uses against a stale client selection: a memo the
  auto-linker just matched out from under the reviewer can never be
  deleted through this endpoint.
