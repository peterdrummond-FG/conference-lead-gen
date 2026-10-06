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
| `local-agent/` | Four poll loops. The only caller of `claude -p`. |
| `watcher/` | Local folder drop → `process-cards` → `contacts-from-ocr`. |
| `.claude/skills/` | The five skills. |
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

# Repo guards (both run in CI; also node scripts/check-no-auto-confirm.mjs)
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
  the `claim_*` RPCs exist rather than filtering client-side.
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
  activated active event" with no rep. The in-app Kiosk tab is exactly that
  call, and `events-active` showed the signed-in rep *their own* event while the
  insert went to a different one (a Region 4 rep's lead landed in MoASSP with
  `rep_id` null, invisible in their Review, 2026-09-29). Now a bare call is
  resolved from the caller's token (their `current_event_id`, credited if
  `sales`); an anonymous one has nothing to resolve from, so it is held in
  `unassigned_submissions` (reason `no_qr`) for Solutions Success rather than
  guessed at or lost. `events-active` returns null for an anonymous bare call.
  Anything that shows an event and anything that writes to one must resolve it
  the same way.

- **Seeing a conference is not being linked to it.** `events-active`'s
  no-linked-user fallback returns the most recently activated event for
  display, but a rep's QR resolves its conference from their own
  `current_event_id` and `contacts-create` holds a scan for Solutions Success
  (rather than filing it anywhere) when that's empty.
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

- **Review is one view, and its rules live in one file.** `/review` is
  `ReviewSmart.vue` (the old Classic view and its ⋮ switch were retired
  2026-10-01). Its readiness / flag / sort / search / grouping logic is
  `frontend/src/utils/reviewSmart.ts` with tests; "Ready to confirm"
  (`READY_LABEL`; one-tap ✓, "Confirm all N") means match finished, no possible
  duplicate, an email or phone, and a school or district. Change the rule there,
  not in a component. To review is newest-first and **must not sort on
  readiness** (it made a just-saved lead vanish to the bottom). Details:
  `docs/ARCHITECTURE.md`, "Review".

- **Nothing is ever auto-confirmed, and "Confirm" is only a word.** Reps always
  confirm a lead (Peter, 2026-10-06). `finalize_contact_match` used to set
  `review_status = 'approved'` on a high-confidence match, which sent a lead to
  Zoho with no person looking; it now always leaves the lead in `needs_review`,
  and the database refuses `auto_approved = true`. The only writers of
  `approved` are a person: a lead's Confirm and Undo/restore (`contacts-patch`) and
  "Confirm all N" (`contacts-bulk-approve`). `scripts/check-no-auto-confirm.mjs`
  fails CI if anything else writes it. The button says "Confirm", the tab
  "Confirmed", the shortcut is C; the stored status, API names and
  `contacts-bulk-approve` keep "approve" (`confirmWording.test.mjs` holds the
  words, not the identifiers).

- **Lead sources have plain names, and only some are stored.** Review's chips
  and Source filter say QR scan, QR Booth, QR Session, Kiosk, Form (legacy only),
  Card photo, List photo, Voice memo, SMS, Imported note. `contacts.intake_path`
  (`rep_qr`/`event_qr`/`kiosk`, set by `contacts-create` from the request, carried
  through `unassigned_submissions`) tells QR scan from Kiosk; SMS vs Imported note
  is read from `note_submissions` at list time. `qr_channel` is the attendee's own
  answer and is what Zoho's "Capture Channel" column exports, so don't reuse it for
  anything else. Old form leads stay "Form": there is nothing to backfill them from.

