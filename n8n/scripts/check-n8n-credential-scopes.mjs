#!/usr/bin/env node
// n8n-side successor to scripts/check-skill-profiles.mjs.
//
// That script enforced "a skill's claude -p session may only reach the
// tools/MCP servers its profile in skill-profiles.mjs declares" and threw at
// invocation time for an undeclared skill. n8n has no equivalent runtime
// enforcement (see the migration plan, "Credential/sandboxing model" —
// n8n's Projects/credential-sharing can make it *inconvenient* to attach the
// wrong credential inside a skill sub-workflow's editor, but nothing stops
// it structurally). This script is the mechanical audit that takes its
// place: a skill sub-workflow that references a credential outside its
// declared policy fails CI, exactly like an undeclared skill failed
// invocation before.
//
// NOT WIRED INTO CI YET. Per the migration plan's sequencing, this becomes a
// required CI step only once local-agent/watch-cards are fully decommissioned
// and scripts/check-skill-profiles.mjs is retired alongside them (Stage 5+) —
// running both in parallel would just be two guards for two different,
// temporarily-coexisting systems. Runnable standalone in the meantime
// against exported workflow JSON to check the audit logic itself.
//
// Usage:
//   node check-n8n-credential-scopes.mjs <path-to-exported-workflows-dir>
//
// Expects one JSON file per workflow (the shape `n8n export:workflow --all
// --output=<dir>` produces — see n8n/workflows/README once that export
// convention is adopted), each tagged `skill-sandboxed` if it's a skill
// sub-workflow this script should check.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// The direct analog of SKILL_PROFILES in local-agent/skill-profiles.mjs.
// Credential NAMES here (not raw ids — see the SDK's own newCredential()
// convention) must match exactly what each skill sub-workflow's nodes
// reference. Extend this map every time a new skill sub-workflow is added —
// an entry-less tagged workflow is treated as a failure, not silently passed.
export const SKILL_WORKFLOW_CREDENTIAL_POLICY = {
  // The shared engine every "thin wrapper" skill sub-workflow below calls
  // via Execute Workflow (see n8n/workflows/sub-run-skill.json, built
  // Stage 1). Updated 2026-09-23: this map originally gave each skill its
  // own ['Anthropic API'] entry, assuming each would call Anthropic
  // directly -- once the actual Call Anthropic node moved into one shared
  // sub-run-skill instead of being duplicated per skill, that assumption
  // went stale before a single skill wrapper was even built. Postgres (n8n
  // pipeline) here is scoped to just the circuit_breaker table's own narrow
  // role/grants (see the migration plan, "Circuit breaker & observability"),
  // not a general-purpose DB credential.
  'sub-run-skill': ['Anthropic API', 'Postgres (n8n pipeline)'],
  // Thin wrappers: a Set node holding the skill's system prompt + an Execute
  // Workflow call into sub-run-skill. No credential of their own -- if one
  // of these ever shows up with a credential, that IS the drift this script
  // exists to catch (the Anthropic call belongs in sub-run-skill only).
  'sub-classify-contact-intent': [],
  'sub-attribute-voice-memo': [],
  'sub-extract-note-contacts': [],
  'sub-research-contact': [],
  // Carved out from the generic contract (multi-turn Zoho tool use /
  // interleaved vision + deterministic file ops) -- these DO hold their own
  // Anthropic credential directly, per the plan's "match-contact: Zoho
  // tool-use loop" and "process-cards" sections.
  'sub-match-contact': ['Anthropic API', 'Zoho Read-Only (MCP)'],
  // Updated 2026-09-23 (Stage 4 build): needs Supabase Storage (n8n) too, not
  // just Anthropic -- it downloads the original photo and uploads crops
  // itself (deliberately not routed through sub-run-skill; see its own
  // sticky note for why), so both credentials legitimately belong on its
  // own nodes.
  'sub-process-cards': ['Anthropic API', 'Supabase Storage (n8n)'],
  'sub-locate-cards': ['Anthropic API'],
};

const SANDBOXED_TAG = 'skill-sandboxed';

function collectCredentialNames(workflowJson) {
  const names = new Set();
  for (const node of workflowJson.nodes ?? []) {
    const creds = node.credentials ?? {};
    for (const credRef of Object.values(creds)) {
      // n8n workflow JSON credential references are typically
      // { id, name } — name is what we compare against the policy above
      // (ids are instance-specific and not meaningful to diff in git).
      if (credRef?.name) names.add(credRef.name);
    }
  }
  return names;
}

function isSandboxed(workflowJson) {
  return (workflowJson.tags ?? []).some((t) => (typeof t === 'string' ? t : t?.name) === SANDBOXED_TAG);
}

async function loadExportedWorkflows(dir) {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  const workflows = [];
  for (const file of files) {
    const raw = await readFile(path.join(dir, file), 'utf8');
    workflows.push({ file, json: JSON.parse(raw) });
  }
  return workflows;
}

export function auditWorkflows(workflows) {
  const failures = [];
  for (const { file, json } of workflows) {
    if (!isSandboxed(json)) continue;
    const name = json.name;
    const policy = SKILL_WORKFLOW_CREDENTIAL_POLICY[name];
    if (!policy) {
      failures.push(
        `${file}: workflow "${name}" is tagged ${SANDBOXED_TAG} but has no entry in ` +
        `SKILL_WORKFLOW_CREDENTIAL_POLICY — refusing to assume it's sandboxed correctly. ` +
        `Add one (most skills need only ['Anthropic API']).`,
      );
      continue;
    }
    const allowed = new Set(policy);
    const used = collectCredentialNames(json);
    for (const credName of used) {
      if (!allowed.has(credName)) {
        failures.push(
          `${file}: workflow "${name}" references credential "${credName}", which is outside its ` +
          `declared policy [${policy.join(', ')}].`,
        );
      }
    }
  }
  return failures;
}

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Usage: node check-n8n-credential-scopes.mjs <path-to-exported-workflows-dir>');
    process.exit(2);
  }
  const workflows = await loadExportedWorkflows(dir);
  const failures = auditWorkflows(workflows);
  if (failures.length > 0) {
    console.error(`check-n8n-credential-scopes: ${failures.length} violation(s) found:\n`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`check-n8n-credential-scopes: ${workflows.length} workflow(s) checked, no violations.`);
}

// `file://${process.argv[1]}` breaks when argv[1] is a relative path (the
// documented usage: `node check-n8n-credential-scopes.mjs <dir>` from the
// n8n/scripts directory, or `node n8n/scripts/check-n8n-credential-scopes.mjs
// <dir>` from the repo root) -- it silently no-ops with exit code 0 instead
// of running, which is worse than crashing for something meant to gate CI.
// pathToFileURL normalises both sides the same way import.meta.url already is.
import { pathToFileURL } from 'node:url';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
