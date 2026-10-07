# CKH Connect — component map

## Components

| Path | What it is |
|---|---|
| `frontend/` | Quasar SPA on Vercel. Talks only to Supabase Edge Functions. |
| `supabase/functions/` | The only server-side API. Service-role clients behind `requireUser()` role checks; RLS is deny-all with zero policies by design. |
| `supabase/migrations/` | Schema + stored functions. Append-only; never edited after the fact. |
| `supabase/seed/` | Zoho reference data (districts/schools/campaigns) for seeding a fresh environment. |
| `local-agent/` | Four poll loops (matching, SMS photo, transcription, note extraction). The only caller of `claude -p`. |
| `watcher/` | Local folder drop → `process-cards` → `contacts-from-ocr`. |
| `.claude/skills/` | The five skills. |
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

### Which conference a Kiosk / Connect submission lands in

`contacts-create` resolves the event and the credited rep from, in order:
`repSlug` (a rep's reusable QR: their linked event, rep credited), `eventSlug`
(+ optional `repId`, revalidated against `event_reps`; event must be active),
then — for a bare call — the **signed-in caller** (the in-app Kiosk tab: their
`current_event_id`, credited if `sales`). A bare call is never resolved to "the
latest-activated event". The decision is `_shared/intakeDestination.ts`, one
tested function; when it can't place a submission it is **held, not rejected**
(next section). Old `/booth` and `/session` slides land in that queue as "No QR
details" until reprinted. `IntakePage` mirrors the resolution: signed in with no
linked event shows "Join a conference first" rather than the fallback event
`events-active` returns for display.

**The conference code (`events.folder_code`) never reaches the browser.** It is the
SMS bind token, so neither `events-active` nor `events-activate` returns it (Admin's
"Show conference code" link and the `folderCode` field in the event store are gone).
It stays in the database: `contacts-from-ocr` and the SMS photo pipeline file photos
by it, and `twilio-webhook` still binds a phone to an *active* event whose code is
texted. Don't add it back to a response for a UI.

### Scans that need a conference

`contacts-create` used to answer 404/409 and keep nothing when a valid attendee
couldn't be placed, so their details were lost. `contacts.event_id` is NOT NULL
and that rule runs through Contacts, duplicate checks, matching and export, so it
is not loosened. Instead the submission waits in `unassigned_submissions` and the
attendee sees the normal "Thanks".

- **Held (reason):** a rep with no conference (`rep_no_conference`; also a stale
  pointer to an ended one), a `repSlug` that matches no sales rep
  (`rep_not_found`), a per-event QR for an ended conference (`event_ended`, with
  `event_hint_id`) or for a slug matching nothing (`event_unknown`), no QR and no
  session (`no_qr`), a signed-in Kiosk tab with no/ended conference
  (`caller_no_conference`). Validation (400) and the rate/queue caps (429) still
  refuse.
- **The rep is credited only when we really know them:** the `repSlug` rep, the
  signed-in sales caller, or an ended-event QR's `repId` after it is re-validated
  against `event_reps` and `role = sales`. Never a client id taken at its word.
- **Nothing expensive at submit time.** No contact row means no matching, no AI,
  no n8n trigger until a person files it, so a public request can't start costly
  work by landing here.
- **Bounded.** The per-network rate limit still runs first; the queue adds a cap
  per network per 24h (`INTAKE_QUEUE_IP_CAP`, 300 because conference wifi is one
  NAT) and on pending rows overall (`INTAKE_QUEUE_TOTAL_CAP`, 3000). Both fail
  closed with the existing 429 wording.
- **Filing is one transaction.** `unassigned-assign` calls
  `assign_unassigned_submission`: it locks the row, re-checks the conference is
  live *now* and the rep is a sales rep, creates the contact through
  `insert_contact_with_duplicate_check` (same path as a normal scan, so duplicate
  checks and the match trigger behave identically) and marks the row assigned, all
  or nothing. A second person assigning the same scan waits on the lock and is
  refused. This replaces the claim/work/confirm shape used elsewhere because
  everything it touches is in one database.
- **Who sees it:** `unassigned-list/-assign/-discard` are admin and Solutions
  Success only, checked server-side. Contacts shows an amber "N scans need a
  conference" banner (`UnassignedScansBanner.vue`) to those roles only, never to a
  rep or while previewing one. No email or text goes out; the banner is the signal.
- **Retention:** rows (any status) are deleted after 90 days by a daily pg_cron job
  (`purge_unassigned_submissions`), the media-retention default (audit S12) but
  scheduled in the database rather than run by hand.
- Copy that depended on the old 409 (QR dialog footer, Setup's QR line, Admin's
  Team lines, the tour's QR notes) now says scans wait for Solutions Success.

### Setup and Admin

`/setup` (any role) is the guided rep flow; `/admin` (`admin` /
`solutionsSuccess`) is where conferences and people are managed. Two things to
preserve:

- **"Joined" is `sessionStore.user.currentEventId`, not `eventStore.activeEvent`.**
  `events-active` falls back to the most recent event for display when nothing
  is linked, so the two differ exactly when a rep is about to have a broken QR.
  Joining is a write (`profiles-set-current-event`); it is never inferred.
- **Placing a rep at a conference has one control per audience** — Setup's
  Choose/Change for yourself, Admin → Team's "Working at" for someone else. Both
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

Setup is two sections, because there are two jobs, each in one card. **You send contacts
in** is the rep's own: **Choose your conference** (folds to one line with a "Change"
button, plus an "Ended N days ago" chip once its last day has passed) and **Your phone**
(status, the number we have on file, the Text SETUP action, Check connection, and the
consent line). **Other people add themselves** is the QR code and **Kiosk** (PIN); for
Admin and Solutions Success it lists the Rep QR slides instead of a personal QR. The two
rows of the first section are numbered circles that become green checks when done, so
return visits are all checks and the rep taps the one to change; the second section is
resources, with no numbers, so the page doesn't read as finished before the rep has done
anything. It used to be five or six separate cards plus a "You're ready to capture leads"
card, which was overwhelming and repeated what the Connected badge already says; that
card is gone (the tabs still reach Contacts and Kiosk).

Phone and laptop are laid out differently and each keeps only its own controls. On a
laptop-sized window the two sections sit side by side; below that they stack in one
column with full-width buttons. The controls follow the device: the Text SETUP button
(opens Messages) is phone-only and a QR to scan with a phone camera is laptop-only
(`TextSetupAction`), and the QR buttons say "Save QR" (share sheet) on a phone and
"Download QR" on a laptop (`QrSaveButtons`). Don't show a control on a device it can't
work on. Keep it that way:

- **One picker.** "Choose" and "Change" both open `StartConferenceDialog`, which
  lists live conferences (Join) and upcoming ones (Activate). Setup has no inline
  list and no separate Start button. A live conference whose name has no date
  only shows when searched for, because the dialog's default list needs an end
  date.
- **Dates come from the campaign name** through the `event_dates()` SQL function
  (the same parser the picker uses), returned by `events-list-active` as
  `startsOn`/`endsOn`; null for an undated name. Don't add a second parser in
  TypeScript.
- **The QR line must stay true.** It names the joined conference; with none chosen
  it says scans wait for Solutions Success to file them, because `contacts-create`
  holds a scan from a rep with no `current_event_id` in `unassigned_submissions`.
  It neither files the lead under the previous conference nor loses it.
- **The rep's number on file** (`/me` -> `phoneNumber`) is shown so a wrong one is
  caught; reps can't edit it, so the "?" points at their Solutions Success rep.
- The "how it works" explanation is the welcome tour, not text on Setup. Keep the
  page's prose to a line or two.

### One conference everywhere

A rep has two pointers to "the conference I'm at": `profiles.current_event_id`
(the app, QR scans, Contacts) and `phone_event_bindings.event_id` (where texted
photos, voice memos and notes are filed). They used to be written by different
code and drifted: a rep who only texted SETUP had a linked phone and an app that
said "choose a conference" (their QR answered 409), and a manager moving a rep in
the app left their texted cards landing in the old conference.

- **App to phone:** `profiles-set-current-event`, `profiles-assign-current-event`
  and `events-activate` all call the SQL function `profile_set_current_event`.
  It moves an **existing** binding to the new (active) conference, **never
  creates one** (a binding is what lets `session-notifications` text a number; a
  phone that never texted SETUP hasn't opted in, and our A2P campaign was
  rejected four times over consent), and does not refresh `last_activity_at`
  (an app change is not activity on the phone). Clearing the conference (null)
  **deletes** the binding, which only stops texts; the next SETUP links again.
- **Phone to app:** every bind path in `twilio-webhook` (name search, activating
  a campaign, supplying the state, a folder code) calls
  `profile_link_event_by_phone` afterwards. `profiles.phone_number` is unique, so
  at most one profile matches; no match leaves the phone bound on its own.
- **A binding outlives its conference.** `events_complete()` clears profiles but
  not bindings, so `twilio-webhook` re-checks `events.is_active` wherever a bound
  phone files something (photos, voice memos, single-contact notes). An ended
  conference files nothing and replies "That conference has ended. Text SETUP to
  pick your current one." A failed lookup files nothing too and asks for a
  resend. A folder code only binds an active event.
- `scripts/check-conference-writers.mjs` (CI) fails if an Edge Function writes
  `current_event_id` directly or the webhook loses those checks.

### Admin "View as"

The switcher in the header (admin only) shows the app as another person sees
it. Every request still carries the admin's own token, so **a write made while
previewing lands on the admin's account**, never the previewed person's.

- **Contacts** reads that person's leads (`contacts-list?viewAsRepId=`,
  `inbound-messages-unresolved-list?viewAsRepId=`). Confirm / Reject still work
  and are done as the admin.