- **State / District / School is one component and the lists are loaded whole.**
  `InstitutionFields.vue` + `useInstitutionPicker.ts` are the only code that draws or
  loads them (attendee form, lead editor, merge dialog; `institutionFields.test.mjs` holds it).
  A state's districts, or a district's schools, are fetched once (`districts-list` /
  `schools-list` with `all=1`) and filtered on the device; "Use '<typed>'" is always last and
  commits on blur as well as Enter/Tab; School works with no district as typed text (research
  fills the district in). Clear downstream answers on the person's own change
  (`changeState`/`changeDistrict`), never in a watcher: a page re-points the whole model at
  another lead in one go and a watcher wipes what it just loaded. Only our tables are used
  (no NCES/Zoho import). A lead with a school and no district gets its district looked up by
  `research-contact` (`resolvedDistrict`), stored by `finalize_contact_match` only if the lead
  still has no district at write time and shown with its source; the "We'll look up the
  district for you" hint is a promise about that pipeline. Details: `docs/ARCHITECTURE.md`,
  "State, District and School".

- **The tab is called "Kiosk", the URL is still `/connect`.** Only the label in
  `MainLayout.vue` changed. `/connect/<repSlug>` is printed on slides and QR
  codes, so the route, its redirects and `generateConnectSlide.ts` keep the old
  name. Don't rename them to match the label.

- **`index.html`'s CSP is `img-src 'self' blob:` (no `data:`) and `connect-src
  'self' https://*.supabase.co`.** An `<img :src="canvas.toDataURL()">` is
  silently refused: the QR dialog shipped as an empty box with only its alt text
  (2026-10-01; it worked in dev because nothing enforced the policy). Use
  `canvas.toBlob` + `URL.createObjectURL` (revoke it), as `RepQrDialog.vue` does.
  A new external host or inline script needs the policy changed deliberately.

- **Lock kiosk lives on the Kiosk page, not in the header.** `LockKioskButton.vue`
  (button + the first-time Set PIN prompt) is rendered by `IntakePage.vue` only for
  signed-in staff on the bare `/connect` tab. The unlock dialog stays in
  `MainLayout.vue` because the header is hidden while locked.

