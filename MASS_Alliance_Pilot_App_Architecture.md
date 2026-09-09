# App architecture — MASS/Alliance contact capture (Supabase/Vercel pilot)

## 1. Overview

**As of Stage 8, three intake paths feed one database**: a kiosk form/QR
code, a local folder-watcher for business-card photos, and texting photos
(and optionally a voice memo) to a Twilio number. Before anything reaches
Zoho, every new contact is first checked against everyone already captured
at the *same event* — catching the same person's card photographed twice,
or someone who both scanned the QR code and handed over a card — since
that's a cheaper, faster check than a Zoho round-trip and shouldn't wait on
one. Only after that does a contact get cross-referenced against your
existing Zoho Contacts and Accounts, so we're avoiding duplicate people and
duplicate school-district records in Zoho itself, not just duplicate local
entries. Card-photo data (whether dropped in the watch folder or texted in)
additionally passes through OCR and research via Claude before it reaches
either check, since it starts as a photo, not typed text — and unlike form
submissions, **card photos aren't processed live during the event at all**;
they're collected at the table (or texted in) and run through the pipeline
afterward. Only form/QR submissions need to work in real time at the venue.

Before any path opens, a sales rep runs a one-time setup step per convention:
pick the event from a list of Zoho Campaigns (`Type = conference`), which locks
that table's State/City and Lead Source for the rest of the day, and (for the
Twilio path) generates the folder code a rep texts first to bind their phone to
that event.

**Stack migrated wholesale in Stages 8–15** — this doc originally described an
ASP.NET Core + local Postgres + Claude Code CLI stack; that's gone. Current
stack, and why:
- **Backend + database**: Supabase (Postgres + Storage + one Edge Function per
  route) + Vercel (static frontend hosting) — the .NET/local-Postgres stack
  couldn't be hosted on Vercel, and the user rejected adding a third infra
  provider (a container host) just to keep ASP.NET Core alive, so the backend
  was rewritten as Edge Functions rather than rehosted.
- **Every `claude -p` step stays local, by deliberate, consistently-applied
  choice**: OCR (`process-cards`), identity/Zoho research and matching
  (`research-contact`/`match-contact`), and voice-memo transcription (local
  Whisper) all run on a Mac via `local-agent/`, not as a metered API call from
  an Edge Function — no metered `ANTHROPIC_API_KEY`, no cloud dependency for
  any of it, same reasoning applied uniformly across the whole pipeline.
- **Frontend + UI pattern**: unchanged — still Vue 3 + Quasar, just calling
  Supabase Edge Functions directly instead of a same-origin `/api` proxy.

## 2. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Backend | Supabase Edge Functions (Deno), one function per route | Vercel can't run .NET; Edge Functions avoid standing up a separate container host just for the API |
| Database + Storage | Supabase Postgres + Storage (`contact-photos`, `voice-memos` buckets) | RLS enabled with **zero policies** on every table — nothing is reachable except through Edge Functions using the service-role key, which bypasses RLS entirely |
| Frontend hosting | Vercel (static SPA build), root directory `frontend/` | Vue/Quasar frontend has no server-side needs beyond what Edge Functions already provide |
| Frontend | Vue 3 + Quasar (SPA mode), hash-based routing | Unchanged from the original .NET-era build; `boot/axios.ts` now points at `VITE_FUNCTIONS_BASE_URL` and attaches the Supabase anon key + staff-PIN header on every call instead of using a same-origin proxy |
| Local matching/transcription agent | `local-agent/` (Node), three concurrent poll loops in one process — matching, SMS-photo intake, voice-memo transcription | Replaces the old .NET `MatchingBackgroundService`/`MatchingRetryScanner`; runs on a Mac so `claude -p` and local Whisper stay off any metered cloud path |
| Card-photo watch-folder | `watcher/watch-cards.command`, a macOS Login Item shelling out to the Claude Code CLI | Same watch-folder → `claude -p` pattern as before Stage 8, now uploading to Supabase Storage and POSTing to `contacts-from-ocr` instead of a local .NET endpoint |
| SMS/MMS intake | Twilio phone number (MMS enabled) → `twilio-webhook` Edge Function | Lets a rep text card photos (and an optional voice memo) instead of needing the watcher's Mac at the table |
| Transcription | Local Whisper CLI (`pip install openai-whisper`) via `local-agent/whisper-runner.mjs` | Originally an OpenAI Whisper API call from an Edge Function (`transcribe-voice-memo`, now unused, still in the repo for reference) — redone as a fully local step so no OpenAI account/key is needed anywhere in this app |

### Prerequisites (things that need to exist before this can run live)
- **Zoho OAuth credentials**, reachable from the Mac running `local-agent`
  (research-contact/match-contact shell out to `claude -p`, which uses the
  Zoho MCP connector — nothing Zoho-related runs in an Edge Function).
