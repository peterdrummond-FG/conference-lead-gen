import { defineStore } from 'pinia';
import { supabase } from '@/lib/supabase';
import { api } from '@/boot/axios';
import type { Profile, Role } from '@/types/review';

export interface SessionUser {
  id: string;
  name: string;
  email: string | null;
  role: Role;
  currentEventId: string | null;
  currentEventName: string | null;
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
    // ever changes which scoping params Review's reads send; every request
    // still carries the real admin's own JWT, so writes always land under
    // the admin's own account, never the previewed user's.
    viewingAs: null as Profile | null,
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
        currentEventId: string | null;
        currentEventName: string | null;
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
    },
    setViewingAs(profile: Profile | null) {
      this.viewingAs = profile;
    },
  },
});