- **The onboarding draws the app's own components, and its copy is a set of promises.**
  The splash, quick start, animated tour and one-hour reminder (`components/tour/`)
  render the same `AppHeader`, `ReviewHeader`, `NotesBody`, `ExportCard`, Admin cards,
  `IntakeFormFields`, `RepQrContent` and `UnassignedScansList` the pages render, with
  sample data. A page change shows up in the tour for free; do **not** paste markup
  into a tour screen (a test fails), and don't put `data-tour`/`data-tt` hooks in an app
  component (scripts find things by their own labels). The words are promises about the
  pipeline: a first-time rep isn't linked yet, so the tour shows the real from-scratch
  SETUP conversation (checked against `twilio-webhook`'s source), a lead that just
  arrived is *processing*, not Ready, and "Ready to confirm" / notes-reach-Zoho /
  scans-wait-for-Solutions-Success must stay true. If you change Smart's Ready rule,
  Setup's flow, the SETUP replies, the intake form or what `export-csv` emits, update
  `components/tour/tourCopy.ts` / `tourText.ts` too; the tests catch the replies, form
  labels, number and banned words, not the prose. What an account has seen is
  `me.onboarding` (`profiles.onboarding_*`, written only by
  `profiles-complete-onboarding`): the ? button replays the whole tour and **never**
  touches `seen`; the reminder is once, an hour later, and plays only what is left. The
  tour never gets its own "text now" button: Setup's phone card and the quick start share
  `TextSetupAction`, so the opt-in disclosure lives in one place. Details:
  `docs/ARCHITECTURE.md`, "Onboarding".

- **Setup is two sections, and its QR line is a claim about the server.**
  "You send leads in" (conference, phone) and "Other people add themselves" (QR,
  Kiosk), each one card; side by side on a laptop, stacked on a phone, with each
  device keeping only the controls that work on it (Text SETUP button on a phone, a
  QR to scan on a laptop; "Save QR" vs "Download QR"). The conference and phone rows
  are numbered circles that turn into green checks; the second section has no
  numbers. There is no "You're ready to capture leads" card (the Connected badge says
  it). "Choose"/"Change" both open the one conference
  dialog (no inline list, no separate Start button), and the QR line names the
  conference scans go to or says they wait for Solutions Success when none is
  chosen, because `contacts-create` holds a scan from a rep with no
  `current_event_id` in the needs-a-conference queue (it neither uses the
  previous conference nor drops the lead; it used to answer 409 and the lead was
  lost. The meeting that specified this page wasn't sure what it did, and reading
  the function settled it). Dates come from the
  `event_dates()` SQL function through `events-list-active`, never a second
  parser in TypeScript. Keep the page's prose to a line or two; the explanation is
  the tour. Details: `docs/ARCHITECTURE.md`, "Setup and Admin".

- **One conference everywhere: a rep has two pointers and one writer.**
  `profiles.current_event_id` (the app, QR scans, Review) and
  `phone_event_bindings.event_id` (where texted photos, voice memos and notes are
  filed) were written by different code and drifted: reps linked only by text had
  a bound phone and no app conference, so their QR scans were rejected, and a
  manager moving a rep in the app left their texted cards landing in the old
  conference (live 2026-10-05). `profile_set_current_event` and
  `profile_link_event_by_phone` are now the only writers of `current_event_id`;
  `scripts/check-conference-writers.mjs` fails CI if an Edge Function writes it
  directly. A binding is **moved, never created** by an app-side change: a binding
  is what lets `session-notifications` text a number, so creating one for a phone
  that never texted SETUP would message someone who didn't consent (the A2P
  campaign was rejected four times over consent). Clearing a conference **deletes**
  the binding (that only stops texts). A binding outlives its conference
  (`events_complete()` doesn't touch it), so `twilio-webhook` re-checks
  `events.is_active` before filing a photo, memo or note, and a folder code only
  binds an active event.

- **Scans that can't be placed are held, not rejected.** `contacts-create` used
  to answer 404/409 and keep nothing when a valid attendee couldn't be placed (a
  rep with no conference, a deleted rep, a QR for an ended conference, no QR, a
  Kiosk tab with no conference), so the person's details were lost.
  `contacts.event_id` stays NOT NULL (it runs through Review, duplicates,
  matching and export), so those submissions wait in `unassigned_submissions`
  (`_shared/intakeDestination.ts` decides; reasons `rep_no_conference`,
  `rep_not_found`, `event_ended`, `event_unknown`, `no_qr`,
  `caller_no_conference`) and the attendee sees the normal thanks. Nothing
  expensive runs until a person files the scan (no contact row, so no matching,
  no AI, no n8n trigger), which is what keeps a public request from starting
  costly work. Bounded: the per-network rate limit still runs first, then
  300/network/24h and 3000 pending overall (both fail closed with the 429
  wording), and a daily pg_cron job deletes rows after 90 days. Filing is one
  locked transaction (`assign_unassigned_submission`), staff-only. The rep is
  credited only when we really know them, never from a client-supplied id.

- **The conference code never reaches the browser, and SMS offers SETUP only.**
  `events.folder_code` is the SMS bind token, so `events-active` and
  `events-activate` don't return it (Admin's "Show conference code" is gone). It
  stays in the database for the photo pipeline and the webhook's active-only
  bind, and the replies to an unlinked phone say to text SETUP, not a code.

## Before shipping a feature

**Read `docs/ENGINEERING-LESSONS.md` first.** It generalises every bug the
September 2026 audit found into the shape to avoid reproducing. The short
version:

- **Backport the lesson, not just the fix.** Four separate findings shared one
  cause: a good principle applied only to that day's code. Grep for every other
  place it applies, in the same change.
- **Fix the class, not the instance.** A fabricated CRM id led to a regex on
  two fields; fourteen others stayed unvalidated, including the one that
  then auto-approved a lead for export (auto-approval is gone, see below).
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
