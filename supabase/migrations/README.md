# Migration history notes

Migrations are **append-only** and are never edited after they're applied.
Where an early migration's comment describes an architecture that has since
been replaced, the replacement is noted here instead of rewriting history.

## Superseded comments

- **`20260902203000_initial_schema.sql`** — describes a shared staff-PIN auth
  model and creates `app_settings.staff_pin`. Superseded by real Supabase Auth
  + `profiles` in `20260911100000_create_profiles.sql` (commit `165d535`). The
  column was later renamed to `kiosk_code` (`20260914120000`) and then
  abandoned in favour of `profiles.kiosk_pin` (`20260914130000`);
  `app_settings` is unused and should be dropped.

- **`20260902232500_audio_transcription_trigger.sql`** — the Edge-Function
  transcription path it creates was dropped three days later in
  `20260903000000` and replaced by a local Whisper CLI step in
  `local-agent/`. The Edge Function itself stayed deployed and callable for
  three months afterwards; it is now a 410 stub.

- **`20260911101500_export_and_mark_synced_fn.sql`** and
  **`20260914200000_export_includes_new_accounts.sql`** — `export_and_mark_synced()`
  stamped `synced_at` before the CSV was delivered, so a dropped download lost
  those leads permanently. Replaced by the two-phase
  `export_reserve` / `export_confirm` / `export_release_stale` in
  `..._export_two_phase_batches`. The old function is left in place but is no
  longer called by `export-csv`.

- **`insert_contact_with_duplicate_check`** — recreated several times to thread
  new columns through (`qr_channel`, `rep_id`, `source_note_id`, and now
  `contact_intent` in `20260915120500`). Every version
  before `..._duplicate_check_exact_and_scoped` used
  `first_name ILIKE trim(...)` against raw attendee/OCR text, which treats `%`
  and `_` in the input as wildcards and matched globally across all events. If
  you recreate it again, start from the current definition, not an older one.

- **`20260902203000_initial_schema.sql`** and **`20260902203500_events_activate_fn.sql`**
  — describe/enforce exactly one active event system-wide
  (`events_one_active_idx`, `events_activate()` deactivating every other row).
  That stopped matching reality once multiple reps ran concurrent conferences;
  superseded by `20260915120000_event_slug_and_concurrent_events.sql`, which
  drops the exclusivity index and adds a per-event `slug` that the booth/
  session QR URL now carries so submissions resolve to the *specific* event
  scanned, not "the" active one.

- **`20260915120000_event_slug_and_concurrent_events.sql`** — its version of
  `events_activate()` slugified the *entire* campaign name with no length
  cap, producing QR fallback URLs too long to type for any real (non-test)
  conference name. Superseded by `20260916100000_shorter_event_slugs.sql`,
  which takes just the first non-stopword word (same idea as `folder_code`'s
  short-word budget, simplified to a single word since that's all a slug
  needs to be recognizable).

## n8n migration additions

- **`20260922100000_backfill_undocumented_functions.sql`** — during the n8n
  migration's research phase, five functions turned up that live code calls
  in production (`claim_contacts_needing_intent`, `export_reserve`,
  `export_confirm`, `export_release_stale`, `check_submission_rate`) but had
  no corresponding file anywhere in this directory — the committed migration
  history was incomplete relative to the deployed schema. This migration
  backfills them verbatim (pulled via `pg_get_functiondef` against the live
  project); it changes nothing about current behavior.
- **`20260922100100_n8n_circuit_breaker.sql`** — adds `circuit_breaker` (a
  shared rate-limit cooldown row n8n's skill sub-workflows check/trip, since
  n8n executions don't share process memory the way `local-agent`'s single
  Node process did) and a narrowly-scoped `n8n_circuit_breaker` role. Purely
  additive; does not touch `local-agent`/`watch-cards.command`, which remain
  the live system until the n8n migration's later phases cut over.
  **Dead as of 2026-09-24.** Only the archived first n8n build ever used it;
  `local-agent` never did. The rebuild dropped circuit breakers: n8n calls the
  Anthropic API with a key, so a 429 lasts seconds, not the hours a Claude
  subscription limit did. Transient errors are handled by retry/backoff and
  attempt refunds instead (`n8n/README.md`). `circuit_breaker` and the
  `n8n_circuit_breaker` role can be dropped by a later migration.

## n8n rebuild (2026-09-25)

- **`20260925190525_contact_note_write_rpcs.sql`** adds
  `append_contact_interaction_notes` and `set_contact_intent_if_current`, both
  service-role only. They replace two n8n writes that put a contact's full
  `interaction_notes` in the request URL as a guard, which fails (414) once
  notes grow long. The append is also atomic and idempotent, so it can't lose a
  reviewer's concurrent edit. Nothing calls either function until the n8n
  pipelines are cut over.
