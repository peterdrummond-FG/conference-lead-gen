# Data retention

Audit S12. Written because nothing was deleting anything, ever.

## What this system holds about people who never signed up for it

Conference attendees hand a rep a business card, or fill in a booth form. What
that produces:

| Data | Where | Sensitivity |
|---|---|---|
| Name, title, email, direct line, employer | `contacts` | ordinary business-card data |
| Photograph of the card | `contact-photos` bucket | an image of an identifiable person's details |
| Voice memo audio | `voice-memos` bucket | a rep's candid spoken assessment **of a named third party** |
| Transcript of that memo | `inbound_messages.transcript` | same, in text |
| `interaction_notes` | `contacts` | the above, concatenated, plus rep-typed notes |
| Pasted note body | `note_submissions.body` | same |

The voice-memo line is the one that matters most. The skill's own example is
*"he doesn't fit the job description"* and *"her school district is going to
purchase every single product"* — opinions about identifiable people, recorded
without their knowledge, stored against their record and fed to a classifier.

## Policy

**Source media: 90 days.** Card photos and voice-memo audio are deleted from
Storage 90 days after arrival. Their extracted content (the contact fields, the
transcript) has long since been written to the database; the media itself is
only ever re-read for a manual "view full sheet" check, which is a
days-to-weeks need, not a years one.

**Derived text: lives with the contact.** Transcripts and `interaction_notes`
are the business value and stay for as long as the contact record does. They
are governed by the contact's lifecycle, not a timer.

**Deletion means deletion.** Deleting a contact removes its card photo, its
crop, and any voice memo reached through `source_message_id`.

## Mechanism

- `expired_media(p_retention_days, p_limit)` — the single definition of the
  retention rule.
- `local-agent/purge-expired-media.mjs` — deletes the Storage objects, then
  calls `mark_media_purged` to null `storage_path`. Supports `--dry-run` and a
  `RETENTION_DAYS` override. Deliberately does not touch rows, transcripts, or
  the contacts the media produced; `contacts-photo` already returns a clean 404
  for a missing object.
- `contacts-bulk-delete` — removes photos, crops and audio before deleting rows.
- `inbound-messages-delete` — same shape for a voice memo that never linked to
  any contact (Review's "Delete" action on the unresolved-intake list):
  removes the audio from the `voice-memos` bucket, then deletes the
  `inbound_messages` row — transcript included, since nothing else points at
  it once the row is gone.

### Running it

Not yet scheduled — run manually, or add to launchd/cron:

```bash
cd local-agent && node --env-file=.env purge-expired-media.mjs --dry-run
cd local-agent && node --env-file=.env purge-expired-media.mjs
```

## Still open

- **Nobody schedules the purge job yet.** Until someone does, retention is a
  documented policy and a working script, not an enforced guarantee.
- **No subject-access or erasure request path.** If an attendee asks what is
  held about them or asks for removal, that is currently a manual SQL job.
- **The 90-day number is a proposal**, not a legal determination. Confirm it
  against whatever notice attendees were actually given at the booth and in the
  Privacy Policy page.
