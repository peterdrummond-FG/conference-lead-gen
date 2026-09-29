// Ported from local-agent/schemas.test.mjs as part of the n8n migration (see
// the migration plan, "Output validation" — this test suite is the gate that
// must pass before the schema port counts as done). Drops the skill-profile
// tests from the original file: those covered local-agent's `claude -p`
// sandboxing model (skill-profiles.mjs / --strict-mcp-config), which no
// longer exists once skills are direct Anthropic Messages API calls — the
// n8n-side successor to that sandboxing is credential scoping per
// sub-workflow, audited by n8n/scripts/check-n8n-credential-scopes.mjs, not
// a Zod-testable contract.
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
  CardVisionOutput,
  IntentOutput,
  MatchOutput,
  NoteExtractionOutput,
} from './schemas.mjs';
import { extractJson } from './extractJson.mjs';

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

test('AttributionOutput accepts a well-formed extractedContact (name + title/district/school)', () => {
  const base = { results: [], extractedContact: { firstName: 'Alex', extractionConfidence: 'medium' } };
  assert.equal(AttributionOutput.safeParse({ ...base, extractedContact: { ...base.extractedContact, title: 'Curriculum Director' } }).success, true);
  assert.equal(AttributionOutput.safeParse({ ...base, extractedContact: { ...base.extractedContact, districtName: 'Rivera Unified' } }).success, true);
  assert.equal(AttributionOutput.safeParse({ ...base, extractedContact: { ...base.extractedContact, schoolName: 'Rivera Elementary' } }).success, true);
});

test('AttributionOutput rejects extractedContact with no title/district/school', () => {
  const r = AttributionOutput.safeParse({
    results: [],
    extractedContact: { firstName: 'Alex', extractionConfidence: 'low' },
  });
  assert.equal(r.success, false);
});

test('AttributionOutput allows omitting extractedContact entirely', () => {
  const id = '2f2a77eb-8039-4359-880f-f4d9ef1d6f65';
  assert.equal(AttributionOutput.safeParse({ results: [{ contactId: id, notFound: true }] }).success, true);
});

test('AttributionOutput accepts an unplacedContact that was met and described', () => {
  const id = '2f2a77eb-8039-4359-880f-f4d9ef1d6f65';
  const person = { firstName: 'Kaylin', interactionNotes: 'Great conversation with Kaylin, a superintendent.', spokeWithRep: true, detailsStated: true, extractionConfidence: 'low' };
  const r = AttributionOutput.safeParse({ results: [{ contactId: id, excerpt: 'Tyler was great.' }], unplacedContacts: [person] });
  assert.equal(r.success, true);
  assert.equal(r.data.unplacedContacts[0].lastName, '');
});

test('AttributionOutput rejects an unplacedContact that is not asserted as met AND described', () => {
  const ok = { firstName: 'Kaylin', interactionNotes: 'Great chat with Kaylin.', spokeWithRep: true, detailsStated: true, extractionConfidence: 'low' };
  const parse = (p) => AttributionOutput.safeParse({ results: [], unplacedContacts: [p] }).success;
  assert.equal(parse(ok), true);
  assert.equal(parse({ ...ok, spokeWithRep: false }), false);
  assert.equal(parse({ ...ok, detailsStated: false }), false);
  const { spokeWithRep, ...noFlag } = ok;
  assert.equal(parse(noFlag), false);
  assert.equal(parse({ ...ok, interactionNotes: '   ' }), false);
  assert.equal(parse({ ...ok, firstName: '' }), false);
});

test('AttributionOutput caps unplacedContacts at ten and defaults to none', () => {
  const p = { firstName: 'A', interactionNotes: 'x', spokeWithRep: true, detailsStated: true, extractionConfidence: 'low' };
  assert.equal(AttributionOutput.safeParse({ results: [], unplacedContacts: Array.from({ length: 11 }, () => p) }).success, false);
  assert.deepEqual(AttributionOutput.parse({ results: [] }).unplacedContacts, []);
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

test('CardVisionOutput accepts a null boundingBox for a single-card photo', () => {
  const card = { index: 1, firstName: 'A', lastName: 'B', extractionConfidence: 'high' };
  const result = CardVisionOutput.safeParse({ status: 'ok', cards: [card] });
  assert.equal(result.success, true);
  assert.equal(result.data.cards[0].boundingBox, null);
});

test('CardVisionOutput accepts a fractional boundingBox for a multi-card photo', () => {
  const card = {
    index: 2,
    firstName: 'A',
    lastName: 'B',
    extractionConfidence: 'medium',
    boundingBox: { x: 0.5, y: 0.1, width: 0.4, height: 0.3 },
  };
  assert.equal(CardVisionOutput.safeParse({ status: 'ok', cards: [card] }).success, true);
});

test('CardVisionOutput rejects an out-of-range boundingBox fraction', () => {
  const card = {
    index: 1,
    firstName: 'A',
    lastName: 'B',
    extractionConfidence: 'high',
    boundingBox: { x: 1.2, y: 0, width: 0.5, height: 0.5 },
  };
  assert.equal(CardVisionOutput.safeParse({ status: 'ok', cards: [card] }).success, false);
});

test('CardVisionOutput requires a card when status is ok', () => {
  assert.equal(CardVisionOutput.safeParse({ status: 'ok', cards: [] }).success, false);
  assert.equal(CardVisionOutput.safeParse({ status: 'no_card_detected', cards: [] }).success, true);
});

// --- extractJson (fallback path only — see extractJson.mjs header) -------

test('extractJson takes the LAST object, not a prose-preamble fragment', () => {
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
