// Run: cd frontend && npm test
// The onboarding's words are promises about the app: what our number texts back,
// what the form asks, who can fix a missing phone number. These tests hold the
// copy to the real thing (or the real thing's source) so it can't drift quietly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ONBOARDING_COPY, SCENE_COPY } from './tourCopy.ts';
import { SETUP_CANDIDATES, SMS_REPLIES, TOUR_CONFERENCE } from './tourText.ts';
import { contactsLeads, tourLeads } from './tourSampleData.ts';
import { SCENES, IMPORT_ONLY, fullSteps, remainderSteps, reminderCopy } from '../../utils/onboardingFlow.ts';
import { TWILIO_NUMBER_DISPLAY } from '../../utils/smsNumber.ts';
import { isProcessing, isReady, leadFlags } from '../../utils/contactsList.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', '..');
const REPO = join(SRC, '..', '..');
const read = (...p) => readFileSync(join(...p), 'utf8');
const webhook = read(REPO, 'supabase/functions/twilio-webhook/index.ts');

function files(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(vue|ts)$/.test(n) ? [p] : [];
  });
}

// Every fragment of `text` that isn't one of the sample `values` must appear in
// the webhook, in order. Catches a reworded reply on either side.
function quotedFromWebhook(text, values) {
  let rest = text;
  const frags = [];
  for (const v of values) {
    const [head, ...tail] = rest.split(v);
    frags.push(head);
    rest = tail.join(v);
  }
  frags.push(rest);
  for (const f of frags.filter((x) => x.trim().length >= 6)) {
    // `${...}` in the source stands for a value here.
    const pattern = f.split('\n').map((line) => line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\S]*?');
    assert.ok(new RegExp(pattern).test(webhook), `twilio-webhook does not say: ${JSON.stringify(f)}`);
  }
}

// ── our number's replies ──
test('SMS_REPLIES say what twilio-webhook really sends', () => {
  quotedFromWebhook(SMS_REPLIES.askName, []);
  quotedFromWebhook(SMS_REPLIES.linked('@C@'), ['@C@']);
  quotedFromWebhook(SMS_REPLIES.alreadySetUp('@C@'), ['@C@']);
  quotedFromWebhook(SMS_REPLIES.noteLogged, []);
  quotedFromWebhook(SMS_REPLIES.received(1).replace('1', '@N@'), ['@N@']);
  // The list: the wrapper lines and both kinds of line.
  const list = SMS_REPLIES.candidates(SETUP_CANDIDATES);
  quotedFromWebhook(list.split('\n')[0], []);
  quotedFromWebhook(list.split('\n').at(-1), []);
  const [a, b] = SETUP_CANDIDATES;
  quotedFromWebhook(SMS_REPLIES.candidateLine({ ...a, name: '@N@', state: '@S@' }, 0).replace('1. ', ''), ['@N@', '@S@']);
  // The webhook adds the state in a nested template for a campaign; the words
  // after it are what we hold it to.
  quotedFromWebhook(SMS_REPLIES.candidateLine({ ...b, name: '@N@', state: null }, 0).replace('1. ', ''), ['@N@']);
  assert.ok(SMS_REPLIES.candidateLine(b, 1).startsWith(`2. ${b.name} (${b.state}) — `));
});

test('a new rep is walked through the conversation a first SETUP really starts', () => {
  assert.match(webhook, /START_TRIGGER_PHRASES[\s\S]*"setup"/);
  assert.ok(SMS_REPLIES.candidates(SETUP_CANDIDATES).includes(TOUR_CONFERENCE));
});

