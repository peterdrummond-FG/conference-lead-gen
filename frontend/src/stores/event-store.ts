import { defineStore } from 'pinia';
import axios from 'axios';
import { api } from '@/boot/axios';

export interface ActiveEvent {
  id: string;
  name: string;
  state: string;
  slug: string;
  activatedAt: string;
  folderCode: string | null;
  // Both only present for an authenticated caller (events-active) — absent
  // (undefined) for the public Intake fetch.
  isLinkedRep?: boolean;
}

export const useEventStore = defineStore('event', {
  state: () => ({
    activeEvent: null as ActiveEvent | null,
    loaded: false,
  }),
  actions: {
    // slug identifies a specific event's QR scan (/connect/<slug>-<channel>,
    // pre-Stage-20), repSlug a rep's own reusable QR
    // (/connect/<repSlug> — the event is whatever that rep is currently
    // linked to) — multiple conferences can be active at once, so one of
    // these is what Intake passes to get *that* event rather than an
    // ambiguous "the" active one. Both omitted for staff pages (Setup),
    // which resolve off the logged-in user's own linked event server-side
    // instead.
    async fetchActive(slug?: string, repSlug?: string) {
      try {
        const params = slug ? { slug } : repSlug ? { repSlug } : {};
        const { data } = await api.get<ActiveEvent>('/events-active', { params });
        this.activeEvent = data;
      } catch (e) {
        if (axios.isAxiosError(e) && e.response?.status === 404) {
          this.activeEvent = null;
        } else {
          throw e;
        }
      } finally {
        this.loaded = true;
      }
    },
  },
});
