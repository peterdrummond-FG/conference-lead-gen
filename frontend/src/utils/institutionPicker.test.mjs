// Run: cd frontend && npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  norm, filterOptions, hasExactMatch, withTypedOption, districtOptions, schoolOptions, resolveTyped, shouldClearSchool,
  DISTRICT_TYPED_CAPTION, SCHOOL_NO_DISTRICT_CAPTION,
} from './institutionPicker.ts';

const o = (id, name) => ({ id, name });
const DISTRICTS = [
  o('d1', 'Aberdeen Community School Corp.'),
  o('d2', 'Carmel Clay Schools'),
  o('d3', 'Carroll Consolidated Schools'),
  o('d4', "St. Mary's Independent School District"),
  o('d5', 'Clay Community Schools'),
  o('d6', 'Greenwood Community Schools'),
];
const names = (l) => l.map((x) => x.name);

// ── matching ──
test('names match without regard to case, accents or punctuation', () => {
  assert.equal(norm("St. Mary's ISD"), 'st marys isd');
  assert.equal(norm('  CARMEL   clay '), 'carmel clay');
  assert.equal(norm('Café Unified'), 'cafe unified');
  assert.equal(hasExactMatch(DISTRICTS, "st marys independent school district"), true);
  assert.equal(hasExactMatch(DISTRICTS, 'car'), false);
  assert.equal(hasExactMatch(DISTRICTS, '   '), false);
});

test('nothing typed returns the whole list, untouched', () => {
  assert.equal(filterOptions(DISTRICTS, ''), DISTRICTS);
  assert.equal(filterOptions(DISTRICTS, '  '), DISTRICTS);
});

test('searchable from the first character', () => {
  assert.deepEqual(names(filterOptions(DISTRICTS, 'c')).slice(0, 3), ['Carmel Clay Schools', 'Carroll Consolidated Schools', 'Clay Community Schools']);
  // One letter also matches inside words, but only after every name that starts with it.
  const a = names(filterOptions(DISTRICTS, 'a'));
  assert.equal(a[0], 'Aberdeen Community School Corp.');
  assert.equal(a.length, 5);
});

test('best match first: starts-with, then each typed word starting a word, then contains', () => {
  // 'clay' starts Clay Community; Carmel Clay has it as a later word; nothing merely contains it here.
  assert.deepEqual(names(filterOptions(DISTRICTS, 'clay')), ['Clay Community Schools', 'Carmel Clay Schools']);
  // Words in any order.
  assert.deepEqual(names(filterOptions(DISTRICTS, 'clay carmel')), ['Carmel Clay Schools']);
  // Substring only (inside a word) comes last.
  const list = [o('1', 'Elkhorn Public'), o('2', 'Horn Lake')];
  assert.deepEqual(names(filterOptions(list, 'horn')), ['Horn Lake', 'Elkhorn Public']);
});

test('nothing matches -> empty (the typed option is added separately)', () => {
  assert.deepEqual(filterOptions(DISTRICTS, 'zzz'), []);
});

// ── "Use '<typed>'" ──
test("Use '<typed>' is always the last option when the text isn't an exact match", () => {
  const out = districtOptions(DISTRICTS, 'car');
  assert.deepEqual(names(out), ['Carmel Clay Schools', 'Carroll Consolidated Schools', 'car']);
  const last = out.at(-1);
  assert.equal(last.typed, true);
  assert.equal(last.id, null);
  assert.equal(last.caption, DISTRICT_TYPED_CAPTION);
});

test('it is still offered when nothing matches at all (a state where we hold few districts)', () => {
  const out = districtOptions([o('n1', 'Omaha Public Schools')], 'Elkhorn Public');
  assert.deepEqual(names(out), ['Elkhorn Public']);
  assert.equal(out[0].typed, true);
});

test('an exact match is just picked: no Use option', () => {
  const out = districtOptions(DISTRICTS, 'carmel clay schools');
  assert.deepEqual(names(out), ['Carmel Clay Schools']);
  assert.equal(out.some((x) => x.typed), false);
});

test('nothing typed adds nothing', () => {
  assert.equal(districtOptions(DISTRICTS, '').length, DISTRICTS.length);
  assert.deepEqual(withTypedOption([], [], '   ', 'x'), []);
});

test('the typed text is trimmed in the option', () => {
  assert.equal(districtOptions(DISTRICTS, '  Elkhorn  ').at(-1).name, 'Elkhorn');
});

// ── School ──
const SCHOOLS = [o('s1', 'Carmel High School'), o('s2', 'Carmel Middle School'), o('s3', 'Clay Center Elementary')];

test("with a district, School lists ALL of its schools, searchable, plus Use '<typed>'", () => {
  const d = o('d2', 'Carmel Clay Schools');
  assert.deepEqual(names(schoolOptions(d, SCHOOLS, '')), names(SCHOOLS));
  assert.deepEqual(names(schoolOptions(d, SCHOOLS, 'cl')), ['Clay Center Elementary', 'cl']);
  assert.equal(schoolOptions(d, SCHOOLS, 'Carmel High School').some((x) => x.typed), false);
});

test("with no district, School offers only the typed entry, with the lookup hint, and no state-wide search", () => {
  assert.deepEqual(schoolOptions(null, SCHOOLS, ''), []);
  const out = schoolOptions(null, SCHOOLS, 'Grace Lutheran');
  assert.deepEqual(names(out), ['Grace Lutheran']);
  assert.equal(out[0].caption, SCHOOL_NO_DISTRICT_CAPTION);
  // Even text that matches a school in some list never lists schools without a district.
  assert.deepEqual(names(schoolOptions(null, SCHOOLS, 'Carmel')), ['Carmel']);
});

