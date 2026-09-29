import { defineStore } from 'pinia';
import type { Role } from '@/types/review';
import { stepsForRole, type TourStep } from '@/utils/onboardingTour';
import { useSessionStore } from '@/stores/session-store';

export type TourPhase = 'idle' | 'splash' | 'tour';

const STORAGE_KEY = 'clg-tour-progress';

// Where the welcome tour is right now. Deliberately knows nothing about the
// router or the DOM: TourOverlay watches `currentStep` and moves the page, so
// this stays a small, predictable piece of state.
//
// Progress is kept in sessionStorage so a refresh part-way through picks up at
// the same step instead of starting over (or vanishing). It is per tab and
// dies with it; whether the tour has been *finished* is the account's
// `onboarded` flag, not this.
export const useTourStore = defineStore('tour', {
  state: () => ({
    phase: 'idle' as TourPhase,
    stepIndex: 0,
    role: null as Role | null,
  }),
  getters: {
    steps: (state): TourStep[] => (state.role ? stepsForRole(state.role) : []),
    currentStep(): TourStep | null {
      return this.phase === 'tour' ? (this.steps[this.stepIndex] ?? null) : null;
    },
    total(): number {
      return this.steps.length;
    },
    isLast(): boolean {
      return this.stepIndex >= this.steps.length - 1;
    },
  },
  actions: {
    // Begins at the three welcome screens. Used for a first login and for a
    // replay from the header alike.
    start(role: Role) {
      this.role = role;
      this.stepIndex = 0;
      this.phase = 'splash';
      this.save();
    },
    beginTour() {
      this.stepIndex = 0;
      this.phase = 'tour';
      this.save();
    },
    next() {
      if (this.isLast) {
        this.close();
        return;
      }
      this.stepIndex += 1;
      this.save();
    },
    // Jumps to a named step: the way past a section someone has already done.
    goTo(id: string) {
      const i = this.steps.findIndex((s) => s.id === id);
      if (i < 0) return;
      this.stepIndex = i;
      this.save();
    },
    back() {
      if (this.stepIndex > 0) {
        this.stepIndex -= 1;
        this.save();
      }
    },
    // Finishing and skipping are the same thing to the account: the person has
    // seen it and shouldn't be shown it again on their own.
    close() {
      this.phase = 'idle';
      this.stepIndex = 0;
      this.save();
      void useSessionStore().completeOnboarding();
    },
    // Drops any in-progress tour without counting it as seen. Used on log out,
    // so the next person to sign in on this tab neither resumes someone else's
    // tour nor has it marked done for them.
    reset() {
      this.phase = 'idle';
      this.stepIndex = 0;
      this.role = null;
      this.save();
    },
    // Picks a refreshed tab back up where it left off. Returns whether there
    // was anything to resume.
    resume(role: Role): boolean {
      try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return false;
        const saved = JSON.parse(raw) as { phase?: TourPhase; stepIndex?: number };
        if (saved.phase !== 'splash' && saved.phase !== 'tour') return false;
        this.role = role;
        this.phase = saved.phase;
        const max = stepsForRole(role).length - 1;
        this.stepIndex = Math.min(Math.max(Number(saved.stepIndex) || 0, 0), Math.max(max, 0));
        return true;
      } catch {
        return false;
      }
    },
    save() {
      try {
        if (this.phase === 'idle') sessionStorage.removeItem(STORAGE_KEY);
        else sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ phase: this.phase, stepIndex: this.stepIndex }));
      } catch {
        // Private windows can refuse storage; resuming is a nicety, not a need.
      }
    },
  },
});
