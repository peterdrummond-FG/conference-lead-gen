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
  a `"low"` value means treat every field as more likely to contain a
  transcription error, not just an informal name. But don't gate misspelling
  checks on this being `"low"` — handwriting and OCR errors on a name often
  don't trip the OCR step's own confidence (a clean-looking scan of "Pruit"
  reads as high-confidence OCR even though the real name is "Pruitt"), so the
  retry logic in step 4 below runs whenever the first-pass search comes back
  weak, regardless of what `extractionConfidence` says.

If `firstName`, `lastName`, or `eventState` is missing or empty, skip straight
to the output step: pass every field through unchanged, set
`researchConfidence: "low"`, `personVerified: false`, leave every new field
below at its "nothing found" default, and explain in `researchNotes` which
required field was missing. Never crash on malformed input — this skill is
invoked headlessly with no one watching for an exception.

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

   **If the input is a bare or partial fragment** (e.g. just "George" with no
   "district"/"school"/county qualifier) **and this query returns nothing
   useful, retry once with common expansions** before concluding "not found"
   — append "County", "Independent School District", "Public Schools", etc.,
   still scoped to `eventState`. This is a search-robustness step, not a new
   fact to report: if an expansion resolves it, that result feeds
   `alternateDistrictNames` in step 6 exactly like any other correction; if
   nothing resolves it either way, that's a normal low-confidence outcome.

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

4. **If step 3 came back weak — no hit, or only an ambiguous/unrelated
   one — retry with plausible spelling variants of the name** before
   concluding the person can't be found. A name a rep hand-wrote or a card
   scanner OCR'd is one of the least reliable fields on the whole card, and a
   search engine's own "did you mean" only fires sometimes and isn't visible
   to you as a distinct signal — you have to go looking for the correction
   yourself:
   - Generate 2-4 plausible variants: doubled-letter fixes in either
     direction (Pruit ↔ Pruitt), common adjacent-letter swaps, an obvious
     transposition. Don't generate implausible or wholesale-different names —
     this is nudging a likely OCR/handwriting slip, not guessing a different
     person.
   - Re-run the person-focused search (step 3's query shape) with each
     variant substituted for `lastName` (or `firstName`, if that's the one
     that looks off).
   - If a variant search turns up a clean, corroborated hit — the same
     institution, a matching title — that the original spelling didn't, that
     variant is your correction candidate. If more than one variant clears
     this bar, prefer the one with the strongest corroboration.
   - This step only runs when step 3 was weak. A name that already got clean
     corroboration under the spelling as given needs no variant search — most
     contacts will skip this step entirely.

5. **Never overwrite `firstName`/`lastName`/`districtName`/`schoolName` —
   always pass them through byte-for-byte exactly as given, even when you're
   highly confident about a correction.** This is not a confidence-based
   judgment call: `match-contact` uses whether a match came from the original
   field itself vs. an alternate-names entry as its own signal for how much
   to trust the match — that signal is meaningless if this skill sometimes
   substitutes a corrected value directly into the original field. Any
   real-world correction, however confident, goes into the corresponding
   `alternate*` field instead (`alternateDistrictNames` from step 2,
   `alternateNameSpellings` from step 4) — put your single best guess
   **first** in each array if you found one, followed by any other plausible
   candidates. An empty array means "no correction found or needed," not
   "input is a confident match" — `match-contact`, which has actual Zoho
   access, is the one that determines that for the district; there is no
   Zoho-side equivalent for the person's name, so `alternateNameSpellings`
   being non-empty is itself the signal a reviewer needs.

6. **Determine `institutionLevel`**: whether this person sits at the
   district's central office or at a specific campus within it.
   - `"specific_campus"` — a search result (staff directory, school website,
     news article) ties this person to a named school/campus specifically.
     Set `institutionLevelCampusName` to that campus's name (this can differ
     from the input `schoolName`, e.g. the input said nothing and research
     found one, or the input's school name was itself informal — same
     never-overwrite rule as step 5 applies: this is a finding, not a
     replacement for `schoolName`).
   - `"central_office"` — evidence ties them to district-wide administration
     (superintendent's office, district-level title with no campus mentioned
     alongside it) rather than any one campus.
   - `"unknown"` — searches didn't clearly establish either. This is a normal
     outcome when the title itself is ambiguous (e.g. "Director" with no
     further context) or nothing came up — report it as `"unknown"` rather
     than guessing based on title alone.
   - Set `institutionLevelConfidence` (`high`/`medium`/`low`) for this
     specific determination, independently of `researchConfidence`.
   - Set `institutionLevelAsOfDate` to the clearest date you can attribute to
     the source that established this (a news article's date, a board
     document's date, a directory's own "updated" stamp) — a plain year is
     fine if that's all a source gives you. **Set it to `null` when no
     source gave you an actual date** — most staff directories and LinkedIn
     snippets don't carry one, and that is expected, not a gap to paper over
     with today's date or a guess.

