// How long each tour scene's script runs, in milliseconds, so the progress bar
// along the top can fill as the scene plays (OnboardingFrame) and the person can
// see when it is done instead of tapping Next halfway through.
//
// These are numbers a person has to keep right: they are the sum of every wait the
// script asks for (the engine counts them, useTourScript.ts). tourLengths.test.mjs
// runs each real script in fast mode and fails if one is more than 15% off, so
// editing a scene without updating its length fails the tests. To re-measure:
//
//   cd frontend && TOUR_LENGTHS_PRINT=1 node --test src/components/tour/tourLengths.test.mjs
//
// and copy the "measured" numbers (rounded to 50) for the variants that changed.
//
// A scene's script differs by more than its words, which is why the table has
// variants: the manager's QR scene is a different script from the rep's; phone vs
// laptop changes how a page is reached (the ☰ menu and then the page, or a tab);
// and a quick-start rep's reminder plays "Send us leads" from Import (`send:import`).
// Whether the account has a phone, or has linked it, only changes the WORDS under
// the scene, so those are not variants. Not part of a length: the 2.5 s pause the
// player adds before a scene loops, since the bar is full by then.
export interface SceneVariant {
  manager: boolean;
  phone: boolean;
  importOnly?: boolean;
}

// phone = a phone-width screen (the ☰ menu), wide = a laptop (tabs along the top).
const SCENE_MS: Record<string, { phone: number; wide: number }> = {
  setup: { phone: 21950, wide: 21950 },
  send: { phone: 27500, wide: 27500 },
  'send:import': { phone: 15450, wide: 15450 },
  qr: { phone: 21700, wide: 21700 },
  'qr:manager': { phone: 7350, wide: 5450 },
  review: { phone: 22600, wide: 21150 },
  export: { phone: 11100, wide: 9200 },
  admin: { phone: 22650, wide: 18850 },
};

// The quick start's first screen (what a rep can text us). Always a phone screen.
export const QUICK_TEXT_MS = 12350;

export function sceneKey(sceneId: string, v: SceneVariant): string {
  return `${sceneId}${v.importOnly ? ':import' : ''}${sceneId === 'qr' && v.manager ? ':manager' : ''}`;
}

// A scene with no declared length is a mistake, not "zero seconds": throw so it shows
// up in the test and in a dev build, rather than a bar that fills instantly.
export function sceneMs(sceneId: string, v: SceneVariant): number {
  if (sceneId === 'quick-text') return QUICK_TEXT_MS;
  const e = SCENE_MS[sceneKey(sceneId, v)];
  if (!e) throw new Error(`tourLengths.ts: no length for scene "${sceneKey(sceneId, v)}"`);
  return v.phone ? e.phone : e.wide;
}