- **Claude Code CLI logged in**, `ffmpeg`, `sips`, and the `whisper` CLI present
  on whichever Mac runs `local-agent/start-agent.command` and
  `watcher/watch-cards.command` day-to-day (set up as macOS Login Items so they
  inherit Terminal's folder permissions and survive a reboot).
- **A Supabase project** (`conference-lead-gen`, project_id
  `yrvppufkerbjpvrxniot`) with its schema/Edge Functions deployed, and the
  **`sb_secret_...`-format** service-role key (not the legacy `eyJ...` JWT one —
  both are valid but for different systems, see the key-format note below) in
  `local-agent/.env` and `watcher/.env`.
- **A Twilio account/phone number with MMS enabled**, its `TWILIO_ACCOUNT_SID`/
  `TWILIO_AUTH_TOKEN` set as Supabase Edge Function secrets, and its webhook
  pointed at `twilio-webhook`.
- **A Vercel project** for `frontend/` (root directory `frontend/`), with the
  Supabase `ALLOWED_ORIGINS` secret updated to include its real URL — CORS
  otherwise only allows localhost.

## 3. Data model

Same logical schema as before, now as plain Postgres tables (`supabase/migrations/`)
instead of EF Core entities — enums are still text + CHECK, matching the old
`HasConversion` provider-string convention, so adding a value later stays a
plain additive change rather than a migration that touches every row.

### `Events` (local record of the Zoho Campaign picked at setup)
| column | type | notes |
|---|---|---|
| Id | uuid PK | |
| ZohoCampaignId | text | the Campaign's Zoho record ID |
| Name | text | Campaign Name — becomes the Lead Source on export |
| State | text | from Campaign's `State` field |
| City | text | from Campaign's `City` field (Zoho has no County field) |
| ActivatedAt | timestamptz | when a rep locked this table to the event |
| FolderCode | text | nullable, unique — short human-typeable id (e.g. `lansing-20260920`) a rep creates a Finder subfolder with by hand for card-photo intake; see section 5 |

### `Contacts`
| column | type | notes |
|---|---|---|
| Id | uuid PK | |
| EventId | FK → Events.Id | determines State/City/Lead Source at export |
| Source | text | `form` or `card_photo` |
| FirstName | text | |
| LastName | text | |
| Email | text | nullable |
| Phone | text | nullable |
| SchoolDistrictId | FK → SchoolDistricts.Id | |
| SchoolId | FK → Schools.Id | nullable |
| Title | text | nullable |
| ExtractionConfidence | text | high / medium / low; null for form entries — how sure the OCR/research was about the *field values themselves* |
| MatchStatus | text | `pending` / `existing_contact` / `new_contact_existing_account` / `new_account` / `ambiguous` — see section 6 |
| MatchConfidence | text | high / medium / low — how sure the *Zoho lookup* is, separate from extraction confidence |
| MatchedZohoContactId | text | nullable — set when MatchStatus = existing_contact |
| MatchedZohoAccountId | text | nullable — set when an Account match is found, existing or not |
| CandidateMatches | jsonb | nullable — array of {type, zohoId, name, score} for the reviewer to pick from when MatchConfidence = medium |
| HasActiveOpportunity / ActiveOpportunityName | boolean / text | nullable — surfaced alongside a match so a reviewer knows the account already has a live deal |
| LocalDuplicateOfContactId | uuid, FK → Contacts.Id | nullable — set when this looks like the same person as another contact already captured at the same event |
| ReviewStatus | text | `approved` / `needs_review` / `rejected` |
| Notes | text | pipeline-owned — `match-contact` output only |
| InteractionNotes | text | **Stage 14** — reviewer-editable free text, separate from `Notes`; a voice memo texted in alongside a card photo gets transcribed and merged in here (same phone + within a 15-minute window of a linked photo) |
| SourceImagePath | text | nullable — only for card_photo rows |
| SourceImageHash | text | content hash of the photo, for dedup — see pipeline note below |
| CroppedImagePath | text | nullable — set when a photo showed multiple cards laid out together and `process-cards` cropped this contact's card out of the sheet |
| SourceMessageId | uuid, FK → InboundMessages.Id | nullable — set when this contact came from a texted-in photo rather than the watcher or the kiosk form (Stage 13) |
| MatchAttempts | int | how many times the matching pipeline has run on this row; drives the stuck-Pending retry sweep (section 6) |
| LastMatchAttemptAt | timestamptz | nullable — null until the first attempt |
| CreatedAt | timestamptz | |

### `PhoneEventBindings` (Stage 13)
| column | type | notes |
|---|---|---|
| PhoneNumber | text PK | the texting rep's number |
| EventId | FK → Events.Id | which event this phone is currently bound to |
| BoundAt / UpdatedAt | timestamptz | |

A rep texts their event's `FolderCode` (shown on `/setup`, same code the
watcher uses) to bind their phone; every photo/audio message from that number
afterward resolves to that event until they text a different code.

