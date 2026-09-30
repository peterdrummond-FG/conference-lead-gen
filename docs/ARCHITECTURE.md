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
| `.claude/skills/` | The six skills. |
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

### Ending an event

`events.is_active` used to be write-once-true: nothing ever set it back to
`false`, because nothing needed to until `events-complete` (2026-09-28) added
a way for admin/Solutions Success to mark a conference over. `events_complete()`
flips `is_active` off and clears `current_event_id` on every profile still
linked to that event, in one transaction — mirroring `events_activate()`'s own
shape (see `20260917100000_event_reps_and_activation_guard.sql`).

An event that can now be inactive again means **every place that resolves an
event from something a client supplied** has to actually check `is_active`,
not just the ones written after this existed. `contacts-create`'s `eventSlug`
branch (a public per-event QR link) didn't — found while adding this feature,
fixed in the same change. `events-active`'s own fallback branch already had
the check; it just hadn't been true everywhere. Grep for `.eq("slug",` /
`.eq("event_id",` on a client-supplied value before adding a new one.

### Which conference a Connect submission lands in

`contacts-create` resolves the event and the credited rep from, in order:
`repSlug` (a rep's reusable QR: their linked event, rep credited), `eventSlug`
(+ optional `repId`, revalidated against `event_reps`; event must be active),
then — for a bare call — the **signed-in caller** (the in-app Connect tab: their
`current_event_id`, credited if `sales`). A bare call with no valid session is a
409, never "the latest-activated event". Old `/booth` and `/session` slides land
here, so they now show "Scan the conference QR code again" until reprinted.
`IntakePage` mirrors this: signed in with no linked event shows "Join a
conference first" rather than the fallback event `events-active` returns for
display.

### Setup and Admin

`/setup` (any role) is the guided rep flow; `/admin` (`admin` /
`solutionsSuccess`) is where conferences and people are managed. Two things to
preserve:

- **"Joined" is `sessionStore.user.currentEventId`, not `eventStore.activeEvent`.**
  `events-active` falls back to the most recent event for display when nothing
  is linked, so the two differ exactly when a rep is about to have a broken QR.
  Joining is a write (`profiles-set-current-event`); it is never inferred.
- **Placing a rep at a conference has one control per audience** — Setup's
  Join/Switch for yourself, Admin → Team's "Working at" for someone else. Both
  end in the same field; don't add a third surface.

Only Sales accounts have a QR (`rep_slug`); admin and Solutions Success are who
send each rep theirs, so Setup lists the Sales reps with a Download each for
them and Admin → Team has a control per rep. All of these use
`components/QrSaveButtons.vue`, which offers two artworks — the 16:9 slide and
a 9:16 phone-screen code a rep holds up to be scanned — through
`downloadRepConnectSlide` in `utils/generateConnectSlide.ts`. On a phone they
open the share sheet (Save Image → Photos; see `utils/saveImage.ts`). Add new
callers there rather than re-assembling the URL. The QR (per rep) and
kiosk PIN (per login) are deliberately available before
joining anything; only the SMS *status* is per conference. The text-in card's
phone steps and its opt-in disclosure are likewise never gated on joining:
texting `SETUP` is self-contained (`twilio-webhook` finds or starts the
conference by name and binds the phone itself), so a rep may never touch this
page. A rep who *has* joined one in the app is not asked: `SETUP` matches their
`profiles.phone_number`, and if `current_event_id` is a still-active event it
binds the phone to it and replies "already set up — reply CHANGE" (CHANGE, from a
bound phone, restarts the name search). Only `SETUP` does this; a folder code is
never resolved through the profile. The disclosure ("By texting this code, …") is a single copy, always
visible directly under the action that gives consent — keep it there, and not
inside the collapsible steps.

Setup is kept short on a phone on purpose (it was three screens): a joined
conference is one compact card, the descriptive copy is a sentence or two, "How
it works" is collapsed until the rep opens it, and a "You're ready to capture
leads" card at the end points to Review and the sign-up form. Don't grow the
prose back; put detail in "How it works".

### Welcome tour

A new staff account sees a three-screen welcome, then a walkthrough (Setup,
setting up their phone, what attendees see, Review, and Export / Admin for admin
and Solutions Success). The wording, step list and per-role filtering are plain
data in `frontend/src/utils/onboardingTour.ts`; `stores/tour-store.ts` tracks
where someone is, and `components/onboarding/` draws it. Things to preserve:

- **A step is a spotlight or an illustration, and the difference is
  reliability.** A `spotlight` step points at a real element that is always on
  its page for a brand-new account (a nav tab, a header button, a Setup card). An
  `illustrated` step draws its own picture (`components/onboarding/mocks/`), so it
  can't depend on the page behind it or on any data. The first version broke
  both ways: the Connect step pointed at the attendee form, which only renders
  once a conference is joined (a new user saw "Join a conference first" inside
  the highlight), and the sample lead was injected into Review's list, which
  pushed the list down and left the highlight behind. Anything that needs a
  mock-up is illustrated; the test keeps an explicit short list of allowed
  spotlight targets.
- **The highlight follows its target every frame.** `useTourTarget` reads the
  element's position on each animation frame (and every 50 ms as a fallback, for
  browsers that throttle frames), waits for fonts and for the element to hold
  still before showing the card, and clamps the window to the screen. Measuring
  once was the bug: the header's icon buttons change width when the icon font
  loads, so the highlight sat a button to the left of what it described.
