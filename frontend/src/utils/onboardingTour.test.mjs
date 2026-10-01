// Run: cd frontend && npm test
// Node strips the TypeScript types itself, so no build step is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAMPLE_CALLOUTS,
  BANNED_WORDS, CONNECT_MOCK, SAMPLE_LEAD, SMS_MOCK, TOUR_STEPS, allTourCopy, splashSlides, stepsForRole, tourStartAction,
} from './onboardingTour.ts';
import { TWILIO_NUMBER_DISPLAY } from './smsNumber.ts';
import { isReady, READY_LABEL, readinessChecklist } from './reviewSmart.ts';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(SRC, '..', '..');
const read = (...p) => readFileSync(join(...p), 'utf8');

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(vue|ts)$/.test(name) ? [p] : [];
  });
}

test('a rep is walked through setup, connect and review, and not export or admin', () => {
  const ids = stepsForRole('sales').map((s) => s.id);
  assert.ok(ids.includes('conference') && ids.includes('review-sample'));
  assert.ok(!ids.includes('export'));
  assert.ok(!ids.includes('admin'));
});

test('admin and Solutions Success also get export and admin', () => {
  for (const role of ['admin', 'solutionsSuccess']) {
    const ids = stepsForRole(role).map((s) => s.id);
    assert.ok(ids.includes('export'), `${role} export`);
    assert.ok(ids.includes('admin'), `${role} admin`);
  }
});

test('every step sends a role only to pages that role can open', () => {
  const routes = readFileSync(join(SRC, 'router/routes.ts'), 'utf8');
  for (const step of TOUR_STEPS) {
    if (!step.route) continue;
    const seg = step.route.replace(/^\//, '');
    const line = routes.split('\n').find((l) => l.includes(`path: '${seg}'`));
    assert.ok(line, `no route for ${step.route}`);
    const allowed = /roles: \[([^\]]*)\]/.exec(line);
    if (!allowed) continue; // public route (e.g. /connect)
    for (const role of step.roles) {
      assert.ok(allowed[1].includes(`'${role}'`), `${step.id}: ${role} cannot open ${step.route}`);
    }
  }
});

// A spotlight may only point at something a brand-new account can see: always
// on its page, and not dependent on a conference being joined or any data having
// loaded. Two earlier steps broke this (the attendee form, which only renders
// once a conference is joined; the sample lead injected into Review's list), so
// the list is deliberately short and a new entry has to be argued for here.
const ALWAYS_THERE = new Set([
  'setup-conference', 'setup-text-in', 'setup-qr', 'review-tabs',
  'review-note-button', 'export-button', 'nav-admin', 'tour-replay',
]);

test('every spotlight step points at something a brand-new account can see', () => {
  const all = sourceFiles(SRC).map((f) => readFileSync(f, 'utf8')).join('\n');
  for (const step of TOUR_STEPS.filter((s) => s.kind === 'spotlight')) {
    assert.ok(step.target, `${step.id} has no target`);
    assert.ok(ALWAYS_THERE.has(step.target), `${step.id}: "${step.target}" is not on the always-there list`);
    assert.ok(all.includes(`data-tour="${step.target}"`), `no data-tour="${step.target}" for step ${step.id}`);
  }
});

test('every illustrated step draws a picture that exists and does not depend on the page behind it', () => {
  const stage = read(SRC, 'components/onboarding/TourStage.vue');
  for (const step of TOUR_STEPS.filter((s) => s.kind === 'illustrated')) {
    assert.ok(step.visual, `${step.id} has no visual`);
    assert.ok(stage.includes(`'${step.visual}':`), `TourStage has no picture for "${step.visual}"`);
    assert.equal(step.route, null, `${step.id} is illustrated, so it should not need a page`);
    assert.equal(step.target, undefined, `${step.id} is illustrated, so it should not have a target`);
  }
});

test('the attendee-form picture uses the labels the real form shows', () => {
  const intake = read(SRC, 'pages/IntakePage.vue');
  const labels = [...CONNECT_MOCK.fields, ...CONNECT_MOCK.optionalFields];
  for (const l of labels) assert.ok(intake.includes(`label="${l}"`), `IntakePage has no field labelled "${l}"`);
  assert.ok(intake.includes(CONNECT_MOCK.subtitle), 'subtitle drifted from IntakePage');
  assert.ok(intake.includes(CONNECT_MOCK.hint), 'hint drifted from IntakePage');
  assert.ok(intake.includes(`label="${CONNECT_MOCK.submit}"`), 'submit label drifted from IntakePage');
});

