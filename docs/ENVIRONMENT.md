# Environment: every secret, setting and credential

Names and places only. **Never put a value in this file, in a commit, or in a
message.** If you find a real value in the repository, tell the owner and rotate it
([`RUNBOOKS.md`](RUNBOOKS.md), "Rotate a credential").

The Supabase project reference is `yrvppufkerbjpvrxniot` (it is public, and appears
in the code). Supabase's `config.toml` in this repo is an unedited command-line
template; no Supabase command-line tool is used here, so it governs nothing in
production.

## Supabase Edge Function settings

Set in the Supabase dashboard (Edge Functions, Secrets) or with `supabase secrets set`.
The first two are injected by Supabase and need no action.

| Name | Used by | What happens if it is missing or wrong |
|---|---|---|
| `SUPABASE_URL` | every function | Injected. Without it every route answers 500. |
| `SUPABASE_SERVICE_ROLE_KEY` | every function; `_shared/auth.ts` also compares an incoming key to it | Injected. It must be the legacy **JWT-format** service-role key (not the `sb_secret_…` format) because the functions n8n calls (`contacts-from-ocr`, `-note`, `-voice-memo`) have `verify_jwt` on, and n8n must send this same key. If they differ those three answer 401. |
| `ALLOWED_ORIGINS` | all browser-facing functions (`_shared/http.ts`) | A comma-separated list of the production web app origins. If unset, browsers are blocked by CORS except from `localhost` ports 9000 and 9200, and each request logs an error. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | `twilio-webhook`, `session-notifications` | Without them the webhook answers 500 "Twilio not configured" to every text, and the reminder job fails every minute. The token is also what verifies Twilio's request signature. |
| `TWILIO_WEBHOOK_URL` (optional) | `twilio-webhook` | The exact public URL Twilio posts to. If unset, the signature is checked against the request URL as the function sees it; behind a proxy that rewrites the host every webhook would be refused (403). |
| `OUTBOUND_SMS_ENABLED` (optional, default on) | `session-notifications` | The kill switch for the texts the system sends unprompted. Sending happens only when it is unset or exactly `true`; any other value stops it. It is read on each run, so no redeploy or cron edit is needed. |
| `MAX_SMS_PER_TICK` (optional, default 25) | `session-notifications` | A cap on texts per one-minute run. Use a whole number. |
| `INTAKE_RATE_MAX`, `INTAKE_RATE_WINDOW_MINUTES` (optional, defaults 20 and 10) | `contacts-create` | The per-network rate limit on the public form. Use whole numbers. |
| `INTAKE_QUEUE_IP_CAP`, `INTAKE_QUEUE_TOTAL_CAP` (optional, defaults 300 and 3000) | `contacts-create` | The caps on the held-scans queue per network per day and overall. Use whole numbers. |
| `IP_HASH_SALT` | `contacts-create` | A long random value used when it hashes a visitor's network address for the rate limit. Set it. If unset the code uses an empty salt without any error. |

## Supabase Vault and storage

| Item | Where | Used by |
|---|---|---|
| Vault secret `cron_dispatch_secret` | Supabase Vault | The cron job `session-notifications-dispatch` sends it in a header; `verify_cron_secret()` checks it. Without it every call to `session-notifications` answers 401. |
| Vault secret `n8n_webhook_secret` | Supabase Vault | `notify_n8n()` sends it in the header `x-ckh-webhook-secret`; the n8n credential **Supabase DB Webhook Secret** must hold the same value ([`n8n/README.md`](../n8n/README.md)). |
| Storage buckets `contact-photos`, `voice-memos` | Supabase Storage (private) | Card photos, crops and voice memo audio. Deleted after 90 days by the purge script, which is run by hand ([`DATA-RETENTION.md`](DATA-RETENTION.md)). |
| Auth settings: Site URL and Redirect URLs | Supabase dashboard, Authentication, URL Configuration | Must be the deployed app's URL, with `https://<app>/reset-password` in Redirect URLs, or password-reset emails land on the wrong page ([`ARCHITECTURE.md`](ARCHITECTURE.md), "Password reset"). Not in the repo. |
| Extensions `pg_cron`, `pg_net`, `pg_trgm`, `pgcrypto`, `uuid-ossp`, `supabase_vault`, `pg_stat_statements` | The database | Scheduled jobs, outbound webhooks, fuzzy search, encryption, secrets storage. |

