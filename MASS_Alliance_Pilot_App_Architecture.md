# App architecture — MASS/Alliance contact capture (local pilot)

## 1. Overview

Two intake paths feed one database. Before anything reaches Zoho, every new
contact is first checked against everyone already captured at the *same event*
— catching the same person's card photographed twice, or someone who both
scanned the QR code and handed over a card — since that's a cheaper, faster
check than a Zoho round-trip and shouldn't wait on one. Only after that does a
contact get cross-referenced against your existing Zoho Contacts and Accounts,
so we're avoiding duplicate people and duplicate school-district records in
Zoho itself, not just duplicate local entries. Card-photo data additionally
passes through OCR and research via Claude before it reaches either check,
since it starts as a photo, not typed text — and unlike form submissions,
**card photos aren't processed live during the event at all**; they're
collected at the table and run through the pipeline afterward, back on normal
office WiFi. Only form/QR submissions need to work in real time at the venue.

Before either path opens, a sales rep runs a one-time setup step per convention:
pick the event from a list of Zoho Campaigns (`Type = conference`), which locks
that table's State/City and Lead Source for the rest of the day.

**Stack is mixed by design, not by accident:**
- **Backend + database**: ASP.NET Core (.NET) + PostgreSQL — your standing
  requirement, regardless of what any reference project uses.
- **Frontend + photo pipeline pattern**: Vue 3 + Quasar, plus the watch-folder →
  Claude Code CLI approach — both taken from `good-wrap-main`, since that's a
  real, working pattern already in use at Flippen Group rather than something I'd
  be inventing.

## 2. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Backend | ASP.NET Core Web API (.NET 8) | Standing requirement |
| Database | PostgreSQL, installed natively via Homebrew | Standing requirement; native install avoids a Docker Desktop dependency on a single dev machine |
| ORM | Entity Framework Core, code-first migrations | .NET's equivalent of GoodWrap's Drizzle setup |
| Frontend | Vue 3 + Quasar (SPA mode) | Matches `good-wrap-main`'s dashboard; Vite dev server proxies `/api` to the .NET backend locally, same as it proxies to GoodWrap's Fastify API |
| Card-photo pipeline | A watch-folder script that shells out to the Claude Code CLI (`claude -p ... --dangerously-skip-permissions`) headlessly, running a dedicated Skill | Mirrors GoodWrap's `start_scanfolder_watcher.command` pattern exactly — billed to your Claude Code plan instead of a metered API key, and it's a pattern you already have running in production for another project |

### Prerequisites (things that need to exist before anyone writes code)
- **Zoho OAuth credentials** — a connected app / API client with read access to
  Campaigns, Accounts, and Contacts, and read-write to Contacts and Accounts for
  the eventual "create Account" step. Stored in a local `.env`, gitignored, same
  convention as GoodWrap.
- **Claude Code CLI logged in** on the machine running the watcher script, so
  `claude -p` runs headlessly without a fresh login prompt.
- **.NET SDK, Node.js (for Quasar CLI), PostgreSQL** installed locally (Postgres via Homebrew, not Docker).

## 3. Data model

Same logical schema as before, now as EF Core entities against Postgres instead
of SQLite tables:

### `Events` (local record of the Zoho Campaign picked at setup)
| column | type | notes |
|---|---|---|
| Id | uuid PK | |
| ZohoCampaignId | text | the Campaign's Zoho record ID |
| Name | text | Campaign Name — becomes the Lead Source on export |
| State | text | from Campaign's `State` field |
| City | text | from Campaign's `City` field (Zoho has no County field) |
| ActivatedAt | timestamptz | when a rep locked this table to the event |

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
| LocalDuplicateOfContactId | uuid, FK → Contacts.Id | nullable — set when this looks like the same person as another contact already captured at the same event |
| ReviewStatus | text | `approved` / `needs_review` / `rejected` |
| Notes | text | OCR/research/matching notes |
| SourceImagePath | text | nullable — only for card_photo rows |
| SourceImageHash | text | content hash of the photo, for dedup — see pipeline note below |
| CreatedAt | timestamptz | |

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

