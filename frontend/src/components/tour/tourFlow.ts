// Attaches the scene components to the words in tourCopy.ts and builds what the
// player plays. The wording lives in tourCopy.ts (plain data a test can read) and
// the rules of what to play and when live in utils/onboardingFlow.ts.
import type { Component } from 'vue';
import { TWILIO_NUMBER_DISPLAY } from '@/utils/smsNumber';
import { fullSteps, isManager, type Step } from '@/utils/onboardingFlow';
import type { Role } from '@/types/review';
import { SCENE_COPY, ONBOARDING_COPY, type SceneCopy } from './tourCopy';
import TourSceneSetup from './scenes/TourSceneSetup.vue';
import TourSceneSend from './scenes/TourSceneSend.vue';
import TourSceneQr from './scenes/TourSceneQr.vue';
import TourSceneReview from './scenes/TourSceneReview.vue';
import TourSceneExport from './scenes/TourSceneExport.vue';
import TourSceneAdmin from './scenes/TourSceneAdmin.vue';

export { ONBOARDING_COPY };

const COMPONENTS: Record<string, Component> = {
  setup: TourSceneSetup,
  send: TourSceneSend,
  qr: TourSceneQr,
  review: TourSceneReview,
  export: TourSceneExport,
  admin: TourSceneAdmin,
};

// One screen of the tour as it will play for this person: the words for their
// role, the version of the scene that matches where they are, the scene itself.
export interface PlayItem extends SceneCopy {
  step: Step;
  component: Component;
}

export function playlist(role: Role, hasPhone: boolean, steps: Step[] = fullSteps(isManager(role))): PlayItem[] {
  const manager = isManager(role);
  return steps.map((step) => {
    const entry = SCENE_COPY.find((c) => c.id === step.sceneId);
    if (!entry) throw new Error(`Tour: no copy for scene "${step.sceneId}"`);
    let copy: SceneCopy = { title: entry.title, body: entry.body, ...(entry.note ? { note: entry.note } : {}) };
    if (manager && entry.forManagers) copy = { ...copy, ...entry.forManagers };
    if (step.importOnly && entry.importOnly) copy = entry.importOnly;
    // No mobile number: SETUP can't link the phone, so say what to do about it.
    // Only on the scene about linking the phone, and in its role's words.
    if (!hasPhone && entry.noPhoneNote && !step.importOnly) copy = { ...copy, note: entry.noPhoneNote[role] };
    return { ...copy, step, component: COMPONENTS[step.sceneId]! };
  });
}

// Copy markup to HTML: escaped first, then **bold** and {number}.
export function renderCopy(s: string): string {
  return s
    .replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
    .replace(/\{number\}/g, `<span style="white-space:nowrap">${TWILIO_NUMBER_DISPLAY}</span>`)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}
