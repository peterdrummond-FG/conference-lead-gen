import { defineStore } from 'pinia';
import { api } from '@/boot/axios';

// The kiosk laptop always boots locked into the Intake-only screen — there's
// no "remember me" here on purpose, since the whole point is that whoever's
// physically at the booth the next morning sees the plain contact form, not
// whatever nav state was left over from last night. `pin` is kept only in
// memory (never localStorage) for exactly the same reason, and doubles as
// what boot/axios.ts's interceptor attaches as x-staff-pin on every
// request now that the staff PIN is enforced server-side, not just by
// which routes the router shows.
export const useKioskStore = defineStore('kiosk', {
  state: () => ({
    locked: true,
    pin: null as string | null,
  }),
  actions: {
    async unlock(pin: string): Promise<boolean> {
      const { data } = await api.post<{ valid: boolean }>('/auth-verify-pin', { pin });
      if (data.valid) {
        this.locked = false;
        this.pin = pin;
      }
      return data.valid;
    },
    lock() {
      this.locked = true;
      this.pin = null;
    },
  },
});
