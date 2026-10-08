# Cutover migrations (not yet applied)

SQL that switches the n8n pipelines on, kept out of `supabase/migrations/` on
purpose so nothing applies it early. Each file has been dry-run against the live
project inside a transaction that was rolled back (2026-09-25): all seven
execute cleanly, and nothing persisted.

Apply through the Supabase MCP `apply_migration` tool, same as every other
migration here (never `supabase db push`). After each one, move the file into
`supabase/migrations/` named `<recorded version>_<name>.sql`, using the version
`list_migrations` shows for it, so the repo matches the database.

## Order

1. **`00_notify_n8n_function.sql`**: creates the vault secret
   `n8n_webhook_secret` and the `notify_n8n()` trigger function. Nothing fires
   yet. Then create the n8n credential **"Supabase DB Webhook Secret"**
   (Header Auth, name `x-ckh-webhook-secret`), with the value from:

   ```sql
   select decrypted_secret from vault.decrypted_secrets where name = 'n8n_webhook_secret';
   ```

   Attach it to each pipeline's DB Webhook trigger node.
2. **`finalize_contact_match_requires_pending.sql`**: the match-status guard.
   It's compatible with local-agent too, so it can go in any time before
   match-contact is live.
3. **One trigger file per pipeline**, applied when that pipeline is activated.
   This gives a staged cutover, lowest consequence first:

   | File | Pipeline | Webhook path |
   |---|---|---|
   | ~~`10_trigger_contact_intent.sql`~~ | ~~pipeline-contact-intent~~ | retired 2026-10-05 (heat removed; see `supabase/migrations/20261005120000_retire_contact_intent_classifier.sql`) |
   | `20_trigger_note_extraction.sql` | pipeline-note-extraction | `ckh-note-extraction` |
   | ~~`30_trigger_voice_transcription.sql`~~ | ~~pipeline-voice-transcription~~ | applied 2026-10-08 (`supabase/migrations/20261008163919_trigger_voice_transcription_n8n.sql`) |
   | `40_trigger_process_cards_sms.sql` | pipeline-process-cards-sms | `ckh-process-cards-sms` |
   | `50_trigger_match_contact.sql` | pipeline-match-contact | `ckh-match-contact` |

   Activate the n8n workflow before applying its trigger. A trigger pointed at
   an inactive workflow gets a 404, which is harmless: pg_net logs it, and the
   workflow's backstop would have caught the row anyway.

## Backing one out

```sql
drop trigger contacts_notify_n8n_match on public.contacts;  -- etc.
```

Deactivating the workflow alone also stops it (the webhook then 404s and the
backstop no longer runs), but it leaves pg_net requests failing every time a
row changes.
