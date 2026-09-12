import { defineStore } from 'pinia';

const STORAGE_KEY = 'clg-kiosk-locked';

// A physical-device display mode, layered on top of (not a substitute for)
// real login: a rep sets up a shared iPad/laptop showing the public Intake
// form for attendees to self-serve, then "locks" this device into
// intake-only navigation so a stranger filling out the form can't wander
// into Setup/Review and see other reps' leads. Locking does NOT sign
// anyone out — the rep's own session stays live underneath, so unlocking
// just re-confirms their own account password (see MainLayout.vue) rather
// than requiring a fresh login. Persisted to localStorage (not sessionStore
// state) since this is specifically about what THIS device/browser shows,
// independent of any single login session, and should survive a reload.
export const useKioskModeStore = defineStore('kioskMode', {
  state: () => ({
    locked: localStorage.getItem(STORAGE_KEY) === 'true',
  }),
  actions: {
    lock() {
      this.locked = true;
      localStorage.setItem(STORAGE_KEY, 'true');
    },
    unlock() {
      this.locked = false;
      localStorage.removeItem(STORAGE_KEY);
    },
  },
});