// ── the form ──
test('the attendee form in the tour IS the app\'s form, not a copy', () => {
  const intake = read(SRC, 'pages/IntakePage.vue');
  const fields = read(SRC, 'components/IntakeFormFields.vue');
  const screen = read(HERE, 'screens/TourIntakeScreen.vue');
  assert.ok(intake.includes('<IntakeFormFields') && screen.includes('<IntakeFormFields'), 'both must render IntakeFormFields');
  assert.ok(!/<q-input|<q-select/.test(screen), 'the tour screen must not draw its own fields');
  // What a first scan from a rep's QR shows: the channel question, then State, District and
  // School (InstitutionFields, which the lead editor and merge dialog draw too).
  const institution = read(SRC, 'components/InstitutionFields.vue');
  assert.ok(fields.includes('<InstitutionFields'), 'the form must render InstitutionFields for State, District and School');
  for (const l of ['First name *', 'Last name *', 'Email', 'Phone', 'Title', 'How did you hear about us?']) {
    assert.ok(fields.includes(`label="${l}"`), `the form has no field labelled "${l}"`);
  }
  for (const l of ['State', 'School district', 'School or campus']) {
    assert.ok(institution.includes(`Label: '${l}'`), `the form has no field labelled "${l}"`);
  }
  for (const h of ['Add your email and phone number']) assert.ok(fields.includes(h), h);
  assert.ok(institution.includes('Pick a state first'));
  assert.ok(fields.includes('label="Submit"'));
});

// ── the number ──
test('our number is written once, in utils/smsNumber.ts', () => {
  assert.match(TWILIO_NUMBER_DISPLAY, /^\+1 \(\d{3}\) \d{3}-\d{4}$/);
  const digits = TWILIO_NUMBER_DISPLAY.replace(/\D/g, '').slice(-7);
  for (const f of files(HERE).filter((f) => !f.endsWith('.test.mjs'))) {
    assert.ok(!read(f).replace(/\D/g, '').includes(digits) || /smsNumber/.test(read(f)), `${f} has its own copy of the number`);
  }
  const everyBody = SCENE_COPY.flatMap((s) => [s.body, s.forManagers?.body]).filter(Boolean);
  assert.ok(everyBody.some((b) => b.includes('{number}')), 'the setup scene should use {number}');
  assert.ok(read(HERE, 'screens/TourMessages.vue').includes("from '@/utils/smsNumber'"));
});

// ── the words ──
// Words that mean something to us but nothing to a rep at a booth.
const BANNED_WORDS = [
  'api', 'csv', 'json', 'database', 'sync', 'pipeline', 'ocr', 'token', 'endpoint',
  'webhook', 'flag', 'badge', 'pin', 'session', 'function', 'query',
];
function allCopy() {
  const out = [];
  for (const s of SCENE_COPY) {
    for (const c of [s, s.forManagers, s.importOnly]) if (c) out.push(c.title, c.body, c.note);
    if (s.noPhoneNote) out.push(...Object.values(s.noPhoneNote));
  }
  const strings = (o) => (typeof o === 'string' ? [o] : o && typeof o === 'object' ? Object.values(o).flatMap(strings) : []);
  out.push(...strings(ONBOARDING_COPY));
  for (const manager of [false, true]) {
    for (const id of [null, 'send-import', 'qr', 'review', 'admin']) {
      for (const path of ['quick', 'tour', null]) {
        const c = reminderCopy(remainderSteps(manager, id), path);
        out.push(c.title, c.body);
      }
    }
  }
  return out.filter(Boolean);
}
test('nothing a rep reads uses developer words', () => {
  for (const text of allCopy()) {
    for (const w of BANNED_WORDS) {
      assert.ok(!new RegExp(`\\b${w}\\b`, 'i').test(text), `"${w}" in: ${text}`);
    }
  }
});

// The bold rule (see SceneCopy in tourCopy.ts): bold is only the name of a tab or
// button the person taps, or SETUP as the word they text. Anything else bold reads
// as random emphasis (a field label, a phone number), which is what this replaced.
const BOLD_ALLOWED = ['SETUP', 'Setup', 'Kiosk', 'Contacts', 'Import', 'Export', 'Admin', 'Confirm', 'Confirm all', 'Ready', 'Filter', 'Followed up', 'Yes, it downloaded', '?'];
test('bold is only a tab or button the person taps, or the word SETUP', () => {
  for (const text of allCopy()) {
    for (const [, word] of text.matchAll(/\*\*(.+?)\*\*/g)) {
      assert.ok(BOLD_ALLOWED.includes(word), `"${word}" is bold but isn't a tab, a button or SETUP, in: ${text}`);
    }
  }
});

