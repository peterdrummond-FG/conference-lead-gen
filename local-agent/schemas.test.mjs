// Audit Q1 Layer 2. These cover the invariants that would be expensive to
// learn about at an event, not coverage for its own sake.
//
// The MatchOutput cases are deliberately built from the REAL failure this
// project already hit: a run whose prose concluded no account existed, but
// whose structured fields claimed a "high confidence" match against a
// fabricated id ("ase") and name ("asdf").
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AttributionOutput,
  CardExtractionOutput,
  IntentOutput,
  MatchOutput,
  NoteExtractionOutput,
} from './schemas.mjs';
import { extractJson } from './skill-runner.mjs';
import { profileFor, SKILL_PROFILES } from './skill-profiles.mjs';

const VALID_ZOHO_ID = '3001271000007193584';

function goodMatch(overrides = {}) {
  return {
    matchStatus: 'new_contact_existing_account',
    matchConfidence: 'high',
    matchedZohoAccountId: VALID_ZOHO_ID,
    matchedZohoAccountName: 'Sunflower County School District',
    matchedZohoAccountLevel: 'district',
    ...overrides,
  };
}

test('MatchOutput accepts a well-formed match', () => {
  assert.equal(MatchOutput.safeParse(goodMatch()).success, true);
});

test('MatchOutput rejects the real fabricated-match payload', () => {
  const r = MatchOutput.safeParse({
    matchStatus: 'new_account',
    matchConfidence: 'high',
    matchedZohoAccountId: 'ase',
    matchedZohoAccountName: 'asdf',
  });
  assert.equal(r.success, false);
});

test('MatchOutput rejects high confidence with no matched account', () => {
  const r = MatchOutput.safeParse({ matchStatus: 'new_account', matchConfidence: 'high' });
  assert.equal(r.success, false);
  assert.match(JSON.stringify(r.error.issues), /refusing to auto-approve/);
});

test('MatchOutput rejects an id without its name', () => {
  const r = MatchOutput.safeParse(goodMatch({ matchedZohoAccountName: null }));
  assert.equal(r.success, false);
});

test('MatchOutput rejects existing_contact with no contact id', () => {
  const r = MatchOutput.safeParse(goodMatch({ matchStatus: 'existing_contact' }));
  assert.equal(r.success, false);
});

test('MatchOutput rejects matchStatus=pending (the contract forbids it)', () => {
  assert.equal(MatchOutput.safeParse(goodMatch({ matchStatus: 'pending' })).success, false);
});

test('IntentOutput accepts null but not an invented level', () => {
  assert.equal(IntentOutput.safeParse({ contactIntent: null }).success, true);
  assert.equal(IntentOutput.safeParse({ contactIntent: 'hot' }).success, true);
  assert.equal(IntentOutput.safeParse({ contactIntent: 'lukewarm' }).success, false);
});

test('AttributionOutput requires exactly one of excerpt / notFound', () => {
  const id = '2f2a77eb-8039-4359-880f-f4d9ef1d6f65';
  assert.equal(AttributionOutput.safeParse({ results: [{ contactId: id, excerpt: 'x' }] }).success, true);
  assert.equal(AttributionOutput.safeParse({ results: [{ contactId: id, notFound: true }] }).success, true);
  assert.equal(
    AttributionOutput.safeParse({ results: [{ contactId: id, excerpt: 'x', notFound: true }] }).success,
    false,
  );
  assert.equal(AttributionOutput.safeParse({ results: [{ contactId: id }] }).success, false);
});

test('NoteExtractionOutput caps contacts per note', () => {
  const one = { firstName: 'A', lastName: 'B', extractionConfidence: 'high' };
  assert.equal(NoteExtractionOutput.safeParse({ contacts: Array(50).fill(one) }).success, true);
  assert.equal(NoteExtractionOutput.safeParse({ contacts: Array(51).fill(one) }).success, false);
});

