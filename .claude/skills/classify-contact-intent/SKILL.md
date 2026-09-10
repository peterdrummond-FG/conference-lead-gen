---
name: classify-contact-intent
description: Read a contact's interaction notes (rep-typed text and voice-memo transcripts alike) and classify how the conversation went as hot/warm/cold, or null if the text carries no signal either way. Use when invoked headlessly by local-agent's intentLoop whenever a contact's interaction_notes text changes and no reviewer has manually set contact_intent.
---

# Classify contact intent

A sales rep captures a contact at a conference, then leaves free-text notes
about the conversation — typed directly into the review UI or transcribed
from a voice memo recorded on the spot. Your job is text-only: read that
note and decide how promising this lead sounds, so a reviewer gets a
heat-indicator badge on the card without having to read every note
themselves.

This is a **text-only** skill: no Zoho lookup, no web search, no photo. Read
exactly the note text you're given, and nothing else.

## Input

You'll be told a file path containing JSON shaped like:

```json
{
  "contactId": "2f2a77eb-8039-4359-880f-f4d9ef1d6f65",
  "interactionNotes": "Really need to follow up with this person — she said budget was approved for next year and she wants a demo ASAP."
}
```

`interactionNotes` is never empty (the caller only invokes this skill when
there's text to classify).

## Steps

1. **Read the note once, in full.** It may be a rep's own shorthand, a
   verbatim voice-memo transcript, or a mix of several notes appended over
   the course of an event — treat all of it as one conversation history.
2. **Classify the overall signal:**
   - **`hot`** — clear buying signal or urgency: explicit interest in
     purchasing/demoing soon, a stated budget or timeline, an explicit ask
     to follow up promptly, or strong enthusiasm paired with a next step
     ("really need to follow up with this person", "wants a demo next
     week", "very excited, ready to move forward").
   - **`warm`** — genuine but unhurried interest: a good conversation, mild
     curiosity, or a soft "check back later" with no urgency or concrete
     next step ("good conversation, interested but says timing isn't
     right yet", "wants more info, no rush").
   - **`cold`** — explicit disinterest or a bad fit: no budget, no
     authority to buy, an explicit brush-off, or a stated reason this
     account won't move forward ("not interested", "no budget this cycle",
     "wrong contact — doesn't handle purchasing").
   - **`null`** — the note carries no signal about interest level at all:
     purely factual/administrative text (correcting a spelling, a title, a
     phone number) with nothing about how the conversation went. Do not
     guess a level from silence — a note that simply doesn't address
     interest is `null`, not `warm`.
3. **When in doubt between two levels**, prefer the calmer one — don't read
   ordinary politeness ("great meeting you") as `hot` on its own; require an
   actual urgency, timeline, or explicit follow-up ask for `hot`.

## Output

**Your entire final message must be exactly one JSON object and nothing
else** — no markdown fence, no leading or trailing commentary. First
character `{`, last character `}`.

```json
{ "contactIntent": "hot" }
```

`contactIntent` must be exactly one of `"hot"`, `"warm"`, `"cold"`, or `null`
— never any other value, never omitted.
