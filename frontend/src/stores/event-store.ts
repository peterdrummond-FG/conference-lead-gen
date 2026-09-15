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
  boothRepId: string | null;
  sessionRepId: string | null;
}

export const useEventStore = defineStore('event', {
  state: () => ({
    activeEvent: null as ActiveEvent | null,
    loaded: false,
  }),
  actions: {
    // slug identifies a specific event's QR scan (/connect/<slug>-<channel>)
    // — multiple conferences can be active at once, so this is what Intake
    // passes to get *that* event rather than an ambiguous "the" active one.
    // Omitted for staff pages (Setup), which resolve off the logged-in
    // user's own linked event server-side instead.
    async fetchActive(slug?: string) {
      try {
        const { data } = await api.get<ActiveEvent>('/events-active', { params: slug ? { slug } : {} });
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
