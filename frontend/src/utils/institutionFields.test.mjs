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
