# Conference Lead Gen

Conference lead capture for The Flippen Group. Reps collect contacts at a
booth; the system researches each one, matches them against Zoho CRM, shows
them to a human for review, and exports approved leads as a Zoho-ready CSV.

## How a lead gets in

Four intake paths, all landing in the same `contacts` table and all going
through the same downstream pipeline:

| Path | How | Processed |
|---|---|---|
| **Kiosk form / QR** | Attendee fills in a form on an iPad, or scans a booth/session QR code | Live, during the event |
| **Card photo — texted** | Rep texts a photo of a business card (and optionally a voice memo) to a Twilio number | After the event |
| **Card photo — dropped** | Rep drops photos into `watcher/inbox/<event-code>/` | After the event |
| **Pasted note** | Rep pastes a whole typed note covering several people into `/notes` | After the event |

Everything after intake is shared: research the person and resolve their real
district → match against Zoho Accounts/Contacts → flag duplicates → human
review → export.

## What happens to it

1. **OCR / extraction** — `process-cards` reads a card photo;
   `extract-note-contacts` splits a pasted note into people. Both return JSON;
   the caller does the writing.
2. **Research** — `research-contact` resolves the real district name and
   corroborates the person, via web search. No Zoho access.
3. **Match** — `match-contact` classifies against live Zoho data:
   `existing_contact` / `new_contact_existing_account` / `new_account` /
   `ambiguous`. Read-only; it never creates a Zoho record.
4. **Review** — a human approves, edits or rejects on `/review`. High-confidence
   matches with a real matched account may auto-approve.
5. **Export** — `/export` produces a CSV; leads are marked synced only once the
   browser confirms it actually received the file.

Voice memos are transcribed locally (Whisper CLI) and attributed to the right
contact, then classified hot/warm/cold.

## Stack

- **Frontend** — Vue 3 + Quasar, deployed on Vercel
- **Backend** — Supabase Edge Functions (Deno), one per route. The only
  server-side API.
- **Database** — Supabase Postgres. RLS enabled with **zero policies** on every
  table; all access goes through Edge Functions using the service-role key.
- **Storage** — Supabase Storage (`contact-photos`, `voice-memos`)
- **AI steps** — Claude Code skills invoked headlessly by `local-agent/` on a
  Mac. Deliberately local: no metered API key, no cloud dependency.
- **SMS** — Twilio (A2P 10DLC)

## Repository

| Path | What |
|---|---|
| `frontend/` | The SPA |
| `supabase/functions/` | Edge Functions — the API |
| `supabase/migrations/` | Schema and stored functions (append-only) |
| `local-agent/` | Five poll loops; the only caller of `claude -p` |
| `watcher/` | Folder-drop card pipeline |
| `.claude/skills/` | The seven skills |
| `scripts/` | Deploy script and CI guards |
| `docs/` | Architecture, data retention |

## Running it

Two long-running processes on a Mac, both installable as macOS Login Items:

```bash
local-agent/start-agent.command    # matching, SMS photos, transcription, intent, notes
watcher/watch-cards.command        # folder-drop card photos
```

They need `claude`, `whisper`, `ffmpeg` and `sips` on `PATH`, plus
`local-agent/.env` and `watcher/.env` (see the `.env.example` next to each).

Frontend:

```bash
cd frontend && npm install && npm run dev
```

Deploying Edge Functions needs a Supabase Management API token:

```bash
export SUPABASE_ACCESS_TOKEN=sbp_...
node scripts/deploy-functions.mjs
```

## Security posture

- Real per-user auth (Supabase Auth) with three roles: `admin`,
  `solutionsSuccess`, `sales`. A sales rep only ever sees their own contacts,
  enforced server-side.
- RLS deny-all; nothing is reachable except through an Edge Function.
- Skills run sandboxed — an explicit tool allowlist and `--strict-mcp-config`,
  so a prompt injected via a business card or voice memo cannot reach the
  operator's connected accounts. Skills are never given credentials.
- Model output is schema-validated before anything is persisted.
- Source media (card photos, voice memos) is purged after 90 days; see
  `docs/DATA-RETENTION.md`.

See `CLAUDE.md` for the rules that are load-bearing and why.

## Documentation

| Doc | Covers |
|---|---|
| `CLAUDE.md` | Working rules, gotchas, common commands |
| `docs/ARCHITECTURE.md` | Component map and conventions |
| `docs/DATA-RETENTION.md` | What's held about whom, and for how long |
| `MASS_Alliance_Pilot_App_Architecture.md` | Full design rationale and history |
| `supabase/migrations/README.md` | Notes on superseded migrations |
