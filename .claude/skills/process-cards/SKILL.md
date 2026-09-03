---
name: process-cards
description: OCR one conference business-card photo — which may show one card filling the frame, or several cards laid out together on a table — extract fields exactly as printed/written per card, assign one overall extraction confidence per card, crop multi-card photos so each contact gets its own image, and hand off to the existing intake pipeline via the contacts-from-ocr Supabase Edge Function. Use when invoked headlessly by watcher/watch-cards.command on a single new photo.
---

# Process cards

This skill has one narrow job: read one photo — which may contain one
business card or several laid out together — and post each card's raw
fields to the backend. It does **not** research the person, does **not**
resolve an official district/school name, and does **not** touch Zoho — that
is `research-contact` and `match-contact`'s job, which already run
automatically afterward (triggered by each POST below), unchanged, regardless
of whether a contact came from a form or a card photo.

**Every invocation is a fresh, memory-less session, and covers exactly one
photo file** (which may yield one or several contacts — see Step 1). The
watcher script that calls you invokes you once per new photo — don't look
for other files, don't loop across photos, don't try to "catch up" on a
backlog.

## Input

You'll be told, directly in the prompt text:
- the absolute path to the photo to **read** (already a JPEG — HEIC is
  always converted before you're invoked, so you never need to handle it).
  This is its *current*, temporary location — read from here.
- the event's folder code (a short string, not a database id),
- the photo's content hash (already computed — never recompute or alter it),
- a **local archive path** — write any cropped card images (Step 2) into
  this same directory (derive it via `dirname` of the given path). **This
  directory already exists** (the watcher creates it before invoking you).
  You are not responsible for moving or archiving the original photo file
  yourself — the watcher script does that once you report success.
- a **Supabase Storage object key** for the original photo (e.g.
  `<folder code>/<hash>.<ext>` for a locally-dropped photo, or
  `sms/<message id>.<ext>` for one that arrived via text — the prefix
  varies by which pipeline invoked you) — echo this back **verbatim** as
  `sourceImagePath` for every card in Step 4. This is *not* a local
  filesystem path — the file already exists there (or, for a locally-
  dropped photo, will be uploaded there once you report success) either
  way, you never read from or write to Storage directly. For a cropped
  card's `croppedImagePath` (Step 4), derive the matching Storage key
  yourself by taking the **same directory prefix as the given
  sourceImagePath key**, plus the basename of the crop file you wrote in
  Step 2 — e.g. if the given Storage object key is
  `lansing-20260920/abc123.jpg` and you wrote a crop to
  `<local archive dir>/abc123-crop-01.jpg`, its Storage key is
  `lansing-20260920/abc123-crop-01.jpg`; if instead the given key were
  `sms/abc123.jpg`, the crop's key would be `sms/abc123-crop-01.jpg`.
- optionally, an **inbound message id** (Stage 13's SMS pipeline only —
  omitted when invoked from the local folder watcher). If given, include it
  verbatim as `inboundMessageId` in every card's POST body (Step 4); if not
  given, omit that key entirely.

## Step 1 — detect how many cards are in the photo

**Read the photo directly** with your Read tool — it can view image files
natively; that is your entire OCR mechanism, there is no external OCR API to
call.

Look at the whole photo and count distinct, separate business cards in it.

- **Most photos have exactly one card filling most of the frame.** This is
  the common case — go straight to Step 3 (skip Step 2 entirely; there is
  nothing to crop when the whole photo already is the one card).
- **Some photos show several cards laid out together** on a table or other
  surface (a rep photographing a stack at once). Treat each visually
  distinct card as its own separate contact — repeat Steps 2–4 once per
  card, **in reading order: top-to-bottom, then left-to-right within a
  row.** This ordering must be a fixed, mechanical rule you'd apply the same
  way on a second look at the same photo, not "whichever order you happened
  to notice them" — a failed/retried photo re-derives per-card identity from
  this order (Step 4), so it has to be reproducible.

## Step 2 — crop each card (multi-card photos only)

Skip this step entirely for a single-card photo — go to Step 3 directly and
omit `cropX`-family fields from the POST body (there's nothing to crop when
the photo already is the card).

For a multi-card photo, once you know how many cards there are and roughly
where each one is:

1. Get the photo's pixel dimensions:
   ```
   sips -g pixelWidth -g pixelHeight <photo path>
   ```
2. For this card, estimate its bounding box as **fractions of the full
   image** (each 0.0–1.0): `x`, `y` (top-left corner) and `width`, `height`.
   You're reasoning about rough proportions here, not pixel-perfect
   detection — that's fine, padding in the next step covers the slack.
3. Convert to pixels and pad generously (the estimate is approximate, not a
   precise detector — err toward too much padding, not too little, so a
   slightly-off box still keeps the whole card in frame): expand the box by
   roughly 15% of its own width on each side horizontally, and 15% of its
   own height on each side vertically, then clamp the result to
   `[0, pixelWidth]` × `[0, pixelHeight]` so you never request a crop that
   runs off the edge of the image. Use `bc` for the arithmetic rather than
   doing it in your head, e.g.:
   ```
   px_x=$(echo "$x * $pixelWidth" | bc)
   px_w=$(echo "$width * $pixelWidth" | bc)
   pad_w=$(echo "$px_w * 0.15" | bc)
   # padded left edge, clamped to >= 0, then similarly for the other 3 edges
   ```
4. Crop with `sips` into a **new file** — never overwrite the original —
   written directly into the local archive directory (derived from the
   given local archive path, per Input above), named
   `<original-hash>-crop-<NN>.<ext>` where `<NN>` is this card's two-digit
   position in reading order (`01`, `02`, …) and `<ext>` matches the source
   photo's extension:
   ```
   sips -c <padded height> <padded width> --cropOffset <padded top Y> <padded left X> \
     <photo path> --out <archive dir>/<original hash>-crop-<NN>.<ext>
   ```
   (verified working: `-c` takes height then width, `--cropOffset` takes the
   top/row offset then the left/column offset — both integers, rounded from
   the padded-and-clamped values above.)

This is the file you'll report as `croppedImagePath` for this card in Step 4.

## Step 3 — extract fields exactly as printed or handwritten on the card

Do not correct, expand, or "resolve" anything:
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

**Set one overall `extractionConfidence`** for this card (not per-field):
- `high` — every field you needed to read was clear and unambiguous.
- `medium` — at least one field required a judgment call: partially
  smudged or stylized handwriting you made a confident best guess on, or
  an unusual card layout you had to interpret.
- `low` — the card is mostly illegible, or a required field
  (first/last name) was itself substantially a guess.

## Step 4 — POST this card's result

POST to the `contacts-from-ocr` Supabase Edge Function (Stage 12 — this
replaced the old local .NET API at `127.0.0.1:5240`), authenticated with the
service-role key. Both `$SUPABASE_URL` and `$SUPABASE_SERVICE_ROLE_KEY` are
real shell environment variables at invocation time (set in `watcher/.env`
and exported by the watcher script before it runs `claude -p`) — reference
them directly in the curl command, don't hardcode either value:

Write the JSON body to a fresh temp file first (`mktemp`, never a fixed
path — a stale leftover payload from an earlier run is exactly the kind of
stale state worth avoiding), then:

    curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST \
      "$SUPABASE_URL/functions/v1/contacts-from-ocr" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
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
      "sourceImageHash": "<see below>",
      "sourceImagePath": "<given Storage object key, verbatim, same for every card from this photo>",
      "croppedImagePath": "<this card's cropped file's Storage key, derived per Input above — omit entirely for a single-card photo>",
      "inboundMessageId": "<given inbound message id, verbatim, same for every card from this photo — omit entirely if you weren't given one>"
    }

