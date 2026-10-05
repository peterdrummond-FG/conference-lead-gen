import { defineStore } from 'pinia';
import type { FlowPhase } from '@/utils/onboardingFlow';

export type TourMode = 'first' | 'remainder' | 'replay';

const STORAGE_KEY = 'clg-onboarding-progress';

// Where the onboarding is on screen right now. Deliberately knows nothing about
// the router, the DOM or the account: MainLayout decides when to start it
// (utils/onboardingFlow.ts has the rules) and OnboardingHost draws it and records
// what happened. This stays a small, predictable piece of state.
//
// Progress is kept in sessionStorage so a refresh part-way through picks up at
// the same place instead of starting over (or vanishing). It is per tab, dies
// with it, and is tied to the person who started it: whether someone has seen it
// is the account's (`me.onboarding`), not this.
export const useTourStore = defineStore('tour', {
  state: () => ({
    phase: 'idle' as FlowPhase,
    mode: null as TourMode | null,
    // A scene id: where a remainder starts (and a refreshed tab resumes it).
    resumeFrom: null as string | null,
    stepIndex: 0,
    userId: null as string | null,
    // Bumped to remount the flow when it is opened again.
    runKey: 0,
  }),
  actions: {
    showSplash(userId: string) {
      this.open(userId, 'splash', 'first', null);
    },
    showReminder(userId: string, resumeFrom: string) {
      this.open(userId, 'reminder', 'remainder', resumeFrom);
    },
    // The reminder's "Watch now": just what is left.
    playRemainder(userId: string, resumeFrom: string | null) {
      this.open(userId, 'tour', 'remainder', resumeFrom);
    },
    // The ? button: the whole tour from the top. Never changes what the account
    // remembers.
    playReplay(userId: string) {
      this.open(userId, 'tour', 'replay', null);
    },
    open(userId: string, phase: FlowPhase, mode: TourMode, resumeFrom: string | null) {
      this.userId = userId;
      this.phase = phase;
      this.mode = mode;
      this.resumeFrom = resumeFrom;
      this.stepIndex = 0;
      this.runKey += 1;
      this.save();
    },
    progress(p: { phase: FlowPhase; index: number }) {
      this.phase = p.phase;
      this.stepIndex = p.index;
      this.save();
    },
    // Closes it and forgets where it was. Records nothing: whoever closes it has
    // already told the account what happened.
    reset() {
      this.phase = 'idle';
      this.mode = null;
      this.resumeFrom = null;
      this.stepIndex = 0;
      this.userId = null;
      this.save();
    },
    // Picks a refreshed tab back up where it left off, but only for the same
    // person: a different account signing in on this tab must not resume the
    // previous person's flow in the previous person's role (the 401 bug).
    // Returns whether there was anything to resume.
    resume(userId: string): boolean {
      try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return false;
        const saved = JSON.parse(raw) as Partial<{ userId: string; phase: FlowPhase; mode: TourMode; resumeFrom: string | null; stepIndex: number }>;
        if (saved.userId !== userId) return false;
        if (!saved.phase || saved.phase === 'idle' || !saved.mode) return false;
        this.userId = userId;
        this.phase = saved.phase;
        this.mode = saved.mode;
        this.resumeFrom = saved.resumeFrom ?? null;
        this.stepIndex = Math.max(Number(saved.stepIndex) || 0, 0);
        this.runKey += 1;
        return true;
      } catch {
        return false;
      }
    },
    save() {
      try {
        if (this.phase === 'idle') sessionStorage.removeItem(STORAGE_KEY);
        else {
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
            userId: this.userId, phase: this.phase, mode: this.mode, resumeFrom: this.resumeFrom, stepIndex: this.stepIndex,
          }));
        }
      } catch {
        // Private windows can refuse storage; resuming is a nicety, not a need.
      }
    },
  },
});
