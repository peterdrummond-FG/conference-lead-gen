# n8n migration (in progress — NOT deployed, NOT live)

This directory holds the n8n-based replacement for `local-agent/` and
`watcher/`, per the plan at
`.claude/plans` (see git history / `CLAUDE.md` for context) once it's
adopted here permanently. Full design: see the migration plan this was built
from — phased rollout, credential/sandboxing model, and verification steps
are all described there; this README only tracks build status.

**Status: build-only.** `local-agent/` and `watcher/` are still the live,
production system — reps are actively using them at conferences. Nothing in
this directory is deployed, activated, or wired to production credentials.
Do not activate any workflow here, apply any migration listed under
`n8n/migrations-to-apply/`, or stop `local-agent`/`watcher` until each
phase's shadow/dual-run verification (see the plan) has actually passed.

## Layout

| Path | What it is |
|---|---|
| `infra/` | Docker Compose stack + custom n8n image for the self-hosted VPS. Not yet provisioned on a real server. |
| `schemas/` | Ported Zod output-validation schemas (`schemas.mjs` + `schemas.test.mjs`, copied near-verbatim from `local-agent/`) for use inside n8n Code nodes. |
| `scripts/` | `check-n8n-credential-scopes.mjs` — the n8n-side successor to `scripts/check-skill-profiles.mjs`. Not yet wired into CI. |
| `workflows/` | Git-trackable exports of the n8n workflows built via the n8n connector (draft/inactive). Source of truth for what's actually built; re-export after any change made in the n8n editor. |

## Phase status (see the migration plan for full phase descriptions)

- [~] Phase 0 — infra scaffold, missing-migration backfill, circuit breaker
      table, Twilio reconciliation/retry workflows, reconciliation sweep,
      purge-expired-media.
      **Built (inactive, in the personal n8n project on
      workflow.flippengroup.com):** `pipeline-reconciliation-sweep`,
      `pipeline-purge-expired-media`, `pipeline-retry-failed-inbound-messages`,
      `pipeline-relink-unlinked-audio` (claim + candidate-refetch only —
      the actual attribution call is deliberately left unwired, see the
      sticky note on that workflow — it needs Stage 1's `sub-run-skill`
      pattern and Stage 3's Whisper container). **Stubbed, not functional:**
      `pipeline-failed-media-retry` (claim step works; the redownload step
      needs a Twilio credential that doesn't exist anywhere in this project
      yet), `pipeline-twilio-reconciliation` (design confirmed, no
      functional nodes — cannot do anything without that same Twilio
      credential). **Still open:** provisioning the real Twilio credential
      and the actual VPS/Docker stack; a dedicated low-privilege Postgres
      role for these workflows (`n8n_circuit_breaker` exists and is scoped
      correctly, but the broader "Postgres (n8n pipeline)" placeholder used
      by the workflows above has no real role/grants behind it yet — needs
      its own migration before any of this can run for real); configuring
      Twilio's Fallback URL (manual, Twilio Console).
- [~] Phase 1 — `sub-run-skill`, `classify-contact-intent`, intent pipeline.
      **Built (inactive):** `sub-run-skill` (circuit breaker check/trip,
      Anthropic call with node-level retry, full `schemas.mjs` inlined for
      validation — tagged `skill-sandboxed`), `sub-classify-contact-intent`
      (thin wrapper embedding the skill's system prompt, tagged
      `skill-sandboxed`), `pipeline-contact-intent` (20s Schedule Trigger →
      claim → classify → optimistic write or no-op). `check-n8n-credential-scopes.mjs`
      passes against all of them (no violations) — its policy map was
      corrected in the same pass: the original Stage 0 skeleton assumed
      each skill called Anthropic directly, which stopped being true the
      moment the actual Anthropic call moved into the one shared
      `sub-run-skill` engine. **No credential is attached to any node in
      any of these three workflows** — the n8n instance still has zero
      credentials configured (verified via `list_credentials`); "Postgres
      (n8n pipeline)" and "Anthropic API" in the sticky notes are the
      *intended* names to create once real secrets exist, not something
      already wired. **Still needs verification before this leaves draft
      status**, called out in `sub-run-skill`'s sticky note: the exact
      field name the Anthropic node's response text lands under (`content`
      vs `text` vs `output`) hasn't been confirmed against a live
      execution — `Validate & Return` defensively checks all three shapes,
      but this needs a real test run once a real Anthropic credential
      exists. **Not done in this pass, by design** (per the plan): no
      workflow activated, no shadow/dual-run against production data yet.
