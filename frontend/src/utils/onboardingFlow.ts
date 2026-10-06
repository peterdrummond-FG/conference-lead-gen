// The rules of the first-time onboarding, as pure functions so they can be tested
// without a browser: when the splash shows, what is recorded when someone leaves,
// when the one-hour reminder is due, and which scenes the reminder plays.
//
// The onboarding has three ways in, and they record different things:
//   'first'      the splash -> quick start or tour. Leaving is recorded.
//   'remainder'  the reminder's "Watch now": just the scenes they haven't seen.
//   'replay'     the ? button: the full tour from the top. Skipping records
//                nothing, and it never touches "seen", so it can't re-open the
//                splash or move a resume point backwards.
//
// Nothing here imports another module's values (only types), so the node tests
// run these files directly with no build.
import type { Role } from '@/types/review';

export interface OnboardingState {
  seen: boolean;
  path: 'quick' | 'tour' | null;
  endedAt: string | null;
  // A scene id (SCENES, or IMPORT_ONLY.id) they stopped before; null = nothing left.
  resumeFrom: string | null;
  reminderShown: boolean;
}

// What `me` answers when its lookup failed: "seen, nothing to resume, reminder
// spent", so a hiccup never shows the splash or a reminder to someone who has
// been through it. The same value the Edge Function sends.
export const ONBOARDING_FAIL_SAFE: OnboardingState = {
  seen: true, path: null, endedAt: null, resumeFrom: null, reminderShown: true,
};

export const REMINDER_DELAY_MS = 60 * 60 * 1000;

// ── The scenes, as data ────────────────────────────────────────────────────
// Ids and "what it's about" in words for the reminder. The words on screen and the
// components live in components/tour/tourFlow.ts, which uses these ids (a test
// keeps the two lists, and the Edge Function's allow-list, the same).
export interface SceneMeta {
  id: string;
  // A phrase that finishes "Still to see: …".
  short: string;
  // A rough length, for "About 40 seconds". Measured off the scripts, not exact.
  seconds: number;
  managersOnly?: boolean;
}

export const SCENES: SceneMeta[] = [
  { id: 'setup', short: 'linking your phone', seconds: 20 },
  { id: 'send', short: 'sending us leads', seconds: 30 },
  { id: 'qr', short: 'your QR code', seconds: 15 },
  { id: 'review', short: 'reviewing your leads', seconds: 15 },
  { id: 'export', short: 'exporting to Zoho', seconds: 10, managersOnly: true },
  { id: 'admin', short: 'looking after your team', seconds: 20, managersOnly: true },
];

// The second half of "Send us leads": Contacts' Import button and a pasted note.
// A quick-start rep has already seen the texting half, so their remainder starts
// here, in a scene that skips the texting.
export const IMPORT_ONLY: SceneMeta = { id: 'send-import', short: 'adding a typed note', seconds: 10 };

export const RESUME_IDS = [...SCENES.map((s) => s.id), IMPORT_ONLY.id];

// One thing to play: a scene, and whether it is the import-only version.
export interface Step { id: string; sceneId: string; importOnly: boolean; short: string; seconds: number }

function toStep(m: SceneMeta): Step {
  return m.id === IMPORT_ONLY.id
    ? { id: m.id, sceneId: 'send', importOnly: true, short: m.short, seconds: m.seconds }
    : { id: m.id, sceneId: m.id, importOnly: false, short: m.short, seconds: m.seconds };
}

export function isManager(role: Role): boolean {
  return role === 'admin' || role === 'solutionsSuccess';
}

// The full tour, in order, for this kind of account.
export function fullSteps(manager: boolean): Step[] {
  return SCENES.filter((s) => manager || !s.managersOnly).map(toStep);
}

// Just what is left from `resumeFrom`: that scene and everything after it. An id
// we don't know (a stale value from an older build) plays the whole tour rather
// than nothing. "send-import" resumes in the middle of "Send us leads", in its
// import-only form, then carries on.
export function remainderSteps(manager: boolean, resumeFrom: string | null): Step[] {
  const all = fullSteps(manager);
  if (!resumeFrom) return all;
  const key = resumeFrom === IMPORT_ONLY.id ? 'send' : resumeFrom;
  const i = all.findIndex((s) => s.id === key);
  if (i < 0) return all;
  const rest = all.slice(i);
  return resumeFrom === IMPORT_ONLY.id ? [toStep(IMPORT_ONLY), ...rest.slice(1)] : rest;
}