test('the text-message picture quotes what twilio-webhook really replies', () => {
  const hook = read(REPO, 'supabase/functions/twilio-webhook/index.ts');
  assert.ok(hook.includes(SMS_MOCK.reply), 'the SETUP reply drifted from twilio-webhook');
  assert.ok(hook.includes('"setup"'), 'twilio-webhook no longer treats SETUP as the start phrase');
});

test('the phone number is written once and shared with Setup', () => {
  assert.match(TWILIO_NUMBER_DISPLAY, /^\+1 \(\d{3}\) \d{3}-\d{4}$/);
  const setup = read(SRC, 'pages/SetupPage.vue');
  assert.ok(setup.includes("from '@/utils/smsNumber'"), 'Setup should import the shared number');
  assert.ok(!setup.includes('218-1311'), 'Setup has its own copy of the number');
  const phoneStep = TOUR_STEPS.find((s) => s.id === 'phone-text');
  assert.ok(phoneStep.body.includes('{number}'), 'the phone step should use the shared number');
});

test('every role is walked through setting up their phone, and can skip past it', () => {
  for (const role of ['admin', 'solutionsSuccess', 'sales']) {
    const steps = stepsForRole(role);
    const ids = steps.map((s) => s.id);
    for (const id of ['phone-text', 'phone-try', 'phone-media']) assert.ok(ids.includes(id), `${role} misses ${id}`);
    const skip = steps.find((s) => s.skipTo);
    assert.ok(skip && ids.includes(skip.skipTo.id), `${role}: the way past the phone section leads nowhere`);
    assert.ok(ids.indexOf(skip.skipTo.id) > ids.indexOf('phone-try'), `${role}: skipping must land after the phone section`);
  }
});

test('the text-message picture shows the confirmation the webhook really sends for a photo or voice note', () => {
  const hook = read(REPO, 'supabase/functions/twilio-webhook/index.ts');
  const [head, tail] = SMS_MOCK.received.split('1');
  assert.ok(hook.includes(head) && hook.includes(tail), 'the "Got it" reply drifted from twilio-webhook');
});

test('the "Phone number needed" note tells people to ask who Setup says to ask', () => {
  const setup = read(SRC, 'pages/SetupPage.vue');
  const note = TOUR_STEPS.find((s) => s.id === 'phone-text').note;
  assert.ok(/Solutions Success rep/.test(note) && /Solutions Success rep/.test(setup), 'tour and Setup name different people to ask');
  assert.ok(setup.includes('label="Phone number needed"') && note.includes('Phone number needed'));
});

// Only Sales accounts have a QR; the Setup card for it is v-if'd on repSlug, and
// admin / Solutions Success get the Rep QR slides card instead. Telling a manager
// to share "your QR code" would point them at something they don't have.
test('a rep is shown their own QR code and a manager the reps\' QR codes, each on the Setup card that exists for them', () => {
  const qrFor = (role) => stepsForRole(role).filter((s) => s.id === 'qr');
  assert.equal(qrFor('sales').length, 1);
  assert.match(qrFor('sales')[0].title, /^Your QR code/);
  for (const role of ['admin', 'solutionsSuccess']) {
    assert.equal(qrFor(role).length, 1, `${role} should get exactly one QR step`);
    assert.match(qrFor(role)[0].title, /reps/i);
  }
  const setup = read(SRC, 'pages/SetupPage.vue');
  assert.ok(/v-if="subject\?\.repSlug" data-tour="setup-qr"/.test(setup), 'the rep QR card lost its tour target');
  assert.ok(/v-if="canManageEvents" data-tour="setup-qr"/.test(setup), 'the Rep QR slides card lost its tour target');
  assert.ok(qrFor('sales')[0].body.includes('slide'), 'the QR step should say what can be saved');
});

test('the walkthrough chapters are the stops the welcome screens list', () => {
  for (const role of ['sales', 'admin']) {
    const stops = splashSlides(role)[1].stops.map((x) => x.label);
    const chapters = [...new Set(stepsForRole(role).map((s) => s.chapter))];
    for (const stop of stops) assert.ok(chapters.includes(stop), `${role}: no walkthrough chapter called "${stop}"`);
  }
});

