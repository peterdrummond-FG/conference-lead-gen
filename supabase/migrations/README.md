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