`sourceImageHash`:
- **Single-card photo:** the given hash, verbatim, unmodified — exactly as
  before.
- **Multi-card photo:** the given hash **plus `-<NN>`**, the same two-digit
  reading-order index used in the crop filename (`<given hash>-01`,
  `<given hash>-02`, …). This is deliberate and load-bearing, not
  incidental: `SourceImageHash` is uniquely constrained in the database, and
  every card from one photo shares the same `sourceImagePath` — without a
  distinguishing suffix per card, only the first card's POST would ever
  succeed. Deriving the suffix from the same deterministic reading-order
  index as the crop filename is what makes a retry of a partially-failed
  photo safe: re-running this skill on the same file re-derives the exact
  same hash for each already-succeeded card, so those POSTs land on the
  existing-hash no-op path (see Step 5) instead of erroring or duplicating,
  and only a genuinely-unprocessed card gets created fresh.

Use empty strings for `email`/`phone`/`title`/`districtName`/`schoolName`
when there's nothing to report for this card — the endpoint treats blank the
same as absent, and every key should still be present.

## Step 5 — interpret this card's response

- `HTTP_STATUS:201` — a new contact row was created. Success for this card.
- `HTTP_STATUS:200` — this card's hash already matched an existing contact;
  this is a safe no-op per the pipeline's own "a repeat is a no-op, not a
  duplicate contact" rule, not a failure. (For a multi-card photo, this is
  the expected outcome for every already-succeeded card on a retry.)
- Any other status, a non-2xx response, or a curl error (non-zero exit,
  connection refused) — a real failure for this card.

**Don't stop the loop on one card's failure** — attempt every remaining card
in the photo regardless, so one bad card doesn't hold up the others. Keep
track of which cards (by index) succeeded vs. failed as you go; you'll need
that list for Step 6.

## Step 6 — final message

**Your entire final message must be exactly one line, nothing before or
after it, no markdown, no fence**, covering the *whole photo* (all cards, if
more than one) — this is unchanged in shape from the single-card case, and
still keyed on the **original** given hash, never a per-card suffixed one:

- Every card succeeded (201 or 200, per Step 5): `PROCESS_CARDS_OK <original
  hash>`
- One or more cards failed: `PROCESS_CARDS_FAIL <original hash> <short
  one-line reason, no newlines>` — name which card(s) failed and why, e.g.
  `card 2/3: HTTP 400 firstName required`. A partial failure fails the whole
  photo (the watcher archives or fails the *original file* as one unit —
  see below) — a rep can just re-drop the same photo to retry; already-
  succeeded cards no-op via Step 5's hash-dedup, only the failed one(s)
  actually redo work.

The watcher script that invoked you greps for exactly this line to decide
whether to archive the *original* photo as processed or move it to the
failed folder — nothing else you say in your final message is read by
anything, so don't add commentary before or after it.

**Known accepted limitation:** on a partial failure, any cards that *did*
succeed already have real contact rows in the database, with their cropped
thumbnail already written and working — but their `sourceImagePath` (the
whole original photo) won't actually exist at that path until the *whole*
photo eventually succeeds and the watcher archives it. Until then, that
handful of contacts' "view full sheet" fallback will 404, though their
normal cropped thumbnail displays fine immediately. This self-heals the
moment the photo is successfully retried. Not a v1 concern to solve further.
