// Run: node --test scripts/check-no-auto-confirm.test.mjs
// The guard has to go red on a planted auto-confirm, not just stay green on the repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { findViolations, repoFiles, DECISION_MIGRATION } from './check-no-auto-confirm.mjs';

const f = (path, text) => [{ path, text }];

test('the real repo has no auto-confirm', () => {
  assert.deepEqual(findViolations(repoFiles()), []);
});

test('a function that writes review_status approved is caught', () => {
  assert.equal(findViolations(f('supabase/functions/some-new-fn/index.ts', 'await s.from("contacts").update({ review_status: "approved" })')).length, 1);
  assert.equal(findViolations(f('local-agent/agent.mjs', "const row = { review_status: 'approved' };")).length, 1);
  assert.equal(findViolations(f('n8n/pipelines/pipeline-match-contact.ts', "const p = { reviewStatus: 'approved' };")).length, 1);
});

test('setting the auto_approved flag is caught', () => {
  assert.equal(findViolations(f('supabase/functions/x/index.ts', 'update({ auto_approved: true })')).length, 1);
});

test('the human writers are allowed, and reading approved is not writing', () => {
  assert.deepEqual(findViolations(f('supabase/functions/contacts-bulk-approve/index.ts', 'update({ review_status: "approved", auto_approved: false })')), []);
  assert.deepEqual(findViolations(f('supabase/functions/export-summary/index.ts', 'q.eq("review_status", "approved")')), []);
  assert.deepEqual(findViolations(f('supabase/functions/contacts-patch/index.ts', 'if (body.reviewStatus === "approved" && x) fail()')), []);
  assert.deepEqual(findViolations(f('supabase/functions/x/index.ts', '// used to set review_status: "approved" here\nconst a = 1;')), []);
});

test('the old finalize_contact_match is caught in a migration from the decision on, and left alone before it', () => {
  const old = "update contacts set review_status = case when p_match_confidence = 'high' then 'approved' else review_status end;";
  assert.equal(findViolations(f(`supabase/migrations/${DECISION_MIGRATION}_x.sql`, old)).length, 1);
  assert.equal(findViolations(f('supabase/migrations/20990101000000_later.sql', old)).length, 1);
  assert.deepEqual(findViolations(f('supabase/migrations/20260925221637_finalize_contact_match_requires_pending.sql', old)), []);
  assert.deepEqual(findViolations(f(`supabase/migrations/${DECISION_MIGRATION}_x.sql`, "-- review_status = 'approved' used to be set here\nselect 1;")), []);
});

test('a workflow node that writes approved is caught; a sticky note describing it is not', () => {
  const node = (type, body) => JSON.stringify({ nodes: [{ type, parameters: { body } }] });
  assert.equal(findViolations(f('n8n/workflows/w.json', node('n8n-nodes-base.httpRequest', '{"review_status": "approved"}'))).length, 1);
  assert.deepEqual(findViolations(f('n8n/workflows/w.json', node('n8n-nodes-base.stickyNote', 'applies the auto-approve rule: review_status approved'))), []);
});
