# CKH Connect — working notes for Claude Code

Conference lead capture for The Flippen Group. Four intake paths feed one
Supabase database; contacts are researched and matched against Zoho CRM by
skills run through a local `claude -p` agent, reviewed by a human, then
exported as CSV for Zoho import.

Read `docs/ARCHITECTURE.md` for the component map and
`MASS_Alliance_Pilot_App_Architecture.md` for the full design rationale.

## Layout

| Path | What it is |
|---|---|
| `frontend/` | Quasar/Vue SPA on Vercel. Talks only to Edge Functions. |
| `supabase/functions/` | The only server-side API. One function per route. |
| `supabase/migrations/` | Schema + stored functions. **Append-only.** |
| `local-agent/` | Five poll loops. The only caller of `claude -p`. |
| `watcher/` | Local folder drop → `process-cards` → `contacts-from-ocr`. |
| `.claude/skills/` | The seven skills. |
| `mcp/` | MCP configs for headless skill runs. |
| `scripts/` | Repo guards and the deploy script. |

## Rules that are load-bearing

These encode incidents, not preferences. Breaking them is how this project has
actually gone wrong before.

### 1. Never invoke a skill unsandboxed

Every `claude -p` call goes through `local-agent/skill-runner.mjs`, which
requires a tool profile in `skill-profiles.mjs`. Adding a skill without one
throws at invocation time, and `scripts/check-skill-profiles.mjs` fails CI.

Skills ingest content supplied by anyone who texts the Twilio number or fills
in the public form — OCR'd cards, Whisper transcripts, pasted notes. Without
scoping, those sessions inherit the operator's **entire account-level MCP
fleet**: Gmail, Drive, Supabase project admin, a write-capable Zoho CRM.

Three facts, each verified by probing rather than assumed:

- `--strict-mcp-config` **does** exclude every MCP server not named in the
  passed config.
- `--allowedTools` does **not** restrict built-in tools under
  `--dangerously-skip-permissions`. A session allowed only `Read` still had
  Bash, Write, Edit, Agent and Workflow.
- `--disallowedTools` **does**. It is the real control for built-ins, which is
  why profiles compute a deny list rather than trusting the allow list.

`skillEnv()` must keep passing `USER` — without it the CLI can't reach its
Keychain credentials and every run fails "Not logged in".

### 2. Skills never hold credentials

A skill returns JSON; the **caller** (`agent.mjs` / `watch-cards.command`)
performs any authenticated write. `process-cards` used to be handed
`$SUPABASE_SERVICE_ROLE_KEY` and told to `curl` with it — an RLS-bypassing
credential inside a session whose entire job is reading an attacker-supplied
photo. Don't reintroduce that shape anywhere.

The agent runs from `AGENT_WORKDIR` (`~/.conference-lead-gen-agent`), which
holds only a `.claude/skills` symlink — never the repo root, which has `.env`.

### 3. Model output is untrusted until validated

`local-agent/schemas.mjs` validates every skill's output before anything is
persisted. A validation failure is a pipeline failure: the row stays pending
for a human, never half-written.

This exists because it already happened — a run whose prose concluded no
account existed emitted structured fields claiming a "high confidence" match
against a fabricated Zoho id. Validate the whole contract, not the field that
broke last time.

### 4. Retiring an Edge Function is a two-step operation

Deleting `supabase/functions/<name>/` does **not** undeploy it. In the same
change:

1. deploy a 410 stub in its place (see `districts-create` for the shape), and
2. add the slug to `RETIRED` in `scripts/check-deployed-functions.sh`.

Two public unauthenticated INSERT endpoints stayed live for three months
because nobody compared the deployed list to the repo. The guard now probes
every RETIRED name to confirm it really answers 410.

### 5. Preserve `verify_jwt` per function

`twilio-webhook` and `session-notifications` are deployed with
`verify_jwt: false` and authenticate themselves (an `X-Twilio-Signature` and a
vault-stored cron secret). Flipping them to `true` breaks both silently —
`scripts/deploy-functions.mjs` encodes this in `NO_JWT`.