| Route | Purpose |
|---|---|
| `GET /setup` (Quasar page) | One-time-per-event screen. Rep searches/selects the Zoho Campaign for today, types in State/City (see note below), and on confirm activates a row in `Events` and generates the QR code pointing at `/intake` |
| `GET /api/campaigns?search=` | .NET endpoint, searches a local Postgres cache of Campaigns (`Type = conference`), synced periodically via `dotnet run -- sync-campaigns` from a Claude-driven Zoho pull — not a live Zoho call. (Named `/campaigns`, not `/events` as originally sketched here — the cache is its own `Campaign` entity, distinct from an *activated* `Event`, and naming the search route after `Event` was actively confusing once that split existed.) |
| `POST /api/events` | Activates a cached Campaign into a new `Event` row. Takes `state`/`city` directly from the rep — see note below, Zoho has no such data to copy |
| `GET /intake` (Quasar page) | The form for the currently active event. State/City shown as fixed context. District and school are type-ahead selects with "+ add new." |
| `POST /api/contacts` | Saves a form row, runs the within-event duplicate check synchronously, then enqueues it for background matching (`research-contact` → `match-contact`, below) — the response returns immediately, before matching completes |
| `GET /api/districts?search=` / `GET /api/schools?districtId=&search=` | Type-ahead lookups |
| `POST /api/districts` / `POST /api/schools` | Add-new, called when someone types something not already in the list |
| `GET /review` (Quasar page) | The clearinghouse — a list view, not a step-through queue, so reviewers can tackle records in any order and bulk-approve a batch of high-confidence ones in one action. Each row shows: source photo (if any) next to editable fields, extraction confidence, a "possible duplicate of [name]" flag when `LocalDuplicateOfContactId` is set, and — when `MatchConfidence = medium` — a picker showing `CandidateMatches` to resolve against. Approve / Edit / Reject per row or in bulk |
| `PATCH /api/contacts/{id}` | Updates a row's fields, resolves a candidate match, and/or updates status |
| `GET /export` (Quasar page) | Generates the Zoho-ready CSV from all `approved` rows. Rows with `MatchStatus = new_account` are excluded until a human has created the Account in Zoho and linked it |
| `POST /api/contacts/from-ocr` | Called by the watcher script (see below) — not by a browser. Inserts one `needs_review` row per card found in a photo |

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

## 5. Card-photo pipeline — mirroring GoodWrap's watcher

Instead of the API polling a folder itself, a small standalone script does — same
division of responsibility as GoodWrap's `downloads_watcher.py` /
`start_scanfolder_watcher.command` pair:

1. Photos land in a local folder (drag-and-drop, AirDrop, whatever's easiest at
   the venue).
2. A polling loop (a `.command` script run as a macOS Login Item, same mechanism
   GoodWrap uses and for the same reason — it inherits Terminal's folder
   permissions instead of losing them silently the way a background LaunchAgent
   does) calls `claude -p` headlessly against a dedicated Skill
   (`.claude/skills/process-cards/SKILL.md`) that OCRs each new photo, runs the
   research step on any gaps, and POSTs the result to `/api/contacts/from-ocr`.
3. Each photo is hashed on arrival; the hash is checked against `SourceImageHash`
   before processing, so re-running the watcher or re-dropping a photo is always
   safe — a repeat is a no-op, not a duplicate contact. Straight from GoodWrap's
   "uploads are idempotent" design.
4. Same cost reasoning as GoodWrap: this runs on your Claude Code plan, not a
   metered `ANTHROPIC_API_KEY` — worth keeping in mind if photo volume is high,
   since GoodWrap paces itself with a cooldown between runs for exactly that
   reason (`SCAN_COOLDOWN_SECONDS`). Worth adopting the same pacing here if a
   convention generates a big batch of photos at once.

This is the one piece I'm defaulting on rather than asking about outright — it's
a real pattern you already run elsewhere, so it seemed like the obvious fit. Say
so if you'd rather call the Anthropic API directly from the .NET backend instead
(simpler code path, but back to metered API billing instead of your Code plan).

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

- **`pending`** — the check hasn't completed yet. Only applies to form
  submissions (see "Async for forms" below); card-photo rows are only ever
  created once their pipeline run, including this check, has already finished.
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

**Web search is the fallback when Zoho alone can't tell.** Zoho's fuzzy match
runs first, same as above. Only when that comes back weak or ambiguous — no
confident Account/Contact hit — does the skill do a live web search on the
person and their stated (or partial) institution, to confirm identity or
resolve which real district/school they belong to (e.g. an attendee wrote just
"Jefferson," or a card's district name doesn't cleanly match anything in Zoho).
This applies to both intake paths, not just card photos — a form submission can
be just as ambiguous as a card. Whatever the search turns up is folded in as
**another candidate signal**, not a final answer: it can raise or lower
`MatchConfidence` and adds context to `CandidateMatches`/`Notes` for the
reviewer, but it never auto-creates an Account or auto-resolves an `ambiguous`
row by itself — a human still makes that call in `/review`. High-confidence
Zoho hits skip the web search entirely, so the common case (a real, unambiguous
match) never pays for it.

