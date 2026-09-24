import test from 'node:test';
import assert from 'node:assert/strict';
import { auditWorkflows } from './check-n8n-credential-scopes.mjs';

function sandboxedWorkflow(name, credentialNames) {
  return {
    file: `${name}.json`,
    json: {
      name,
      tags: ['skill-sandboxed'],
      nodes: credentialNames.map((credName, i) => ({
        name: `Node ${i}`,
        credentials: { someCredType: { id: 'irrelevant-in-git', name: credName } },
      })),
    },
  };
}

test('passes a skill workflow using only its declared credential', () => {
  const failures = auditWorkflows([sandboxedWorkflow('sub-classify-contact-intent', ['Anthropic API'])]);
  assert.deepEqual(failures, []);
});

test('fails a skill workflow that reaches an out-of-policy credential', () => {
  // The exact incident this guards against: a text-only skill sub-workflow
  // that somehow ends up with a node referencing the Supabase write
  // credential — should never happen, must be caught mechanically.
  const failures = auditWorkflows([
    sandboxedWorkflow('sub-classify-contact-intent', ['Anthropic API', 'Supabase Write (service role)']),
  ]);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /Supabase Write \(service role\)/);
  assert.match(failures[0], /outside its declared policy/);
});

test('fails a tagged workflow with no policy entry at all, rather than assuming it is fine', () => {
  const failures = auditWorkflows([sandboxedWorkflow('sub-some-new-skill', ['Anthropic API'])]);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /no entry in SKILL_WORKFLOW_CREDENTIAL_POLICY/);
});

test('ignores workflows not tagged skill-sandboxed even with unusual credentials', () => {
  const untagged = {
    file: 'pipeline-contact-intent.json',
    json: {
      name: 'pipeline-contact-intent',
      tags: [],
      nodes: [{ name: 'Write', credentials: { postgres: { id: 'x', name: 'Supabase Write (service role)' } } }],
    },
  };
  assert.deepEqual(auditWorkflows([untagged]), []);
});

test('only match-contact may reference the Zoho credential', () => {
  const violating = sandboxedWorkflow('sub-classify-contact-intent', ['Anthropic API', 'Zoho Read-Only (MCP)']);
  const failures = auditWorkflows([violating]);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /Zoho Read-Only \(MCP\)/);

  const allowed = sandboxedWorkflow('sub-match-contact', ['Anthropic API', 'Zoho Read-Only (MCP)']);
  assert.deepEqual(auditWorkflows([allowed]), []);
});
