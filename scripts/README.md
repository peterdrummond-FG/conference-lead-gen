# scripts

Every script has a usage header; this is the index. None needs a secret unless noted.

| Script | What it does | Run |
|---|---|---|
| `check-conference-writers.mjs` | Fails if an Edge Function writes `profiles.current_event_id` directly, or the Twilio webhook stops re-checking that a conference is active. | `node scripts/check-conference-writers.mjs` |
| `check-no-auto-confirm.mjs` (+ `.test.mjs`) | Fails if anything other than a person's Confirm writes `review_status = 'approved'` or `auto_approved = true`. | `node scripts/check-no-auto-confirm.mjs` and `node --test scripts/check-no-auto-confirm.test.mjs` |
| `check-auth-signout.mjs` | Fails if anything signs an account out of every device (`signOut` must be scope `local`). | `node scripts/check-auth-signout.mjs` |
| `check-deployed-functions.sh` | Compares the Edge Functions deployed to Supabase with `supabase/functions/`, and probes each retired slug for a 410. **Needs** `SUPABASE_ACCESS_TOKEN` (and `SUPABASE_ANON_KEY` for the probe). Without them it prints `SKIP` and exits 0 having checked nothing, so read its output. | `bash scripts/check-deployed-functions.sh` |
| `deploy-functions.mjs` | Deploys Edge Functions through the Supabase Management API, preserving `verify_jwt` (`NO_JWT`). **Needs** `SUPABASE_ACCESS_TOKEN` (env or macOS Keychain) except with `--dry-run`. | `node scripts/deploy-functions.mjs [name ...] [--dry-run]` |
| `retention/purge-expired-media.mjs` | Deletes photos and voice memos older than 90 days from Storage. **Not scheduled.** **Needs** `scripts/retention/.env`. | See `docs/DATA-RETENTION.md` |

The checks above run in CI (`.github/workflows/ci.yml` and `.gitlab-ci.yml`, which must
be kept in step). A guard that scans a directory skips one that is missing without
failing, so after moving or renaming a folder, confirm the guard still sees the files.
`n8n/scripts/` holds the n8n-side scripts (`build-skill-workflow.mjs`,
`check-n8n-credential-scopes.mjs`); see `n8n/README.md`.
