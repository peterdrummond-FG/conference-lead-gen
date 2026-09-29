// Run: cd frontend && npm test
// Node strips the TypeScript types itself, so no build step is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BANNED_WORDS, SAMPLE_LEAD, TOUR_STEPS, allTourCopy, splashSlides, stepsForRole,
} from './onboardingTour.ts';
import { isReady } from './reviewSmart.ts';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

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

test('every spotlight target exists on a real element', () => {
  const all = sourceFiles(SRC).map((f) => readFileSync(f, 'utf8')).join('\n');
  for (const step of TOUR_STEPS) {
    assert.ok(all.includes(`data-tour="${step.target}"`), `no data-tour="${step.target}" for step ${step.id}`);
  }
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
