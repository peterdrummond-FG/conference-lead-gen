// Run: cd frontend && npm test
// District and School are ONE component (InstitutionFields) and one composable
// (useInstitutionPicker) wherever they appear. Before 2026-10-06 each page had its own
// copy of the requests, the typed-value handling and the clearing rules, and they had
// drifted (the merge dialog never committed a typed value on blur). This holds the one-place
// rule: a new screen that draws its own District select, or calls the lists directly,
// fails here instead of becoming the fourth copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('..', import.meta.url));
function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(vue|ts)$/.test(name)) yield p;
  }
}
const rel = (p) => p.slice(SRC.length);
const read = (r) => readFileSync(join(SRC, r), 'utf8');

// Every place the fields render. If one of these stops using the component, it has its own
// copy again.
const RENDERERS = [
  'components/IntakeFormFields.vue', // the attendee form: /connect/<repSlug>, the Kiosk tab, and the tour's phone
  'components/contacts/ContactEditor.vue', // the lead editor: Contacts' pane and sheet
  'components/DuplicateResolutionDialog.vue', // the merge dialog
];

test('every place the fields render uses the one component', () => {
  for (const r of RENDERERS) {
    assert.ok(read(r).includes('<InstitutionFields'), `${r} does not render <InstitutionFields>`);
  }
  // And that is all of them: no other screen has a district or school select of its own.
  const own = [];
  for (const f of files(SRC)) {
    const r = rel(f);
    if (r === 'components/InstitutionFields.vue') continue;
    if (/<q-select[^>]*(district|school)/i.test(readFileSync(f, 'utf8'))) own.push(r);
  }
  assert.deepEqual(own, []);
});

test('only the composable talks to the district and school lists', () => {
  const callers = [];
  for (const f of files(SRC)) {
    // Comments may name the endpoints (usStates.ts does); only a real call counts.
    if (/districts-list|schools-list/.test(readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, ''))) callers.push(rel(f));
  }
  assert.deepEqual(callers, ['composables/useInstitutionPicker.ts']);
});

test('the pages that used to keep their own picker logic no longer do', () => {
  for (const r of ['pages/IntakePage.vue', 'components/contacts/ContactEditor.vue', 'components/DuplicateResolutionDialog.vue']) {
    const s = read(r);
    assert.ok(!/useTypeahead|resolveTypedOption|filterStateOptions/.test(s), `${r} still has its own picker logic`);
  }
});

test('the fields load the whole list once and filter on the device', () => {
  const c = read('composables/useInstitutionPicker.ts');
  assert.match(c, /all: 1/, 'the lists are fetched whole (all=1)');
  assert.ok(!/search/.test(c.replace(/\/\/.*$/gm, '')), 'no per-keystroke server search');
});

// 2026-10-07: InstitutionFields renders State, District and School as a fragment (three roots), and a
// scoped style only reaches a child's SINGLE root. The editor's `.le-s2 / .le-s4 / .le-s6` column
// spans were plain scoped rules, so the three fields never got them and each squeezed into one of the
// grid's six tracks on a phone ("Texas", an empty District and "Chocta" side by side, arrows over the
// text). Any host that hands layout classes to the component must style them with :deep.
test('the lead editor spans the institution fields with :deep rules, which reach a fragment', () => {
  const src = readFileSync(join(SRC, 'components/contacts/ContactEditor.vue'), 'utf8');
  const classes = /state-class="(le-s\d)" district-class="(le-s\d)" school-class="(le-s\d)"/.exec(src);
  assert.ok(classes, 'ContactEditor passes layout classes to InstitutionFields');
  for (const cls of classes.slice(1)) {
    assert.match(src, new RegExp(`\\.le-form :deep\\(\\.${cls}\\)`), `.${cls} must be a :deep rule`);
    assert.doesNotMatch(src, new RegExp(`^\\.${cls}\\s*\\{`, 'm'), `.${cls} must not be a plain scoped rule`);
  }
});