7. **Set `titleFinding`**: the specific title/role your search actually
   corroborated for this person right now, independent of whatever `title`
   the card/form already carries.
   - Populate it only when a source gave you something concrete — it may
     match the input `title` exactly (corroboration) or differ from it (a
     promotion, a role change since the card was printed, or the input title
     being wrong). Leave it `null` if nothing corroborated any title at all.
   - Set `titleFindingConfidence` (`high`/`medium`/`low`, `null` if
     `titleFinding` is `null`).
   - Set `titleFindingAsOfDate` the same way as `institutionLevelAsOfDate` —
     the actual date a source attributes to that title, or `null` if none
     did. A `titleFinding` that matches the input `title` still needs its own
     as-of date if you want it treated as current — a 2019 news article
     confirming someone's old title is not the same finding as a 2025 one.

8. **Set `researchConfidence`** for your own overall identity/institution
   resolution (this is independent of Zoho, which you never query, and is
   kept for `match-contact`'s existing use of it — it does not replace the
   more specific confidences from steps 6-7):
   - `high` — a search result clearly and unambiguously names the real
     institution, ideally with independent person corroboration too.
   - `medium` — you resolved the institution but found no independent
     evidence about the specific person, or vice versa; or you found a
     plausible answer but with some residual uncertainty.
   - `low` — searches were inconclusive, contradictory, or turned up nothing
     useful. This is a normal, expected outcome for many searches — report it
     plainly rather than fabricating a confident-sounding answer.

9. **Set `personVerified`**: `true` only if you found actual independent
   evidence (not just "this seems plausible") that this named person holds
   the stated title at this institution. Default to `false` — don't infer
   this just because the institution resolved cleanly.

10. **Write `researchNotes`** (2-4 sentences): what you searched for
    (including any name-variant or district-expansion retries you ran), what
    you found or explicitly didn't find, and why you did or didn't propose
    each correction. This is the reviewer's main window into your reasoning,
    so name the specific corrections you're proposing (or explicitly say you
    found none) rather than only describing your process in the abstract.

11. **Your entire final message must be the JSON object and nothing else.**
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
      "alternateNameSpellings": [],
      "nameCorrectionConfidence": null,
      "institutionLevel": "central_office",
      "institutionLevelCampusName": null,
      "institutionLevelConfidence": "medium",
      "institutionLevelAsOfDate": null,
      "titleFinding": "Principal",
      "titleFindingConfidence": "medium",
      "titleFindingAsOfDate": "2024",
      "researchConfidence": "medium",
      "personVerified": false,
      "researchNotes": "Web search indicates Indianola, MS is served by Sunflower County School District, not a district named 'Indianola School District' — no Zoho lookup performed, this is a web-only finding. No independent corroboration found for Latoya Pruitt specifically, so no name-variant retry was warranted; treated as central office since no specific campus surfaced anywhere."
    }

A case where the name itself needed a variant retry:

    {
      "...": "same pass-through fields as above",
      "firstName": "Latoya",
      "lastName": "Pruit",
      "alternateDistrictNames": [],
      "alternateNameSpellings": ["Pruitt"],
      "nameCorrectionConfidence": "high",
      "institutionLevel": "specific_campus",
      "institutionLevelCampusName": "Ruleville Central Elementary",
      "institutionLevelConfidence": "high",
      "institutionLevelAsOfDate": "2025",
      "titleFinding": "Principal",
      "titleFindingConfidence": "high",
      "titleFindingAsOfDate": "2025",
      "researchConfidence": "high",
      "personVerified": true,
      "researchNotes": "Search for 'Latoya Pruit' returned no relevant results. Retried with the variant 'Pruitt': a 2025 Sunflower County CSD staff directory lists a Latoya Pruitt as Principal of Ruleville Central Elementary, a specific campus in the district — proposing 'Pruitt' as a spelling correction, not applying it."
    }

Every input field is passed through unchanged (even ones you didn't touch) so
`match-contact` never has to merge two files together — its input is just
this skill's output, in full.

## Field reference

| Field | Type | Notes |
|---|---|---|
| `alternateDistrictNames` | `string[]` | Unchanged from before. Best guess first; empty = none found/needed. |
| `alternateNameSpellings` | `string[]` | New. Best guess first; empty = none found/needed. Only populated after a step-4 retry found a stronger hit than the original spelling. |
| `nameCorrectionConfidence` | `"high"\|"medium"\|"low"\|null` | New. `null` when `alternateNameSpellings` is empty — there's nothing to rate. |
| `institutionLevel` | `"central_office"\|"specific_campus"\|"unknown"` | New. |
| `institutionLevelCampusName` | `string\|null` | New. Only set when `institutionLevel` is `"specific_campus"`. |
| `institutionLevelConfidence` | `"high"\|"medium"\|"low"` | New. Always set, even for `"unknown"` (rate your confidence *in the unknown determination itself* as low, not omit it). |
| `institutionLevelAsOfDate` | `string\|null` | New. A date/year attributable to an actual source; `null` is the expected default. |
| `titleFinding` | `string\|null` | New. `null` if nothing corroborated any title. |
| `titleFindingConfidence` | `"high"\|"medium"\|"low"\|null` | New. `null` when `titleFinding` is `null`. |
| `titleFindingAsOfDate` | `string\|null` | New. Same rules as `institutionLevelAsOfDate`. |
