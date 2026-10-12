# Handoff: start here

For a team that has never seen CKH Connect and has nobody to ask. Read this page, then
follow the links. Everything here is also in a more detailed document; this page says
which one.

## What it is

CKH Connect captures leads at conferences for The Flippen Group. Reps and attendees put
contacts in (a public form, texted photos and voice memos, notes). The system reads
each one, researches who they are, matches them against Zoho CRM, and puts them in front
of a person to confirm. Confirmed leads are exported as a CSV that Zoho imports.
([`README.md`](../README.md) has the longer version.)

## Five-minute orientation

```
 Attendee form (QR / Kiosk)      Rep texts a photo, memo or note        Rep pastes a note
            |                                  |                                |
     contacts-create                    twilio-webhook                     notes-submit
            \________________________________|________________________________/
                                             |
                          Supabase: Postgres + Storage  (Edge Functions are the only API)
                                             |   database triggers call n8n
                                             v
        n8n pipelines (run by the n8n admin) call five AI "skills", one model call each
        read the card / transcribe the memo / split the note -> research -> match to Zoho
                                             |
                          contacts wait, flagged, for a person
                                             |
                  Contacts page: confirm, edit or reject  (nothing is ever auto-confirmed)
                                             |
                       Export page -> CSV -> imported into Zoho by a person
```

- The **web app** (`frontend/`) is a Vue 3 + Quasar app on Vercel. It talks only to the
  Edge Functions, never to the database.
- The **API** is the Supabase Edge Functions (`supabase/functions/`, one folder per
  route). They are the only code with database access.
- The **pipelines** are n8n workflows. The source of each is in `n8n/pipelines/`; each
  skill's prompt is a `SKILL.md` in `.claude/skills/`. Nothing runs on a laptop.
- Four people-facing roles: an attendee (no account), `sales`, `solutionsSuccess`,
  `admin`.

## Where to read next

| You want to... | Read |
|---|---|
| Run the web app and the checks | [`README.md`](../README.md), "Running and testing it"; [`frontend/README.md`](../frontend/README.md) |
| Understand how a part works and why | [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) |
| Do a recurring job (deploy, migrate, rotate a credential, a stuck lead, ...) | [`docs/RUNBOOKS.md`](RUNBOOKS.md) |
| Find a secret, setting or credential | [`docs/ENVIRONMENT.md`](ENVIRONMENT.md) |
| Know what is in the database and who calls each function | [`docs/DATABASE.md`](DATABASE.md) |
| Work on the pipelines or skills | [`n8n/README.md`](../n8n/README.md), [`.claude/skills/README.md`](../.claude/skills/README.md) |
| Know what data is kept and for how long | [`docs/DATA-RETENTION.md`](DATA-RETENTION.md) |
| Avoid re-making the bugs the 2026 audit found | [`docs/ENGINEERING-LESSONS.md`](ENGINEERING-LESSONS.md) (finish with its checklist) |
| See the rules that must not be broken | [`CLAUDE.md`](../CLAUDE.md), and the plain-language list below |
| Understand an old migration | [`supabase/migrations/README.md`](../supabase/migrations/README.md) |
| See what each script does | [`scripts/README.md`](../scripts/README.md) |
| See the original design (historical) | [`MASS_Alliance_Pilot_App_Architecture.md`](../MASS_Alliance_Pilot_App_Architecture.md) |

**Which document wins?** For how the app and API behave, `ARCHITECTURE.md`. For the
pipelines, `n8n/README.md`. For the rules, `CLAUDE.md`. For the database, the database
itself (`DATABASE.md` is a snapshot). For anything in conflict with the code, the code.
`CLAUDE.md` is written for an AI coding assistant but is a good checklist for any
developer; this page is the version for people.

## Who owns what

The previous team is not available. Fill this in and move it to `CODEOWNERS` as you go.

