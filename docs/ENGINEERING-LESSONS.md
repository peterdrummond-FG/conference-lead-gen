# Building features here without repeating the last round of bugs

Derived from the September 2026 security audit. Every item below is a
generalisation of something that actually went wrong in this repo — the
specific fix is already applied; what follows is the shape to avoid
reproducing.

Read this before adding an intake path, a skill, an Edge Function, or a poll
loop.

---

## 1. Backport the lesson, not just the fix

**What happened.** Four separate findings shared one cause: a good principle
was applied to the code being written that day and never carried back.

- The pasted-note pipeline correctly kept credentials out of the model's
  hands. `process-cards`, doing the same job, kept its `curl`.
- The new skill shipped with a data-vs-instructions anchor. The three older
  skills handling the *least* trustworthy input didn't get one.
- A retired Edge Function got a comment banner saying "retired" while
  remaining deployed and callable.
- A migration dropped an unused PIN column's purpose, and three days later a
  new plaintext PIN column appeared beside it.

**The rule.** When you establish a pattern, grep for every other place it
applies *in the same change*, and either fix them or write down why not.

```bash
# Before calling a pattern "done":
grep -rn "<the old shape>" --include="*.mjs" --include="*.ts" --include="*.md" .
```

If the list is long, fix the highest-risk instances now and open the rest as
explicit follow-ups. "New code does it right" is not a completed fix — it is a
widening inconsistency.

---

## 2. Fix the class, not the instance

**What happened.** A production run emitted a fabricated Zoho account id
alongside a "high confidence" label. The fix was a regex on the two fields
that were wrong. Fourteen other fields from the same untrusted source stayed
unvalidated — including `matchConfidence`, which is what *auto-approves a lead
for CRM export with no human review*.

The instinct was right. The scope was one instance of a general problem.

**The rule.** When something malformed reaches persistence, ask: *what is the
full contract this should have satisfied?* Then enforce the contract.

- Model output → a schema (`local-agent/schemas.mjs`), not a field check.
- A request body → a validator (`_shared/validate.ts`), not three `typeof`
  tests.
- If you find yourself writing a second ad-hoc check next to a first one,
  that's the signal to replace both.

---

## 3. Prose is not a control

**What happened.** `match-contact`'s SKILL.md stated it never writes to Zoho —
"even when a write-capable Zoho tool happens to be reachable in this
environment." That sentence accurately described a live capability gap. The
model held `createRecords`, `updateRecords` and `deleteRecords` against the
production CRM, and the only thing standing between an adversarial business
card and a mutated record was an instruction in the same context window as the
adversarial text.

**The rule.** If a document states a guarantee, something in the runtime must
enforce it. Write the sentence *and* the control:

| Guarantee in prose | Control that enforces it |
|---|---|
| "never writes to Zoho" | tool allowlist with no write verb |
| "text-only skill" | `allowedTools: ['Read']`, no MCP config |
| "the caller does the writing" | skill env carries no credential |
| "retired endpoint" | deployed 410 stub + CI probe |

A sentence that describes a capability you *have* but promise not to use is a
finding, not a mitigation. When you catch yourself writing "even though X is
reachable, don't use X" — remove X instead.

---

## 4. Verify the running system, not the artifact

**What happened, twice.**

- Two public unauthenticated INSERT endpoints stayed live for ~3 months after
  being deleted from the repo. Deleting source is not undeploying.
- During the audit I asserted all eleven orphaned functions were live, inferred
  from their last version in git history. Probing showed **nine were already
  410 stubs**. I overstated a Critical finding by reading the artifact instead
  of the system.

**The rule.** For anything deployed, the repo is a claim and the endpoint is
the evidence. Check the evidence.

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/<fn>" \
  -H "Authorization: Bearer $ANON" -d '{}'