- **"Seen it" is the account's, not the device's.** `profiles.onboarded_at`,
  returned by `me` as `onboarded` and written by `profiles-complete-onboarding`
  (own row only, idempotent). The migration backfilled every account that
  existed, so only accounts created afterwards start it. The tour starts only on
  an explicit `onboarded === false`, and `me` answers `true` if its lookup
  errors: a hiccup must never show it to someone who finished.
- **The sample lead is a picture, never data.** `SAMPLE_LEAD` is drawn inside the
  illustrated card and is on no Review page, list, count, filter or bulk
  selection, because "Approve N ready" acts on lead ids and this one doesn't
  exist. A test checks it really is Ready under `reviewSmart.isReady`.
- **The pictures quote the real thing, and tests hold them to it.** The form
  mock's labels must appear in `IntakePage.vue`; the text-message reply must
  appear in `twilio-webhook`; the number comes from `utils/smsNumber.ts`, which
  Setup uses too.
- **The tour never offers its own "text now" button.** Texting SETUP is consent,
  and the opt-in disclosure lives once, on Setup, directly under the real button.
  The "Try it now" step spotlights that real button and disclosure instead. A
  test fails if the disclosure wording or an `sms:` link appears in the tour.
- **A missing target is a plain card, not a stuck tour.** If a spotlight target
  never appears (Review's Classic view has none of Smart's markers), the card is
  centred and says so.
- **The wording is for a rep at a booth.** A test fails if technical vocabulary
  (`BANNED_WORDS`) appears in anything the tour shows.
- **Never for attendees or a locked kiosk, and never outlives its user.** The
  splash and overlay only mount for a signed-in user on an unlocked device, and
  never start while an admin is previewing someone else ("View as").
  `tourStartAction` (in `onboardingTour.ts`, tested) decides start / reset /
  leave-alone; "no user" resets, because a 401 signs the person out
  (`boot/axios.ts`) without going through Log out, and their tour would
  otherwise be resumed by whoever signs in next on that tab.
- **The copy makes promises about Setup and Review.** If Smart's Ready rule,
  Setup's flow or the text-in replies change, update `onboardingTour.ts` in the
  same change.

### Connect (the attendee form)

`/connect` (formerly `/intake`; the old path redirects) is the public form an
attendee fills in on their own phone or at a booth device. Two rules:

- **Autofill is on only for an attendee's own phone.** `IntakePage.vue` sets
  `autocomplete` tokens (`given-name`, `email`, `tel`, ...) when no staff member
  is signed in on the device and the kiosk isn't locked, and `autocomplete="off"`
  otherwise — a shared booth device's browser would otherwise offer its owner's
  saved name, email and phone to every attendee who taps a field.