test('NoteExtractionOutput allows a blank surname but caps interactionNotes', () => {
  assert.equal(
    NoteExtractionOutput.safeParse({
      contacts: [{ firstName: 'Marcus', lastName: '', extractionConfidence: 'medium' }],
    }).success,
    true,
  );
  assert.equal(
    NoteExtractionOutput.safeParse({
      contacts: [{ firstName: 'A', lastName: 'B', extractionConfidence: 'high', interactionNotes: 'x'.repeat(4001) }],
    }).success,
    false,
  );
});

test('CardExtractionOutput rejects a path in cropFileName', () => {
  const card = { index: 1, firstName: 'A', lastName: 'B', extractionConfidence: 'high' };
  assert.equal(CardExtractionOutput.safeParse({ status: 'ok', cards: [card] }).success, true);
  assert.equal(
    CardExtractionOutput.safeParse({ status: 'ok', cards: [{ ...card, cropFileName: '../../evil.jpg' }] }).success,
    false,
  );
});

test('CardExtractionOutput requires a card when status is ok', () => {
  assert.equal(CardExtractionOutput.safeParse({ status: 'ok', cards: [] }).success, false);
  assert.equal(CardExtractionOutput.safeParse({ status: 'no_card_detected', cards: [] }).success, true);
});

// --- extractJson ---------------------------------------------------------

test('extractJson takes the LAST object, not a prose-preamble fragment', () => {
  // The failure mode this guards: a run that reasons in prose first and emits
  // a JSON-looking fragment before the real answer. Taking the first match
  // silently parses the fragment and nulls every real field.
  const out = 'Let me check {"foo": 1} first.\n\n{"contactIntent": "hot"}';
  assert.deepEqual(extractJson(out), { contactIntent: 'hot' });
});

test('extractJson handles fences, nesting and braces inside strings', () => {
  assert.deepEqual(extractJson('```json\n{"a":{"b":2}}\n```'), { a: { b: 2 } });
  assert.deepEqual(extractJson('{"a":"} not the end {"}'), { a: '} not the end {' });
});

test('extractJson throws when there is no object at all', () => {
  assert.throws(() => extractJson('no json here'), /No JSON object found/);
});

// --- skill profiles ------------------------------------------------------

test('every skill profile denies Bash unless it explicitly needs it', () => {
  for (const [skill, profile] of Object.entries(SKILL_PROFILES)) {
    const resolved = profileFor(skill);
    const wantsBash = profile.allowedTools.some((t) => t.startsWith('Bash'));
    assert.equal(
      resolved.disallowedTools.includes('Bash'),
      !wantsBash,
      `${skill}: Bash should be ${wantsBash ? 'allowed' : 'denied'}`,
    );
  }
});

test('text-only skills get exactly one tool', () => {
  for (const skill of ['classify-contact-intent', 'attribute-voice-memo', 'extract-note-contacts']) {
    assert.deepEqual(profileFor(skill).allowedTools, ['Read'], `${skill} should be Read-only`);
    assert.equal(profileFor(skill).mcpConfig, null, `${skill} should load no MCP server`);
  }
});

test('only match-contact may reach Zoho, and only read verbs', () => {
  for (const [skill, profile] of Object.entries(SKILL_PROFILES)) {
    const zohoTools = profile.allowedTools.filter((t) => t.includes('zoho'));
    if (skill === 'match-contact') {
      assert.ok(zohoTools.length > 0, 'match-contact needs Zoho read tools');
      for (const t of zohoTools) {
        assert.match(t, /^mcp__zoho_readonly__/, `${t} must come from the read-only connector`);
        assert.doesNotMatch(t, /create|update|upsert|delete|insert/i, `${t} is a write verb`);
      }
    } else {
      assert.equal(zohoTools.length, 0, `${skill} must not reach Zoho`);
    }
  }
});

test('an undeclared skill throws rather than running unsandboxed', () => {
  assert.throws(() => profileFor('some-new-skill'), /No tool profile declared/);
});