```

`scripts/check-deployed-functions.sh` now does this in CI — it compares the
deployed list to the repo **and** probes every supposedly-retired slug to
confirm it answers 410. Keep both halves; the second is what would have caught
the three-month gap.

---

## 5. Don't trust a flag because of its name

**What happened.** Building the skill sandbox, I assumed `--allowedTools Read`
restricted the session to `Read`. Probing showed that session still had Bash,
Write, Edit, Agent and Workflow — under `--dangerously-skip-permissions` it
reads as an *additional-permissions* list, not an exclusive one. Only
`--disallowedTools` removes a built-in.

Had I trusted the name, the sandbox would have looked correct in review and
been porous in production.

**The rule.** For any security-relevant flag, config or API, prove the
behaviour once and record the result next to the code:

```js
//   * --allowedTools does NOT restrict BUILT-IN tools under
//     --dangerously-skip-permissions. Probed: a session allowed only Read
//     still had Bash, Write, Agent.
//   * --disallowedTools DOES. Probed: with Bash denied, no shell tool.
```

The probe costs minutes. The wrong assumption costs a boundary.

---

## 6. Re-validate at every trust boundary

**What happened.** A handset-supplied `Content-Type` became a substring →
became a Storage object key (written with `upsert: true`) → was read back out
of that key → was interpolated into a `claude -p` prompt. Each layer trusted
the previous one to have validated. None had.

**The rule.** "It was checked upstream" is a reason to check cheaply, not a
reason to skip. Especially when a value crosses a *system* boundary — webhook
→ database → different process → prompt.

Concretely, in this repo:

- Allowlist, don't sanitise, anything that becomes a path or a key.
- Assert the composed value, not just its inputs:
  `if (!/^sms\/[0-9a-f-]{36}\.[a-z0-9]{1,5}$/.test(key)) throw`.
- Never interpolate into a prompt without asserting shape first — a value
  carrying a newline or a quote is a prompt-framing primitive, not a filename.

---

## 7. A convenience default is a decision

**What happened.** Three defaults each turned into a security or correctness
problem:

- CORS fell back to `allowed[0]` for an unknown origin — not a denial, just a
  misleading header that masked the misconfiguration.
- The frontend fell back to the **production** Supabase project when an env var
  was missing, so a typo pointed a dev build at live data instead of failing.
- `ALLOWED_ORIGINS` unset silently meant "localhost only", whose first symptom
  in production would be an outage that looks like anything but config.

**The rule.** For each default, ask: *if this fires in production, is it safe
and obvious?*

- Unknown/invalid input → refuse, don't substitute a plausible value.
- Missing required config → fail loudly at startup or build, never fall back to
  the riskiest working value.
- If a fallback must exist, log it at `error` so it shows up before a user
  finds it.

---

## 8. Don't mark work done before it's delivered

**What happened.** `export-csv` stamped `synced_at` on every exportable contact
as its *first* action, before building the CSV, let alone delivering it. A
timeout, a dropped download or a closed tab permanently removed those leads
from every future export — with no record of which ones, because that list was
the response body.

**The rule.** Order side effects so a failure is recoverable:

1. reserve / claim (idempotent, reversible)
2. do the work
3. confirm, only once the consumer has it

Choose at-least-once over at-most-once whenever a duplicate is cheaper than a
loss. A duplicate row in a Zoho import is a mergeable nuisance; a conference
lead that never arrives is gone. Add an expiry so an unconfirmed reservation
returns to the pool on its own.

---

## 9. Follow the concurrency pattern this codebase already has

**What happened.** The new SMS cron read a set of rows, did slow per-row HTTP
work, then wrote a watermark. pg_cron fires every 60 s without waiting for the
previous run, so overlapping ticks re-read the same rows and re-sent the same
messages — which on an A2P 10DLC campaign is a carrier-filtering risk, not just
an annoyance.

Every other loop in this repo already does it correctly.

**The rule.** Before writing a new loop, copy the existing shape:

```js
// Claim BEFORE the slow work, conditional on the precondition still holding.
const { data: claimed } = await supabase
  .from(table).update({ status: 'processing', claimed_at: now })
  .eq('id', id).eq('status', 'pending')   // re-assert
  .select('*').maybeSingle();