| Thing | Used for | Owner |
|---|---|---|
| Supabase project `yrvppufkerbjpvrxniot` | Database, Storage, Edge Functions, sign-in | TBD |
| Vercel project (root `frontend/`) | The web app | TBD |
| Vercel project `audio-convert-ffmpeg` | Standby voice converter | TBD |
| n8n instance (editor `workflow.flippencodes.com`, webhooks `workflow.flippengroup.com`) | All pipelines and AI skills. Run by the n8n admin, not this team. | The n8n admin (name: TBD) |
| Twilio account and the number | Receiving photos, memos, notes; sending confirmations | TBD |
| Zoho CRM (connected app, the read-only connector, the CSV import) | Matching, and the destination of the export | TBD |
| Anthropic and OpenAI accounts | The AI skills; voice transcription | TBD (held by the n8n admin as credentials) |
| claude.ai account with the daily health routine | A morning report of stuck work (currently off) | TBD |
| GitHub and GitLab repositories | Source; CI | TBD |
| Product decisions ("is this behavior right?") | | TBD |

## The rules that must not be broken, in plain language

Each one exists because something went wrong. The code and `CLAUDE.md` hold the detail.

1. **An AI skill gets one credential only: the model's.** Skills read content from
   anyone who texts the number or fills in the form. When skills ran on a laptop they
   inherited the operator's email, Drive and CRM access, and a setting everyone
   believed restricted them did not. Now each skill is its own n8n workflow with only
   the model credential, and a script checks that after any change
   ([`n8n/README.md`](../n8n/README.md), Rule 5).
2. **A skill returns text; the pipeline writes.** Earlier, a skill that reads a photo
   from an outsider was handed a database key and told to use it.
3. **What a model returns is untrusted until checked.** Everything goes through a
   schema, and the pipeline re-checks what it acts on. A run once claimed a "high
   confidence" match to a Zoho id the model had made up. A validation failure leaves the
   row waiting for a person; nothing is half-written.
4. **Deleting a function's folder does not undeploy it.** Replace it with a 410 stub and
   list it in `RETIRED` in `scripts/check-deployed-functions.sh`. Two public,
   unauthenticated insert endpoints stayed live for three months because nobody compared
   what was deployed with what was in the repo.
5. **Keep `verify_jwt` off only for `twilio-webhook` and `session-notifications`.** They
   check their own caller. Turning it on breaks both without any error.
6. **Never edit a migration that has been applied.** Add a new one, and note history in
   `supabase/migrations/README.md`.
7. **Nothing is ever auto-confirmed.** A match result leaves the lead for a person.
   Before this rule a high-confidence match sent a lead to Zoho with no one looking. A
   CI check fails if any code but a person's Confirm writes `approved`.
8. **One conference everywhere.** A rep has two pointers (their app conference and
   where their texted media is filed). They drifted apart and leads landed in the wrong
   conference. Now one function writes both. Do not write them directly.
9. **A scan that cannot be placed is held, not rejected.** The public form used to
   answer an error and lose the person's details. Now it waits in a queue for Solutions
   Success.
10. **What the screen promises must be true in the pipeline.** The Notes tooltip said
    notes were in the Zoho import while the export did not read them. If you change what
    `export-csv` writes, change the tooltips and the onboarding tour too.
11. **The Kiosk tab's URL stays `/connect`.** It is printed on QR codes already in the
    field. Only the label changed.
12. **Mind the Content Security Policy.** An image set from a canvas data URL is
    silently blocked in production, and works in development. Test new images, scripts
    and hosts in a production build.
13. **Do not point the database's webhook at n8n's editor address.** It must stay on the
    webhook host or every pipeline trigger stops
    ([`n8n/README.md`](../n8n/README.md)).

## Not done yet

Things that are known to be open, so you do not discover them by surprise. None of
these changes how the system behaves today.

- **The media retention purge is not scheduled.** The 90-day rule is a documented policy
  and a script someone has to run ([`DATA-RETENTION.md`](DATA-RETENTION.md)).
- **No failure alerting.** The email workflow `error-alert-email` is built but off: it
  needs an SMTP credential and addresses. A stopped pipeline shows up as leads waiting
  too long.
- **The daily health check is switched off.** The routine exists in a claude.ai account
  ([`RUNBOOKS.md`](RUNBOOKS.md), "Re-enable the daily health routine").
