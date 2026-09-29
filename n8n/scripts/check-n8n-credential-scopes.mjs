#!/usr/bin/env node
// n8n-side successor to scripts/check-skill-profiles.mjs.
//
// That script enforced "a skill's claude -p session may only reach the tools
// its profile declares". n8n has no runtime equivalent: nothing stops someone
// attaching the Supabase service-role credential to a node inside a skill
// workflow, whose whole job is reading attacker-supplied text and photos. This
// audit is the mechanical check that takes its place.
//
// Rewritten 2026-09-25 for the rebuilt workflows (the first version checked
// the archived 20-workflow build's `sub-*` names, a shared engine and a
// Postgres credential that no longer exist, and only looked at workflows
// tagged `skill-sandboxed` -- a tag nothing in the rebuild carries, so it
// would have passed everything). Coverage is now by name prefix: every
// `skill-`, `pipeline-` and `error-` workflow must have a policy entry, and a
// missing entry is a failure, not a pass.
//
// The two invariants that matter most:
//   - Skills hold only the model credential. Every authenticated write happens
//     in the calling pipeline, never inside the session that reads untrusted
//     input (CLAUDE.md rule 2).
//   - Pipelines never hold the model credential. Every model call goes through
//     a skill workflow, whose output is schema-validated before a pipeline can
//     act on it (CLAUDE.md rule 3).
//
// NOT WIRED INTO CI YET: it becomes a required step when local-agent is
// decommissioned and scripts/check-skill-profiles.mjs retires with it.
//
// Usage:
//   node n8n/scripts/check-n8n-credential-scopes.mjs <dir-of-exported-workflow-json>
//
// Accepts either `n8n export:workflow --all --separate --output=<dir>` files
// or the n8n MCP get_workflow_details payload ({ workflow: {...} }).

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Credential NAMES as they appear on nodes (ids are instance-specific and
// meaningless in git). Keep in step with n8n/scripts/build-skill-workflow.mjs
// (ANTHROPIC_CREDENTIAL) and the pipelines' newCredential() names.
const MODEL = 'Anthropic account 2';
const SUPABASE = 'Supabase account';
const DB_WEBHOOK_SECRET = 'Supabase DB Webhook Secret';
const ALERT_SMTP = 'Alert SMTP';

export const WORKFLOW_CREDENTIAL_POLICY = {
  // The Zoho MCP tool on skill-match-contact authenticates via the URL held in
  // the n8n_config data table, not an n8n credential, so it doesn't appear here.
  'skill-classify-contact-intent': [MODEL],
  'skill-extract-note-contacts': [MODEL],
  'skill-attribute-voice-memo': [MODEL],
  'skill-research-contact': [MODEL],
  'skill-match-contact': [MODEL],
  'skill-process-cards': [MODEL],

  'pipeline-contact-intent': [SUPABASE, DB_WEBHOOK_SECRET],
  'pipeline-note-extraction': [SUPABASE, DB_WEBHOOK_SECRET],
  'pipeline-voice-transcription': [SUPABASE, DB_WEBHOOK_SECRET],
  'pipeline-process-cards-sms': [SUPABASE, DB_WEBHOOK_SECRET],
  'pipeline-match-contact': [SUPABASE, DB_WEBHOOK_SECRET],

  'error-alert-email': [ALERT_SMTP],
};

const COVERED_PREFIXES = ['skill-', 'pipeline-', 'error-'];

function unwrap(json) {
  return json?.workflow && Array.isArray(json.workflow.nodes) ? json.workflow : json;
}

function collectCredentialNames(workflow) {
  const found = [];
  for (const node of workflow.nodes ?? []) {
    for (const ref of Object.values(node.credentials ?? {})) {
      // A reference with no name can't be checked against a name-based policy.
      // Report it rather than skipping it.
      found.push({ node: node.name, name: ref?.name ?? null });
    }
  }
  return found;
}

export function auditWorkflows(workflows) {
  const failures = [];
  let checked = 0;
  for (const { file, json } of workflows) {
    const wf = unwrap(json);
    const name = wf?.name ?? '';
    if (!COVERED_PREFIXES.some((p) => name.startsWith(p))) continue;
    checked++;
    const policy = WORKFLOW_CREDENTIAL_POLICY[name];
    if (!policy) {
      failures.push(
        `${file}: "${name}" has no entry in WORKFLOW_CREDENTIAL_POLICY -- refusing to assume ` +
        `its credentials are scoped correctly. Add one.`,
      );
      continue;
    }
    const allowed = new Set(policy);
    for (const { node, name: credName } of collectCredentialNames(wf)) {
      if (credName === null) {
        failures.push(`${file}: "${name}" node "${node}" has a credential reference with no name.`);
      } else if (!allowed.has(credName)) {
        failures.push(
          `${file}: "${name}" node "${node}" references credential "${credName}", outside its ` +
          `policy [${policy.join(', ')}].`,
        );
      }
    }
  }
  return { failures, checked };
}

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Usage: node n8n/scripts/check-n8n-credential-scopes.mjs <dir-of-exported-workflow-json>');
    process.exit(2);
  }
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  const workflows = [];
  for (const file of files) {
    workflows.push({ file, json: JSON.parse(await readFile(path.join(dir, file), 'utf8')) });
  }
  const { failures, checked } = auditWorkflows(workflows);
  // Every policy entry should have been seen: a workflow missing from the
  // export is as much a gap as one missing from the policy.
  const seen = new Set(workflows.map(({ json }) => unwrap(json)?.name));
  for (const expected of Object.keys(WORKFLOW_CREDENTIAL_POLICY)) {
    if (!seen.has(expected)) failures.push(`policy lists "${expected}" but no exported workflow has that name.`);
  }
  if (failures.length > 0) {
    console.error(`check-n8n-credential-scopes: ${failures.length} problem(s):\n`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`check-n8n-credential-scopes: ${checked} workflow(s) checked, no violations.`);
}

// pathToFileURL, not `file://${argv[1]}`: a relative argv[1] made the old
// comparison silently false, so the script exited 0 without running.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