// Export downloads a file that someone imports into Zoho; it never sends
// anything to Zoho itself. Copy that said "sends them on to Zoho" was wrong.
test('nothing claims the app sends leads to Zoho; it exports a file', () => {
  for (const text of allTourCopy()) assert.ok(!/\bsends? (?:them |leads )?(?:on )?to Zoho\b/i.test(text), text);
  const exp = TOUR_STEPS.find((s) => s.id === 'export');
  assert.ok(/downloads/i.test(exp.body) && /import/i.test(exp.body));
  assert.ok(read(SRC, 'pages/ExportPage.vue').includes('Export to Zoho'), 'the export step names a title the page does not show');
});

// The callout names only what a rep supplies; Review also needs the Zoho match
// finished and no possible duplicate. If it starts requiring a fifth thing, this
// fails so the wording is revisited.
test('Ready to approve names what a rep has to supply, and Review still checks only four things', () => {
  const text = SAMPLE_CALLOUTS.map((c) => c.text).join(' ').toLowerCase();
  assert.equal(readinessChecklist(SAMPLE_LEAD).length, 4, 'Review checks something new: update the tour callout');
  for (const needle of ['phone or email', 'school or district']) {
    assert.ok(text.includes(needle), `callouts no longer mention "${needle}"`);
  }
});

test('the consent wording is not copied into the tour', () => {
  const tourFiles = sourceFiles(join(SRC, 'components/onboarding')).map((f) => readFileSync(f, 'utf8')).join('\n') + allTourCopy().join('\n');
  assert.ok(!/By texting this code/i.test(tourFiles), 'the opt-in disclosure lives once, on Setup, under the real button');
  assert.ok(!/sms:/i.test(tourFiles), 'the tour must not offer its own text-now button; that is consent, and the disclosure has to sit beside it');
});

test('the sample lead is genuinely Ready under Review\'s own rule', () => {
  assert.equal(isReady(SAMPLE_LEAD), true);
});

test('every role gets the same number of splash screens, ending on a way forward', () => {
  for (const role of ['admin', 'solutionsSuccess', 'sales']) {
    const slides = splashSlides(role);
    assert.equal(slides.length, 3);
    assert.equal(slides[2].id, 'ready');
  }
});

test('a rep sees three stops on the journey, a manager four', () => {
  assert.equal(splashSlides('sales')[1].stops.length, 3);
  assert.equal(splashSlides('admin')[1].stops.length, 4);
});

test('the wording avoids technical vocabulary', () => {
  for (const text of allTourCopy()) {
    for (const word of BANNED_WORDS) {
      assert.ok(!new RegExp(`\\b${word}\\b`, 'i').test(text), `"${word}" in: ${text}`);
    }
  }
});

test('wording stays short: no step body runs past three sentences', () => {
  for (const s of TOUR_STEPS) {
    const sentences = s.body.split(/[.!?]+\s/).filter(Boolean);
    assert.ok(sentences.length <= 3, `${s.id} has ${sentences.length} sentences`);
  }
});

test('signing out (or a 401) drops a tour in progress instead of leaving it for the next person', () => {
  const base = { hasUser: true, kioskLocked: false, viewingAs: false, phase: 'idle' };
  assert.equal(tourStartAction({ ...base, hasUser: false, phase: 'tour' }), 'reset');
  assert.equal(tourStartAction({ ...base, hasUser: false, phase: 'splash' }), 'reset');
  assert.equal(tourStartAction({ ...base, hasUser: false, phase: 'idle' }), 'none');
});

test('a locked kiosk never shows the tour and clears one in progress', () => {
  const base = { hasUser: true, kioskLocked: true, viewingAs: false, phase: 'idle' };
  assert.equal(tourStartAction(base), 'none');
  assert.equal(tourStartAction({ ...base, phase: 'tour' }), 'reset');
});

test('an admin previewing someone else, or a tour already running, is left alone', () => {
  const base = { hasUser: true, kioskLocked: false, viewingAs: false, phase: 'idle' };
  assert.equal(tourStartAction({ ...base, viewingAs: true }), 'none');
  assert.equal(tourStartAction({ ...base, phase: 'tour' }), 'none');
  assert.equal(tourStartAction(base), 'begin');
});

test('the tour calls the state by the name Review shows on the chip', () => {
  const step = TOUR_STEPS.find((s) => s.id === 'review-sample');
  assert.ok(step.body.includes(READY_LABEL), `review-sample should say "${READY_LABEL}"`);
  assert.ok(SAMPLE_CALLOUTS.some((c) => c.text.includes(READY_LABEL)), 'a callout should use the chip wording');
});