test('a district the person typed has no schools of ours: School is typed-only too', () => {
  const typedDistrict = { id: null, name: 'Elkhorn Public' };
  assert.deepEqual(names(schoolOptions(typedDistrict, SCHOOLS, 'Elkhorn High')), ['Elkhorn High']);
  assert.deepEqual(schoolOptions(typedDistrict, SCHOOLS, ''), []);
});

// ── commit on blur ──
test('typed text with no match is committed on blur as plain text', () => {
  assert.deepEqual(resolveTyped('Elkhorn Public', null, DISTRICTS), { id: null, name: 'Elkhorn Public' });
  assert.deepEqual(resolveTyped('  Elkhorn Public  ', o('d1', 'Aberdeen Community School Corp.'), DISTRICTS), { id: null, name: 'Elkhorn Public' });
});

test('typed text that IS a list entry commits that entry, so its id is kept', () => {
  assert.deepEqual(resolveTyped('carmel clay schools', null, DISTRICTS), { id: 'd2', name: 'Carmel Clay Schools' });
});

test('leaving the box as it is, or empty, changes nothing', () => {
  const cur = o('d2', 'Carmel Clay Schools');
  assert.equal(resolveTyped('Carmel Clay Schools', cur, DISTRICTS), cur);
  assert.equal(resolveTyped('', cur, DISTRICTS), cur);
  assert.equal(resolveTyped('   ', null, DISTRICTS), null);
});

test('blur commits a typed school with no district (nothing in the list to match)', () => {
  assert.deepEqual(resolveTyped('Grace Lutheran', null, []), { id: null, name: 'Grace Lutheran' });
});

// ── changing the district ──
test('changing the district clears a school picked from the old one, but keeps a typed school', () => {
  const picked = o('s1', 'Carmel High School');
  const typed = { id: null, name: 'Grace Lutheran' };
  assert.equal(shouldClearSchool('d2', 'd6', picked), true);
  assert.equal(shouldClearSchool('d2', null, picked), true);
  assert.equal(shouldClearSchool(null, 'd6', picked), true);
  assert.equal(shouldClearSchool('d2', 'd6', typed), false);
  assert.equal(shouldClearSchool('d2', 'd6', null), false);
});

test('picking the same district again leaves the school alone', () => {
  assert.equal(shouldClearSchool('d2', 'd2', o('s1', 'Carmel High School')), false);
});

// ── the model a form keeps ──
import { changeState, changeDistrict, changeSchool } from './institutionPicker.ts';

const IN = { code: 'IN', name: 'Indiana' };
const OH = { code: 'OH', name: 'Ohio' };
const filled = () => ({ state: IN, district: o('d2', 'Carmel Clay Schools'), school: o('s1', 'Carmel High School') });

test('a different state clears district and school; the same state keeps them', () => {
  const m = filled();
  changeState(m, { code: 'IN', name: 'Indiana' });
  assert.equal(m.district.id, 'd2');
  assert.equal(m.school.id, 's1');
  changeState(m, OH);
  assert.equal(m.state, OH);
  assert.equal(m.district, null);
  assert.equal(m.school, null);
});

test('changing the district clears the old picked school, keeps a typed one, and strips menu bookkeeping', () => {
  const m = filled();
  changeDistrict(m, { id: 'd6', name: 'Greenwood Community Schools', typed: false, caption: 'x' });
  assert.deepEqual(m.district, { id: 'd6', name: 'Greenwood Community Schools' });
  assert.equal(m.school, null);

  const t = { state: IN, district: o('d2', 'Carmel Clay Schools'), school: { id: null, name: 'Grace Lutheran' } };
  changeDistrict(t, { id: null, name: 'Elkhorn Public', typed: true });
  assert.deepEqual(t.district, { id: null, name: 'Elkhorn Public' });
  assert.deepEqual(t.school, { id: null, name: 'Grace Lutheran' });
});

test('picking the same district again keeps the picked school', () => {
  const m = filled();
  changeDistrict(m, o('d2', 'Carmel Clay Schools'));
  assert.equal(m.school.id, 's1');
});

test('a school can be set with no district (the quiet fallback) and cleared', () => {
  const m = { state: IN, district: null, school: null };
  changeSchool(m, { id: null, name: 'Grace Lutheran', typed: true, caption: 'x' });
  assert.deepEqual(m.school, { id: null, name: 'Grace Lutheran' });
  changeSchool(m, null);
  assert.equal(m.school, null);
});

// ── the lookup line ──
import { lookupSource, lookupLineVisible } from './institutionPicker.ts';

const LOOKUP = { name: 'Sunflower County Consolidated School District', evidenceUrl: 'https://www.autocaldata.com/calendars/x', confidence: 'medium', mappedToOurList: true };

test('the lookup source is the address host, and only for a real web address', () => {
  assert.deepEqual(lookupSource(LOOKUP), { host: 'autocaldata.com', href: 'https://www.autocaldata.com/calendars/x' });
  assert.equal(lookupSource(null), null);
  assert.equal(lookupSource({ ...LOOKUP, evidenceUrl: 'javascript:alert(1)' }), null);
  assert.equal(lookupSource({ ...LOOKUP, evidenceUrl: 'not a url' }), null);
});

test('the lookup line shows only while the district is still the one the lookup produced', () => {
  const saved = { id: 'd1', name: 'Sunflower County Consolidated School District' };
  assert.equal(lookupLineVisible(LOOKUP, saved, { ...saved }), true);
  assert.equal(lookupLineVisible(LOOKUP, saved, { id: 'd2', name: 'Other' }), false);
  assert.equal(lookupLineVisible(LOOKUP, saved, { id: null, name: 'Typed over it' }), false);
  assert.equal(lookupLineVisible(null, saved, saved), false);
  assert.equal(lookupLineVisible(LOOKUP, null, null), false);
});
