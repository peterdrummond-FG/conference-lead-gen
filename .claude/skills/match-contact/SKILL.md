---
name: match-contact
description: Classify a conference-captured contact against real Zoho CRM data (Accounts and Contacts) into existing_contact / new_contact_existing_account / new_account / ambiguous. Use when asked to "match this contact", "run match-contact", or when invoked headlessly as the second step of the intake pipeline, always after research-contact has already run.
---

# Match contact

This skill is the **only** place that decides what counts as a Zoho match,
regardless of whether a contact came from a typed form or a scanned business
card. It always runs **after** the `research-contact` skill — its input is
that skill's output, not raw form/OCR fields. This skill has Zoho access but
**never does its own web search** — any web research already happened
upstream; if Zoho doesn't have a confident answer even after trying every
name `research-contact` surfaced, the result is `new_account` or `ambiguous`,
full stop. A human resolves it further in a review UI (not built yet), not
this skill running another search.

**Every invocation is a fresh, memory-less session.** Don't rely on how you
classified a similar-looking contact in a previous run — re-derive the answer
from this file and live Zoho data every time.

## Input

A file path (primary) or inline JSON (fallback, simple ASCII cases only) —
exactly the output shape of `research-contact`. **`districtName`/`schoolName`
are always the person's own original words, verbatim — `research-contact`
never overwrites them, no matter how confident its research was.** Any
real-world correction it found lives only in `alternateDistrictNames`, with
its single best guess listed first. This is why a match found via
`districtName` itself is trusted more than one found via an alternate — the
distinction is meaningful precisely because it's never blurred upstream.
```json
{
  "contactId": null,
  "firstName": "Latoya",
  "lastName": "Pruitt",
  "email": null,
  "phone": null,
  "title": "Principal",
  "districtName": "Indianola School District",
  "schoolName": null,
  "eventState": "Mississippi",
  "source": "card_photo",
  "extractionConfidence": "medium",
  "alternateDistrictNames": ["Sunflower County School District"],
  "researchConfidence": "medium",
  "personVerified": false,
  "researchNotes": "..."
}
```
If `firstName`, `lastName`, or `eventState` is missing/empty, skip to the
output step with `matchStatus: "ambiguous"`, `matchConfidence: "low"`, and
explain the missing field in `notes`. Never crash on malformed input.

## Steps

### Normalize names before comparing

Apply to `districtName`, every entry in `alternateDistrictNames`, and
`schoolName` before any comparison or Zoho query:
1. Lowercase; strip periods and commas.
2. Collapse hyphens and repeated spaces to a single space; strip apostrophes
   without inserting a space (`O'Connor` → `oconnor`).
3. Strip a trailing parenthetical state qualifier before comparing, but keep
   the original string for display (`"Cleveland School District (MS)"` →
   compare as `cleveland school district`, display the original).
