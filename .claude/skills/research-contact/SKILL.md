---
name: research-contact
description: Verify a conference-captured contact's identity and resolve their stated school district/school to its real-world official name via web search, before any Zoho lookup happens. Use when asked to "research this contact", "run research-contact", or when invoked headlessly as the first step of the intake pipeline (before match-contact) for both typed form submissions and OCR'd business cards.
---

# Research contact

Conference attendees write down (or a scanned business card carries) very little
information — often just a name, a title, and a district or school name that
may be incomplete, misspelled, or use an informal short name instead of the
official one. This skill runs **before** any Zoho query — its job is to
verify who this person is and resolve their institution's real name using
general web knowledge, so the downstream `match-contact` skill has the best
possible input to search Zoho with. It never touches Zoho itself.

This is the first step of a fixed two-step pipeline: `research-contact` →
`match-contact`. It runs for every contact, regardless of whether the input
came from a typed form or (a later stage) an OCR'd business card — there's no
"this one looks complete enough, skip research" shortcut. Conference contacts
almost always carry minimal information, so a verification search is close to
always worth doing rather than something to gate behind a completeness check.

**Every invocation is a fresh, memory-less session.** Nothing about a prior
contact you researched carries over — treat each run as if it's the only one
that will ever happen, and re-verify everything against this file rather than
relying on how you handled a similar case before.

## Input

You'll be told either a file path containing the contact's JSON, or the JSON
inline in the prompt text. Read the file first if one is given — real district
names contain periods, ampersands, and hyphens that make inline shell
quoting unreliable, so a file path is the primary, robust form.

