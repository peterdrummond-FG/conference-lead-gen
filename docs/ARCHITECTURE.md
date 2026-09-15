# Conference Lead Gen — component map

## Components

| Path | What it is |
|---|---|
| `frontend/` | Quasar SPA on Vercel. Talks only to Supabase Edge Functions. |
| `supabase/functions/` | The only server-side API. Service-role clients behind `requireUser()` role checks; RLS is deny-all with zero policies by design. |
| `supabase/migrations/` | Schema + stored functions. Append-only; never edited after the fact. |
| `supabase/seed/` | Zoho reference data (districts/schools/campaigns) for seeding a fresh environment. |
| `local-agent/` | Five poll loops (matching, SMS photo, transcription, intent, note extraction). The only caller of `claude -p`. |
| `watcher/` | Local folder drop → `process-cards` → `contacts-from-ocr`. |
| `.claude/skills/` | The seven skills. |
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
