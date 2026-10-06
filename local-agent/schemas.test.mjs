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
  MatchOutput,
  NoteExtractionOutput,
  ResearchOutput,
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

test('AttributionOutput rejects extractedContact with no first name', () => {
  const r = AttributionOutput.safeParse({
    results: [],
    extractedContact: { firstName: '', title: 'Curriculum Director', extractionConfidence: 'medium' },
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

// --- extractJson ---------------------------------------------------------

test('extractJson takes the LAST object, not a prose-preamble fragment', () => {
  // The failure mode this guards: a run that reasons in prose first and emits
  // a JSON-looking fragment before the real answer. Taking the first match
  // silently parses the fragment and nulls every real field.
  const out = 'Let me check {"foo": 1} first.\n\n{"matchStatus": "new_account"}';
  assert.deepEqual(extractJson(out), { matchStatus: 'new_account' });
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
  for (const skill of ['attribute-voice-memo', 'extract-note-contacts']) {
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

// ── ResearchOutput.resolvedDistrict (2026-10-06, research-contact step 5b) ───
// A district the skill found for a contact who gave a school and no district. Model
// output that lands on a lead a person confirms, so the whole contract is checked.
const baseResearch = { firstName: 'Latoya', lastName: 'Pruitt', researchConfidence: 'high', personVerified: false };
const goodDistrict = { name: 'Sunflower County School District', evidenceUrl: 'https://www.sunflower.k12.ms.us/schools', confidence: 'high' };
const research = (resolvedDistrict) => ({ ...baseResearch, resolvedDistrict });

test('ResearchOutput: a well-formed resolvedDistrict is kept, trimmed', () => {
  const r = ResearchOutput.safeParse(research({ ...goodDistrict, name: '  Sunflower County School District ', confidence: 'medium' }));
  assert.equal(r.success, true);
  assert.deepEqual(r.data.resolvedDistrict, { ...goodDistrict, confidence: 'medium' });
});

test('ResearchOutput: resolvedDistrict is null when the skill returns null or leaves it out', () => {
  assert.equal(ResearchOutput.safeParse(research(null)).data.resolvedDistrict, null);
  assert.equal(ResearchOutput.safeParse(baseResearch).data.resolvedDistrict, null);
});

// Each of these must be REJECTED (a validation failure leaves the row pending for a
// human, CLAUDE.md rule 3), never coerced into something half-written.
const MALFORMED_DISTRICTS = {
  'a low-confidence guess (less sure than medium is null)': { ...goodDistrict, confidence: 'low' },
  'no evidence address': { name: goodDistrict.name, confidence: 'high' },
  'evidence that is not a web address': { ...goodDistrict, evidenceUrl: 'sunflower.k12.ms.us' },
  'evidence with another scheme': { ...goodDistrict, evidenceUrl: 'javascript:alert(1)' },
  'evidence with whitespace in it': { ...goodDistrict, evidenceUrl: 'https://x.example/a b' },
  'evidence over 500 characters': { ...goodDistrict, evidenceUrl: 'https://x.example/' + 'a'.repeat(500) },
  'a blank name': { ...goodDistrict, name: '   ' },
  'a one-character name': { ...goodDistrict, name: 'A' },
  'a name over 200 characters': { ...goodDistrict, name: 'D'.repeat(201) },
  'a name with a control character (it is copied into notes and the CSV)': { ...goodDistrict, name: 'Sunflower\nCounty' },
  'an unknown extra key': { ...goodDistrict, zohoAccountId: '3001271000007193584' },
  'a string instead of an object': 'Sunflower County School District',
  'an array': [goodDistrict],
};
for (const [label, value] of Object.entries(MALFORMED_DISTRICTS)) {
  test(`ResearchOutput rejects resolvedDistrict with ${label}`, () => {
    assert.equal(ResearchOutput.safeParse(research(value)).success, false);
  });
}

test('ResearchOutput still passes every input field through (match-contact reads them unchanged)', () => {
  const r = ResearchOutput.safeParse({ ...research(goodDistrict), districtName: null, schoolName: 'Ruleville Central Elementary', eventState: 'Mississippi' });
  assert.equal(r.data.schoolName, 'Ruleville Central Elementary');
  assert.equal(r.data.districtName, null);
});