test('the no-phone note names who can fix it, by role', () => {
  const setup = SCENE_COPY.find((s) => s.id === 'setup');
  assert.match(setup.noPhoneNote.sales, /Solutions Success rep/);
  assert.match(setup.noPhoneNote.solutionsSuccess, /admin/);
  assert.match(setup.noPhoneNote.admin, /Admin, under Team/);
  // Live Admin: Solutions Success sees Sales accounts only; an admin sees both kinds, an Edit on each.
  const team = read(SRC, 'components/AdminTeamCard.vue');
  assert.ok(team.includes("'Solutions Success and Sales accounts.' : 'Sales accounts.'"), 'Admin no longer lists accounts the way the note assumes');
});

// ── the scenes ──
test('the scene ids are the same in the copy, the rules and the components', () => {
  assert.deepEqual(SCENE_COPY.map((s) => s.id), SCENES.map((s) => s.id));
  const flow = read(HERE, 'tourFlow.ts');
  for (const s of SCENES) assert.ok(new RegExp(`\\b${s.id}:\\s*TourScene`).test(flow), `no component for ${s.id}`);
  assert.equal(SCENE_COPY.find((s) => s.id === 'send').importOnly != null, true);
  assert.equal(IMPORT_ONLY.id, 'send-import');
});

test('managers get Export and Admin and reps do not', () => {
  assert.ok(SCENE_COPY.filter((s) => s.managersOnly).map((s) => s.id).join() === 'export,admin');
  assert.equal(fullSteps(false).length, 4);
});

// ── the sample people ──
test('the tour\'s leads are made up, and look like a new rep\'s Contacts', () => {
  const all = contactsLeads();
  assert.equal(all.length, 6);
  assert.ok(all.every((l) => l.id.startsWith('tour-')), 'sample lead ids must never look real');
  assert.ok(all.every((l) => l.reviewStatus === 'needs_review'), 'a new rep has confirmed nothing');
  const by = Object.fromEntries(all.map((l) => [l.firstName, l]));
  // Priya's note had no phone or email: the real "Needs a phone or email" lead.
  assert.ok(leadFlags(by.Priya).some((f) => f.key === 'no-contact'));
  assert.equal(isReady(by.Priya), false);
  // Adding her phone is what makes her ready.
  assert.equal(isReady({ ...by.Priya, phone: '(512) 555-0176' }), true);
  for (const n of ['Dana', 'Sam', 'Tom', 'Grace']) assert.equal(isReady(by[n]), true, `${n} should be Ready`);
});

test('a lead that has just arrived is processing, never ready', () => {
  const fresh = tourLeads(['dana', 'sam', 'priya'], { processing: ['dana', 'sam', 'priya'] });
  assert.ok(fresh.length === 3 && fresh.every(isProcessing));
  assert.ok(fresh.every((l) => !isReady(l)));
  assert.ok(fresh.every((l) => l.matchedZohoAccountName === null), 'no Zoho result before matching finishes');
});

test('the tour draws the contact editor with `demo`, so its pickers fetch nothing', () => {
  const screen = read(HERE, 'TourContactsScreen.vue');
  const tags = screen.match(/<ContactEditor[^>]*>/g) ?? [];
  assert.ok(tags.length >= 2, 'the screen should draw the editor for the pane and the sheet');
  for (const t of tags) assert.ok(/\sdemo[\s>]/.test(t), 'a ContactEditor in the tour is missing `demo`');
});

test('the tour never talks to the server, apart from the host that records the outcome', () => {
  for (const f of files(HERE).filter((f) => !f.endsWith('OnboardingHost.vue'))) {
    const src = read(f);
    assert.ok(!/boot\/axios|stores\/session-store|stores\/event-store/.test(src), `${f} reaches the server or the account`);
  }
});

