// Run: cd frontend && npm test
// Node strips the TypeScript types itself, so no build step is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BANNED_WORDS, CONNECT_MOCK, SAMPLE_LEAD, SMS_MOCK, TOUR_STEPS, allTourCopy, splashSlides, stepsForRole,
} from './onboardingTour.ts';
import { TWILIO_NUMBER_DISPLAY } from './smsNumber.ts';
import { isReady } from './reviewSmart.ts';

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
  'setup-conference', 'setup-capture-head', 'setup-text-in', 'review-tabs',
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
  assert.ok(hook.includes(SMS_MOCK.replyPrefix), 'reply opening drifted from twilio-webhook');
  assert.ok(hook.includes(SMS_MOCK.replyRest.replace(/^\.\s*/, '')), 'reply body drifted from twilio-webhook');
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
    for (const id of ['phone-text', 'phone-media', 'phone-try']) assert.ok(ids.includes(id), `${role} misses ${id}`);
    const skip = steps.find((s) => s.skipTo);
    assert.ok(skip && ids.includes(skip.skipTo.id), `${role}: the way past the phone section leads nowhere`);
    assert.ok(ids.indexOf(skip.skipTo.id) > ids.indexOf('phone-try'), `${role}: skipping must land after the phone section`);
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
