---
name: attribute-voice-memo
description: Given a voice-memo transcript and the list of contacts captured so far by the same rep at the same event, decide which parts of the transcript are about which contact, quoting only the relevant verbatim excerpt per person. Use when invoked headlessly by local-agent's transcription loop whenever a memo has 2+ candidate contacts to attribute against.
---

# Attribute voice memo

A rep just recorded a voice memo after (or between) photographing business
cards. The memo may be about one person, several people, or — reasoning about
a name alone can be wrong — no one you can confidently place at all. Your job
is text-only: given the transcript and every contact still eligible to be
what it's about, decide which contact(s) it actually references, and extract
*only* the words relevant to each one.

**Every invocation is a fresh, memory-less session, covers exactly one
memo,** and is given every currently-eligible contact in one call — reason
about all of them together (this lets you tell two similarly-named people
apart, or notice a memo covers more than one of them), not one at a time.

This is a **text-only** skill: no photo, no image path, no Zoho lookup, no
web search. Everything you need is in the input JSON.

## Input

You'll be told a file path containing JSON shaped like:

```json
{
  "transcript": "All right, this is a note that is supposed to attach to Morgan Goering...",
  "candidates": [
    { "contactId": "d3c0aa3c-cb1f-4988-993e-14860cebd1bb", "firstName": "Tyler", "lastName": "Tucker", "email": null, "phone": null, "title": null },
    { "contactId": "2f2a77eb-8039-4359-880f-f4d9ef1d6f65", "firstName": "Morgan", "lastName": "Goering", "email": "mgoering@mnscsc.org", "phone": "(507) 386-2973", "title": "COMPASS Regional MnMTSS Lead" }
  ]
}
```

`candidates` is every contact this memo could plausibly be about (captured
by the same rep, at the same event) — not just the one card photographed
immediately before this memo. A memo can reference someone captured much
earlier in the day.

## Steps

1. **Read the transcript once, in full.**
2. **For each candidate**, decide whether the transcript explicitly refers to
   that specific person — first name, last name, or full name is the primary
   signal; email/phone/title are corroborating signals only, useful when a
   name alone doesn't disambiguate (e.g. two candidates share a first name).
   An unanchored pronoun ("she was great") only counts if a name was just
   stated immediately before it in the same breath — don't chain a pronoun
   across unrelated sentences to a name mentioned much earlier.
3. **Extract the verbatim span(s)** of the transcript relevant to that
   candidate — copy the exact words spoken. Never paraphrase, summarize,
   clean up, or invent wording that isn't in the transcript. If the same
   person is referenced in two separate places, concatenate those spans in
   transcript order, joined with `" ... "`.
4. **Ambiguity rule — do not guess.** If two or more candidates have the same
   or a confusably similar name and nothing in the transcript disambiguates
   which one is meant, or a reference doesn't clearly match any one
   candidate, mark the affected candidate(s) `"notFound": true` instead of
   forcing an attribution. Attaching the wrong person's private note to a
   contact's CRM record is worse than attaching nothing.
5. **No-name-mentioned case:** if the transcript contains no attributable
   reference to *any* candidate at all (a rep just narrating a general
   impression, no name spoken), mark every candidate `"notFound": true`. Do
   not guess a "most likely" recipient — the caller owns a separate,
   deterministic fallback for exactly this case; your job stops at "found
   nothing to attribute."
6. Every candidate you were given must appear exactly once in your output —
   either `excerpt` or `notFound: true`, never both, never neither.

## Output

**Your entire final message must be exactly one JSON object and nothing
else** — no markdown fence, no leading or trailing commentary. First
character `{`, last character `}`.

```json
{
  "results": [
    { "contactId": "d3c0aa3c-cb1f-4988-993e-14860cebd1bb", "excerpt": "I'd like to add that Tyler Tucker is not someone that we are going to be processing as a teacher because he doesn't fit the job description." },
    { "contactId": "2f2a77eb-8039-4359-880f-f4d9ef1d6f65", "excerpt": "Morgan Goering, he's great. Had a great conversation with her, really enjoyable, very knowledgeable, and I think that her school district is going to purchase every single product in our entire inventory. Sweet." }
  ]
}
```

Include exactly one entry per candidate you were given, in any order —
either `excerpt` (the verbatim relevant span) for a confidently-attributed
contact, or `"notFound": true` for one the memo doesn't clearly reference.
Never both, never neither.
