import { defineStore } from 'pinia';
import { supabase } from '@/lib/supabase';
import { api } from '@/boot/axios';
import type { Profile, Role } from '@/types/review';
import { ONBOARDING_FAIL_SAFE, type Ended, type OnboardingState } from '@/utils/onboardingFlow';

// What the browser tells profiles-complete-onboarding. Same shapes the Edge
// Function validates.
export type OnboardingEvent =
  | { event: 'seen' }
  | Ended
  | { event: 'reminder-shown' }
  | { event: 'complete' };

export interface SessionUser {
  id: string;
  name: string;
  email: string | null;
  // The number texted cards are credited to. Optional for the same reason as
  // `onboarded`: an older `me` response doesn't send it.
  phoneNumber?: string | null;
  role: Role;
  currentEventId: string | null;
  currentEventName: string | null;
  repSlug: string | null;
  hasKioskPin: boolean;
  // Has this person finished or skipped the first-time welcome tour? Optional
  // on purpose: an older `me` response has no such field, and the tour only
  // starts on an explicit `false`, so a missing value never shows it to
  // everyone (see MainLayout's auto-start).
  onboarded?: boolean;
  // The first-time onboarding (splash, quick start, tour, reminder). Optional for
  // the same reason as `onboarded`: an older `me` has no such field, and the
  // onboarding only starts when it is present (see onboardingFlow.flowStartAction).
  onboarding?: OnboardingState;
  // The account has a mobile number (without one, SETUP can't credit texted
  // leads to this person), and their phone has already texted SETUP for their
  // current conference. The onboarding words change on both.
  hasPhone?: boolean;
  phoneConnected?: boolean;
}

// The previewed person's own Setup facts, from `me?viewAsId=` (admin only).
// smsBound is only present when they have both a phone number and a
// conference, same rule as events-active's own smsBound.
export interface PreviewUser extends SessionUser {
  smsBound?: boolean;
}

// Replaces kiosk-store.ts (shared-PIN lock/unlock) and role-store.ts
// (client-side-only role picker) wholesale — identity now comes from a
// real Supabase Auth session + the `me` Edge Function, not a shared secret
// or a free client-side toggle.
export const useSessionStore = defineStore('session', {
  state: () => ({
    user: null as SessionUser | null,
    initialized: false,
    // Admin-only "view as" preview (see MainLayout's user switcher) — only
    // ever changes what is read and shown (Review's scoping params, and the
    // `preview` facts Setup and Kiosk display); every request
    // still carries the real admin's own JWT, so writes always land under
    // the admin's own account, never the previewed user's.
    viewingAs: null as Profile | null,
    // What Setup and Kiosk show while previewing: the viewingAs profile
    // alone carries no conference name, phone-connected state or PIN state,
    // which is why those pages used to hide everything instead. Null until
    // it has loaded (and whenever nobody is being previewed).
    preview: null as PreviewUser | null,
  }),
  getters: {
    // What Review should actually scope its reads to, whether that's the
    // real logged-in user or (admin only) whoever they're previewing.
    effectiveRole: (state): Role | null => state.viewingAs?.role ?? state.user?.role ?? null,
    effectiveRepId: (state): string | null =>
      state.viewingAs
        ? (state.viewingAs.role === 'sales' ? state.viewingAs.id : null)
        : (state.user?.role === 'sales' ? state.user.id : null),
  },
  actions: {
    async fetchMe() {
      const { data } = await api.get<{
        id: string;
        name: string;
        role: Role;
        email: string | null;
        phoneNumber: string | null;
        currentEventId: string | null;
        currentEventName: string | null;
        repSlug: string | null;
        hasKioskPin: boolean;
        onboarded?: boolean;
        onboarding?: OnboardingState;
        hasPhone?: boolean;
        phoneConnected?: boolean;
      }>('/me');
      this.user = data;
    },
    async initialize() {
      if (this.initialized) return;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) await this.fetchMe();
      } finally {
        this.initialized = true;
      }

      supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') {
          this.user = null;
          this.viewingAs = null;
          this.preview = null;
        }
      });
    },
    async login(email: string, password: string) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await this.fetchMe();
    },
    async logout() {
      await supabase.auth.signOut();
      this.user = null;
      this.viewingAs = null;
      this.preview = null;
    },
    async setViewingAs(profile: Profile | null) {
      this.viewingAs = profile;
      this.preview = null;
      if (profile) await this.fetchPreview();
    },
    // Separate so Setup's "Check connection" can refresh the previewed
    // person's phone state the same way it refreshes the admin's own.
    async fetchPreview() {
      const target = this.viewingAs;
      if (!target) return;
      const { data } = await api.get<PreviewUser>('/me', { params: { viewAsId: target.id } });
      // A second pick made while this was in flight wins.
      if (this.viewingAs?.id === target.id) this.preview = data;
    },
    // Records where the person is in the first-time onboarding, on screen first and
    // on the account second, so the rules that read it (the splash, the one-hour
    // reminder) see the change straight away. If the save fails nothing is stuck:
    // the worst case is the splash or the reminder showing once more, which is
    // harmless; being unable to leave it is not.
    async recordOnboarding(e: OnboardingEvent) {
      const u = this.user;
      if (!u) return;
      const cur = u.onboarding ?? { ...ONBOARDING_FAIL_SAFE, seen: false, reminderShown: false };
      switch (e.event) {
        case 'seen':
          u.onboarding = { ...cur, seen: true };
          break;
        case 'ended':
          u.onboarding = { seen: true, path: e.path, endedAt: new Date().toISOString(), resumeFrom: e.resumeFrom, reminderShown: false };
          break;
        case 'reminder-shown':
          u.onboarding = { ...cur, reminderShown: true };
          break;
        case 'complete':
          u.onboarding = { ...cur, seen: true, resumeFrom: null };
          break;
      }
      try {
        await api.post('/profiles-complete-onboarding', e);
      } catch {
        // Deliberately silent; see above.
      }
    },
  },
});