// ── When things happen ─────────────────────────────────────────────────────
export type FlowPhase = 'idle' | 'splash' | 'quick1' | 'quick2' | 'tour' | 'finish' | 'reminder';

//  'reset'    drop whatever is in progress, without recording anything
//  'splash'   show the first-time splash
//  'reminder' show the one-hour reminder
//  'none'     leave it alone
// A 401 signs the person out but used to leave the old tour "in progress" in
// memory, so the next person to sign in on that tab resumed the previous person's
// tour in the previous person's role: no user means nothing in progress. A locked
// kiosk (an iPad at a booth) and "view as" never see staff onboarding.
export type FlowAction = 'reset' | 'splash' | 'reminder' | 'none';

export function flowStartAction(o: {
  hasUser: boolean;
  kioskLocked: boolean;
  viewingAs: boolean;
  phase: FlowPhase;
  onboarding: OnboardingState | null | undefined;
  now: number;
}): FlowAction {
  if (o.kioskLocked || !o.hasUser) return o.phase !== 'idle' ? 'reset' : 'none';
  if (o.viewingAs || o.phase !== 'idle') return 'none';
  // An older `me` with no onboarding field must not show the splash to everyone.
  if (!o.onboarding) return 'none';
  if (!o.onboarding.seen) return 'splash';
  return reminderDue(o.onboarding, o.now) ? 'reminder' : 'none';
}

// Shown once, an hour or more after they left, and only if something was left.
export function reminderDue(s: OnboardingState, now: number): boolean {
  if (!s.resumeFrom || s.reminderShown || !s.endedAt) return false;
  const ended = Date.parse(s.endedAt);
  return Number.isFinite(ended) && now - ended >= REMINDER_DELAY_MS;
}

// ── What is recorded when someone leaves ───────────────────────────────────
export interface Ended { event: 'ended'; path: 'quick' | 'tour'; resumeFrom: string | null }

// The quick start (Close, or Text SETUP): the texting half of "Send us leads" and
// Text SETUP count as seen, so what is left starts at the import half.
export function quickEnd(): Ended {
  return { event: 'ended', path: 'quick', resumeFrom: IMPORT_ONLY.id };
}

// Skipping the first-time tour at a step. Null for any other mode: a skip during
// the reminder's remainder or a ? replay records nothing (the reminder has had its
// say, and a replay must not move a resume point back to the top).
export function tourSkip(mode: 'first' | 'remainder' | 'replay', step: Step): Ended | null {
  if (mode !== 'first') return null;
  return { event: 'ended', path: 'tour', resumeFrom: step.id };
}

// ── The reminder's words, from what is actually left ───────────────────────
function joinPhrases(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function howLong(seconds: number): string {
  if (seconds < 90) return `${Math.max(10, Math.round(seconds / 10) * 10)} seconds`;
  const m = Math.round(seconds / 60);
  return `${m} minute${m === 1 ? '' : 's'}`;
}

// What the reminder says depends on how they left, because the two people are in
// different spots and one sentence can't be true for both. "You skipped part of the
// tour" was false for someone who chose "Just get me texting" (path 'quick'): they
// never started the tour, so for them it is an offer, not a nudge to finish. An
// unknown path (an older record) gets the finish-the-tour wording, which is true
// for anyone who has a resume point at all.
//
// The title is fixed per path, not derived from the length. It used to switch
// between "Got a minute?" and "Got a few minutes?" at 60s, so a 70-second remainder
// read "Got a few minutes?" above "About 70 seconds." (live 2026-10-06), and "See
// the rest:" never said the rest of what.
export function reminderCopy(steps: Step[], path: OnboardingState['path'] = null): { title: string; body: string } {
  const list = joinPhrases(steps.map((s) => s.short));
  const length = howLong(steps.reduce((n, s) => n + s.seconds, 0));
  if (path === 'quick') {
    return {
      title: 'Want a quick tour?',
      body: `You went straight to texting earlier. In about ${length}, see what else you can do: ${list}.`,
    };
  }
  return {
    title: 'Finish the tour?',
    body: `You left the tour partway through. Still to see: ${list}. About ${length}.`,
  };
}

// The progress bar counts only what is being played.
export function progress(steps: Step[], index: number): { current: number; total: number } {
  return { current: Math.min(Math.max(index, 0), Math.max(steps.length - 1, 0)), total: steps.length };
}