### `InboundMessages` (Stage 13)
| column | type | notes |
|---|---|---|
| Id | uuid PK | |
| TwilioMessageSid | text, unique | de-dupes Twilio's own webhook retries; suffixed by index when one message carries multiple media parts |
| FromPhone / ToPhone | text | |
| EventId | FK → Events.Id | nullable — resolved from the phone binding, or null for `unrecognized` |
| Kind | text | `folder_code_bind` / `photo` / `audio` / `unrecognized` |
| Status | text | `received` / `pending_ocr` / `pending_transcription` / `processing` / `completed` / `failed` — the three local-agent poll loops (section 5/9) each claim rows in one of the `pending_*` states |
| Body | text | nullable — the raw SMS text, only meaningful for a folder-code bind |
| MediaContentType / StoragePath | text | nullable — set once the webhook's background upload to `contact-photos`/`voice-memos` completes |
| Transcript | text | nullable — Whisper output, only for `audio` rows |
| MatchedContactIds | uuid[] | nullable — which `Contacts` row(s) a voice memo's transcript got merged into |
| Attempts / Error | int / text | retry bookkeeping, same shape as `Contacts.MatchAttempts` |

**`ReviewStatus` is no longer just about extraction quality.** A record only
auto-approves if `ExtractionConfidence` is high-or-null, `MatchConfidence` is
high, and `LocalDuplicateOfContactId` is null — a typed-by-hand form entry can
still land in `needs_review` for any of: an ambiguous account match, no account
match at all (a genuinely new account needs a human to create it in Zoho, per
your call below), or looking like a duplicate of someone already captured at
this event. While `MatchStatus = pending` (waiting on a Zoho lookup that's
retrying in the background — see section 6), a record can't reach `approved`
either; it just sits until the check completes. This is a change from the
earlier version of this doc, where form entries were unconditionally
auto-approved. `rejected` rows are kept, not deleted — audit trail of what was
reviewed and turned down, though they're excluded from export same as
`needs_review`.

### `SchoolDistricts`
| column | type |
|---|---|
| Id | uuid PK |
| State | text |
| Name | text |

### `Schools`
| column | type |
|---|---|
| Id | uuid PK |
| DistrictId | FK → SchoolDistricts.Id |
| Name | text |

District and school start empty and grow via "+ add new" as people type them in.

## 4. Routes / pages

Every `/api/...` route below is now its own Supabase Edge Function under
`supabase/functions/` (one function per route — Edge Functions don't do
Express-style path templating, so a path param like `{id}` became a `?id=`
query param instead). The Quasar pages are unchanged in shape; they just call
`VITE_FUNCTIONS_BASE_URL/<function-name>` through the shared `api` axios
instance (`frontend/src/boot/axios.ts`) instead of a same-origin `/api` proxy,
with the Supabase anon key as bearer/`apikey` and `x-staff-pin` attached on
every call.

| Page / Function | Purpose |
|---|---|
| `GET /setup` (Quasar page) | One-time-per-event screen. Rep searches/selects the Zoho Campaign for today, types in State/City (see note below), and on confirm activates a row in `Events`, shows the QR code for `/intake` **and the event's `FolderCode`** — printed/shown for the watcher's inbox subfolder and for reps to text first over SMS |
| `campaigns-list` | Searches a Postgres cache of Campaigns (`Type = conference`) — same cache-not-live-call approach as before, now just an Edge Function instead of a .NET endpoint |
| `events-activate` | Activates a cached Campaign into a new `Event` row (atomic "deactivate current + insert new" lives in the `events_activate` Postgres function, since Edge Functions calling Postgres via `supabase-js` don't get automatic multi-statement transactions the way EF Core's `BeginTransactionAsync` did). Takes `state`/`city` directly from the rep — Zoho still has no such data to copy — and generates the `FolderCode` |
| `events-active` | The currently active event, for both the frontend and (indirectly) the watcher/local-agent |
| `GET /intake` (Quasar page) | The form for the currently active event. State/City shown as fixed context. District and school are type-ahead selects with "+ add new" |
| `contacts-create` | Saves a form row, runs the within-event duplicate check synchronously, then leaves it `pending` for `local-agent`'s matching loop to pick up (below) — the response returns immediately, before matching completes |
| `districts-list` / `schools-list` | Type-ahead lookups |
| `districts-create` / `schools-create` | Add-new, called when someone types something not already in the list. **No dedup-by-name and no client-supplied `state`** — always inserts, and `state` is always derived server-side from an event (an `eventId` param, or the currently-active event), matching the original `.NET` contract exactly (an earlier pass at this port had invented different behavior here — caught and fixed in Stage 15) |
| `GET /review` (Quasar page) | The clearinghouse — a list view, not a step-through queue, so reviewers can tackle records in any order and bulk-approve a batch of high-confidence ones in one action. Each row shows: source photo (if any) next to editable fields, extraction confidence, a "possible duplicate of [name]" flag when `LocalDuplicateOfContactId` is set, an editable `InteractionNotes` field, and — when `MatchConfidence = medium` — a picker showing `CandidateMatches` to resolve against. Approve / Edit / Reject per row or in bulk |
| `contacts-list` / `contacts-duplicates` | List with filters, and the duplicate-pair lookup for the review UI |
| `contacts-patch` | Updates a row's fields, resolves a candidate match, and/or updates status |
| `contacts-bulk-approve` / `contacts-bulk-delete` / `contacts-merge-duplicates` | Bulk review actions |
| `GET /export` (Quasar page) | Generates the Zoho-ready CSV from all `approved` rows. Rows with `MatchStatus = new_account` are excluded until a human has created the Account in Zoho and linked it |
| `export-summary` / `export-csv` | The running-count view and the actual CSV generation — ported from the original `.NET` `ExportEndpoints.cs` (these two were simply missing from the first pass at this port; added in Stage 15) |
| `contacts-from-ocr` | Called by the watcher script and (indirectly) `local-agent`'s SMS-photo loop — not by a browser. Resolves the `Event` from a folder code, creates one `Contact` row per photo, and leaves it `pending` for the same matching loop forms use |
| `contacts-photo` | Streams the original (or cropped) card photo for a `card_photo` contact via a signed Storage URL redirect, for the panel on `/review`. Fetched as a blob (not a plain `<img src>`) since it needs the staff-PIN header and anon-key bearer token |
| `contacts-retry-match` | Manually re-marks a `pending` row for another matching attempt — the escape hatch once the automatic stuck-Pending retry (section 6) has given up |
| `auth-verify-pin` / `auth-change-pin` | The staff-PIN gate itself (section 8) — verify on kiosk unlock, change from `/setup` |
| `twilio-webhook` | Receives Twilio's SMS/MMS POST (section 9) — not called by the frontend at all |