- **Not yet applied:** `n8n/cutover-migrations/` holds the Database Webhook
  triggers and a `finalize_contact_match` guard (`match_status = 'pending'`).
  They're kept out of this directory so nothing applies them early. When each
  one is applied, move it here under its recorded version.

## match-contact without Zoho (2026-09-29)

- **`20260929170000_match_candidate_accounts_fn.sql`** adds
  `match_candidate_accounts(states, district_tokens, school_tokens, limit)`,
  service-role only. It is how `pipeline-match-contact` hands
  `skill-match-contact` a list of real Zoho Accounts (from the
  `school_districts`/`schools` copy) when the Zoho MCP endpoint is unusable.
  Applied through the Supabase MCP under its own version stamp, so the
  timestamp in this file name is not the recorded one.

- **`20260929180000_voice_memo_multi_contact.sql`** replaces the partial unique
  index `contacts_voice_memo_source_message_id_idx` (one `voice_memo` contact
  per memo) with `contacts_voice_memo_source_message_person_idx` (one per memo
  *and person*). The 2026-09-28 migration's comment that a memo "can only ever
  produce at most one contact" no longer holds: a memo now also creates a
  contact for every person the rep met and described who matches no
  captured card (`contacts-from-voice-memo`, `unplacedContacts`). Applied through the
  Supabase MCP under its own version stamp.

## Voice-memo link-state and OCR-retry (2026-09-22 audit)

- **`20260922110000_voice_memo_link_state_and_ocr_retry.sql`** — adds
  `inbound_messages.link_status`/`link_attempts`/`last_link_attempt_at`
  (mirrors `contacts.match_status`/`match_attempts`/`last_match_attempt_at`)
  and `processing_attempts`/`last_processing_attempt_at`/`error_class`, plus
  `claim_unlinked_audio_messages` and
  `reconcile_retryable_failed_inbound_messages`. Fixes voice memos going
  permanently unattached or attaching to the wrong contact, and photo OCR
  having no retry at all — see `docs/ARCHITECTURE.md`'s "Claim-based retry"
  convention and `docs/ENGINEERING-LESSONS.md` #14 for the full incident.
  Schema-only: `local-agent/agent.mjs` was updated in the same change to
  actually use the new columns/functions, so there's no gap where the schema
  exists but nothing reads or writes it.

## Voice-memo fallback contact creation (2026-09-28)

- **`20260928120000_voice_memo_fallback_contact_creation.sql`** extends two
  of the check constraints added above rather than replacing their
  description: `contacts.source` gains `'voice_memo'`, and
  `inbound_messages.link_status` gains a fourth value, `contact_created`
  (distinct from `linked` — see the column comment this migration rewrites).
  Also adds a partial unique index on `contacts(source_message_id) WHERE
  source = 'voice_memo'` so `contacts-from-voice-memo` can dedupe a retried
  create the same way `contacts-from-ocr` dedupes on `source_image_hash`.
  Schema-only, same shape as the 2026-09-22 entry above: `local-agent/agent.mjs`
  and the new `contacts-from-voice-memo` Edge Function were added in the same
  change. See `docs/ARCHITECTURE.md`'s "Voice-memo fallback contact creation".

## Event dates for Setup (2026-09-30)

- **`20260930120000_event_dates_fn.sql`** adds `event_dates(uuid[])`, a thin
  wrapper over `conference_date_from_name()` / `conference_end_date_from_name()`
  that returns start and end dates for live events. `events-list-active` calls it
  so Setup can show "Sep 30 to Oct 2" and an "Ended N days ago" chip without a
  second date parser in TypeScript. Service role only (execute revoked from
  `anon`/`authenticated`). Undated names (test conferences) return nulls. Run over
  every event when added: 19 events, 5 with dates in the name, 3 of them ranges.

## Watch out for

- **`create or replace` with a changed argument list silently drops settings.**
  `events_activate` lost its pinned `search_path` that way and had to be
  re-pinned. Prefer declaring `set search_path = public` inside the function
  body so it survives a later replace.

- **Generated columns must be immutable.** `timestamptz + interval` is not (it
  depends on the session TimeZone), so Postgres rejects it in a generated
  expression. The media-retention window is a function parameter for this
  reason.

- **Applying migrations.** Use the Supabase MCP tools. Do **not** run
  `supabase db push` — it would replay ~30 migrations against production, and
  there is no Supabase CLI on the deploy host anyway.

- **`20261005120000_retire_contact_intent_classifier.sql`** — drops the
  `contacts_notify_n8n_contact_intent` trigger and the two RPCs behind the heat
  classifier. `20260910140000_add_contact_intent.sql`, `20260915120500` and
  `20260925222514_trigger_contact_intent.sql` describe a feature that no longer
  runs; the `contact_intent*` columns are kept on purpose, and
  `insert_contact_with_duplicate_check` still maps a `contact_intent` payload key
  (nothing sends one). Recreate that function before ever dropping the columns.
