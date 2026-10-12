# CKH Connect

Conference lead capture for The Flippen Group. Reps and attendees put contacts
into the system at a conference. It researches each one, matches them against
Zoho CRM, shows them to a person to confirm, and exports the confirmed leads as a
CSV that Zoho imports.

**New to this repo? Start with [`docs/HANDOFF.md`](docs/HANDOFF.md).** It is the
five-minute orientation, the access list, and the index of every other document.

## Who uses it

| Role | What they do |
|---|---|
| `sales` (a rep) | Collects contacts at a conference, then confirms or edits them in **Contacts**. Sees only their own. |
| `solutionsSuccess` | Starts and ends conferences, creates and manages `sales` accounts, files scans that could not be placed, runs the **Export**. |
| `admin` | Everything above, and can also create `solutionsSuccess` accounts. |
| An attendee | Fills in the public form (the **Kiosk** or a QR code). Has no account. |

## How a lead gets in

Four ways in, all ending up in one `contacts` table and one shared pipeline:

| Way in | How | Where it goes |
|---|---|---|
| **Public form** | An attendee fills in the form on a Kiosk tablet or after scanning a rep's, booth's or session's QR code (`/connect`). | `contacts-create`. If a scan cannot be placed (no conference chosen, the conference ended) it waits in `unassigned_submissions` for Solutions Success to file. |
| **Texted photo or voice memo** | A rep texts a business-card photo, a photo of a printed attendee list, or a voice memo to the Twilio number. | `twilio-webhook` stores it in `inbound_messages`; an n8n pipeline reads the card or transcribes the memo. |
| **Texted note** | A rep texts a note about one person. | `twilio-webhook` stores it in `note_submissions`; an n8n pipeline turns it into a contact. |
| **Pasted note** | A rep pastes a note covering several people into the **Notes** page. | `notes-submit`, then the same pipeline. |

## What happens to a lead

1. **Read it.** A card photo is OCR'd; a pasted or texted note is split into one
   contact per person; a voice memo is transcribed and attributed to the right
   contact or contacts.
2. **Research** (`research-contact`): confirm who the person is and resolve the real
   school district name, by web search. It has no Zoho access.
3. **Match** (`match-contact`): classify against live Zoho data as
   `existing_contact`, `new_contact_existing_account`, `new_account` or `ambiguous`.
   It only reads Zoho; it never creates a record there.
4. **Confirm.** A person confirms, edits or rejects each lead on **Contacts**.
   **Nothing is ever auto-confirmed**: a match always leaves the lead for a person.
   (Decision of 2026-10-06; `scripts/check-no-auto-confirm.mjs` enforces it.) A
   rep's notes travel with the lead into the CSV's Description column.
5. **Export.** `/export` produces the CSV. The server reserves the leads when the
   file is made and marks them synced only after the person exporting confirms the
   download worked ("Did the file download?").

Steps 1 to 3 are five **skills**, each one AI call, run as n8n workflows. They
return JSON and are never given a credential; the pipeline that calls them does the
database writing and checks everything the model returned before using it
([`n8n/README.md`](n8n/README.md)).

## What it is made of

| Part | Where | Notes |
|---|---|---|
| Web app | [`frontend/`](frontend/README.md) | Vue 3 + Quasar single-page app on Vercel. Talks only to Edge Functions. |
| API | [`supabase/functions/`](supabase/functions) | Supabase Edge Functions (Deno), one per route. The only server-side API. |
| Database and storage | [`supabase/migrations/`](supabase/migrations/README.md) | Supabase Postgres. Row-level security (RLS) is on with **no policies**, so nothing is readable except through an Edge Function. Photos and voice memos are in Supabase Storage (`contact-photos`, `voice-memos`). |
| Pipelines and AI skills | [`n8n/`](n8n/README.md), [`.claude/skills/`](.claude/skills) | n8n workflows run by the n8n admin. `.claude/skills/<name>/SKILL.md` is the source of each skill's live prompt. |
| Text messages | Twilio | One number, registered for business texting (A2P 10DLC, which needs the public Privacy and Terms pages). Receives photos, memos and notes; sends confirmations. |
| CRM | Zoho | Read through a read-only connector; leads go in by CSV import. |
| Guards and scripts | [`scripts/`](scripts) | Repo checks run in CI, the deploy script, and the media purge. |

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) is the detailed component map and the
reasoning behind each design choice.

