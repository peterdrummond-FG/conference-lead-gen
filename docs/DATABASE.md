# The database: tables, jobs, triggers and who calls what

What is in the live Supabase Postgres database, as read from the live catalogs on
2026-10-08. If this disagrees with the database, the database is right: re-read it
with the Supabase tools (`list_tables`, `list_migrations`) or SQL against `pg_catalog`.
For how the migration files relate to the live database, read
[`supabase/migrations/README.md`](../supabase/migrations/README.md).

**Row-level security (RLS)** is switched on for every table and **no table has a
policy**, so nothing can be read or written through the public key. Every read and
write goes through an Edge Function using the service-role key, which bypasses RLS.
That is deliberate; do not add a policy to "make something work", add a function.

## Tables (public schema)

| Table | What it holds |
|---|---|
| `contacts` | The leads. One row per person captured, with their source, match result, review status (`review_status`), a rep's notes, and Zoho match fields. The three `contact_intent*` columns belong to a retired "heat" classifier and are kept on purpose. |
| `events` | Conferences: name, state, slug (used in QR links), `is_active`, and the `folder_code` that used to bind a phone by text (never sent to a browser now). |
| `event_reps` | Which rep works which conference. |
| `profiles` | App users: role (`admin`, `solutionsSuccess`, `sales`), phone number, `current_event_id`, `rep_slug` (a rep's QR link), kiosk PIN, onboarding progress. Logins themselves live in Supabase Auth (`auth.users`). |
| `campaigns` | A cache of Zoho Campaigns of type conference, used by the conference search. |
| `school_districts`, `schools` | Copies of Zoho Accounts, used by the State, District and School pickers and by the match step's fallback. |
| `inbound_messages` | Everything texted to the Twilio number (photos, voice memos, notes), and the work queue for OCR and transcription: status, attempts, transcript, link state, and where the files are in Storage (`storage_path`, the original; `playback_path`, a voice memo's MP3 copy that browsers can play). |
| `note_submissions` | Pasted, texted or voice-memo-derived notes waiting for, or finished with, extraction into contacts. |
| `phone_event_bindings` | Which conference a phone's texted photos, memos and notes are filed under. |
| `conference_setup_sessions` | The state of an in-progress "SETUP" text conversation. |
| `unassigned_submissions` | Public form scans that could not be placed (no conference, conference ended, ...), held until Solutions Success files or discards them. Deleted after 90 days. |
| `export_batches` | Reservations made by the two-phase CSV export. |
| `public_submission_log` | The public form's rate-limit log; prunes itself after 24 hours. |
| `app_settings` | Unused. A legacy shared kiosk code from before per-user PINs. |
| `circuit_breaker` | Unused. A rate-limit cooldown the first n8n build used. |

Storage buckets (private): `contact-photos`, `voice-memos`.

## Scheduled jobs (`pg_cron`)

| Name | When | What |
|---|---|---|
| `session-notifications-dispatch` | every minute | Calls the `session-notifications` Edge Function (with the secret from the Vault) to send the "contact received" texts. |
| `purge-unassigned-submissions` | daily 03:15 UTC | `purge_unassigned_submissions(90)`: deletes held scans older than 90 days. |

There is **no** scheduled job for media retention: that is a script run by hand
([`DATA-RETENTION.md`](DATA-RETENTION.md)).

## Triggers

Four triggers call `notify_n8n('<path>')` to start an n8n pipeline; they are
described in [`n8n/README.md`](../n8n/README.md), "How the database starts a
pipeline". They are `contacts_notify_n8n_match` (new `pending` contact),
`inbound_messages_notify_n8n_cards` (photo ready for OCR),
`inbound_messages_notify_n8n_voice` (audio ready for transcription) and
`note_submissions_notify_n8n` (note waiting for extraction).

## Stored functions and who calls them

| Function | Called by |
|---|---|
| `insert_contact_with_duplicate_check` | `contacts-create`, `contacts-from-ocr`, `contacts-from-note`, `contacts-from-voice-memo`, and `assign_unassigned_submission` |
| `finalize_contact_match` | `pipeline-match-contact` (the only place a match result is applied; it never confirms a lead) |
| `claim_pending_contacts`, `match_candidate_accounts` | `pipeline-match-contact` |
| `claim_unlinked_audio_messages`, `append_contact_interaction_notes` | the voice pipeline |
| `reconcile_stale_inbound_messages`, `reconcile_retryable_failed_inbound_messages`, `reconcile_stale_note_submissions` | the pipelines' 5-minute backstops |
| `events_activate`, `events_complete` | `events-activate` and `twilio-webhook`; `events-complete` |
| `profile_set_current_event`, `profile_link_event_by_phone` | The only writers of `profiles.current_event_id` (checked by `scripts/check-conference-writers.mjs`) |
| `match_conferences_by_name`, `conference_search`, `event_dates`, `conference_date_from_name`, `conference_end_date_from_name` | The conference search, the SMS SETUP flow and the date display |
| `export_reserve`, `export_confirm`, `export_release_stale` | `export-csv`, `export-confirm` |
| `check_submission_rate`, `queue_unassigned_submission`, `assign_unassigned_submission`, `discard_unassigned_submission`, `purge_unassigned_submissions` | `contacts-create`, the `unassigned-*` functions, and the purge cron job |
| `verify_cron_secret`, `notify_n8n` | `session-notifications`; the four triggers |
| `expired_media`, `mark_media_purged` | `scripts/retention/purge-expired-media.mjs` (run by hand) |
| `health_check` | The daily health routine, which is built and currently switched off ([`ARCHITECTURE.md`](ARCHITECTURE.md), "Daily health check") |
| `export_and_mark_synced` | Nothing. It was replaced by the two-phase functions above and is left in place. |

The extension `pg_trgm` adds about thirty more functions (`similarity`, `set_limit`,
...) to the public schema; those are not ours.

## What each Edge Function does, and who may call it

`GET`/`POST` and so on, who can call it, and what it writes. "Signed in" means any of
the three roles. A `sales` rep who calls one of the `contacts-*` or `inbound-messages-*`
functions is limited on the server to their own rows. "Public" means no sign-in is
needed (the gateway still wants the public key).

| Function | Who may call | Writes |
|---|---|---|
| `campaigns-list` | signed in | nothing (read) |
| `contacts-bulk-approve` | signed in | `contacts.review_status` (a person's "Confirm all") |
| `contacts-bulk-delete` | signed in | deletes rejected contacts and their Storage files |
| `contacts-create` | public (a signed-in caller is credited) | a contact, or a held `unassigned_submissions` row |
| `contacts-duplicates` | signed in | nothing |
| `contacts-from-note`, `contacts-from-ocr`, `contacts-from-voice-memo` | the service-role key only (the n8n pipelines) | contacts |
| `contacts-list` | signed in | nothing |
| `contacts-mark-not-duplicate`, `contacts-merge-duplicates`, `contacts-patch`, `contacts-retry-match` | signed in | the contact row(s) |
| `contacts-photo` | signed in | nothing (signs a URL) |
| `districts-list`, `schools-list` | public | nothing |
| `events-activate` | signed in | an event; the caller's conference |
| `events-active` | public (a signed-in caller sees their own) | nothing |
| `events-assign-rep`, `events-complete` | admin, solutionsSuccess | `event_reps`; an event (ends it) |
| `events-list-active`, `events-list-recent` | signed in | nothing |
| `export-csv`, `export-confirm` | admin, solutionsSuccess | export batch reservation and confirmation |
| `export-summary` | admin, solutionsSuccess | nothing |
| `inbound-messages-assign`, `-create-contacts`, `-delete`, `-retry` | signed in | the memo or photo row, notes, contacts, Storage |
| `inbound-messages-audio`, `-link-candidates`, `-photo`, `-unresolved-list` | signed in | nothing |
| `kiosk-set-code`, `kiosk-verify-code` | signed in (own PIN only) | the caller's kiosk PIN; nothing |
| `me` | signed in | nothing |
| `notes-status`, `notes-submit` | signed in | nothing; a `note_submissions` row |
| `profiles-create`, `-delete`, `-update`, `-assign-current-event` | admin, solutionsSuccess (within the role hierarchy) | logins and profiles; the conference pointer |
| `profiles-list` | admin, solutionsSuccess | nothing (it fills in a missing `rep_slug` for a sales rep) |
| `profiles-set-current-event`, `profiles-complete-onboarding` | signed in | the caller's own profile |
| `session-notifications` | the cron secret only | `phone_event_bindings`; sends texts |
| `transcribe-voice-memo` | nobody (a retired 410 stub) | nothing |
| `twilio-webhook` | Twilio (checked by signature) | `inbound_messages`, `note_submissions`, `phone_event_bindings`, `conference_setup_sessions`, Storage |
| `unassigned-assign`, `-discard`, `-list` | admin, solutionsSuccess | files or discards a held scan; nothing |

Two functions are deployed with `verify_jwt` off and check their caller themselves:
`twilio-webhook` and `session-notifications`. Do not change that
(`scripts/deploy-functions.mjs`, `NO_JWT`). Every function's file begins with a
header saying the same in more detail.

## Objects that are no longer used

Kept, not dropped, because dropping needs a migration and nothing in the repository uses them:
`app_settings`, `circuit_breaker` and the database role `n8n_circuit_breaker`,
`export_and_mark_synced()`, `profiles.onboarded_at`, `phone_event_bindings.expiry_notified_at`
and the `contact_intent*` columns. Each is explained in
[`supabase/migrations/README.md`](../supabase/migrations/README.md).