- **Everything is open from the start; the first block folds once it's done.** The
  name / email / phone block collapses to a one-line summary (name plus contact,
  with Edit) when the attendee moves into a field *outside* it and has a name plus
  a valid-looking email or a phone. It folds on focus **entering** another field,
  not on leaving the block (someone who dismisses the keyboard first would
  otherwise never fold), and never while they type in it. The fields stay mounted
  (`v-show`), so values and validation are untouched; Edit reopens them. State is
  deliberately **not** prefilled from the conference: it is visible from the
  start, so a prefill would be sent even if the attendee never looked at it.
- "How did you hear about us?" is hidden when the QR already sets the channel
  (`?channel=booth|session`); the channel is still sent with the submission.
- Phone is `type="tel"` with `inputmode="tel"` (number pad); the "email or phone,
  one is enough" rule is stated under the fields, not only as an error after
  Submit. Field labels and edges use the darker greys (`#5f6368` / `#8b95a1`);
  the old `#9a9a9a` / `#d8d8d8` were about 2.7:1 and 1.4:1.

### Password reset

Sign-in is Supabase Auth from the browser (`lib/supabase.ts`). "Forgot password?"
on `/login` calls `resetPasswordForEmail` with `redirectTo` =
`<origin>/reset-password`; that page (`ResetPasswordPage.vue`, public) reads the
recovery session the emailed link creates and calls `supabase.auth.updateUser`
to set the new password. It was broken until 2026-09-29: the request had no
`redirectTo`, the link dropped people on the site root, and nothing anywhere
let them choose a password (they were merely signed in by the recovery session
with the password they'd forgotten). The request's response was also ignored, so
a failure still said "Check your email".

Two things live outside the repo and must be right in the Supabase dashboard
(Authentication → URL Configuration), because `supabase/config.toml` is local dev
only: **Site URL** must be the deployed app's URL, and
`https://<app>/reset-password` must be in **Redirect URLs**. If it isn't, Supabase
ignores `redirectTo` and sends the link to the Site URL, and the reset silently
lands on the wrong page. The link works once and expires; the page says so and
points back to sign-in. There is no admin-side "reset this person's password"
(Admin only edits name and phone).

### Exporting

Export is two-phase (audit Q2): `export-csv` **reserves** the exportable leads
and returns the file with an `X-Export-Batch-Id`; `export-confirm` stamps
`synced_at` only when told the file arrived; `export_release_stale` gives back
any batch left unconfirmed for 30 minutes. `ExportPage.vue` used to confirm the
instant it clicked the download link, which proves nothing (a blocked or dropped
download marked every lead synced and lost them). It now holds the generated
file, asks "Did the file download?", and only calls `export-confirm` when the
person says yes. **Download again** re-saves the held file without touching the
server — needed because a fresh export inside the 30-minute window would find
the reserved leads unavailable. Leave the page without confirming and the batch
simply releases itself. The summary card's "Still needs review" count links to
Review, since those are the leads that won't be in the file.

The Description column leads with the rep's notes (`Notes: …`); see "Review's
two views".

### Starting a conference

Any role may start one (`events-activate`, with `campaigns-list` behind the
search): a rep at a booth is often the first person to know a conference hasn't
been started, and could already do it by texting `SETUP`. Because the caller is
no longer necessarily staff, `events-activate` **never trusts the request's
`name`** — it reads the name from the `campaigns` cache by `zohoCampaignId` and
rejects an id that isn't there. Keep it that way: the name becomes the Zoho Lead
Source. Ending stays admin/Solutions Success. Both Setup and Admin open the same
`StartConferenceDialog`.

The search behind it is `campaigns-list` → the `conference_search()` database
function, not a plain `select` on `campaigns`. Conference names start
`YYYY MM.DD[-DD] (ST)`, so sorting by name puts December ahead of this week's
conference; `conference_search` instead lists conferences that **haven't ended**
(window on the parsed *end* date, plus one day's grace) nearest first when the
query is blank, and matches substring-or-fuzzy otherwise, ranking unfinished
conferences first. Each row carries `liveEventId` (already running → the client
offers **Join**, never a second `events_activate`) and a `state` read from the
name's `(ST)` code, which the client prefills and asks for only when it's absent
or not a real postal code (e.g. `(TW)`). The name shown in the list is tidied
(`utils/conferenceName.ts`); the confirm step always shows the full exact name
because that is the Lead Source.

On a phone the dialog is one full-screen sheet with a plain scrolling list and a
native `<select>` for the state. Don't reintroduce a `q-select` (with
`use-input`) inside it: on a phone Quasar renders each as its own full-screen
popup over the dialog.

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

### Voice-memo fallback contact creation

"Nobody yet" and "nobody ever" aren't the only two outcomes — a memo can
also describe someone thoroughly enough (a name plus a title, school, or
district) that no card or roster photo is needed to place them at all. At
`link_attempts = LINK_FALLBACK_ATTEMPT` (5, well below `LINK_MAX_ATTEMPTS`'s
20), `linkTranscriptToContacts` asks `attribute-voice-memo` to additionally
judge this — via an `extractFallbackContact` input flag and an
`extractedContact` output field, both optional and ignored on every other
attempt (`.claude/skills/attribute-voice-memo/SKILL.md`, validated by
`local-agent/schemas.mjs`'s `AttributionOutput`). A qualifying transcript is
POSTed to a new Edge Function, `contacts-from-voice-memo` (sibling of
`contacts-from-note`, keyed on the inbound message id instead of a note
submission, deduped by a partial unique index on `(source_message_id, lower(first_name),
lower(last_name)) WHERE source = 'voice_memo'` — was `(source_message_id)` alone until
2026-09-29), which inserts a `source='voice_memo'` contact —
`match_status='pending'`, so it flows into `research-contact`/`match-contact`
through the ordinary pending-contact loop with no special-casing needed.

**People a memo names who matched nobody.** The paragraph above covers a memo
that placed no one. The other case was found 2026-09-29: a memo naming four
people, two with cards and two without, attached to the two and was marked
`linked`, and the other two vanished — attribution only ever sorted a memo
among contacts that already existed, and a `linked` memo is never revisited.
Now, when at least one candidate gets an excerpt, `attribute-voice-memo` also
returns `unplacedContacts` (SKILL.md Step 8) — but only for a person the rep
**spoke with and said something about**. A name merely mentioned in relation to
a lead ("he knows Kaitlyn, she's the superintendent at Maple Ridge") is not a
new lead: that whole sentence stays in the lead's own excerpt, and anything the
model can't classify is treated the same way (a missed contact is added by hand
in seconds; a stray one has to be found and rejected). The schema makes the
model assert `spokeWithRep` and `detailsStated` (both `literal(true)`) and
supply a non-empty verbatim span; that forces the claim but cannot verify it,
so the judgment itself lives in the prompt. `linkTranscriptToContacts` creates
each through the same `contacts-from-voice-memo` function, gated on a candidate
really having been attached (in code), capped at `MAX_UNPLACED_PER_MEMO` (10),
re-checked against the candidate list so the model can't mint a second Tyler,
and skipped-and-logged per person on failure. That function's dedupe key became
memo + name (`20260929180000_voice_memo_multi_contact.sql`), since one memo can
now create several. The memo stays `linked`, with the new contacts' ids added to
`matched_contact_ids`. The n8n `pipeline-voice-transcription` does **not** handle
`unplacedContacts` yet — port it before that pipeline is cut over.

`inbound_messages.link_status` gained a fourth value, `contact_created`,
distinct from `linked` (attached to an *existing* candidate) — deliberately
left out of `inbound-messages-unresolved-list`'s and `inbound-messages-delete`'s
`link_status IN (...)` allowlists above, since a `contact_created` memo
already has a real contact record backing it and surfaces through Review the
same way any other new contact does. See
`20260928120000_voice_memo_fallback_contact_creation.sql` for the schema
change and `local-agent/agent.mjs`'s `linkTranscriptToContacts` for the full
decision logic. Mirrored (but unverified — the pipeline isn't live yet) in
`n8n/pipelines/pipeline-voice-transcription.ts` and
`n8n/schemas/attribution.schema.json`.

### Follow-up tracking

`contacts.followed_up` (`20260928130000_add_contact_followed_up.sql`) is a
plain reviewer-set boolean, unrelated to `review_status` and never touched by
any skill or auto-classification — a rep toggles it directly via
`contacts-patch`, and it saves as they tap. In Classic that's on the card
(collapsed or expanded, any tab); in Smart it's on every To review and Approved
row and beside Heat in the editor header (see "Review's two views" below). The
Approved tab's follow-up filter is the only place it drives behavior beyond
display — Classic's "Follow-up status" dropdown, Smart's All / To follow up /
Followed up toggle plus a default "Follow up first" sort — and it's a
client-side filter over the already-loaded list (same mechanism as the
conference filter), not a server query param. `export-csv` carries it through
as its own `Follow Up Done` column —
no Zoho field is mapped to it yet, so it rides along unmapped until Sales
picks one.

### Review's two views (Smart and Classic)

`/review` renders one of two views, chosen from the ⋮ menu in the page header
and remembered per browser (`localStorage`, default **Smart**):

- **Classic** (`ReviewClassic.vue` + `ReviewContactCard.vue`) — the original
  masonry card grid, unchanged apart from carrying the menu.
- **Smart** (`ReviewSmart.vue`, `components/smart/`) — a list of compact rows
  with a plain-language flag for why a lead needs a look (or a green Ready),
  live tab counts, search and sort, one-tap Approve / Reject with a 6-second
  Undo, "Approve N ready", tap-to-call / tap-to-email, and Followed up, Add
  note and (on Approved) Heat straight from the row. On a desktop (≥1024px)
  the list sits beside a sticky editor pane (J / K move, A approves, R
  rejects); below that the same editor is a bottom sheet. Leaving a lead with
  unsaved edits asks first.

Rules worth knowing before changing Smart:

- **Ready** (`utils/reviewSmart.ts`, `isReady`) means: match finished, no
  possible duplicate, has an email or phone, and has a school or district.
  Bulk approve only ever sends ready ids; the server still skips any pending
  ones and the response is read and reported.
- Smart loads all three statuses at once (six requests for a rep: current and
  past scope) so tab counts are live and approve/reject/undo move a lead
  between tabs locally. No backend change was needed.
- A rep sees their current event first, then past events as collapsible
  sections ordered by each event's most recent lead. `contacts-list` carries
  no event date, so that proxy is computed over every status, not the visible
  tab, to keep the order stable when switching tabs.
- Empty states are deliberate: "You're all caught up" only when To review is
  empty and the rep has other leads; a rep with no leads at all is told to join
  a conference (with a Link button); a search or filter with no hits offers to
  clear it.
- Reps get "New / Existing school / district" and the contact-already-in-Zoho
  banner and candidate picker; the match score, opportunity line and full
  "Account: ..." wording are Admin / Solutions Success only (`isSales` in
  `ReviewLeadEditor.vue`, i.e. the effective role). Neither view has the old
  "Zoho Account Id (once created)" / "Account name" fields or the "Show match
  reasoning" link any more: linking a new account is the import step's job, and
  the boxed "AI guess, unverified" summary made the reasoning link redundant.
  An ambiguous match shows **"Pick a Zoho match"** only when there are
  candidates to pick from; with none there is no pill and no flag (the editor
  still explains it in words, and the lead stays approvable as a new lead).
- Notes: the "Notes" field and the "Add note" button both write
  `interaction_notes` (typed text and voice-memo transcripts share it; Add note
  appends a dated line and saves at once). `export-csv` puts it first in the
  Zoho **Description** column as `Notes: ...`, ahead of the confidence lines and
  the AI match reasoning (`contacts.notes`). Before 2026-09-29 it was not
  exported at all. The Review tooltips promise this, so change both together,
  and redeploy `export-csv` when the export changes.
- Followed up sits beside Heat in the editor header (not the footer); both save
  as you tap, while the text fields still need Save (or Approve, which carries
  pending edits on the same PATCH).
- Bulk selection (Rejected tab) is counted only over what is on screen. The
  same was fixed in Classic, whose bulk approve also now reads and reports the
  `{ approved, skipped }` response instead of discarding it.
- Logic tests: `cd frontend && npm test`.

