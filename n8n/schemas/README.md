# Skill output schemas

One JSON Schema per skill output contract. These are the source of truth for
what a skill may return; each skill sub-workflow passes its schema to
`sub-run-skill` (n8n workflow `mSh7BrUutm3k2p4B`), whose Structured Output
Parser rejects anything that doesn't match. A rejection is a pipeline failure:
the row stays pending for a human (CLAUDE.md rule 3).

| File | Skill |
|---|---|
| `intent.schema.json` | classify-contact-intent |
| `note-extraction.schema.json` | extract-note-contacts |
| `attribution.schema.json` | attribute-voice-memo |
| `research.schema.json` | research-contact |
| `match.schema.json` | match-contact |
| `card-vision.schema.json` | process-cards (vision call) |

Translated from the Zod schemas in `schemas.mjs` (the archived build's copy of
`local-agent/schemas.mjs`). The same 64 fixtures run through both agree on
every case but one, which is deliberate (see attribution below).

## Encoding rules — these are not style, they are what n8n's parser honours

Probed live on `workflow.flippengroup.com`, 2026-09-24:

- **Never use `if` / `then` / `else`.** The parser silently ignores them: a
  `matchConfidence: "high"` with no matched account — the fabricated-match
  incident's exact shape — passed validation.
- **Write every cross-field rule as `anyOf`, and combine rules under `allOf`.**
  "A implies B" is `anyOf: [not-A, B]`. "Set together or null together" is
  `anyOf: [both absent, both present]`. Both forms are enforced.
- **No `$ref`.** The parser doesn't support it; inline everything.
- **A nullable object or array is `anyOf: [{type: null}, {...}]`**, not a
  `type` array.

## How the parser actually works (so the behaviour below makes sense)

n8n does not parse free text. It gives the model a `format_final_json_response`
**tool** whose input schema is this schema, then validates the tool call. The
model therefore sees the constraints and usually shapes its output to fit —
extra keys get dropped, `"yes"` becomes `true` — before validation runs. Real
violations still get through to the validator and are rejected (the incident's
`"ase"`/`"asdf"` was, on the real `match.schema.json`), so validation remains
the control; it just isn't the only thing shaping the output.

## Things the schema can't do, which the caller must

- **Pass-through fields.** Unknown keys do not survive: research-contact's
  input fields (email, district, phone…) were silently dropped. Its contract —
  output is the input plus the research fields, handed to match-contact
  unchanged — is therefore implemented by the research-contact sub-workflow
  merging `{...input, ...validatedOutput}`, not by the model copying fields.
  Research's own `firstName`/`lastName` still win, preserving name correction.
- **Defaults.** Every probe case came back with defaulted fields filled in, but
  whether the parser or the model did it isn't observable. Read optional fields
  with a fallback (`?? ''` / `?? null`) rather than assuming they're present.
- **Blank → null.** Zod's `blankToNull` trimmed and nulled blank strings. JSON
  Schema can't transform, so `""` and whitespace-only strings pass through as
  strings. The cross-field rules already treat blank as absent; the pipeline
  must convert blank to null before persisting (match-contact and
  research-contact text fields).

## Deliberate differences from the Zod version

- `attribution.schema.json` rejects an extra key on a result (Zod silently
  dropped it). "No other keys" is the simplest proven way to say "exactly one
  of `excerpt` or `notFound`". It fails safe: the memo stays pending.

## Changing a schema

Edit the file here, then rebuild the skill sub-workflow that embeds it — n8n
holds a copy, not a reference. Test both the case you're allowing and the case
you're rejecting; the parser has already proven it will ignore a keyword
without complaint.