- **Setup, Kiosk and Notes** show that person's own conference, phone and PIN
  state from `me?viewAsId=` (admin only; returns the same shape as `me` plus
  `smsBound`, never the PIN itself). Controls that would change the admin's own
  account (join a conference, text SETUP, set a PIN, submit the form, send a
  note) are shown but switched off, since they would act on the admin rather than
  the person on screen. Before this, Setup hid its whole personal section and
  Connect showed the admin's own conference under the rep's name.
- A purple "Viewing as …" bar sits under the header on every page. On a phone
  the switcher is an unlabelled icon, so nothing else says whose view it is.

### Onboarding (splash, quick start, animated tour, reminder)

A signed-in staff account that hasn't seen it gets a splash with two choices:
**Just get me texting** (two screens ending at the SETUP text) or **Show me how it
works** (an animated tour of 4 scenes, or 6 for admin and Solutions Success). The
tour plays the app's own components with sample data and a scripted finger; nothing in
it is clickable and nothing is sent anywhere. Where things live:

| Piece | File |
|---|---|
| The rules (when the splash shows, what's recorded, the reminder, what the remainder plays) | `frontend/src/utils/onboardingFlow.ts` (pure, tested) |
| The words | `components/tour/tourCopy.ts` (scenes, splash, quick start, "Your turn") and `tourText.ts` (what our number texts back) |
| Wiring words to scene components | `components/tour/tourFlow.ts` (`playlist`) |
| How long each scene plays (for the progress bar) | `components/tour/tourLengths.ts`, held to the real scripts by `tourLengths.test.mjs` |
| The screens | `components/tour/OnboardingFlow.vue` (splash, quick start, tour, "Your turn"), `TourPlayer.vue`, `TourReminder.vue` |
| Connecting it to the account and router | `components/tour/OnboardingHost.vue`, `stores/tour-store.ts` (per-tab progress), `stores/session-store.ts` (`recordOnboarding`) |
| What the account remembers | `profiles.onboarding_*` / `tour_resume_from` (migration `20261006120000_onboarding_v2.sql`), read by `me`, written by `profiles-complete-onboarding` |
| A review page | `/tour-preview` (development builds only): any role, `?role=admin\|solutionsSuccess`, `?phone=0`, `?linked=1`, and `?fast` |

Things to preserve:

- **The tour draws the app's own components, not copies.** Each page's markup was split
  into a presentational part that both the page and the tour render: `AppHeader` and
  `AppMenu` (MainLayout), `ContactsHeader`, `NotesBody`, `ExportCard`,
  `AdminConferencesCard` / `AdminTeamCard`, `IntakeFormFields` (with the fold-up),
  `RepQrContent` and `UnassignedScansList`. The page keeps its data, requests and
  dialogs; the tour passes sample data and no handlers. The app's components carry no
  tour hooks (scripts find things by their own labels), and a test fails if a tour
  screen stops rendering the same component as its page. What the tour still draws
  itself: the phone's texting app (it isn't ours), Contacts' list/pane layout around the
  real header and rows, and the intake page's title.
