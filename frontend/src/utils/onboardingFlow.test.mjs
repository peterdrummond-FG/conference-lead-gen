// Run: cd frontend && npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IMPORT_ONLY, ONBOARDING_FAIL_SAFE, REMINDER_DELAY_MS, RESUME_IDS, SCENES,
  flowStartAction, fullSteps, progress, quickEnd, reminderCopy, reminderDue, remainderSteps, tourSkip,
} from './onboardingFlow.ts';

const NOW = Date.parse('2026-10-06T15:00:00Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const unseen = { seen: false, path: null, endedAt: null, resumeFrom: null, reminderShown: false };
const base = { hasUser: true, kioskLocked: false, viewingAs: false, phase: 'idle', onboarding: unseen, now: NOW };

// ── when the splash shows ──
test('the splash shows for someone who has not seen it', () => {
  assert.equal(flowStartAction(base), 'splash');
});
test('not while the kiosk is locked, or when previewing someone, or when nobody is signed in', () => {
  assert.equal(flowStartAction({ ...base, kioskLocked: true }), 'none');
  assert.equal(flowStartAction({ ...base, viewingAs: true }), 'none');
  assert.equal(flowStartAction({ ...base, hasUser: false }), 'none');
});
test('a 401 or a lock drops an in-progress flow instead of leaving it for the next person (reset-on-401)', () => {
  assert.equal(flowStartAction({ ...base, hasUser: false, phase: 'tour' }), 'reset');
  assert.equal(flowStartAction({ ...base, kioskLocked: true, phase: 'splash' }), 'reset');
});
test('it never starts over something already on screen', () => {
  assert.equal(flowStartAction({ ...base, phase: 'tour' }), 'none');
});
test('an older me with no onboarding field does not show the splash to everyone', () => {
  assert.equal(flowStartAction({ ...base, onboarding: undefined }), 'none');
});
test('the fail-safe me answer never shows the splash or a reminder', () => {
  assert.equal(flowStartAction({ ...base, onboarding: ONBOARDING_FAIL_SAFE }), 'none');
});

// ── the reminder ──
const left = (extra = {}) => ({ seen: true, path: 'quick', endedAt: iso(REMINDER_DELAY_MS + 1000), resumeFrom: IMPORT_ONLY.id, reminderShown: false, ...extra });
test('the reminder is due an hour after they left, if something is left and it has not been shown', () => {
  assert.equal(reminderDue(left(), NOW), true);
  assert.equal(flowStartAction({ ...base, onboarding: left() }), 'reminder');
});
test('not before an hour', () => {
  assert.equal(reminderDue(left({ endedAt: iso(REMINDER_DELAY_MS - 60_000) }), NOW), false);
});
test('exactly one hour counts', () => {
  assert.equal(reminderDue(left({ endedAt: iso(REMINDER_DELAY_MS) }), NOW), true);
});
test('only once', () => {
  assert.equal(reminderDue(left({ reminderShown: true }), NOW), false);
  assert.equal(flowStartAction({ ...base, onboarding: left({ reminderShown: true }) }), 'none');
});
test('not when nothing is left to see (finished the tour)', () => {
  assert.equal(reminderDue(left({ resumeFrom: null }), NOW), false);
});
test('not without an end time, or with a garbage one', () => {
  assert.equal(reminderDue(left({ endedAt: null }), NOW), false);
  assert.equal(reminderDue(left({ endedAt: 'not a date' }), NOW), false);
});

// ── what is recorded when they leave ──
test('closing the quick start, or tapping Text SETUP, leaves the import half for later', () => {
  assert.deepEqual(quickEnd(), { event: 'ended', path: 'quick', resumeFrom: 'send-import' });
});
test('skipping the first-time tour at a scene resumes at that scene', () => {
  for (const manager of [false, true]) {
    for (const step of fullSteps(manager)) {
      assert.deepEqual(tourSkip('first', step), { event: 'ended', path: 'tour', resumeFrom: step.id });
    }
  }
});
test('a skip during the reminder or a ? replay records nothing', () => {
  const step = fullSteps(false)[1];
  assert.equal(tourSkip('remainder', step), null);
  assert.equal(tourSkip('replay', step), null);
});

// ── what the remainder plays ──
test('the full tour: a rep gets four scenes, a manager gets six', () => {
  assert.deepEqual(fullSteps(false).map((s) => s.id), ['setup', 'send', 'qr', 'review']);
  assert.deepEqual(fullSteps(true).map((s) => s.id), ['setup', 'send', 'qr', 'review', 'export', 'admin']);
});
test('a quick-start rep sees the import half, then QR and Contacts', () => {
  const r = remainderSteps(false, 'send-import');
  assert.deepEqual(r.map((s) => s.id), ['send-import', 'qr', 'review']);
  assert.equal(r[0].importOnly, true);
  assert.equal(r[0].sceneId, 'send');
  assert.equal(r[1].importOnly, false);
});
test('a quick-start manager also gets Export and Admin', () => {
  assert.deepEqual(remainderSteps(true, 'send-import').map((s) => s.id), ['send-import', 'qr', 'review', 'export', 'admin']);
});
test('a skip at any scene resumes from exactly that scene, with everything after it', () => {
  for (const manager of [false, true]) {
    const all = fullSteps(manager);
    all.forEach((step, i) => {
      assert.deepEqual(remainderSteps(manager, step.id).map((s) => s.id), all.slice(i).map((s) => s.id), `${manager} ${step.id}`);
    });
  }
});
test('nothing left means the whole tour, and so does an id from an older build', () => {
  assert.equal(remainderSteps(false, null).length, 4);
  assert.equal(remainderSteps(false, 'a-scene-that-was-removed').length, 4);
});
test('a rep never gets a manager scene, even if the id was recorded for one', () => {
  assert.equal(remainderSteps(false, 'admin').length, 4);
});

// ── the reminder's words come from what is left, and from how they left ──
test('a quick-start rep is offered the tour, not told they left one', () => {
  assert.deepEqual(reminderCopy(remainderSteps(false, 'send-import'), 'quick'), {
    title: 'Want a quick tour?',
    body: 'You went straight to texting earlier. In about 40 seconds, see what else you can do: adding a typed note, your QR code and reviewing your leads.',
  });
});
test('someone who left the tour partway is asked to finish it', () => {
  assert.deepEqual(reminderCopy(remainderSteps(false, 'qr'), 'tour'), {
    title: 'Finish the tour?',
    body: 'You left the tour partway through. Still to see: your QR code and reviewing your leads. About 30 seconds.',
  });
  assert.match(reminderCopy(remainderSteps(false, 'review'), 'tour').body, /Still to see: reviewing your leads\. About 20 seconds\.$/);
  const long = reminderCopy(remainderSteps(true, 'setup'), 'tour');
  assert.match(long.body, /About 2 minutes\.$/);
});
test('an unknown path gets the finish-the-tour wording, which is true of anyone with a resume point', () => {
  assert.equal(reminderCopy(remainderSteps(false, 'qr'), null).title, 'Finish the tour?');
  assert.equal(reminderCopy(remainderSteps(false, 'qr')).title, 'Finish the tour?');
});
test('the title never depends on the length, so it cannot contradict the body', () => {
  // 70 seconds used to flip the title to "Got a few minutes?" over "About 70 seconds."
  for (const path of ['quick', 'tour']) {
    const titles = new Set();
    for (const manager of [false, true]) for (const id of RESUME_IDS) titles.add(reminderCopy(remainderSteps(manager, id), path).title);
    assert.equal(titles.size, 1, `${path}: ${[...titles]}`);
  }
});
test('reminder copy never says the reminder promise it cannot keep', () => {
  for (const manager of [false, true]) for (const id of RESUME_IDS) {
    for (const path of ['quick', 'tour']) {
      const { title, body } = reminderCopy(remainderSteps(manager, id), path);
      assert.ok(!/few minutes|See the rest|skipped/.test(`${title} ${body}`), body);
    }
  }
});

// ── the bar counts only what is played ──
test('the progress bar counts the remainder, not the whole tour', () => {
  const r = remainderSteps(false, 'send-import');
  assert.deepEqual(progress(r, 0), { current: 0, total: 3 });
  assert.deepEqual(progress(r, 99), { current: 2, total: 3 });
});

// ── the lists agree ──
test('the scene ids are the same in the rules, the tour and the Edge Function (_shared/onboardingEvent.ts)', async () => {
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = dirname(fileURLToPath(import.meta.url));
  const fn = readFileSync(join(here, '../../../supabase/functions/_shared/onboardingEvent.ts'), 'utf8');
  const inFn = /RESUME_IDS = \[([^\]]*)\]/.exec(fn)[1].match(/"([a-z-]+)"/g).map((s) => s.replaceAll('"', ''));
  assert.deepEqual([...inFn].sort(), [...RESUME_IDS].sort());
  assert.deepEqual(SCENES.map((s) => s.id), ['setup', 'send', 'qr', 'review', 'export', 'admin']);
});