// ── the tour draws the app's own parts ──
// Each screen in the tour renders the same component the page renders, so the tour
// cannot drift from the app. If someone pastes markup back into a tour screen, or a
// page stops using the shared part, this fails.
const SHARED = [
  ['TourAppBar.vue', 'AppHeader', 'layouts/MainLayout.vue'],
  ['TourAppBar.vue', 'AppMenu', 'layouts/MainLayout.vue'],
  ['TourContactsScreen.vue', 'ContactsHeader', 'pages/ContactsPage.vue'],
  ['TourContactsScreen.vue', 'ContactsFilterPanel', 'components/ContactsFilter.vue'],
  ['TourContactsScreen.vue', 'ContactsConfirmAll', 'pages/ContactsPage.vue'],
  ['TourContactsScreen.vue', 'ContactList', 'pages/ContactsPage.vue'],
  ['TourContactsScreen.vue', 'UnassignedScansList', 'components/UnassignedScansBanner.vue'],
  ['screens/TourNotesScreen.vue', 'NotesBody', 'pages/NotesPage.vue'],
  ['screens/TourExportScreen.vue', 'ExportCard', 'pages/ExportPage.vue'],
  ['screens/TourAdminScreen.vue', 'AdminConferencesCard', 'pages/AdminPage.vue'],
  ['screens/TourAdminScreen.vue', 'AdminTeamCard', 'pages/AdminPage.vue'],
  ['screens/TourIntakeScreen.vue', 'IntakeFormFields', 'pages/IntakePage.vue'],
  ['screens/TourQrOverlay.vue', 'RepQrContent', 'components/RepQrDialog.vue'],
];
test('every tour screen renders the same component its page renders', () => {
  for (const [screen, comp, page] of SHARED) {
    assert.ok(new RegExp(`<${comp}[\\s>/]`).test(read(HERE, screen)), `${screen} does not render <${comp}>`);
    assert.ok(new RegExp(`<${comp}[\\s>/]`).test(read(SRC, page)), `${page} does not render <${comp}>`);
  }
});

test('the app\'s components carry no tour hooks', () => {
  for (const f of ['AppHeader', 'AppMenu', 'ContactsHeader', 'NotesBody', 'ExportCard', 'AdminConferencesCard', 'AdminTeamCard', 'IntakeFormFields', 'RepQrContent', 'UnassignedScansList']) {
    assert.ok(!/data-tt|data-tour/.test(read(SRC, `components/${f}.vue`)), `${f} has a tour hook`);
  }
});

// ── consent ──
// Texting SETUP is the opt-in, and the disclosure has to sit under the action that
// gives it (the texting campaign was rejected four times over this). So the wording
// exists once, and the only things that offer the action are Setup's phone card and
// the quick start, through the one component.
test('the opt-in disclosure is written once and only the one action component offers SETUP', () => {
  const withDisclosure = files(SRC).filter((f) => read(f).includes('By texting this code'));
  assert.deepEqual(withDisclosure.map((f) => f.split('/').pop()), ['SmsConsent.vue']);
  const withSmsLink = files(SRC).filter((f) => /sms:\$\{|`sms:/.test(read(f)));
  assert.deepEqual(withSmsLink.map((f) => f.split('/').pop()), ['TextSetupAction.vue']);
  assert.ok(read(SRC, 'components/TextSetupAction.vue').includes('<SmsConsent'), 'the action must carry its disclosure');
  assert.ok(read(SRC, 'pages/SetupPage.vue').includes('<TextSetupAction'), 'Setup must use the shared action');
  assert.ok(read(HERE, 'OnboardingFlow.vue').includes('<TextSetupAction'), 'the quick start must use the shared action');
  for (const f of files(join(HERE, 'scenes')).concat(files(join(HERE, 'screens')))) {
    assert.ok(!read(f).includes('TextSetupAction'), `${f}: the tour's scenes never offer their own text-now button`);
  }
});
