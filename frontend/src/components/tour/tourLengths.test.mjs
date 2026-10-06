// Run: cd frontend && npm test
// The tour's progress bar fills as a scene plays and holds near the end until the
// script really finishes, so it needs to know how long each script runs. Those
// lengths are declared by hand in tourLengths.ts; this test measures every scene
// by running its REAL script (the .vue file's own <script setup>) against the REAL
// engine in fast mode and checks the declared number is within 15% of what the
// script asks to wait. Edit a scene without updating its length and this fails.
//
// How it runs a scene without a browser: a pair of module hooks compile the
// scenes' <script setup> with Vue's own SFC compiler, give every other .vue
// import an empty stand-in (only the templates use them) and hand `quasar` a
// stub whose screen is phone-sized or not. The script's finders (find, findText,
// ...) return an inert element; the engine's timing (wait, tap, type, scrollTo,
// ring) is the real createRun, which in fast mode adds up each wait it was asked
// for. A smooth scroll's real duration is not modelled (the stub arrives at once),
// which is why the allowance is 15% and not 1%.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileScript, parse } from 'vue/compiler-sfc';
import { createRun } from './useTourScript.ts';
import { sceneMs, QUICK_TEXT_MS } from './tourLengths.ts';
import { fullSteps, remainderSteps, IMPORT_ONLY } from '../../utils/onboardingFlow.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', '..');
const TOLERANCE = 0.15;

// ── running a scene's <script setup> in node ──
const asFile = (path) => pathToFileURL(path).href;
function existing(base) {
  for (const ext of ['', '.ts', '.vue']) {
    if (existsSync(base + ext) && !base.endsWith('/') && /\.[a-z]+$/.test(base + ext)) return base + ext;
  }
  return null;
}
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'quasar') return { url: 'tour-stub:quasar', shortCircuit: true };
    let base = null;
    if (specifier.startsWith('@/')) base = join(SRC, specifier.slice(2));
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) base = join(dirname(fileURLToPath(context.parentURL)), specifier);
    const hit = base && existing(base);
    return hit ? { url: asFile(hit), shortCircuit: true } : nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'tour-stub:quasar') return { format: 'module', source: 'export const useQuasar = () => globalThis.__tourQuasar;', shortCircuit: true };
    if (url.endsWith('.vue')) {
      const path = fileURLToPath(url);
      // Only the scenes' scripts matter; every other component is template-only here.
      if (!path.includes(`${join('tour', 'scenes')}`)) return { format: 'module', source: 'export default {};', shortCircuit: true };
      const { descriptor } = parse(readFileSync(path, 'utf8'), { filename: path });
      const script = compileScript(descriptor, { id: 'scene', inlineTemplate: false });
      return { format: 'module', source: stripTypeScriptTypes(script.content), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

// An element that accepts anything a script does to it. Never thenable (an `await`
// on it must not hang), and its numbers are plain so scrollTo's maths is defined.
function inertElement() {
  const rect = () => ({ left: 0, top: 0, width: 10, height: 10, right: 10, bottom: 10 });
  const classList = { add() {}, remove() {} };
  const el = new Proxy(function () {}, {
    get(_t, key) {
      if (key === 'then' || typeof key === 'symbol') return undefined;
      if (key === 'getBoundingClientRect') return rect;
      if (key === 'classList') return classList;
      if (key === 'scrollTop') return 0;
      if (key === 'scrollHeight') return 1000;
      if (key === 'clientHeight') return 500;
      if (key === 'textContent') return '';
      return el;
    },
    apply: () => el,
  });
  return el;
}

const loaded = new Map();
async function sceneComponent(sceneId) {
  if (!loaded.has(sceneId)) {
    const file = sceneId === 'quick-text' ? 'TourSceneQuickText' : { setup: 'TourSceneSetup', send: 'TourSceneSend', qr: 'TourSceneQr', review: 'TourSceneReview', export: 'TourSceneExport', admin: 'TourSceneAdmin' }[sceneId];
    loaded.set(sceneId, (await import(asFile(join(HERE, 'scenes', `${file}.vue`)))).default);
  }
  return loaded.get(sceneId);
}

// What the script asks to wait, in ms, for one variant of one scene.
async function measure(sceneId, { manager, phone, importOnly }) {
  globalThis.__tourQuasar = { screen: { lt: { sm: phone } } };
  const comp = await sceneComponent(sceneId);
  let api = null;
  comp.setup({ manager, ...(importOnly ? { importOnly: true } : {}) }, { expose: (o) => { if (o) api = o; }, emit: () => {}, attrs: {}, slots: {} });
  assert.ok(api?.run && api?.reset, `${sceneId}: the scene doesn't expose run and reset`);
  const el = inertElement();
  const device = { root: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }) }), scale: () => 1, finger: { x: 0, y: 0, visible: false, tapping: false } };
  const run = createRun(device, { paused: () => false, alive: () => true, fast: true, stepMs: 1 });
  Object.assign(run, { find: () => el, findText: () => el, findIncl: () => el, field: () => el });
  api.reset();
  await api.run(run);
  return run.elapsed();
}

// Every variant whose script differs: role (the QR scene), phone or laptop (how a
// page is reached), and the import-only "Send us leads" a quick-start rep gets from
// the reminder. The no-phone and phone-linked accounts see different WORDS on the
// same script, so they are the same variant here.
function variants() {
  const out = [];
  for (const manager of [false, true]) {
    const full = fullSteps(manager);
    const reminders = [...new Set([null, 'send-import', ...full.map((s) => s.id)])].flatMap((id) => remainderSteps(manager, id));
    for (const step of [...full, ...reminders]) {
      for (const phone of [false, true]) out.push({ sceneId: step.sceneId, manager, phone, importOnly: step.importOnly });
    }
  }
  const seen = new Set();
  return out.filter((v) => {
    const k = JSON.stringify(v);
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

test('every scene variant plays for about as long as tourLengths.ts says', async () => {
  const problems = [];
  for (const v of variants()) {
    const measured = await measure(v.sceneId, v);
    const declared = sceneMs(v.sceneId, v);
    const off = Math.abs(measured - declared) / measured;
    if (process.env.TOUR_LENGTHS_PRINT) console.log(JSON.stringify(v), 'measured', measured, 'declared', declared);
    if (!(off <= TOLERANCE)) problems.push(`${JSON.stringify(v)}: the script waits ${measured} ms, tourLengths.ts says ${declared} ms`);
  }
  assert.deepEqual(problems, [], `update tourLengths.ts for the scenes you changed:\n${problems.join('\n')}`);
});

test('the quick start\'s texting screen plays for about as long as QUICK_TEXT_MS says', async () => {
  const measured = await measure('quick-text', { manager: false, phone: true, importOnly: false });
  assert.ok(Math.abs(measured - QUICK_TEXT_MS) / measured <= TOLERANCE, `the script waits ${measured} ms, QUICK_TEXT_MS says ${QUICK_TEXT_MS}`);
});

test('a quick-start rep\'s reminder and the whole tour agree on how a scene is named', () => {
  assert.equal(IMPORT_ONLY.id, 'send-import');
  assert.ok(variants().some((v) => v.sceneId === 'send' && v.importOnly), 'the import-only variant is not being measured');
  assert.ok(variants().some((v) => v.sceneId === 'qr' && v.manager), "the manager's QR scene is not being measured");
});