### 6. Migrations are append-only

Never edit an applied migration. Where an old one's comment describes
something since replaced, note it in `supabase/migrations/README.md`.

## Common tasks

```bash
# Deploy Edge Functions (needs a Management API token, sbp_ + 40 hex).
# Required after ANY change under supabase/functions/_shared/ — every
# consumer must be redeployed to pick it up.
export SUPABASE_ACCESS_TOKEN=sbp_...
node scripts/deploy-functions.mjs              # all
node scripts/deploy-functions.mjs export-csv   # some
node scripts/deploy-functions.mjs --dry-run    # plan, no token needed

# Repo guards (both run in CI)
node scripts/check-skill-profiles.mjs
bash scripts/check-deployed-functions.sh

# Tests
cd local-agent && npm test
cd frontend && npm run typecheck

# Retention purge (audit S12)
cd local-agent && node --env-file=.env purge-expired-media.mjs --dry-run
```

Migrations are applied through the **Supabase MCP tools**, not `supabase db
push` — that would replay ~30 migrations against production. There is no
Supabase CLI on this machine.

## Gotchas found the hard way

- **PostgREST can't express a column-to-column comparison.** That's why
  `claim_contacts_needing_intent()` exists rather than filtering client-side.
- **PostgREST can't disambiguate a self-referencing FK's direction** from a
  column-name embed hint — `contacts!local_duplicate_of_contact_id(...)`
  silently resolves backwards. Use a follow-up query (`attachDuplicateNames`).
- **CTEs in one statement share a snapshot.** A test that inserts in one CTE
  and reads in another will "fail" misleadingly — use separate statements.
- **Generated columns must be immutable.** `timestamptz + interval` is not
  (it depends on TimeZone), which is why the retention window is a function
  parameter, not a generated column.
- **Supabase's new API key format** (`sb_publishable_…`/`sb_secret_…`) is a
  different value from the legacy JWT `service_role` key the dashboard also
  shows. Edge Functions, `local-agent/.env` and `watcher/.env` need the one
  that matches what's deployed, or auth silently 401s.
- **The Management API token** (`sbp_…`) is none of the above.

## Before shipping a feature

**Read `docs/ENGINEERING-LESSONS.md` first.** It generalises every bug the
September 2026 audit found into the shape to avoid reproducing. The short
version:

- **Backport the lesson, not just the fix.** Four separate findings shared one
  cause: a good principle applied only to that day's code. Grep for every other
  place it applies, in the same change.
- **Fix the class, not the instance.** A fabricated CRM id led to a regex on
  two fields; fourteen others stayed unvalidated, including the one that
  auto-approves a lead for export.
- **Prose is not a control.** If a doc states a guarantee, something in the
  runtime must enforce it. "X is reachable but don't use X" is a finding.
- **Verify the running system, not the artifact.** Deleting source is not
  undeploying. Probe the endpoint.
- **Don't trust a flag because of its name.** `--allowedTools` does not do what
  it sounds like. Probe once, record the result in a comment.
- **Re-validate at every trust boundary**, especially across systems
  (webhook → DB → process → prompt).
- **A convenience default is a decision.** Fail closed and loud, never fall
  back to the riskiest working value.
- **Don't mark work done before it's delivered.** Reserve → work → confirm.
- **Copy the concurrency pattern already here**: claim before slow work,
  re-assert the precondition, reconcile after a crash.
- **Bound everything** — batch, concurrency, field length, rate, retention.
  Watch for amplification: one cheap public request triggering expensive work.
- **Use equality when you mean equality.** `ILIKE` against raw input treats
  `%` as a wildcard.
- **Verify the happy path after hardening**, not just that the attack is
  blocked. Restricting the subprocess env once broke CLI auth outright.

The checklist at the end of that doc is the thing to actually run through.

## Style

Comments in this codebase explain *why*, and usually name the failure that
motivated the code. That's an asset — match it. When you fix something,
record what broke, not just what the code now does.

Git: push to **both** remotes, `github` and `origin` (GitLab).
