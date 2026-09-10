import { defineStore } from 'pinia';

export type Role = 'sales' | 'customerSuccess';

const STORAGE_KEY = 'clg-role';
const REP_ID_KEY = 'clg-active-rep-id';
const REP_NAME_KEY = 'clg-active-rep-name';

function readStored(): Role {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'customerSuccess' ? 'customerSuccess' : 'sales';
}

// A demo-only role switcher, not real access control — there's no backend
// user model to back it, so it's just a client-side picker that decides
// which tabs show up and, for 'sales', which single rep's own leads Review
// scopes to. Persisted to localStorage purely so the choice survives a
// page reload during a demo, not for security. Switching to a specific rep
// (SetupPage.vue) is confirmed against that rep's own PIN first
// (reps-verify-pin) so this isn't a bare clickable list of everyone's
// names, but it's still a client-side gate ahead of real per-user auth.
export const useRoleStore = defineStore('role', {
  state: () => ({
    role: readStored(),
    activeRepId: localStorage.getItem(REP_ID_KEY) as string | null,
    activeRepName: localStorage.getItem(REP_NAME_KEY) as string | null,
  }),
  actions: {
    setRole(role: Role) {
      this.role = role;
      localStorage.setItem(STORAGE_KEY, role);
      if (role === 'customerSuccess') this.setActiveRep(null, null);
    },
    setActiveRep(repId: string | null, repName: string | null) {
      this.activeRepId = repId;
      this.activeRepName = repName;
      if (repId && repName) {
        localStorage.setItem(REP_ID_KEY, repId);
        localStorage.setItem(REP_NAME_KEY, repName);
      } else {
        localStorage.removeItem(REP_ID_KEY);
        localStorage.removeItem(REP_NAME_KEY);
      }
    },
  },
});