## Web app (Vercel)

Set in the Vercel project settings (root directory `frontend/`). All three are
required, and are public values (see [`frontend/README.md`](../frontend/README.md)):

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_FUNCTIONS_BASE_URL` | `https://<project-ref>.supabase.co/functions/v1` |
| `VITE_SUPABASE_ANON_KEY` | the project's anon (public) key |

## n8n

Credentials, by their names in n8n (held by the n8n admin; the values are not
anywhere in this repository):

| Credential | Type | Attached to | If it is missing |
|---|---|---|---|
| Anthropic account 2 | Anthropic API | the five `skill-*` workflows only | every skill fails |
| Supabase account | Supabase API (service role) | the pipelines only (never a skill) | pipelines cannot read or write |
| Supabase DB Webhook Secret | Header Auth, header `x-ckh-webhook-secret` | each pipeline's webhook trigger | the webhook fast path answers 403; the 5-minute backstop still runs |
| OpenAI account 2 | OpenAI API | the voice pipelines (transcription only) | voice memos fail transiently and wait |
| FFmpeg Service Key | Header Auth | the v2 voice standby only | only matters if you roll back to v2 |
| Alert SMTP | SMTP | `error-alert-email` | **does not exist yet**; no failure emails are sent |

The `n8n_config` data table holds `ZOHO_MCP_URL`, the read-only Zoho connector's
address. The address contains a secret key; treat it as a secret. If it is missing or
masked, matching falls back to the local copy of Zoho Accounts
([`n8n/README.md`](../n8n/README.md), "Match without Zoho").

The community node `n8n-nodes-ffmpeg-audio` must be installed on the n8n host.

## Operator machine and CI

| Name | Where | Used by |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` (starts `sbp_`) | Your shell, or on macOS the Keychain item of the same name; a CI secret of the same name (GitHub) | `scripts/deploy-functions.mjs`, `scripts/check-deployed-functions.sh`. Without it a deploy stops with instructions, and the drift check prints `SKIP` and checks nothing. |
| `SUPABASE_PROJECT_REF` (optional) | Shell / CI secret | The same scripts; the real project is the built-in default. |
| `SUPABASE_ANON_KEY` | CI secret (GitHub only) | The 410 probe in `check-deployed-functions.sh`. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | `scripts/retention/.env` (git-ignored; copy `.env.example`) | `purge-expired-media.mjs`. Use the key format that matches what is deployed. |
| `RETENTION_DAYS`, `PURGE_BATCH` (optional) | the same environment | The purge's window (default 90) and batch size (default 500). |
| `FFMPEG_SERVICE_KEY` | Vercel project `audio-convert-ffmpeg` (Production environment); also the macOS Keychain on the machine that set it up | `n8n/ffmpeg-service` (the v2 standby). It fails closed (500) if unset. |

GitHub and GitLab each need the CI secrets above for the drift check to do anything;
the GitLab pipeline file does not set them, so there that check only prints `SKIP`.

## Other services (who holds them is the owner's decision)

Twilio (the number, the messaging registration and the webhook URL pointing at the
`twilio-webhook` function), Zoho CRM (the connected app behind the read-only
connector, and the import into which the CSV is loaded), Vercel (the web app project,
and the standby converter project), the claude.ai account that holds the daily health
routine, and the GitHub and GitLab repositories. [`HANDOFF.md`](HANDOFF.md) has a table
to record who owns each.
