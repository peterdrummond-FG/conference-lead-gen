import { defineStore } from 'pinia';

export type Role = 'sales' | 'customerSuccess';

const STORAGE_KEY = 'clg-role';

function readStored(): Role {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'customerSuccess' ? 'customerSuccess' : 'sales';
}

// A demo-only role switcher, not real access control — there's no backend
// user model to back it, so it's just a client-side toggle that decides
// which tabs show up. Persisted to localStorage purely so the choice
// survives a page reload during a demo, not for security.
export const useRoleStore = defineStore('role', {
  state: () => ({
    role: readStored(),
  }),
  actions: {
    setRole(role: Role) {
      this.role = role;
      localStorage.setItem(STORAGE_KEY, role);
    },
  },
});