- **The n8n credential audit is not part of CI.** It needs an export of the live
  workflows; run it by hand after any change.
- **`unplacedContacts` is not ported.** People a rep mentions in a voice memo but did
  not photograph are returned by the skill and then ignored.
- **How new Zoho Campaigns reach the conference list is not defined**
  ([`RUNBOOKS.md`](RUNBOOKS.md), "Add a conference").
- **No request path for access or erasure of a person's data**
  ([`DATA-RETENTION.md`](DATA-RETENTION.md)).
- **The migration files do not rebuild the database on their own**
  ([`supabase/migrations/README.md`](../supabase/migrations/README.md)).
- **Two leftover inactive workflows** in n8n (`skill-classify-contact-intent` and a
  `Probe` workflow) are for the n8n admin to archive.

## Words you will meet

| Word | Meaning |
|---|---|
| **Edge Function** | One small server program in Supabase (Deno), one per route. The only API. |
| **JWT / `verify_jwt`** | A signed login token. `verify_jwt` makes Supabase's gateway demand a valid one before a function runs. |
| **Anon key / service-role key** | The public key the web app carries, and the all-powerful server key. Only the second can read the database. |
| **RLS (row-level security)** | A database feature that restricts rows per user. Here it is on with no rules, so the public key can read nothing. |
| **PostgREST** | Supabase's automatic web layer over the tables. Its 1,000-row cap and its limits on comparing two columns explain several functions. |
| **CTE** | An SQL `WITH` clause. Parts of one statement see the same snapshot of the data. |
| **n8n** | The workflow tool the pipelines run in. A **pipeline** is a workflow that owns triggers and writes; a **skill** is a workflow that makes one AI call and returns JSON. |
| **Claim** | An atomic "take this row" update, so only one worker handles a row, with the attempt count stored on the row. |
| **Backstop / reconcile sweep** | A five-minute run inside each pipeline that picks up rows the instant webhook missed or that failed temporarily. |
| **Database webhook** | A database trigger that calls n8n the moment a row changes (`notify_n8n()`). |
| **`pg_cron`, `pg_net`, Vault** | Database extensions for scheduled jobs, outgoing web calls and encrypted secrets. |
| **`callerPolicy`** | An n8n setting limiting which workflow may call a skill. |
| **MCP** | A standard way to give a model tools. The match step reads Zoho through a read-only MCP connector. |
| **Structured Output Parser** | The n8n step that rejects a model's answer if it does not match the skill's JSON schema. |
| **A2P 10DLC** | The US carrier registration a business needs to text from an ordinary phone number. It was rejected several times over consent wording; the Privacy and Terms pages exist for it. |
| **SETUP** | The word a rep texts to the number to link their phone to a conference. |
| **Folder code** | A short token that once bound a phone to a conference by text. Never sent to a browser now; texting SETUP replaced it. |
| **Solutions Success** | Flippen's internal support role (`solutionsSuccess`): like admin for conferences, people and filing held scans. |
| **Kiosk** | The public attendee form on a tablet. The signed-in tab is labelled Kiosk; its URL is `/connect`. |
| **Rep QR / booth / session QR** | A rep's own reusable QR link, versus the older per-conference QR with a booth or session channel. |
| **Held scan** | A public submission that could not be placed under a conference, waiting in `unassigned_submissions`. |
| **Ready to confirm** | The Contacts rule: match finished, no possible duplicate, an email or phone, and a school or district. The rule is in `frontend/src/utils/contactsList.ts`. |
| **Lead Source / Capture Channel** | Two Zoho import columns: the conference name, and the attendee's own answer (booth or session). |
| **Two-phase export** | The export reserves the leads, then marks them synced only after the person confirms the file downloaded. |
| **Zoho Campaign** | A Zoho CRM record (type conference). The `campaigns` table caches them; an `events` row is a conference actually in use. |
| **"Stage N" in old comments** | The numbered build phases of the original Supabase migration, described in the historical design doc. |
| **"The agent", `local-agent`, the watcher** | The retired laptop programs that used to run the AI steps (removed 2026-10-08). Their code is in git history before commit `1cb0ea2`. |
