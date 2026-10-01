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
| `.claude/skills/` | The six skills. |
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
# consumer must be redeployed to pick it up. The script reads the token from
# $SUPABASE_ACCESS_TOKEN or, on macOS, the Keychain item of that name (save it
# once: security add-generic-password -a "$USER" -s SUPABASE_ACCESS_TOKEN -w).
node scripts/deploy-functions.mjs              # all
node scripts/deploy-functions.mjs export-csv   # some
node scripts/deploy-functions.mjs --dry-run    # plan, no token needed

# Repo guards (both run in CI)
node scripts/check-skill-profiles.mjs
bash scripts/check-deployed-functions.sh

# Tests
cd local-agent && npm test
cd frontend && npm run typecheck
cd frontend && npm test              # Review Smart-view logic (utils/reviewSmart)

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
- **An event's `is_active` flag can now go back to `false`.** `events_complete()`
  (added alongside `events-complete`) ends a conference for everyone — it clears
  `current_event_id` on every linked profile, but a public per-event QR link
  (`contacts-create`'s `eventSlug` path) resolves the event by slug alone.
  Found while adding this: that path had **no `is_active` check at all**, so a
  printed QR for a completed conference would have kept accepting Intake
  submissions indefinitely. Any new place that resolves an event from
  client-supplied data (a slug, a rep's reusable QR, anything not already
  scoped to the caller's own `current_event_id`) needs the same check —
  `events-active`'s own fallback branch already had it; `contacts-create`'s
  `eventSlug` branch didn't.

- **A bare call must not guess the conference.** `contacts-create` used to
  file a submission with no `repSlug`/`eventSlug` under "the most recently
  activated active event" with no rep. The in-app Connect tab is exactly that
  call, and `events-active` showed the signed-in rep *their own* event while the
  insert went to a different one (a Region 4 rep's lead landed in MoASSP with
  `rep_id` null, invisible in their Review, 2026-09-29). Now a bare call is
  resolved from the caller's token (their `current_event_id`, credited if
  `sales`) and an anonymous one is rejected with 409; `events-active` returns
  null for an anonymous bare call. Anything that shows an event and anything
  that writes to one must resolve it the same way.

- **Seeing a conference is not being linked to it.** `events-active`'s
  no-linked-user fallback returns the most recently activated event for
  display, but a rep's QR resolves its conference from their own
  `current_event_id` and `contacts-create` rejects a scan when that's empty.
  UI that says "you're at X" must key off the session's `currentEventId`
  (Setup's `joinedEvent`), never `eventStore.activeEvent`.

- **In a Postgres regex, `\b` is a backspace, not a word boundary — use `\y`.**
  `conference_end_date_from_name` shipped with `\b` and silently parsed *zero*
  of 441 real multi-day names (every range fell back to its start date). Found
  only by running the function over the whole `campaigns` table and counting
  parsed ranges — reading the SQL looked fine. Validate a parser against the
  real data, not a sample, and count the successes.

- **A UI promise has to be true in the pipeline behind it.** Review's Notes
  tooltip says notes are "included in the Zoho import". When it was written,
  `export-csv` built the Description column from `contacts.notes` (the AI match
  reasoning) and never read `interaction_notes`, so a rep's notes never reached
  Zoho. Found by reading the export before writing the tooltip. If you change
  what `export-csv` emits, update Review's tooltips (`ReviewLeadEditor.vue`,
  `AddNoteDialog.vue`, `ReviewLeadRow.vue`) too — and redeploy `export-csv`.

- **Review has two views, and Smart's rules live in one file.** `/review`
  switches between Classic (`ReviewClassic.vue`, deliberately left as it was)
  and Smart (`ReviewSmart.vue`). Smart's readiness / flag / sort / search /
  grouping logic is `frontend/src/utils/reviewSmart.ts` with tests; "Ready to approve"
  (`READY_LABEL`; one-tap ✓, "Approve all N") means match finished, no possible
  duplicate, an email or phone, and a school or district. Change the rule there,
  not in a component. Details: `docs/ARCHITECTURE.md`, "Review's two views".

- **The welcome tour's copy is a set of promises.** Its Review step says a green
  "Ready to approve" lead approves in one tap and that notes reach Zoho; its "Set up your
  phone" steps show the text reply `twilio-webhook` sends and the number from
  `utils/smsNumber.ts`; its Setup steps point at the conference card
  (`data-tour="setup-conference"`), the phone card (`setup-text-in`) and the QR
  card (`setup-qr`, on both the rep's and the managers' version) by name
  and button label ("Text the code SETUP"). If you change Smart's Ready rule, Setup's flow, the SETUP reply, the
  attendee form's labels or what `export-csv` emits, update
  `frontend/src/utils/onboardingTour.ts` too. Its tests catch the Ready rule, the
  form labels, the reply wording and the shared number, but not the prose.
  Spotlights may only point at things a brand-new account sees (short allow-list
  in the test); anything state-dependent is an illustrated card. The tour never
  gets its own "text now" button: the opt-in disclosure lives once, on Setup,
  under the real one. Details: `docs/ARCHITECTURE.md`, "Welcome tour".

- **Setup is a card per step, and its QR line is a claim about the server.**
  Conference, phone and kiosk are numbered cards that turn into green checks; the
  QR is an unnumbered resource. "Choose"/"Change" both open the one conference
  dialog (no inline list, no separate Start button), and the QR line names the
  conference scans go to or says they won't go through when none is chosen,
  because `contacts-create` answers 409 for a rep with no `current_event_id` (it
  does not use the previous conference; the meeting that specified this page
  wasn't sure, and reading the function settled it). Dates come from the
  `event_dates()` SQL function through `events-list-active`, never a second
  parser in TypeScript. Keep the page's prose to a line or two; the explanation is
  the tour. Details: `docs/ARCHITECTURE.md`, "Setup and Admin".

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
