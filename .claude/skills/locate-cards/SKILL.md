---
name: locate-cards
description: Given a photo of several business cards laid out together and a list of contacts already known to be on it (their already-extracted name/email/phone/title, no re-OCR needed), find which card belongs to each contact and crop it out into its own image file. Use when invoked headlessly by the backend's `backfill-card-crops` tool to retroactively crop existing contacts that share a multi-card sheet photo.
---

# Locate cards

This is a **backfill** skill, distinct from `process-cards`. It never
creates a contact, never touches Zoho, never POSTs anything — every contact
it's given already exists in the database with correct fields. Its only job
is spatial: given a photo of several cards and a list of people already
known to be somewhere on it, figure out which card is whose and crop it out.

**Every invocation is a fresh, memory-less session, covers exactly one
photo,** and is given every contact currently known to be on that photo in
one call — reason about all of them together (this lets you disambiguate
similarly-named people on the same sheet, tell two cards apart by which
email/phone/title matches which, etc.), not one at a time.

## Input

You'll be told a file path containing JSON shaped like:

```json
{
  "photoPath": "/absolute/path/to/processed/<code>/<hash>.jpeg",
  "contacts": [
    {
      "id": "3c31df48-84b3-48ca-bce1-ac41cc1fff9f",
      "firstName": "Antoinette",
      "lastName": "Woodall",
      "email": null,
      "phone": null,
      "title": "Curriculum Director"
    }
  ]
}
```

`photoPath` is a real, permanent file on disk — read it directly with your
Read tool. `contacts` is every contact still needing a crop from this
specific photo (a previous partial run may have already placed some of this
photo's contacts; those aren't included here, and you don't need to account
for them — see the file-naming rule below, which is retry-safe regardless).

## Steps

1. **Read the photo.** Identify every distinct business card visible in it.
2. **For each contact you were given**, find which card is theirs by
   comparing the legible text on each card against that contact's
   `firstName`/`lastName` (primary signal) and `email`/`phone`/`title` (
   corroborating signal when a name alone is ambiguous — e.g. two people
   with the same last name on one sheet).
3. **Only place a contact on a card you're actually confident about.** If
   you can't find a card whose name clearly matches, or two+ candidate cards
   are equally plausible and you can't disambiguate even with
   email/phone/title, do **not** guess — report that contact as
   `"notFound": true` instead. A wrong crop silently showing a reviewer a
   *different* person's card is worse than no crop at all; this list is
   allowed to be incomplete.
4. **Crop each confidently-placed card**, using the exact same technique
   `process-cards` uses for a freshly-detected multi-card photo:
   1. Get the photo's pixel dimensions: `sips -g pixelWidth -g pixelHeight
      <photoPath>`.
   2. Estimate that card's bounding box as fractions of the full image (0.0–
      1.0): `x`, `y` (top-left corner), `width`, `height`.
   3. Convert to pixels and pad by roughly 15% of the box's own
      width/height on each side (the estimate is approximate, not
      pixel-perfect — err toward more padding, not less), then clamp to
      `[0, pixelWidth]` × `[0, pixelHeight]`. Use `bc` for the arithmetic
      rather than doing it in your head.
   5. Crop into a **new file**, written into the *same directory* as
      `photoPath` (it's already the permanent archive directory — nothing
      else needs to move it), named
      **`<photo's own filename, without extension>-<contact's id,
      verbatim>.<same extension as photoPath>`** — e.g. photo
      `.../724958ec….jpeg` + contact id
      `3c31df48-84b3-48ca-bce1-ac41cc1fff9f` →
      `.../724958ec….3c31df48-84b3-48ca-bce1-ac41cc1fff9f.jpeg`.
      **Use the contact's own id for this, not a position/reading-order
      number** — unlike `process-cards` (which doesn't have a contact id
      yet at crop time, since the row doesn't exist until the POST
      succeeds), you're given a stable id up front, and keying the filename
      on it makes this tool safely re-runnable: a retry only ever gets
      handed the contacts still missing a crop, so there's no risk of two
      different runs' position-based numbering colliding or overwriting an
      already-placed contact's file.
      ```
      sips -c <padded height> <padded width> --cropOffset <padded top Y> <padded left X> \
        <photoPath> --out <same dir>/<photo filename w/o ext>-<contact id>.<ext>
      ```

## Output

**Your entire final message must be exactly one JSON object and nothing
else** — no markdown fence, no leading or trailing commentary. First
character `{`, last character `}`.

```json
{
  "results": [
    { "contactId": "3c31df48-84b3-48ca-bce1-ac41cc1fff9f", "croppedImagePath": "/absolute/path/.../724958ec….3c31df48-84b3-48ca-bce1-ac41cc1fff9f.jpeg" },
    { "contactId": "c326e012-26e2-468b-9d2c-887a28fd9ef1", "notFound": true }
  ]
}
```

Include exactly one entry per contact you were given, in any order — either
`croppedImagePath` (the file you just wrote) for a confidently-placed card,
or `"notFound": true` for one you couldn't place. Never both, never neither.