**Zoho's Campaigns module has no State/City fields at all** — confirmed
against all 671 real conference campaigns pulled: every one has both null,
and no related field carries it either. The only trace of location is
embedded inconsistently in free-text campaign names (e.g. `"2023 01.29-02.01
(TX) TASA Mid-winter Conference"` — a state abbreviation in parens
sometimes, a city almost never). Per your call, the rep simply types
State/City in at `/setup` when activating an event, rather than anything
being parsed or copied from Zoho.

### Export format

The CSV mirrors the format from the first batch, with matching data added so
Zoho's import can link precisely instead of fuzzy-matching by name a second
time:

`Salutation, First Name, Last Name, Email, Phone, Title, Account Name, Account Id, Lead Source, Description`

- **Account Id** is populated from `MatchedZohoAccountId` when there is one —
  Zoho's import can key off this directly. Left blank only for the rare case
  where a brand-new Account was created manually in Zoho after review but the
  link hasn't been confirmed yet.
- **Lead Source** is always the active Event's name.
- **Description** carries forward extraction/match confidence notes, same as
  the first batch.

The export screen also shows a running count — approved and in this file,
still in `needs_review`, and blocked on a manual Account creation — so nothing
silently vanishes from view between review and export.

## 5. Card-photo pipeline — watch folder and (Stage 13) Twilio MMS

Instead of the API polling a folder itself, a small standalone script
(`watcher/watch-cards.command`) does — run as a macOS Login Item so it
inherits Terminal's folder permissions instead of losing them silently the
way a background LaunchAgent does. As of Stage 13, this is one of **two**
ways a card photo enters the exact same pipeline: dropped in the watch
folder, or texted to the Twilio number (section 9) and picked up by
`local-agent`'s `photoLoop`. Both call the same `process-cards` Skill and the
same `contacts-from-ocr` Edge Function; only the upload path differs.

`research-contact` and `match-contact` exist as their own pipeline stage
(section 6), wired in from the form path and shared unchanged by card
photos — so `process-cards` (`.claude/skills/process-cards/SKILL.md`) has a
narrower job: **OCR one photo — which may show one card or several laid out
together — extract fields exactly as printed per card, crop a multi-card
photo so each contact gets its own image, and hand off — nothing more.** It
does not research the person and does not touch Zoho.

- **Explicit per-event folder selection, not "whichever event is `IsActive`."**
  Cards are processed after the event, often once a different event is already
  active for whatever's next — so the watcher can't lean on the form path's
  `IsActive` shortcut. Each `Event` gets a `FolderCode` (slugified city +
  activation date, e.g. `lansing-20260920`) shown on `/setup` once activated;
  a rep creates a matching subfolder under `watcher/inbox/` by hand, and the
  watcher/skill resolve the `Event` from that code — never a client-trusted id.
