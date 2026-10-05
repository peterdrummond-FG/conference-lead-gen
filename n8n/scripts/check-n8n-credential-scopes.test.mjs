import test from 'node:test';
import assert from 'node:assert/strict';
import { auditWorkflows } from './check-n8n-credential-scopes.mjs';

function wf(name, credentialNames, { wrapped = false } = {}) {
  const workflow = {
    name,
    nodes: credentialNames.map((credName, i) => ({
      name: `Node ${i}`,
      credentials: { someCredType: { id: 'irrelevant-in-git', name: credName } },
    })),
  };
  return { file: `${name}.json`, json: wrapped ? { workflow } : workflow };
}

test('passes a skill holding only the model credential', () => {
  assert.deepEqual(auditWorkflows([wf('skill-extract-note-contacts', ['Anthropic account 2'])]).failures, []);
});

test('fails a skill that reaches the Supabase service-role credential', () => {
  // The shape CLAUDE.md rule 2 forbids: an authenticated write inside the
  // session that reads attacker-supplied input.
  const { failures } = auditWorkflows([wf('skill-process-cards', ['Anthropic account 2', 'Supabase account'])]);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /"Supabase account", outside its policy/);
});

test('fails a pipeline that holds the model credential directly', () => {
  // Rule 3: every model call goes through a skill whose output is validated.
  const { failures } = auditWorkflows([wf('pipeline-match-contact', ['Supabase account', 'Anthropic account 2'])]);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /Anthropic account 2/);
});

test('fails a covered workflow with no policy entry instead of passing it', () => {
  const { failures } = auditWorkflows([wf('skill-some-new-skill', ['Anthropic account 2'])]);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /no entry in WORKFLOW_CREDENTIAL_POLICY/);
});

test('fails a credential reference with no name', () => {
  const nameless = { file: 'x.json', json: { name: 'skill-match-contact', nodes: [{ name: 'Agent', credentials: { anthropicApi: { id: 'abc' } } }] } };
  const { failures } = auditWorkflows([nameless]);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /no name/);
});

test('ignores workflows outside the covered prefixes', () => {
  const { failures, checked } = auditWorkflows([wf('Probe: Step 4 anything', ['Supabase account', 'Anthropic account 2'])]);
  assert.deepEqual(failures, []);
  assert.equal(checked, 0);
});

test('reads the MCP get_workflow_details shape too', () => {
  const { failures, checked } = auditWorkflows([wf('error-alert-email', ['Alert SMTP'], { wrapped: true })]);
  assert.deepEqual(failures, []);
  assert.equal(checked, 1);
});

test('lets the voice pipeline hold the transcription credential', () => {
  const { failures } = auditWorkflows([wf('pipeline-voice-transcription', ['Supabase account', 'Supabase DB Webhook Secret', 'OpenAI account 2'])]);
  assert.deepEqual(failures, []);
});

test('fails the transcription credential on any other pipeline or a skill', () => {
  // It is allowed on exactly one workflow. Spreading it to others would give a
  // second place where untrusted text reaches a model without a validated schema.
  for (const name of ['pipeline-match-contact', 'pipeline-note-extraction', 'skill-attribute-voice-memo']) {
    const { failures } = auditWorkflows([wf(name, ['OpenAI account 2'])]);
    assert.equal(failures.length, 1, name);
    assert.match(failures[0], /"OpenAI account 2", outside its policy/);
  }
});