- **"Seen it" is the account's, not the device's, and each way in records differently.**
  `me` returns `onboarding { seen, path, endedAt, resumeFrom, reminderShown }`.
  The first onboarding is `mode = first`: choosing on the splash stamps `seen` (closing
  the tab on the splash shows it again); closing the quick start records
  `path=quick, resumeFrom=send-import` (the texting half and Text SETUP count as seen);
  skipping the tour at scene *k* records `path=tour, resumeFrom=k`; reaching the end
  records `complete`. The **reminder** (`mode = remainder`) is shown once, on app open,
  an hour or more after they left, only if something was left, and plays just the rest;
  either of its buttons spends it, and a skip inside it records nothing. The **? button**
  (`mode = replay`) always plays the whole tour, records only `complete` at the end, and
  never touches `seen`, so it can't re-open the splash or move a resume point back. Every
  account that existed when this shipped has `seen = false`: each sees the new splash
  once, as asked. `me` answers `seen = true` with nothing to resume if its lookup errors:
  a hiccup must never re-show it. `profiles-complete-onboarding` validates every value
  (`resumeFrom` must be a known scene id) and writes the caller's own row only.
- **The rules are pure and tested** (`onboardingFlow.test.mjs`): the splash conditions,
  the resume points for a skip at each scene, the one-hour gate and one-time use, the
  quick-start remainder (`send-import` is the Import half of "Send us leads", then QR,
  Contacts, Export and Admin for managers), and the reminder's words generated from what is
  actually left and from how they left (`me.onboarding.path`). A quick-start person is
  *offered* the tour ("Want a quick tour? You went straight to texting earlier. In about
  40 seconds, see what else you can do: …"); anyone else is asked to finish it ("Finish the
  tour? You left the tour partway through. Still to see: …. About 40 seconds."). The title
  is fixed per path, never derived from the length (it once said "Got a few minutes?" above
  "About 70 seconds."), and the card says the ? in the top bar replays the tour, because
  "Not now" uses the reminder up. A new scene needs a `short` phrase in `SCENES`.
- **Never for attendees or a locked kiosk, and never outlives its user.** The host only
  mounts for a signed-in user on an unlocked device and never starts while an admin is
  previewing someone ("View as"). `flowStartAction` decides splash / reminder / reset /
  leave-alone; "no user" resets, because a 401 signs the person out (`boot/axios.ts`)
  without going through Log out. Refresh-resume lives in sessionStorage and is tied to
  the person who started it, so a different account on that tab never resumes it.
- **It tells a first-time rep what is actually true.** A new rep isn't linked yet, so the
  tour shows the real from-scratch conversation (SETUP, "What's the name of the
  conference?", a partial name, the list, a number, "You're linked to…"), quoted from
  `twilio-webhook`. Their contacts arrive in the real **processing** state (`Checking
  match…`), Confirmed and Rejected start at 0, and the people are one story across scenes
  (`tourSampleData.ts`). With no mobile number on the account (`me.hasPhone`), scene 1's
  note says who can add it, by role; once the phone is linked (`me.phoneConnected`),
  "Your turn" says "You're all set" and goes to Contacts instead of Setup.
- **The pictures quote the real thing, and tests hold them to it** (`onboardingCopy.test.mjs`):
  every reply our number sends is checked against `twilio-webhook`'s source; the form is
  `IntakeFormFields`; the number comes from `utils/smsNumber.ts`; the scene ids match the
  rules and the Edge Function's allow-list; none of the sample contacts' ids look real, a
  fresh contact is processing and never Ready, and no tour file talks to the server (apart
  from the host that records the outcome).
- **The Contacts scene teaches the page as it is** (2026-10-07). `TourContactsScreen.vue`
  draws the app's own `ContactsHeader`, `ContactList`, `ContactsConfirmAll` and
  `ContactsFilterPanel` (the Filter panel without its dialog, which would escape the phone
  frame) with the real ordering (`orderDeck`) and the real hold-then-slide. The script:
  open a contact that needs info, the Zoho banner, Followed up, add the phone, Confirm (it
  turns green and stays), go on to another contact (it slides to the bottom), the status
  bar's colours, Ready then Confirm all, then the conference line, which opens Filter at
  Conference, with Rejected and Conference pointed out. The tour's editor is drawn with
  `demo` so State / District / School fetch nothing (sample ids; the real `schools-list`
  answers 400 and the app would toast it); `onboardingCopy.test.mjs` holds that. The words
  say new contacts are checked against Zoho "within a few minutes", because the scene before
  shows them processing.
- **The tour never offers its own "text now" button.** Texting SETUP is consent. The quick
  start's SETUP action and Setup's phone card are the same component (`TextSetupAction`),
  so the opt-in disclosure lives in one place directly under the action; on a laptop it
  offers a QR code that opens a text with SETUP filled in.
- **Say what the app does, not what it sounds like.** Export *downloads a file* that
  someone imports into Zoho; nothing is sent to Zoho. Only Sales accounts have a QR, and a
  scan from a rep with no conference waits in Contacts for Solutions Success to file
  (see "Scans that need a conference"), so the tour says so.
- **The wording is for a rep at a booth.** A test fails if technical vocabulary
  (`BANNED_WORDS`) appears in anything the tour shows, including the generated reminder.
- **Playing every scene is checkable headlessly.** `/tour-preview?fast` plays each script
  with its waits cut and counts completed runs in `<html data-tour-cycles>`; a scene that
  can't find what it points at logs an error and stops. "Cycles went up and the console is
  clean" for every scene, per role and width, is the check run before shipping.
- **The progress bar shows when a scene is done.** The current segment of the bar fills
  as the scene plays (`OnboardingFrame`'s `fill`); finished scenes are full and later ones
  empty. Watching on a phone, you couldn't tell how long a scene ran and tapped Next
  halfway through. The fill is the engine's own count of the ms each `wait()` asked for
  (`createRun`'s `elapsed()`, pause-aware, not wall-clock) divided by the scene's declared
  length in `tourLengths.ts`, held at 97% until the script really finishes and then
  snapped to 100%, so a slow device never shows "done" early. On that first finish Next
  pulses once (`.of-pulse`; no pulse under reduced motion) and the scene keeps looping;
  Next works at any time. Back, Next, a replay or a phone/laptop flip restart the bar.
  The same goes for the quick start's first screen. A scene's length is a number someone
  has to keep right, so `tourLengths.test.mjs` runs every real scene script (the `.vue`
  file's own `<script setup>`, compiled with Vue's SFC compiler, against the real engine
  in fast mode) for every variant (rep/manager QR, phone/laptop, import-only) and fails if
  a declared length is more than 15% off. A smooth scroll's real duration isn't modelled,
  hence the allowance. Re-measure with `TOUR_LENGTHS_PRINT=1`. CI used to run only the
  frontend typecheck, not `npm test`, so none of these tests (Contacts list logic, tour copy)
  gated anything; both CI files now run it.
- **The copy makes promises about Setup and Contacts.** If the Ready rule, the status bar's words, Setup's flow,
  the text-in replies or the intake form change, update the tour's copy in the same change.

### State, District and School (the pickers)

One component, `InstitutionFields.vue`, draws State, District and School on the attendee form (`IntakeFormFields`, so the Kiosk tab, a rep's QR page and the tour's phone too), in the lead editor and in the duplicate-merge dialog; `institutionFields.test.mjs` fails if a screen draws its own or calls the list endpoints itself. The behaviour is `composables/useInstitutionPicker.ts` and the pure rules are `utils/institutionPicker.ts` (tested).

- **Lists are loaded once and filtered on the device.** Setting a State fetches that state's whole district list (`districts-list?state=X&all=1`); picking a District fetches that district's whole school list (`schools-list?districtId=X&all=1`). Opening a field shows the list at once, typing filters it from the first letter (starts-with first, then each typed word starting a word, then contains), and nothing is requested per keystroke, which is what makes it work on conference wifi. Texas, the biggest, is 932 districts, about 88 KB (a third of that compressed); the biggest district has 183 schools, about 27 KB. The server pages past PostgREST's 1,000-row limit and refuses past 5,000 (`_shared/referenceLists.ts`) rather than serving a silently truncated list; responses are `Cache-Control: private, max-age=600, stale-while-revalidate=86400`; the browser also keeps each list in `localStorage` for a day (any failure there just refetches). The old search mode (2+ characters, 50 rows) is still there for older clients.
- **"Use '<typed>'"** is always the last option when the typed text isn't an exact match, so a state where we hold only a few districts is still easy to get past. It is committed on Enter, Tab **and blur** (QSelect's own new-value only fires on Enter/Tab, so a rep who typed a name and tapped Save lost it). A typed value is kept as plain text (`schoolDistrictNameRaw` / `schoolNameRaw`), never a new `school_districts` / `schools` row.
- **District comes first; School without a district is a quiet fallback.** School is usable once State is set. With a district from our list it lists that district's schools; with none (or with a typed district, which has no schools of ours) it takes typed text only, and the "We'll look up the district for you" hint appears only once they start typing, because research fills a missing district in (`research-contact`). No searching a state's schools.
- **Clearing is done on the person's own change, never by a watcher.** A different State clears District and School; a different District clears a School picked from the old one (it has an id) but keeps a typed school (`changeState` / `changeDistrict`). Watchers would wipe the values a page has just loaded when it re-points the model at another lead.
- **Research fills in a missing district** (2026-10-06). For a lead with a school and **no** district, `research-contact` (SKILL.md step 5b) returns `resolvedDistrict { name, evidenceUrl, confidence }`: the district that operates that school in that state, backed by a search-result address, `high` or `medium` only, `null` when unsure, ambiguous or generic, and always `null` when a district was given (rule 5: a given district is never overwritten). The name also goes first in `alternateDistrictNames` so `match-contact` uses it. The skill writes nothing: the pipeline passes it to `finalize_contact_match`, which already writes a match atomically and only while the row is still `pending`, and writes the district only if the row, locked and re-read, still has no district of any kind: it maps to OUR `school_districts` (same state, normalised name, exactly one match) and the school to that district's schools if exactly one matches, otherwise keeps the name as `school_district_name_raw`; it records `contacts.district_lookup` and a line in notes with the source. The editor shows one line ("District looked up from the school", with the source) while the district is still that one. The contract is validated three ways (both Zod copies and `research.schema.json`, tested together) and re-checked in SQL. Nothing here confirms the lead. Tests: `supabase/tests/resolved_district.sql` (against the real functions, rolls back) and the live eval `local-agent/evals/research-district-eval.mjs`. Research runs only when a contact is first claimed, so a school added later in the editor is looked up only through Retry match.
- Districts and schools are only ever OUR tables (`school_districts`, `schools`): no NCES import and no Zoho append (Peter, 2026-10-06; the data is already shaped the way he wants). The one `school_districts` row with `state = 'MN'` instead of `Minnesota` doesn't show under Minnesota; it is a one-row data fix, left until Peter says.

### Kiosk (the attendee form, `/connect`)

`/connect` (formerly `/intake`; the old path redirects; the signed-in tab is labelled **Kiosk** but the URL stays `/connect`, because it is printed on QR codes) is the public form an
attendee fills in on their own phone or at a booth device. Two rules:

**Lock kiosk** (hands the device to attendees) is a button on this page, `LockKioskButton.vue`, shown only to signed-in staff on the bare tab, not in the header (it used to sit next to Log out, one stray tap from locking a device by accident). A rep with no kiosk PIN is asked to set one first; unlocking is in `MainLayout.vue`.

- **Autofill is on only for an attendee's own phone.** `IntakePage.vue` sets
  `autocomplete` tokens (`given-name`, `email`, `tel`, ...) when no staff member
  is signed in on the device and the kiosk isn't locked, and `autocomplete="off"`
  otherwise — a shared booth device's browser would otherwise offer its owner's
  saved name, email and phone to every attendee who taps a field.
- **Everything is open from the start; the first block folds once it's done.** (The fields are `IntakeFormFields`, which the onboarding tour renders too.) The
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

### Signing out

Log out and the 401 handler (`boot/axios.ts`, any 401 from a staff-gated function) both end
in `session-store.logout()`, which calls `supabase.auth.signOut({ scope: 'local' })`: this
device's session only. supabase-js's default is `'global'`, which revokes every session the
account has, so one Log out on a phone (or one stray 401) used to sign the account out of
its kiosk iPad mid-conference too; Peter's own account was found with zero sessions
(2026-10-06). Nothing in the app signs out everywhere. `scripts/check-auth-signout.mjs`
(CI) fails any `signOut(` without `scope: 'local'`; a deliberate "sign out everywhere" must
be its own explicit choice, marked `// sign-out-everywhere: <why>` on the line above.

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
simply releases itself. The summary card's "Not confirmed yet" count links to
Contacts, since those are the leads that won't be in the file.

The Description column leads with the rep's notes (`Notes: …`); see "Contacts".

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
identical from inside the loop. Contacts' **Unlinked Voice Memos / Errors** section
(`inbound-messages-unresolved-list`; `components/memos/`, state in
`composables/useVoiceMemos.ts`, words and rules in `utils/voiceMemos.ts`) puts
those memos in front of a person, in amber, above the contacts. A memo is listed
only once it has a transcript, and only while its `link_status` is `unlinked`
("Still matching") or `no_candidate_found` ("Needs review"); one that names a
contact already in Contacts links itself and never appears. On a phone each memo
is one thin card with every control on it; on a laptop it is a thin row that opens
in the right pane (player, full transcript, the actions), where the contact editor
normally is. The section is **closed until the rep opens it** (open, it pushed
every contact below it); its header and count are always visible. It also holds
photos and memos that **failed to process** (`status='failed'`) as soft-red cards
(`FailedCard`) on laptop and phone alike: Retry (only once the system has given
up, `error_class` not `transient`), Delete (`inbound-messages-delete` also accepts
a failed photo or memo and removes its file from the right bucket) and View photo /
Play (`inbound-messages-photo` redirects to a signed `contact-photos` URL the page
shows as a blob; memos use `inbound-messages-audio`). The old
`UnresolvedIntakePanel` is gone. Four actions on an unmatched memo:

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
  Refused (409) while a Create contacts run is in flight for the memo.
- `inbound-messages-retry` — also **Retry matching**: a memo at
  `no_candidate_found` goes back to `unlinked` with `link_attempts = 0`, guarded on
  the status it was read at, so the sweep picks it up on its next pass. Offered only
  on Needs review; a memo still `unlinked` is already being retried and is refused.
  (The same endpoint still puts a *failed* photo or memo back in the queue.)
- `inbound-messages-create-contacts` — **Create contacts**: for a memo about
  someone new. Records the transcript as a `note_submissions` row with
  `source_message_id` set and `from_phone` = the memo's sender, so the existing
  note extraction (`extract-note-contacts` via the agent / n8n) does the work and
  nothing here calls a model. `contacts-from-note` sees `source_message_id`, files
  each person as `source='voice_memo'` against the memo (deduped on memo + name, same
  index as `contacts-from-voice-memo`) and only then marks the memo `contact_created`,
  so a run that finds nobody leaves the memo listed (reserve → work → confirm).
  Bounded: one run in flight per memo, three runs in total (`MAX_ATTEMPTS`), the
  transcript capped at the notes limit. While a run is in flight
  `claim_unlinked_audio_messages` skips the memo (the sweep and the person must not
  both create the same people). The list reports it as `create: working | none |
  failed`, which is what the card shows ("Reading memo…"), and the page polls every
  6s while any memo is working.
- `inbound-messages-audio` — the play button. Returns `{ url }`, a 5-minute signed
  `voice-memos` URL (JSON rather than contacts-photo's 302, because an `<audio>`
  element can't send the Authorization header). Same ownership rule as the others;
  404 once the 90-day purge has removed the file, and the card then shows no
  player. `index.html`'s CSP gained `media-src 'self' https://*.supabase.co` for it.

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
already has a real contact record backing it and surfaces through Contacts the
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
`contacts-patch`, and it saves as they tap. It's on every contact's
row and at the top of the editor (see "Contacts" below). Filter's **Followed up**
(Any / Not yet / Done) and the confirmed group's default "Follow up first" order are the only
places it drives behavior beyond display, and it's a
client-side filter over the already-loaded list (same mechanism as the
conference filter), not a server query param. `export-csv` carries it through
as its own `Follow Up Done` column —
no Zoho field is mapped to it yet, so it rides along unmapped until Sales
picks one.

### Resolving a duplicate

`DuplicateResolutionDialog.vue` opens from a lead flagged "possible duplicate".
The flag means only one thing: another row has the same first and last name
(`insert_contact_with_duplicate_check`, set once at insert). So the name can't
say which record is right, and two real people can share one. The sheet shows
what can: how each record was captured, OCR confidence, research and Zoho-match
status, the card photo, and amber marks on the values the records disagree about.
That logic is `utils/duplicateEvidence.ts` (with tests); "Suggested" is a hint
and is withheld on a tie.

Two exits: **Merge** keeps one record and rejects the rest
(`contacts-merge-duplicates`), and **Not a duplicate** clears the flag on the
group and changes nothing else (`contacts-mark-not-duplicate`). Nothing re-flags
cleared rows, so the button asks first. On a phone the sheet is full screen with
the header and both buttons pinned; only the middle scrolls. It used to scroll as
one card, which put Merge ~1800px down.

### Contacts

`/contacts` is `ContactsPage.vue` + `components/contacts/`. It was called Review until
2026-10-06 (Peter's rename): `/review` still redirects here with its query. Only the page's
own names changed; the database's words did not (`review_status`, `'needs_review'`,
`ReviewStatus`, the `contacts-*` functions, `types/review.ts`). (There used to be a second
"Classic" card-grid view behind a ⋮ switch; it was retired 2026-10-01, and the
switch did nothing on phones anyway. A browser that still has `ckh.review.view`
saved just ignores it.) It is **one list, no tabs** (redesigned 2026-10-06): compact rows
with a plain-language flag for why a contact needs a look (or a green "Ready to confirm"),
a status bar with live counts, search, Filter, one-tap Confirm / Reject with a 6-second
Undo, "Confirm all N", tap-to-call / tap-to-email, and Followed up, Add
note straight from the row. On a desktop (≥1024px)
the list sits beside a sticky editor pane (J / K move, C confirms, R
rejects, both only on an unconfirmed contact); below that the same editor is a bottom
sheet. Leaving a lead with unsaved edits asks first.

Top of the page, one line each: **search** ("Search contacts"), **Filter** (a count badge
when anything differs from the defaults) and **Import** (icon-only under 375px); then the
**status bar**, one joined control, All · Ready · Needs info · Processing · Confirmed, each
with a coloured dot, its count and its word; then the **conference line**. There is no title
row (the nav bar says Contacts). On a laptop the top row sits at the top of the list column.
The account bar carries a **QR** button (`RepQrDialog.vue`, the
same phone-screen artwork Setup saves, drawn on screen as a `blob:` image because the CSP forbids `data:`) for
`repSlug`, or the previewed rep's.

Rules worth knowing before changing Contacts:

- **"Approve" is "Confirm" in every word a person reads** (2026-10-06). Only the words changed: the stored status is still `approved`, and `contacts-bulk-approve`, `reviewStatus: 'approved'`, `approveClick` and the like keep their names. The keyboard shortcut moved from A to C. `utils/confirmWording.test.mjs` fails if a screen says Approve again. The editor's separate **Confirm match** button (confirms the Zoho match) is unchanged. Reject / Rejected are unchanged.
- **Nothing is ever auto-confirmed** (Peter, 2026-10-06). A match result always leaves a lead in `needs_review`; `finalize_contact_match` no longer touches `review_status`. The only writers of `approved` are a person: a lead's Confirm (`contacts-patch`), "Confirm all N" (`contacts-bulk-approve`) and Undo/restore. `scripts/check-no-auto-confirm.mjs` (CI) fails if server code, the agents, the n8n pipelines or workflow nodes, or a migration from this decision on writes `approved` or `auto_approved = true`, and the database refuses `auto_approved = true` (`contacts_never_auto_approved`). `contacts.auto_approved` stays as history. A queue scan that Solutions Success files (`assign_unassigned_submission`) arrives as `needs_review` like any new lead.
- **Ready to confirm** (`READY_LABEL`; `utils/contactsList.ts`, `isReady`) means: match finished, no
  possible duplicate, has an email or phone, and has a school or district.
  Bulk confirm only ever sends ready ids; the server still skips any pending
  ones and the response is read and reported.
- **The deck: unconfirmed first, confirmed after, and nothing moves under a finger.**
  Unconfirmed contacts (Ready / Needs info / Processing, interleaved) come first in plain
  arrival order (newest first); confirmed contacts follow at the bottom of the same list;
  rejected ones are hidden (Filter, Show: Rejected). There is still no "needs attention
  first" sort: that sort ranked on the readiness flags, so on 2026-10-01 adding a district
  to the newest lead flipped it to Ready and sent it from row 1 to row 41 the instant Save
  landed. Orders that read editable fields are computed once (`buildRank`, on load / sort
  change) and kept (`orderByRank`), not re-run live; the background poll
  (`load({ keepOrder: true })`) keeps that order and yields to any write in flight.
  **Confirming a contact one at a time turns it confirmed IN PLACE** (green edge, "Confirmed"
  chip, no ✓ ✕): the page *holds* it (`held`, `orderDeck`). It slides to the top of the
  confirmed group (a ~350ms FLIP, instant under `prefers-reduced-motion`; `TransitionGroup`'s
  move class in `ContactList.vue`, switched on only while the page is settling: left on, a
  resize or the 8s poll slid rows too, and a resize stacked cards on each other at 320px) only when the person goes on to another contact: opens
  another card, ticks another card's ✓ / ✕ / Followed up, or presses Next / J / K, and
  on a laptop Confirm's auto-advance counts as selecting the next contact. Changing the
  search, a filter or the status bar settles too; **Confirm all N settles right away**.
  The held and just-edited (`pinnedId`) contacts stay listed even when they stop matching the
  status bar or a filter, until the person moves on.
- **The status bar is the filter.** One segment at a time; tap the selected one again for
  All. It is ALWAYS drawn, even when every count is 0 (zero segments go grey and, other than
  All, are disabled): the old pills vanished with no contacts and left Import floating alone.
  Counts (`statusCounts`, same rules as the chips via `rowStatus`) follow conference, search,
  source and followed-up, so a number is what the list shows. With **Ready** selected a full
  width green "Confirm all N" sits above the list; it acts only on what is on screen. A
  card's 4px left edge always means status (`rowStatus`): green ready, orange needs info,
  blue processing, soft green confirmed, grey rejected; the open contact is a tint and an
  outline, never the edge.
- **Which conference** (`homeConference`, `inConferenceView`, `conferenceLine`). A rep sees
  their current conference; with none, their most recent one (the line then says "Your most
  recent conference: X"); typing a search looks across ALL their conferences and the cards name
  theirs; managers default to All conferences. Reps can choose Earlier or All conferences in
  Filter, which keep the per-conference sections (`groupByEvent`, the first open). The line under
  the status bar opens Filter at Conference. Link / Unlink are gone from this page: **Setup
  owns the conference** (a rep with no conference and no contacts gets an empty state with a
  Go to Setup button).
- **Filter** (`ContactsFilter.vue`, state in `ContactFilters`): a bottom sheet under 1024px, a
  dropdown under the button on a laptop. Show (Contacts | Rejected), Conference, Followed up,
  Source, Sort (applies within the unconfirmed group), and for managers a Team section (Rep,
  Sent to Zoho: the server filters those two). Reset, and a sticky "Show N contacts".
  Rejected view: a slim "Showing rejected contacts (n)" bar, Select all / Delete selected,
  Restore on the cards.
- **Processing** (`isProcessing`): a lead whose match is still `pending` and not
  yet given up on has no Confirm and no Reject, in the editor or on the row. A
  notice ("We're still processing this contact…") takes the buttons' place, and
  `ContactsPage` re-fetches quietly every 8 seconds while any lead is processing,
  which is what brings the buttons back. A *stuck* match (attempts exhausted) is
  not processing: it keeps Reject, loses Confirm, and points at Retry match.
- All three statuses are loaded at once (six requests for a rep: current and past
  scope; the page filters by conference itself) so the status bar's counts are live and
  confirm / reject / undo move a contact between the lists locally. No backend change was
  needed. `contacts-list` carries no event date, so section order uses the event whose most
  recent contact is newest, computed over every status.
- Empty states are deliberate: nothing matches (clear search and filters), no contacts yet
  (or "choose a conference in Setup" for a rep with none), and nothing rejected.
- Reps get "New / Existing school / district" and the contact-already-in-Zoho
  banner and candidate picker; the match score, opportunity line and full
  "Account: ..." wording are Admin / Solutions Success only (`isSales` in
  `ContactEditor.vue`, i.e. the effective role). Neither view has the old
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
  exported at all. The Contacts tooltips promise this, so change both together,
  and redeploy `export-csv` when the export changes.
- Followed up sits at the top of the editor (not the footer) and saves as you
  tap, while the text fields still need Save (or Confirm, which carries pending
  edits on the same PATCH).
- **Heat is retired (2026-10-05); Source replaced it.** The hot/warm/cold control,
  chip and "Hot first" sort, the classifier skill, its n8n pipeline and local-agent
  loop, and the DB trigger that fired it are gone. `contacts.contact_intent*` stays
  as inert history (~17 rows). Contacts' **Source** filter (Filter -> Source; everyone, on every list) filters by how a lead was
  captured, and "Source" is a sort. The labels (2026-10-06): **QR scan** (a rep's own
  reusable QR), **QR Booth / QR Session** (the older per-event QR with a channel),
  **Kiosk** (the in-app Kiosk tab), **Form** (legacy only: a form lead from before the
  door was recorded, which can't be told apart, so it is not relabelled), **Card photo**,
  **List photo** (was Directory photo), **Voice memo**, **SMS** (one contact texted in) and
  **Imported note** (pasted on Import), plus **Other**. The key comes from
  `contacts.source` plus three facts: `intake_path` (`rep_qr` / `event_qr` / `kiosk`,
  written by `contacts-create` from the request's shape via `intakePathFor`, never from a
  client value, and carried through `unassigned_submissions` so a scan that waited keeps
  it), `qr_channel` (the attendee's own booth/session answer, which only names the
  source when the door doesn't), and `noteOrigin` (read from `note_submissions` through
  `source_note_id`: `from_phone` set is SMS, `submitted_by` set is Import; derived at read
  time rather than stored again, so it can't drift, and the phone number never leaves
  the server). None of it reaches Zoho: export-csv's "Lead Source" column is the
  conference name and "Capture Channel" still reads only `qr_channel`. All in
  `contactsList.ts` (`sourceKey`, `SOURCE_OPTIONS`). Tests read the latest
  `contacts_source_check` and `intake_path` migrations and fail if the DB allows a
  source or door the UI has no option for. Source never changes after capture, so unlike a
  field an edit can change it needs no frozen order.
- Bulk selection (Rejected tab) is counted only over what is on screen. The
  same was fixed in Classic, whose bulk approve also now reads and reports the
  `{ approved, skipped }` response instead of discarding it.
- Logic tests: `cd frontend && npm test`.