Expected input shape:
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
  "extractionConfidence": "medium"
}
```
- `firstName`/`lastName`/`eventState` are required. Everything else may be
  `null` or an empty string — that's normal input, not an error condition.
- `extractionConfidence` (only meaningful when `source` is `"card_photo"`) is
  how confident an earlier OCR step was about the *text values themselves* —
  a `"low"` value means treat `districtName`/`schoolName` as more likely to
  contain a transcription error, not just an informal name.

If `firstName`, `lastName`, or `eventState` is missing or empty, skip straight
to the output step: pass every field through unchanged, set
`researchConfidence: "low"`, `personVerified: false`, and explain in
`researchNotes` which required field was missing. Never crash on malformed
input — this skill is invoked headlessly with no one watching for an
exception.

## Steps

1. **Read the input** (file path first, inline JSON as fallback). Validate the
   required fields per above.

2. **Run an institution-focused web search.** Build a query from whatever's
   available — district/school name fragment plus `eventState` plus a term
   like "school district" (e.g. `"Indianola school district Mississippi"`, or
   if only a school name is given, `"<school name> <state> school district"`).
   The goal is to find the institution's real, official name — resolving a
   short/informal/misremembered name to what a district actually calls itself
   is the single highest-value thing this skill can do, since a well-formed
   but differently-named input gives no textual hint that it needs
   correction (e.g. someone writes "Indianola School District" because that's
   the town they work in, but the real district covering Indianola,
   Mississippi is legally named "Sunflower County School District" — nothing
   about the input string itself looks wrong).

3. **Run a person-focused search** when a `title` or institution fragment
   exists: `"<firstName> <lastName> <districtName or schoolName> <eventState>"`.
   Look for independent corroboration — a staff directory, a school board
   agenda, a news article, a LinkedIn profile — that this specific person
   holds (or recently held) the stated role at this institution. This is
   corroborating evidence for `match-contact` later, not a Zoho lookup — you
   have no Zoho access in this skill.

   The review UI flags two contacts sharing a first+last name as a possible
   duplicate regardless of event or district — a sales rep or a traveling
   principal can legitimately turn up at a different event, so that flag
   fires even when the two are genuinely different people who happen to
   share a name. Your `researchNotes` is the reviewer's main tool for telling
   those cases apart, so be explicit about what your person-focused search
   turned up either way:
   - If it turns up this name credibly tied to a **different** institution
     or state than the one on this card, say so plainly (e.g. "A Chad
     Schmelar appears in a 2024 staff directory for a different district in
     a different state — this may be a different person of the same name,
     not a data-entry conflict"). This is exactly the signal that separates
     a common-name collision from a garbled/duplicate entry.
   - If the search turns up nothing at all for this name, say that plainly
     too, rather than defaulting to a vague "no corroboration found" that
     reads the same whether you found conflicting evidence or none.

4. **Never overwrite `districtName`/`schoolName` — always pass them through
   byte-for-byte exactly as given, even when you're highly confident about a
   correction.** This is not a confidence-based judgment call: `match-contact`
   uses whether a match came from `districtName` itself vs. an
   `alternateDistrictNames` entry as its own signal for how much to trust the
   match — that signal is meaningless if this skill sometimes substitutes a
   corrected value directly into `districtName`. Any real-world correction,
   however confident, goes into `alternateDistrictNames` instead — put your
   single best guess **first** in that array if you found one, followed by
   any other plausible candidates. An empty `alternateDistrictNames` array
   means "no correction found or needed," not "input is a confident match" —
   `match-contact`, which has actual Zoho access, is the one that determines
   that.

5. **Set `researchConfidence`** for your own identity/institution resolution
   (this is independent of Zoho, which you never query):
   - `high` — a search result clearly and unambiguously names the real
     institution, ideally with independent person corroboration too.
   - `medium` — you resolved the institution but found no independent
     evidence about the specific person, or vice versa; or you found a
     plausible answer but with some residual uncertainty.
   - `low` — searches were inconclusive, contradictory, or turned up nothing
     useful. This is a normal, expected outcome for many searches — report it
     plainly rather than fabricating a confident-sounding answer.

6. **Set `personVerified`**: `true` only if you found actual independent
   evidence (not just "this seems plausible") that this named person holds
   the stated title at this institution. Default to `false` — don't infer
   this just because the institution resolved cleanly.

7. **Write `researchNotes`** (1–3 sentences): what you searched for, what you
   found or explicitly didn't find, and why you did or didn't correct the
   institution name.

8. **Your entire final message must be the JSON object and nothing else.**
   Do your reasoning, searching, and note-drafting in earlier turns. Then, in
   your last message: the very first character you output must be `{` and the
   very last character must be `}` — no markdown code fence (no ` ``` `
   anywhere in that message), no "Here's the result:" or "Based on my
   research..." preamble, no closing summary or commentary after the closing
   `}`. A caller runs this exact command and parses stdout directly as JSON —
   `claude -p "..." --dangerously-skip-permissions | python3 -c "import
   json,sys; json.load(sys.stdin)"` — any character outside the `{...}`
   breaks that parse and fails the whole pipeline. Re-verify field names
   against the schema below before printing; don't rely on memory of how you
   formatted a previous run.

   **Wrong** (breaks the parser — a leading sentence and a code fence, even a
   short one, are both fatal):
   > No corroboration found for the person. Here's the result:
   > ```json
   > {"firstName": "Dana", ...}
   > ```

   **Right** (the entire message, start to finish, first character `{`):
   > {"firstName": "Dana", ...}

   If you feel the urge to explain something before printing the JSON, that
   explanation belongs inside the `researchNotes` field's value — not as
   text in the message. There is no other place for it to go.

## Output

Print exactly one JSON object as your final message. This is what the object
looks like (shown indented here purely for readability in this document —
your actual output has no fence and no indentation requirement, just valid
JSON):

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
      "researchNotes": "Web search indicates Indianola, MS is served by Sunflower County School District, not a district named 'Indianola School District' — no Zoho lookup performed, this is a web-only finding. No independent corroboration found for Latoya Pruitt specifically."
    }

Every input field is passed through unchanged (even ones you didn't touch) so
`match-contact` never has to merge two files together — its input is just
this skill's output, in full.