- [~] Phase 2 — `extract-note-contacts` + note pipeline, `research-contact`.
      **Built (inactive):** `sub-extract-note-contacts` (thin wrapper,
      tagged `skill-sandboxed`), `pipeline-note-extraction` (replaces
      `noteLoop`: claim → extract → POST each contact to `contacts-from-note`
      → aggregate write — the "POST per extracted item to an Edge Function"
      pattern the plan calls out as needed later for photos), and
      `sub-research-contact` (standalone, web search enabled, deliberately
      **not** wired to `match-contact` or any write yet, per the plan's
      Phase 2 sequencing). `sub-run-skill` (Stage 1) was extended with an
      optional `webSearch` boolean input, mapped to the Anthropic node's
      native `options.webSearch` — backward compatible with existing
      callers (unmapped input resolves to `false`). Two new credential
      *names* introduced (still unattached, same as everywhere else):
      "Supabase Service Role (n8n)" (Authorization-only, for POSTing to
      Edge Functions like `contacts-from-note`/`contacts-from-ocr`) is
      distinct from Stage 0's "Supabase Storage (n8n)" (needs both `apikey`
      and `Authorization` headers) — same underlying secret, two different
      `httpTemplatedCustomAuth` credential *definitions*, since the header
      template is baked into the credential type itself. All 12 exported
      workflows still pass `check-n8n-credential-scopes.mjs` with no
      violations. **Not done in this pass, by design:** no credentials
      attached, nothing activated, `sub-research-contact` not run against a
      real contact yet.
- [~] Phase 3 — voice-memo transcription pipeline.
      **Built (inactive):** `sub-attribute-voice-memo` (thin wrapper,
      tagged `skill-sandboxed`, no fast path — always invoked whenever
      candidates.length > 0, per the 2026-09-22 audit),
      `sub-link-transcript-to-contacts` (new shared sub-workflow —
      extracted `linkTranscriptToContacts`/`recordLinkResult` logic,
      mirroring `agent.mjs`'s own factoring, since both the first-pass
      pipeline and the retry sweep need the identical logic),
      `pipeline-voice-transcription` (replaces `transcriptionLoop`: claim →
      download from Storage → call Whisper → write transcript → delegate
      linking), and **`pipeline-relink-unlinked-audio` (Stage 0's
      placeholder) is now complete** — its candidate-fetch query was fixed
      to use a `json_agg` aggregate (the original per-row `SELECT` would
      have broken 1:1 pairing across up to 3 claimed messages and been
      silently skipped on zero candidates) and its `TODO` `NoOp` now calls
      the real shared sub-workflow. All 15 exported workflows still pass
      `check-n8n-credential-scopes.mjs`.
      **A refactor worth noting:** `pipeline-voice-transcription` was
      first built with the attribution/attach/write-link-result logic
      inlined (13 nodes), then immediately refactored to call
      `sub-link-transcript-to-contacts` instead, once it became clear
      `pipeline-relink-unlinked-audio` needed the exact same logic — done
      before any duplication could drift the two callers apart, the same
      class of problem this project's own history (the old SMS-photo/
      watcher duplication) warns about.
      **Explicitly NOT verified, per the plan's own callout:** the Call
      Whisper node's request shape (`POST /asr?task=transcribe&language=en
      &initial_prompt=...&output=text`) is a best-effort port of
      `whisper-asr-webservice`'s documented API — nothing has confirmed
      against a live instance that this image actually exposes
      `initial_prompt` over HTTP the way the CLI flag does. **Not done in
      this pass, by design:** no credentials attached, nothing activated,
      no Whisper container provisioned yet.
      **2026-09-23 correction:** Call Whisper's `url` was originally
      hardcoded to `http://whisper:9000/asr` — the Docker Compose
      service-name hostname from `infra/docker-compose.yml`'s scaffold,
      valid only if this workflow runs inside that (not-yet-provisioned)
      stack. Confirmed with the user, then verified with a real test
      execution (`getaddrinfo ENOTFOUND whisper`), that
      `workflow.flippengroup.com` — the actual instance every workflow in
      this migration was built in — is a separate, pre-existing n8n
      hosting setup, not that compose stack, with no Whisper deployment
      reachable from it. Replaced with a `placeholder()`, same treatment as
      `sub-match-contact`'s Zoho MCP endpoint URL, so this is a visible gap
      in the editor rather than a silently-wrong address. **Still open:**
      where Whisper actually gets hosted relative to
      `workflow.flippengroup.com` hasn't been decided.