- **Folder layout**: `inbox/<code>/` (drop zone) → `.processing/<code>/`
  (transient staging for one photo's run) → `processed/<code>/<hash>.<ext>`
  (permanent archive, doubles as `SourceImagePath`) or `failed/<code>/` on
  error, plus `logs/watch.log`. All gitignored except the script and each
  folder's `.gitkeep`.
- **Idempotency at two layers.** The watcher hashes each photo's original bytes
  on arrival (before any HEIC conversion) and checks the archive folder for
  that hash by filename — a match is a local no-op, skipped without invoking
  `claude` at all. `contacts-from-ocr` separately checks `SourceImageHash`
  against existing contacts as a server-side backstop (`200`/
  `alreadyProcessed: true`, no new row) — belt-and-suspenders, since the
  watcher's own check is what actually avoids the cost of a Claude invocation.
  This backstop is what makes a rare double-run (e.g. two watcher processes
  racing on the same file after an unclean restart) a safe no-op rather than a
  duplicate contact.
- **Upload goes to Supabase Storage (`contact-photos` bucket)**, then
  `contacts-from-ocr` is called over HTTPS with the service-role key — this
  replaced a same-machine .NET endpoint call in Stage 12. Storage's raw REST
  object endpoint needs an explicit `apikey` header alongside `Authorization`
  under Supabase's newer `sb_secret_...` key format (the `@supabase/
  supabase-js` client `local-agent` uses sends both automatically; the
  watcher's hand-rolled `curl` call needed it added explicitly).
- **HEIC handling**: iPhone photos convert to JPEG via `sips` (built into
  macOS) before staging; the identity hash is always the pre-conversion
  original bytes, so re-dropping the same photo is recognized regardless of
  which format it arrives in.
- **Crash-safe.** Anything still sitting in `.processing/` when a poll starts
  means the previous run died mid-file (killed Terminal, laptop sleep) — a
  `reconcile_stale` step moves it back to `inbox/` to retry before that poll
  does anything else. Verified: killing the watcher mid-run and restarting it
  recovers the staged photo and reprocesses it correctly.
- **Local district/school resolution for OCR'd free text.** `Contact`'s
  district/school FKs are required, but OCR just reads raw text with no
  type-ahead-guaranteed match. A simple exact case-insensitive lookup scoped to
  the event's state finds-or-creates a local row (`ZohoAccountId = null`,
  same as a form's "+ add new") — the real fuzzy/authoritative resolution
  still happens downstream in `research-contact`/`match-contact` against Zoho,
  regardless of which local row this picks. A card with no legible
  institution text at all resolves to a shared per-state placeholder district
  (`"(none provided on card)"`), easy for a reviewer to spot and fix via the
  district/school pickers now on `/review`.
- **No email/phone requirement for card photos.** The form path requires one
  of the two; a photographed business card routinely has neither legible, and
  there's no kiosk user to push back on it — `from-ocr` skips that rule.
- **Portable timeout, no GNU coreutils.** Confirmed neither `timeout` nor
  `gtimeout` exists on this Mac — the watcher backgrounds each `claude -p`
  call and polls/`kill -9`s it past a configurable ceiling with plain bash,
  rather than assuming a GNU tool that isn't there.
- **Poll interval: 45s** (watcher) / **20s** (`local-agent`'s `photoLoop`,
  configurable via `PHOTO_POLL_INTERVAL_MS`) — a big multi-card sheet can take
  `process-cards` up to ~15 minutes, so `photoLoop` runs concurrently with, and
  must never block, the much cheaper/more frequent matching loop (section 9).
- This runs on your Claude Code plan, not a metered `ANTHROPIC_API_KEY` —
  worth keeping in mind if photo volume is high.

Verified end-to-end (both intake paths): JPEG and HEIC photos both OCR
correctly and produce a `Contact` row that the matching pipeline then picks up
exactly like a form submission; a duplicate is caught at both layers; a
no-institution card lands under the placeholder and is correctable on
`/review`; a simulated mid-run crash recovers cleanly on restart; a real
multi-card sheet photo gets OCR'd and cropped into one contact + one image per
card.

## 6. Duplicate and match checks

### Within-event check (runs first, no Zoho involved)

Before anything touches Zoho, a new contact is compared against everyone
already captured under the same `EventId` — fuzzy name + school match, same
normalization as the Zoho check below. A likely hit sets
`LocalDuplicateOfContactId` and forces `needs_review` regardless of anything
else, so a reviewer decides whether it's a genuine repeat (someone's card
photographed twice, or they used both the form and handed over a card) rather
than the app silently merging or silently keeping two rows for one person.

### Zoho cross-reference / matching

For every contact, before it can reach `approved`, one skill checks it against
your actual Zoho data and classifies it into exactly one of:

- **`pending`** — the check hasn't completed yet. Applies to both intake
  paths: `process-cards` only OCRs a photo and hands off (section 5); the
  Zoho matching check itself always runs afterward, asynchronously, on the
  same background queue as a form submission (see "Async for forms" below).
- **`existing_contact`** — matched an existing Zoho Contact by name (and
  email/phone if present). Nothing new to create.
- **`new_contact_existing_account`** — no Contact match, but the school/district
  matched an existing Account. Safe to add as a new Contact under it.
- **`new_account`** — no Account match at all. Per your call, this **never**
  auto-creates in Zoho — it's flagged, and a human creates the Account manually
  before this contact can be linked and exported.
- **`ambiguous`** — a medium-confidence Account or Contact match. Surfaces
  `CandidateMatches` in the review app for a human to pick from, rather than
  guessing either way.

**Why this can't just be exact-name matching**, based on what I found checking
your actual Accounts data:
- `County`, `Billing_County`, and the federal `NCES_Id` are unpopulated on every
  account I checked, Mississippi or otherwise — there's no secondary key to lean
  on, so this comes down to name matching.
- The one field that *does* get used (`County_TX`) is a Texas-specific
  customization by every value I found in it — not usable as a general county
  field.
- District names alone already show spelling drift in your own card data
  ("Coahoma Co." vs. "Coahoma County"), so matching needs normalization (case,
  punctuation, common abbreviations) and a fuzzy score, not `=`.
- Many Accounts are individual schools linked to a parent district via
  `Parent_Account` — confirmed on a real example (`Browning High School` →
  parent `Browning Public Schools`), and each side has an `Organization_Level`
  field (`Campus / Child entity` vs. `District / Parent entity`) that cleanly
  identifies which is which. Matching checks both levels using this field rather
  than guessing from the name alone.
- **State uses `Shipping_US_State`, not `Billing_State`** — confirmed populated
  on real accounts (the earlier COQL rejection on `Billing_State` was the right
  field name mismatch, not a dead end).
- When an Account match is found, matching also pulls its existing linked
  Contacts (name, title, phone) as corroborating context — not to auto-match on,
  but to show the reviewer alongside a candidate: a business card naming someone
  with a similar title, or a phone number matching the account's listed line, is
  useful evidence either way.
- Search is scoped to the event's own State (via `Shipping_US_State`) —
  narrower and faster than a nationwide sweep, and it cuts down on false matches
  between similarly-named districts in different states. If nothing matches
  within the state, matching stays scoped there rather than falling back to a
  nationwide search — per your call, a same-named district in another state
  should never surface as a candidate.

**Web search runs on every contact, unconditionally, before Zoho is ever
queried.** `research-contact` (identity/institution verification) always runs
first, followed by `match-contact` (pure Zoho classification) — Zoho is never
checked first, so there is no "skip the search on a clean Zoho hit" shortcut,
by deliberate choice: conference attendees almost always carry minimal,
possibly-misspelled information, so verifying identity and resolving the
institution's real name is treated as worth doing every time rather than
gated behind a completeness check. This applies to both intake paths, not
just card photos — a form submission can be just as ambiguous as a card.
Whatever the search turns up is folded in as **another candidate signal**,
not a final answer: it can raise or lower `MatchConfidence` and adds context
to `CandidateMatches`/`Notes` for the reviewer, but it never auto-creates an
Account or auto-resolves an `ambiguous` row by itself — a human still makes
that call in `/review`. The tradeoff: every contact pays for at least one web
search's latency/cost, even a clean, unambiguous case Zoho alone could have
resolved instantly — accepted deliberately in favor of consistent
verification quality over per-contact cost savings.

**Where this runs**: this is two Claude Code CLI skills, not one —
`research-contact` (identity/institution verification, web search when
needed) followed by `match-contact` (a pure Zoho classifier, no web search).
As of Stage 11, both run headlessly (`claude -p`, via
`local-agent/skill-runner.mjs`) inside `local-agent/agent.mjs`'s
`matchingLoop` — replacing the old .NET `MatchingQueue`/
`MatchingBackgroundService`/`MatchingRetryScanner` trio with one Postgres
function (`claim_pending_contacts`, using `FOR UPDATE SKIP LOCKED`) plus one
poll loop: the claim function's attempts/cooldown condition covers what the
retry scanner used to do separately. Both skills are agnostic to how the
`Contact` row was created — a card photo only differs upstream, in that
`process-cards` (section 5) does the OCR step and hands off via
`contacts-from-ocr`, which leaves the row `pending` for this same loop to
pick up. One place decides what counts as a match — and when web research is
worth doing — regardless of which intake path a contact came from.

**"+ Add new" district/school doesn't skip this.** Typing a district that isn't
in our own local `SchoolDistricts` list only means it's new *to us* — it could
already exist as a Zoho Account under slightly different spelling. Adding a new
local district/school still runs the same matching check against Zoho; "not in
our list" and "not in Zoho" are different questions, and only the second one
actually matters for `MatchStatus`.

**Async for forms, per your call.** The kiosk can't sit and wait on a Zoho
round-trip mid-event — a submission saves immediately (`MatchStatus = pending`)
and the kiosk resets right away, same as always. The matching check kicks off
right after. Card-photo rows go through this exact same async path —
`process-cards` only OCRs and hands off, so a fresh card-photo row is
`MatchStatus = pending` too, until the background queue's matching check
completes, just like a form row.

**Stuck-Pending retry (Stage 7, ported in Stage 11).** If the pipeline fails (a
`claude -p` subprocess timeout or transient error — `research-contact`/
`match-contact` each already retry twice internally before giving up) or a row
was claimed but never finished before `local-agent` restarted, it's left at
`Pending` rather than a fabricated result. `claim_pending_contacts` itself now
covers the retry sweep that used to be a separate background service:
`matchingLoop`'s poll (every `MATCH_POLL_INTERVAL_MS`, default 20s) re-claims
any `Pending` row idle long enough, up to 3 auto attempts (`MatchAttempts`/
`LastMatchAttemptAt` on `Contact`). Past that cap, `/review` shows a distinct
"stuck — needs attention" chip and `contacts-retry-match` gives a reviewer a
manual way to force another attempt.

## 7. Kiosk behavior (iPad)

On submit: the form fades to a brief thank-you message ("Thanks — you're
entered!") for a few seconds, then clears and returns to blank automatically —
handled in the Quasar frontend, no server round-trip beyond the initial save.
The Zoho matching check runs after this point, asynchronously (section 6) — the
kiosk never waits on it, so a slow or briefly-down Zoho connection never shows
up as lag at the table.

## 8. Security note — implemented in Stage 9, unified with the kiosk PIN

The original pilot version of this app ran open on venue WiFi with no auth at
all (`/setup`, `/review`, `/export` unlocked same as `/intake`) — accepted risk
for a short-lived, staff-supervised test run, with a staff PIN flagged here as
a minimum requirement before it ran unsupervised. **That PIN now exists.**
`app_settings.staff_pin` (default `1234` — change this before real use, see
section 11) is a single shared secret serving two roles at once, deliberately
unified rather than two separate secrets: it's the kiosk-unlock PIN in the
frontend (`kioskStore`, held in-memory only) *and* the server-side gate
(`requireStaffPin`, `supabase/functions/_shared/auth.ts`) every privileged Edge
Function checks via the `x-staff-pin` header. Public routes (`contacts-create`,
`districts-list`, etc. — anything `/intake` itself needs before a rep has
unlocked anything) ignore the header entirely; a privileged one 401s without
it, which the frontend's response interceptor treats as "session died" and
re-locks the kiosk. Every Edge Function also requires a valid Supabase anon-key
JWT to pass the gateway's own check first — a real security boundary the
staff-PIN sits on top of, not instead of.

Separately, RLS is enabled with **zero policies** on every table (section 3) —
nothing is reachable directly by a client key at all; every read/write must go
through an Edge Function using the service-role key, which bypasses RLS
entirely. The staff-PIN check happens inside those functions, not at the
database layer.

## 9. Texting it in — Twilio SMS/MMS + local voice-memo transcription (Stage 13–14)

A third intake path alongside the kiosk form and the watch folder: a rep texts
photos (and optionally a voice memo) to a Twilio number instead of needing a
laptop/iPad at the table at all.

**Binding a phone to an event.** A plain-text message with no media is only
ever a folder-code bind attempt — `twilio-webhook` looks up the event by
`FolderCode` (same code shown on `/setup` and used by the watcher) and upserts
a `PhoneEventBindings` row for that phone number. Every photo/audio message
from that number afterward resolves to that event until the rep texts a
different code. Media sent before any bind attempt is rejected with a TwiML
reply asking for the code first.

**Media handling.** `twilio-webhook` is deployed with `verify_jwt: false`
(Twilio's own POST isn't a Supabase-authenticated call — it carries its own
`X-Twilio-Signature` instead, validated via `npm:twilio@5`'s `validateRequest`,
reachable only off that package's default export under Deno's CJS/ESM
interop). Twilio expects a fast ack, so the webhook inserts one
`InboundMessages` row per media item synchronously (classified `photo` vs.
`audio` off content-type) and returns its TwiML reply immediately, then
downloads and uploads each attachment to Storage (`contact-photos` /
`voice-memos`) in the background via `EdgeRuntime.waitUntil`. A message with
multiple attachments shares one `TwilioMessageSid` from Twilio, so each part
gets a synthetic `-<index>` suffix for its own unique row.

**Two more `local-agent` poll loops pick these up**, running concurrently with
`matchingLoop` (all three in one `Promise.all` inside `agent.mjs`) — this
project's replacement for the old .NET background-service trio, extended
rather than duplicated for the new intake path:
- **`photoLoop`** claims `pending_ocr` rows the same optimistic-claim way
  `matchingLoop` claims contacts, runs `process-cards` on the downloaded photo,
  and hands off to `contacts-from-ocr` exactly like the watcher does — same
  pipeline, different upload path (section 5).
- **`transcriptionLoop`** claims `pending_transcription` rows and shells out to
  the local `whisper` CLI (`local-agent/whisper-runner.mjs`) rather than
  calling an API. **This was originally built as an Edge Function
  (`transcribe-voice-memo`, calling OpenAI's Whisper API off a Postgres
  `pg_net` trigger) and deliberately redone mid-build** to match the
  no-metered-API-key approach used everywhere else in this pipeline — the
  trigger is dropped (`20260903000000_drop_audio_transcription_trigger.sql`),
  and the old Edge Function's source is left in the repo for reference only,
  unused. **No OpenAI account or key is needed anywhere in this app.** A
  transcript gets correlated to a linked contact by phone number + a
  15-minute window around a `photo` message from the same sender, and merged
  into that `Contact`'s `InteractionNotes` (append, not overwrite) — logic
  ported verbatim from the retired Edge Function.

Both loops use the same optimistic-claim pattern as `matchingLoop`'s stuck-row
handling (an `UPDATE ... WHERE status = 'pending_*'` that returns nothing if
another poll already claimed the row first) — not just to avoid double
billing, but because it's also what makes a crash/restart safe.

## 10. Resolved and open items

**Resolved:**
- **Stages 8–15**: backend + database migrated from ASP.NET Core + local
  Postgres to Supabase (Edge Functions + Postgres + Storage) + Vercel; every
  `claude -p` step (OCR, research, matching) and voice-memo transcription
  stays on a local Mac via `local-agent/`, never a metered API call — see
  section 1/2.
- Frontend and photo-pipeline pattern follow `good-wrap-main` (Quasar/Vue,
  watch-folder + Claude Code CLI) — unchanged by the backend migration.
- Events = Zoho Campaigns, `Type = conference`; City used in place of County
  (verified — Campaigns has no County field).
- Event locked per table for the whole day; event name becomes Lead Source.
- **Staff PIN auth, deferred through Stage 7, built in Stage 9**: gates
  `/setup`, `/review`, `/export` server-side (not just hidden client-side) via
  `x-staff-pin`, unified with the kiosk-unlock PIN rather than a second secret
  (section 8).
- Matching (section 6): ambiguous matches show candidates to pick from; a new
  account is always flagged for manual creation in Zoho, never auto-created;
  matching is scoped to the event's own State via `Shipping_US_State`, with no
  nationwide fallback. `Parent_Account` + `Organization_Level` handle the
  district/school distinction; existing linked Contacts are surfaced as
  corroborating context on a match.
- Within-event duplicates are checked first, before Zoho, and always force
  human review rather than auto-merging.
- Review app is a list, not a step-through queue; bulk-approve is supported.
- Card photos are never processed live during an event — only form/QR
  submissions need to work in real time, and those retry Zoho automatically in
  the background rather than blocking the kiosk.
- **Card-photo events use explicit per-event folder selection (`FolderCode`),
  not whichever `Event` is `IsActive`** — cards are processed after the event,
  possibly once a different one is already active by then, so the form path's
  `IsActive` shortcut doesn't apply here (section 5).
- `process-cards` OCRs only — the Zoho research/matching step is the same
  `research-contact`/`match-contact` pipeline the form path already uses, not
  a separate combined skill (section 5/6).
- **Stage 7 pilot hardening scoped down to one concrete fix**: a stuck-Pending
  auto-retry sweep + manual retry endpoint + a "stuck" flag on `/review`
  (section 6), plus a small bonus global exception handler. Confidence-
  threshold calibration is deferred to the live dry run, since `MatchConfidence`
  is pure LLM judgment with no numeric threshold in code to calibrate; a DOE
  roster supplement for sparse-state seed data stayed out of scope — the
  existing "+ add new" local-district fallback already covers it functionally.
- **Stage 13/14 (Twilio + voice memo)**: see section 9. A phone number binds to
  an event by texting its `FolderCode`; photos and voice memos both land in
  `InboundMessages` and are picked up by `local-agent` poll loops sharing the
  exact same downstream pipeline as the watcher/kiosk paths, so matching logic
  lives in exactly one place regardless of intake path.
- **Real bugs caught only once Stage 15 checked the frontend's contracts
  against the original `.NET` source** (not assumed from the schema alone):
  `districts-create`/`schools-create` had invented a dedup-by-name behavior
  the original never had; `contacts-duplicates` and `export-summary`/
  `export-csv` were missing outright; PostgREST can't disambiguate a
  self-referencing FK's direction from a column-name embed hint
  (`contacts!local_duplicate_of_contact_id(...)` silently resolved backwards)
  — fixed with a plain follow-up query instead of a PostgREST embed
  (`attachDuplicateNames`, `supabase/functions/_shared/contacts.ts`). All three
  only surfaced from real testing, not code review.
- **Supabase's new API key format** (`sb_publishable_...`/`sb_secret_...`)
  is a different value from the legacy JWT `service_role` key the dashboard
  also shows — both real, valid, for different systems. Edge Functions read
  `SUPABASE_SERVICE_ROLE_KEY` as the new-style key; `local-agent/.env` and
  `watcher/.env` need that one specifically, or auth checks silently 401.

**Still open (blocking a live pilot run):**
- **Twilio account + MMS-enabled phone number** — not yet created; secrets
  not yet set; the webhook has never received a real Twilio request (every
  test so far simulated what it would produce).
- **`local-agent`/`watcher` need to run continuously** on whichever Mac does
  this job — set up as macOS Login Items (section 2), with `claude`, `ffmpeg`,
  `sips`, and the `whisper` CLI confirmed present on that machine.
- **`frontend/` isn't deployed to Vercel yet** — code and `vercel.json` are
  ready, but nothing pushed to an actual account/project; once it is, the
  Supabase `ALLOWED_ORIGINS` secret needs the real Vercel URL(s) added (CORS
  currently only allows localhost).
- **Change the staff PIN off the default `1234`** before real use (section 8) —
  there's a change-PIN form on `/setup` already.
- **Old pilot data**: not yet checked whether the earlier local .NET Postgres
  database holds real pilot data that needs migrating into Supabase before
  cutover.
- **`backend/` (the old .NET app)**: nothing depends on it once the frontend
  is fully on Vercel — decommission or keep as reference, undecided.
- **Matching thresholds**: I haven't set actual score cutoffs for
  high/medium/low match confidence yet — that needs a first real pass against
  your data to calibrate rather than a guessed number up front.
- **`Conference` lookup field on Accounts**: exists, links Accounts to
  Campaigns, and is unused in every record I checked — worth asking whoever
  manages Zoho whether it was built for something we should be reusing here
  instead of (or alongside) our own `Events` table.
- **Seeding the district/school list**: still starts empty and grows via
  "add new," unchanged from the original design — never revisited in favor of
  seeding from an existing Zoho Accounts export/state DOE roster.
- **Still assumes one active event/table at a time**: `Events.is_active` is a
  single unique-partial-index row (section 3); two intake tables running at
  once against the same Supabase project would need a real multi-active-event
  design, not just "point both at the same database" — worth confirming if
  that's a real scenario before it comes up live.