if (!claimed) continue;                    // someone else got it
```

Plus: a reconcile function for rows stuck mid-flight after a crash, and release
of the claim on a transient failure so it retries. See `photoLoop`,
`claim_pending_contacts`, `reconcile_stale_inbound_messages`.

---

## 10. Bound everything

**What happened.** Unbounded things found in one audit: contacts created per
pasted note; contacts classified per intent tick; text length on every
user-supplied field; SMS sent per cron tick; submissions per IP; rows fetched
per poll; log file growth; media retention.

Each one is individually reasonable at pilot scale and individually a problem
at event scale or under abuse — and several multiply, because a row inserted
here costs two `claude -p` calls downstream.

**The rule.** For every new input or loop, write down the cap before shipping:
batch size, concurrency, field length, per-actor rate, retention. If the honest
answer is "unbounded," that's a design decision needing a sentence of
justification, not a default.

Pay attention to *amplification*: one cheap public request that triggers
expensive downstream work is the shape to bound hardest.

---

## 11. Use equality when you mean equality

**What happened.** Duplicate detection used `first_name ILIKE trim(v_first)`
against raw attendee/OCR text. `%` and `_` in the right-hand side are
wildcards, so a contact named `%` matched every contact in the table. The
lookup was also unscoped across every event and every year, and collided on
placeholder names (`"Illegible"`, blank surnames), chaining unrelated people
into one duplicate group — which then suppressed auto-approval for all of them.

**The rule.** `ILIKE`/`LIKE` is pattern matching. If you want case-insensitive
equality, write `lower(trim(a)) = lower(trim(b))`. If a caller supplies a
search pattern, escape the metacharacters (`escapeLike`). And scope the
comparison to the domain where "same" actually means something — here, one
event.

Also: think about the placeholder values your own pipeline produces
(`"Illegible"`, `""`) before writing a matching rule that will see them.

---

## 12. Verify the happy path after hardening

**What happened.** Restricting the skill subprocess's environment to
`PATH`/`HOME` broke CLI authentication — `USER` is needed to reach the
Keychain, so every run failed "Not logged in". My attack-path test passed; the
normal path was broken. Found only by running a real extraction end to end.

**The rule.** A hardening change needs both tests:

- the thing you blocked is actually blocked, **and**
- the thing you intended to keep working still works.

For this repo that means running a real skill invocation after touching
`skill-runner.mjs`, `skill-profiles.mjs`, or anything under `_shared/`.

Related: understand your test harness before trusting a red result. A Postgres
CTE test looked like it failed because all CTEs in one statement share a
snapshot — the code was correct, the test was wrong. Confirm with separate
statements before "fixing" working code.

---

## 13. Write instructions that can't be pasted wrong

**What happened.** I documented `SUPABASE_ACCESS_TOKEN=... node
scripts/deploy-functions.mjs`. The `...` was pasted literally, and the script
fired 34 requests that each returned `JWT could not be decoded` — saying
nothing about the cause.

**The rule.** For anything a human runs:

- Validate obviously-wrong input up front and name the likely mistake
  ("set to a placeholder").
- Fail fast on an error that will repeat identically — one clear message beats
  34 copies.
- In docs, prefer `export VAR=<realistic-shaped-value>` on its own line over an
  inline `...` that invites exactly this.
- Say which credential is needed when several exist. This project has four
  plausible secrets (`sbp_` Management token, anon key, service-role key,
  project ref) and only one is right for any given task.

---

## 14. A guessing fallback is worse than a visibly pending state

**What happened.** Voice-memo attribution had two fallbacks, both written
under the reasoning "better than losing the memo entirely": a single-candidate
fast path that skipped attribution and attached the *whole* transcript to
whoever's card was photographed most recently, and a "nobody matched, so
attach to whichever contact was captured most recently" default when the
attribution skill came back empty. Both shipped deliberately, both read as
reasonable in review — a memo that fails to attach at all looks like a worse
outcome than one that attaches to *someone*.

In production it was the opposite. A 2026-09-22 audit found real contacts'
CRM notes silently polluted with other people's conversations — one contact's
notes were entirely made of three different other people's excerpts, none of
them about him. That's strictly worse than an empty field: an empty field is
visibly incomplete; a wrong excerpt reads as ground truth to a human reviewer
and to whatever feeds it into Zoho.

Same root shape as #10 (unbounded retry) from the other direction: instead of
retrying forever, the code gave up on retrying and substituted a guess. Both
are a caller papering over "I don't have enough information yet" instead of
saying so.

**The rule.** When a pipeline step can't confidently resolve its output,
leave the row in an explicit pending/unresolved state and make that state
*visible* (a queue, a banner, a chip — see `inbound-messages-unresolved-list`
+ Review's unresolved-intake panel), rather than forcing a plausible-looking
answer. A human can act correctly on "we don't know yet." A human cannot tell
a confident-looking wrong answer from a right one without redoing the work
themselves — which defeats the point of automating it.

Ask, for any "attach the best guess" or "default to the first/most-recent
candidate" code: what does a human reviewer see when this guess is wrong, and
how would they ever notice? If the answer is "it looks identical to a correct
result," that's the finding.

---

## Checklist before shipping a feature

- [ ] Any new skill has a profile in `skill-profiles.mjs`, minimum tools
- [ ] Any new skill's SKILL.md has the data-vs-instructions anchor
- [ ] No skill is given a credential — the caller does the writing
- [ ] Model output is schema-validated before persistence
- [ ] Every user-supplied field is length- and format-capped
- [ ] Every new loop claims before slow work, and reconciles after a crash
- [ ] Caps written down: batch, concurrency, rate, retention
- [ ] Side effects ordered reserve → work → confirm
- [ ] New Edge Function: `verify_jwt` correct; added to the repo AND deployed
- [ ] Retired endpoint: 410 stub deployed + added to `RETIRED`
- [ ] Defaults fail closed and loudly
- [ ] `node scripts/check-skill-profiles.mjs && cd local-agent && npm test`
- [ ] Ran the real happy path once, not just the unit tests
- [ ] Grepped for other places the same pattern applies
- [ ] Any "can't confidently resolve this" path leaves an explicit, visible
      pending state — never a best-guess default a reviewer can't tell apart
      from a real result
- [ ] Any new poll-loop retry uses the claim-based shape
      (`claim_pending_contacts`/`claim_unlinked_audio_messages`), not a
      time-window-from-receipt or in-process cooldown state
