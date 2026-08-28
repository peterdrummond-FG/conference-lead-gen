---
name: process-cards
description: OCR one conference business-card photo, extract fields exactly as printed/written (no research, no Zoho lookup), assign one overall extraction confidence, and hand off to the existing intake pipeline via POST /api/contacts/from-ocr. Use when invoked headlessly by watcher/watch-cards.command on a single new photo.
---

# Process cards

This skill has one narrow job: read one photo of a business card and post its
raw fields to the backend. It does **not** research the person, does **not**
resolve an official district/school name, and does **not** touch Zoho — that
is `research-contact` and `match-contact`'s job, which already run
automatically afterward (triggered by the POST below), unchanged, regardless
of whether a contact came from a form or a card photo.

**Every invocation is a fresh, memory-less session, and covers exactly one
photo.** The watcher script that calls you invokes you once per new photo —
don't look for other files, don't loop, don't try to "catch up" on a backlog.

## Input

You'll be told, directly in the prompt text:
- the absolute path to the photo to read (already a JPEG — HEIC is always
  converted before you're invoked, so you never need to handle it),
- the event's folder code (a short string, not a database id),
- the photo's content hash (already computed — never recompute or alter it),
- the exact path the photo will permanently live at (echo this back verbatim
  as `sourceImagePath` — you are not responsible for moving or archiving the
  file yourself, the watcher script does that once you report success).

## Steps

1. **Read the photo directly** with your Read tool — it can view image files
   natively; that is your entire OCR mechanism, there is no external OCR API
   to call.

2. **Extract fields exactly as printed or handwritten on the card** — do not
   correct, expand, or "resolve" anything:
   - `firstName`/`lastName` — required. If genuinely no name is legible at
     all (a mostly illegible or blank card), use `"Illegible"` for both
     rather than fabricating a plausible-sounding name, and rely on a low
     `extractionConfidence` to flag it — never skip creating the row just
     because the card is hard to read; a human reviews it afterward, but
     only if a row exists for them to see.
   - `email`/`phone` — read exactly as printed; empty string if neither is
     present or legible. This is normal, expected input for a business card,
     not an error condition.
   - `title` — read as printed, or empty string if none.
   - `districtName` — the literal text on the card for their district (or
     school, if that's what's printed and no separate district appears) —
     empty string if nothing institutional is printed at all. **Do not**
     attempt to identify the real/official name of an institution you
     recognize or can guess at — pass through literally what's written,
     nothing more. That resolution happens downstream, in `research-contact`.
   - `schoolName` — the literal school-level text, if any; empty string if
     the card only names a district, or names nothing at all.

3. **Set one overall `extractionConfidence`** for the whole card (not
   per-field):
   - `high` — every field you needed to read was clear and unambiguous.
   - `medium` — at least one field required a judgment call: partially
     smudged or stylized handwriting you made a confident best guess on, or
     an unusual card layout you had to interpret.
   - `low` — the card is mostly illegible, or a required field
     (first/last name) was itself substantially a guess.

4. **POST the result** to the backend running on this same machine (never the
   Vite dev-server proxy on port 9000 — that's for browser traffic only; the
   backend itself is always on port 5240):

   Write the JSON body to a fresh temp file first (`mktemp`, never a fixed
   path — a stale leftover payload from an earlier run is exactly the kind of
   stale state worth avoiding), then:

       curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST \
         http://127.0.0.1:5240/api/contacts/from-ocr \
         -H "Content-Type: application/json" \
         -d @<your temp payload file>

   Remove the temp file afterward regardless of outcome. The body has this
   shape (shown indented here for readability only — write it as compact,
   valid JSON, no markdown fence):

       {
         "eventFolderCode": "<given folder code, verbatim>",
         "firstName": "...",
         "lastName": "...",
         "email": "...",
         "phone": "...",
         "title": "...",
         "districtName": "...",
         "schoolName": "...",
         "extractionConfidence": "high | medium | low",
         "sourceImageHash": "<given hash, verbatim>",
         "sourceImagePath": "<given final archive path, verbatim>"
       }

   Use empty strings for `email`/`phone`/`title`/`districtName`/`schoolName`
   when there's nothing to report — the endpoint treats blank the same as
   absent, and every key should still be present.

5. **Interpret the response.**
   - `HTTP_STATUS:201` — a new contact row was created. Success.
   - `HTTP_STATUS:200` — the photo's hash already matched an existing
     contact; this is a safe no-op per the pipeline's own "a repeat is a
     no-op, not a duplicate contact" rule, not a failure.
   - Any other status, a non-2xx response, or a curl error (non-zero exit,
     connection refused) — a real failure.

6. **Your entire final message must be exactly one line, nothing before or
   after it, no markdown, no fence:**
   - On success (201 or 200 above): `PROCESS_CARDS_OK <hash>`
   - On failure: `PROCESS_CARDS_FAIL <hash> <short one-line reason, no
     newlines>` — e.g. what curl reported, or the response body's error
     message.

   The watcher script that invoked you greps for exactly this line to decide
   whether to archive the photo as processed or move it to the failed
   folder — nothing else you say in your final message is read by anything,
   so don't add commentary before or after it.