- [~] Phase 4 — `process-cards` (SMS path) + `sub-post-cards-to-ocr`.
      **Built (inactive):** `sub-post-cards-to-ocr` (shared per-card POST to
      `contacts-from-ocr`, reuses Stage 2's "Supabase Service Role (n8n)"
      credential), `sub-process-cards` (vision extraction + crop, 25 nodes),
      and `pipeline-process-cards-sms` (replaces `photoLoop`, the sole
      card-photo intake path now that `watcher/` is retired). A new schema,
      `CardVisionOutput`, was added to `n8n/schemas/schemas.mjs` (+ 4 tests,
      19/19 passing) — the vision call's actual output shape genuinely
      differs from the CLI skill's existing `CardExtractionOutput`: the
      model reports a `boundingBox` (fractions of the image) instead of
      executing its own crop arithmetic, and a Code node does the
      padding/pixel-conversion/cropping with `sharp` afterward — "a real
      simplification the migration buys for free," per the plan.
      **A deliberate deviation from the plan's own grouping, explained in
      the sticky note:** `sub-process-cards` does NOT route its vision call
      through `sub-run-skill`, even though process-cards's field-extraction
      half was listed among `sub-run-skill`'s five callers back in Stage 1.
      Reason: `sub-run-skill`'s Anthropic call sits behind a Postgres node
      in the data path, and whether n8n's Postgres node preserves an item's
      incoming *binary* property is unconfirmed — risking a silently
      dropped image attachment. `sub-process-cards` duplicates the
      circuit-breaker-check/call/validate pattern locally instead, with an
      explicit binary-restore step as defensive insurance either way.
      `check-n8n-credential-scopes.mjs`'s policy map was updated to give
      `sub-process-cards` both Anthropic API and Supabase Storage (n8n) —
      the original Stage 0 skeleton only anticipated Anthropic for it.
      All 18 exported workflows still pass the credential audit.
      **Genuinely higher uncertainty than earlier stages, explicitly
      flagged in the sticky notes rather than assumed:** whether Postgres
      nodes actually drop binary data (the reason for the sub-run-skill
      deviation above), and whether the Code-node binary helper APIs used
      (`this.helpers.getBinaryDataBuffer`/`prepareBinaryData`) and `sharp`
      usage are exactly correct — none of this has been exercised against
      a live n8n instance. **`locate-cards` was not built** — per the plan,
      it's dormant with no real caller anywhere in the codebase, lowest
      priority, fine to leave until genuinely needed. **Not done in this
      pass, by design:** no credentials attached, nothing activated, no
      shadow-run against real photos yet (the plan calls for shadow-mode
      testing before cutover here specifically, since this loop is not
      safely dual-runnable with `local-agent`).
- [~] Phase 5 — `match-contact` + full matching pipeline.
      **Built (inactive):** `sub-match-contact` (Zoho tool-use loop -- a plain
      Anthropic node with an MCP Client Tool subnode wired permanently,
      `maxToolsIterations: 20`, tagged `skill-sandboxed` like `sub-process-cards`
      since it holds its own Anthropic credential directly rather than routing
      through `sub-run-skill` -- a tool subnode is a static graph wire in the
      SDK, so it can't be attached conditionally per-caller the way `webSearch`
      was), and `pipeline-match-contact` (replaces `matchingLoop`: claim ->
      `sub-research-contact` -> `sub-match-contact` -> `finalize_contact_match`,
      mirroring `processContact`'s exact call order and its 19-parameter RPC
      call). `sub-research-contact` (built standalone in Phase 2) is now wired
      up for the first time, exactly as the plan specified: its full output
      object passes into `sub-match-contact` completely unchanged, no
      transform node in between. The Zoho MCP endpoint URL
      (`mcp/zoho-readonly.json` -- a live secret embedded in the URL path
      itself) is a `placeholder()`, never a real value or a credential --
      `endpointUrl` is confirmed to be a plain node parameter, not
      credential-backed, which means `check-n8n-credential-scopes.mjs`
      (auditing only `node.credentials`) structurally cannot see this node's
      Zoho access; its policy-map entry for `sub-match-contact` documents
      that gap explicitly rather than leaving it silently under-audited. All
      20 exported workflows pass the credential audit; all 19 schema tests
      pass.
      **A real drift was found and fixed along the way:** the committed
      `20260908130000_finalize_contact_match_fn.sql` migration did not match
      the live function -- missing the `p_matched_zoho_account_level` and
      `p_glance_summary` parameters, and missing two auto-approve safety
      guards (`matched_zoho_account_id is not null`,
      `research_confidence <> 'low'`) that are already live and already
      stricter than what's committed. A new backfill migration,
      `20260923180000_finalize_contact_match_account_level_and_glance_summary.sql`,
      records the live definition verbatim (a no-op against current behavior)
      -- drafted, not yet applied, per this repo's append-only migration
      convention. This mattered specifically because the auto-approve guard
      is the single most safety-critical logic in the whole matching system,
      per this project's own documented incident history, and this pipeline
      needed to call the RPC with confidence that the committed migration and
      the live function actually agree.
      **Genuinely unverified, flagged rather than assumed:** whether
      `serverTransport: 'httpStreamable'` is the right transport for this
      specific Zoho MCP server (the plan itself calls this out); whether the
      Anthropic node's own retry re-runs the whole tool-use loop from scratch
      or just the last request (informed the choice to cap `sub-match-contact`
      at 2 tries instead of the other skills' 3). **Not done in this pass, by
      design:** no credentials attached, nothing activated, no shadow-run
      against real contacts or real Zoho data yet -- the plan calls for
      validating `MatchOutput` against a held-out set and a shadow run
      (matching without writing) before `local-agent`'s `matchingLoop` is
      ever disabled.

This closes out the originally-requested Stages 0-5. None of these are cut over. `local-agent`/`watcher` remain the system of
record until each phase's plan-mandated shadow verification passes and a
human explicitly decides to cut over.