4. Expand common abbreviations as whole-word swaps (never substring swaps —
   don't let "Assoc." corrupt an unrelated word): `co.`/`cnty`→county,
   `dist.`→district, `sch.`→school, `ind.`/`indep.`→independent,
   `cons.`/`consol.`→consolidated, `pub.`→public, `twp.`→township,
   `mun.`→municipal, `&`→and. Leave `isd` as its own recognized term. Leave
   `st.` alone when it reads as part of a proper noun/place name ("Bay St.
   Louis") rather than generic filler.
5. Split into tokens; mark generic tokens (`school`, `district`, `county`,
   `public`, `independent`, `consolidated`, `schools`, `municipal`, `co`) vs.
   distinctive tokens (everything else — proper nouns). Distinctive-token
   overlap is what scoring is based on, not raw string similarity, since two
   completely unrelated districts routinely share every generic word.

### Query and score

1. **Extract the distinctive token(s)** from the normalized `districtName` —
   this is the primary search anchor. Repeat for each entry in
   `alternateDistrictNames` — these are equally valid anchors, not a
   last-resort fallback; `research-contact` already did the work of deciding
   they're plausible.

2. **Query district-level Accounts scoped to `eventState`**, one query per
   anchor (original name, then each alternate) via a COQL-style tool:
   ```sql
   select id, Account_Name, Organization_Level, Parent_Account, Shipping_US_State
   from Accounts
   where Shipping_US_State = '<eventState>'
   and Organization_Level = 'District / Parent entity'
   and (Account_Name like '%<distinctive token>%')
   ```
   Do not widen scope to other states if this returns nothing — absence
   in-state is itself a signal (pushes toward `new_account`), never a reason
   to search nationwide; a same-named district in another state must never
   surface as a candidate. If a query errors (e.g. a field name mismatch),
   confirm the real API name via a fields/module-metadata tool and retry once
   before giving up on that query.

3. **If `schoolName` is present, also query campus-level Accounts** the same
   way (`Organization_Level = 'Campus / Child entity'`). For each plausible
   campus candidate, resolve its `Parent_Account`:
   - Null → record the signal `"no parent set in Zoho"` (a real, confirmed
     gap affecting some campus accounts — not an error, but it caps
     confidence, see below).
   - Resolves to an Account whose own `Organization_Level` is
     `"District / Parent entity"` → that parent is now a leading
     district-level candidate too, even if it didn't independently surface
     in step 2.
   - Resolves to anything else (blank, or itself campus-tagged) → record the
     signal `"parent not cleanly tagged as a district"`.

4. **Score every candidate** by distinctive-token overlap, reasoned directly
   rather than a canned similarity number: does it share the same proper-noun
   token(s), differing only in generic wording, or does a real qualifying
   difference remain (a different county/directional qualifier — this org's
   real data has both "North Panola School District" and separately-named
   Panola-area districts, and both "Jefferson County School District" and
   "Jefferson Davis County School District")? Explicitly flag when two or
   more candidates tie or cluster near the top — this org's Zoho data
   contains genuine duplicate rows for the same district, so a tie is a
   first-class outcome to detect, not an edge case to dismiss.

5. **Once a leading Account candidate exists, pull its linked Contacts**
   (a related-records query against that Account for its Contacts list) —
   `First_Name`, `Last_Name`, `Email`, `Phone`, `Title` for each. Do this
   every time a leading Account exists, regardless of whether you expect a
   person match:
   - Compare the input `firstName`/`lastName` (and `email`/`phone` if
     provided) against each linked Contact. A strong match (same normalized
     full name, no conflicting email/phone) is the only path to
     `existing_contact`.
   - Every other linked Contact is still corroborating context for a human
     reviewer — a similar title, a phone number matching the account's
     listed line — fold a one-line summary into `notes` even when none of
     them is the target person.

### Confidence rules

**High** — all of:
- Leading candidate's distinctive tokens match exactly, or differ only by a
  mechanical abbreviation-table swap;
- No other candidate ties it within the state+level scope;
- If campus-level, `Parent_Account` resolved cleanly to a properly-tagged
  district (no gap signal from step 3);
- `extractionConfidence` (if provided) is not `"low"`;
- **The match was found via the original `districtName`, not an
  `alternateDistrictNames` entry** — OR it was found via an alternate but
  `researchConfidence` was `"high"` and this candidate is otherwise clean and
  unique. A research-derived name match generally caps at Medium unless
  research itself was highly confident.
- For `existing_contact` specifically: exactly one linked Contact clears an
  equivalent bar, with no conflicting email/phone. `personVerified: true`
  from the input is a positive signal that can help this bar clear High even
  when the name-match alone would only reach Medium.

**Medium**:
- A real qualifying difference survives normalization;
- Two or more candidates tie/cluster;
- A campus name is a clean hit but its parent resolution hit a tagging gap;
- The candidate was found via `alternateDistrictNames` rather than the
  original `districtName`, without a `"high"` `researchConfidence` to back it;
- A Contact-level near-match where a detail conflicts, or the name match is
  only fuzzy.

**Low**:
- Best candidate shares only generic tokens (no matching proper noun);
- Zero candidates found in-state across `districtName` and every alternate;
- `extractionConfidence: "low"` compounding an already-Medium-or-worse match;
- A Zoho query failed and one retry also failed.

### Classification mapping

| Situation | matchStatus | matchConfidence |
|---|---|---|
| High-confidence linked-Contact match | `existing_contact` | `high` |
| Contact-level match only reaches Medium | `ambiguous` | `medium` (candidates = the contact(s)) |
| No Contact match; High-confidence Account | `new_contact_existing_account` | `high` |
| No Contact match; Account only reaches Medium | `ambiguous` | `medium` (`matchedZohoAccountId` left `null`, candidates listed) |
| No Contact match; Account is Low or absent (even trying all alternates) | `new_account` | `low` (never auto-created in Zoho) |
| A Zoho query failed twice | `ambiguous` | `low` (explicit failure explanation in `notes`) |

`matchStatus` must never be `"pending"` under any circumstance.

## Output

**Your entire final message must be the JSON object and nothing else.** Do
your reasoning, querying, and note-drafting in earlier turns. Then, in your
last message: the very first character you output must be `{` and the very
last character must be `}` — no markdown code fence (no ` ``` ` anywhere in
that message), no "Here's the result:" or "Based on my analysis..." preamble,
no closing summary after the closing `}`. A caller runs this exact command
and parses stdout directly as JSON — `claude -p "..."
--dangerously-skip-permissions | python3 -c "import json,sys;
json.load(sys.stdin)"` — any character outside the `{...}` breaks that parse
and fails the whole pipeline.

Wrong (breaks the parser — a leading sentence and a code fence are both
fatal, even a short one): "Based on my research, here's the match:" followed
by a ` ``` `-fenced block. Right: the message starts with `{` and nothing
precedes it.

This is what the object looks like (shown indented here purely for
readability in this document — your actual output has no fence and no
indentation requirement, just valid JSON):

    {
      "contactId": null,
      "matchStatus": "new_contact_existing_account",
      "matchConfidence": "medium",
      "matchedZohoContactId": null,
      "matchedZohoAccountId": "3001271000007193584",
      "candidateMatches": [
        {"type": "account", "zohoId": "3001271000007193584", "name": "Sunflower County School District", "score": 0.8}
      ],
      "notes": "Input district name 'Indianola School District' did not match anything in Zoho for Mississippi. research-contact resolved this to 'Sunflower County School District' based on general geographic knowledge (Indianola, MS is in Sunflower County) — confirmed as a real Account in Zoho, medium confidence since the match came via an alternate name rather than the original input. No existing linked Contact named Latoya Pruitt at this account."
    }

`candidateMatches` is `null` (not `[]`) when there's nothing worth surfacing —
a clean `existing_contact`, or a true `new_account` with no plausible
candidates at all. Re-verify field names and enum strings against this file
before printing.