**Where this runs**: the same Claude Code CLI skill that does OCR/research for
card photos also does the Zoho lookup (and, when needed, the web-search
fallback) in the same pass, since it already has read access to Zoho CRM. For
form submissions — which skip OCR but still need this same matching-and-research
check — the .NET API triggers that skill directly (a quick, synchronous
`claude -p` call against a narrower version of the skill that starts from typed
fields instead of a photo) right after saving the row, rather than duplicating
matching logic inside the .NET backend itself. One place decides what counts as
a match — and when web research is worth doing — regardless of which intake
path a contact came from.

**"+ Add new" district/school doesn't skip this.** Typing a district that isn't
in our own local `SchoolDistricts` list only means it's new *to us* — it could
already exist as a Zoho Account under slightly different spelling. Adding a new
local district/school still runs the same matching check against Zoho; "not in
our list" and "not in Zoho" are different questions, and only the second one
actually matters for `MatchStatus`.

**Async for forms, per your call.** The kiosk can't sit and wait on a Zoho
round-trip mid-event — a submission saves immediately (`MatchStatus = pending`)
and the kiosk resets right away, same as always. The matching check kicks off
right after, and if Zoho is briefly unreachable it retries automatically in the
background rather than failing the submission or blocking the next attendee.
Card-photo rows never carry `pending` at all, since that whole pipeline already
runs after the event, when the matching check completing is just one more step
in an already-non-live process.

## 7. Kiosk behavior (iPad)

On submit: the form fades to a brief thank-you message ("Thanks — you're
entered!") for a few seconds, then clears and returns to blank automatically —
handled in the Quasar frontend, no server round-trip beyond the initial save.
The Zoho matching check runs after this point, asynchronously (section 6) — the
kiosk never waits on it, so a slow or briefly-down Zoho connection never shows
up as lag at the table.

## 8. Security note — one place GoodWrap's model doesn't transfer directly

GoodWrap's "no login screen" decision leans entirely on being bound to
`localhost` — nothing but the machine itself can reach it. **Our app is
deliberately reachable over the venue's local WiFi** so iPads and attendees'
phones can hit it, which is a materially different exposure: anyone on that WiFi
who finds or guesses the address could hit `/review` or `/export`, not just
`/intake`.

**Decision: no auth for the pilot.** `/setup`, `/review`, and `/export` are open
on the local WiFi during the pilot, same as `/intake` — accepted risk for a
short-lived, staff-supervised test run. For the production version, a staff PIN
on those three routes is a minimum requirement before it runs unsupervised —
noted here so it doesn't get lost between the pilot and the real build.

## 9. Resolved and open items

**Resolved:**
- Backend/database stay .NET + Postgres regardless of reference project.
- Frontend and photo-pipeline pattern follow `good-wrap-main` (Quasar/Vue,
  watch-folder + Claude Code CLI).
- Events = Zoho Campaigns, `Type = conference`; City used in place of County
  (verified — Campaigns has no County field).
- Event locked per table for the whole day; event name becomes Lead Source.
- No auth for the pilot; a staff PIN on `/setup`, `/review`, `/export` is a
  minimum requirement for the production version (see section 8) — not building
  it now, not forgetting it either.
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

**Still open:**
- **Watcher billing model**: defaulted to mirroring GoodWrap's Claude Code CLI
  approach (see section 5) — confirm or override.
- **State/City as event context, not attendee's own location** — still reading
  it this way given how many different counties one event's attendees came from
  in the first card batch.
- **Seeding the district/school list**: start empty and grow via "add new," or
  seed from an existing Zoho Accounts export/state DOE roster.
- **Single table assumed**: two intake tables running at once would both need to
  reach the same Postgres instance rather than each running its own — worth
  confirming if that's a real scenario.
- **Matching thresholds**: I haven't set actual score cutoffs for
  high/medium/low match confidence yet — that needs a first real pass against
  your data to calibrate rather than a guessed number up front.
- **`Conference` lookup field on Accounts**: exists, links Accounts to
  Campaigns, and is unused in every record I checked — worth asking whoever
  manages Zoho whether it was built for something we should be reusing here
  instead of (or alongside) our own `Events` table.
