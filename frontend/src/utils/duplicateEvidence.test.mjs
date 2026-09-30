// Run: cd frontend && npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { alternativeValues, differingFields, evidenceTags, suggestedId } from './duplicateEvidence.ts';

function rec(over = {}) {
  return {
    id: 'a', firstName: 'Calen', lastName: 'Taylor', email: null, phone: null, title: null, source: 'form',
    districtName: null, schoolDistrictNameRaw: null, schoolName: null, schoolNameRaw: null,
    matchStatus: 'new_account', personVerified: null, extractionConfidence: null,
    ...over,
  };
}

test('a field differs only when two records give different non-empty values', () => {
  const group = [
    rec({ id: 'a', email: 'calen@x.org', phone: '555' }),
    rec({ id: 'b', firstName: 'Caleb', email: 'ctaylor@x.org', phone: null }),
  ];
  const d = differingFields(group);
  assert.ok(d.has('firstName'));
  assert.ok(d.has('email'));
  // b simply has no phone: missing data, not a disagreement.
  assert.ok(!d.has('phone'));
  assert.ok(!d.has('lastName'));
});

test('case and spacing alone are not a difference', () => {
  const d = differingFields([rec({ title: 'Director  of Curriculum' }), rec({ id: 'b', title: 'director of curriculum' })]);
  assert.ok(!d.has('title'));
});

test('alternatives are de-duplicated and exclude the current value', () => {
  const group = [rec({ lastName: 'Taylor' }), rec({ id: 'b', lastName: 'taylor' }), rec({ id: 'c', lastName: 'Tailor' })];
  assert.deepEqual(alternativeValues(group, 'lastName', 'Taylor'), ['Tailor']);
  assert.deepEqual(alternativeValues(group, 'email', ''), []);
});

test('a verified attendee with a Zoho match is suggested over a low-confidence scan', () => {
  const group = [
    rec({ id: 'scan', source: 'card_photo', extractionConfidence: 'low', firstName: 'Caleb' }),
    rec({ id: 'form', matchStatus: 'existing_contact', personVerified: true, email: 'c@x.org' }),
  ];
  assert.equal(suggestedId(group), 'form');
});

test('a tie suggests nothing rather than guessing', () => {
  assert.equal(suggestedId([rec({ id: 'a' }), rec({ id: 'b' })]), null);
});

test('evidence tags name the match, research and OCR confidence', () => {
  const labels = evidenceTags(rec({ source: 'card_photo', extractionConfidence: 'low', matchStatus: 'existing_contact', personVerified: false })).map((t) => t.label);
  assert.deepEqual(labels, ['Contact in Zoho', 'Not verified online', 'Hard to read']);
  // OCR confidence means nothing for a typed form.
  assert.deepEqual(evidenceTags(rec({ extractionConfidence: 'low' })), []);
});