## Running and testing it

Nothing runs on a laptop except the web app. The pipelines exist only in n8n.

```bash
# The web app (needs frontend/.env; see frontend/README.md)
cd frontend && npm install && npm run dev

# The checks CI runs
cd frontend && npm run typecheck && npm test
cd n8n/schemas && npm ci && npm test
node --test n8n/scripts/check-n8n-credential-scopes.test.mjs
node scripts/check-conference-writers.mjs
node scripts/check-no-auto-confirm.mjs && node --test scripts/check-no-auto-confirm.test.mjs
node scripts/check-auth-signout.mjs
deno lint supabase/functions && deno test --no-lock supabase/functions/_shared/
```

Deploying and the other recurring jobs (functions, migrations, n8n, credentials) are
in [`docs/RUNBOOKS.md`](docs/RUNBOOKS.md). Where each secret lives (names and
places, never values) is in [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md).

## Security posture

- Real per-user sign-in (Supabase Auth) with the three roles above. A `sales`
  rep only ever sees their own contacts, enforced on the server.
- RLS on with no policies; all access goes through Edge Functions.
- A skill is allowed to hold only the AI model credential, never a database or Zoho
  write credential. It is enforced by a credential audit you run by hand after any
  workflow change ([`n8n/README.md`](n8n/README.md), Rule 5).
- Everything a model returns is checked against a schema before anything is saved.
- Photos and voice memos are meant to be deleted after 90 days
  ([`docs/DATA-RETENTION.md`](docs/DATA-RETENTION.md)).

The rules that must not be broken, and the incident behind each, are in
[`CLAUDE.md`](CLAUDE.md) (written for an AI coding assistant, but the content is for
everyone) and explained in plain language in [`docs/HANDOFF.md`](docs/HANDOFF.md).

## Documentation

| Doc | What it is for | Source of truth for |
|---|---|---|
| [`docs/HANDOFF.md`](docs/HANDOFF.md) | Orientation, access, plain-language rules, glossary, open items | The index |
| [`docs/RUNBOOKS.md`](docs/RUNBOOKS.md) | How to do the recurring jobs | Procedures |
| [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) | Every secret, setting and credential: where it is set and what breaks without it | Configuration |
| [`docs/DATABASE.md`](docs/DATABASE.md) | Tables, scheduled jobs, triggers and who calls the stored functions | The schema's purpose |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | How each part works and why | Behaviour of the app and API |
| [`n8n/README.md`](n8n/README.md) | The pipelines and skill workflows: ids, triggers, rollback | The pipelines |
| [`CLAUDE.md`](CLAUDE.md) | The load-bearing rules and gotchas | The rules |
| [`docs/ENGINEERING-LESSONS.md`](docs/ENGINEERING-LESSONS.md) | The September 2026 audit's bugs, turned into things to avoid, plus a pre-ship checklist | The checklist |
| [`docs/DATA-RETENTION.md`](docs/DATA-RETENTION.md) | What is held about whom, and for how long | Retention |
| [`supabase/migrations/README.md`](supabase/migrations/README.md) | Which old migrations were superseded | Migration history notes |
| [`MASS_Alliance_Pilot_App_Architecture.md`](MASS_Alliance_Pilot_App_Architecture.md) | The original design, written during the Supabase migration. **Historical**: parts describe a retired design. | Why it was first built this way |
| [`CODEOWNERS`](CODEOWNERS) | Who to ask for what. To be filled in by the receiving team. | Ownership |
