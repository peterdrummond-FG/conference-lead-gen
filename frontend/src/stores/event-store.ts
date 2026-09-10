import { defineStore } from 'pinia';
import axios from 'axios';
import { api } from '@/boot/axios';

export interface ActiveEvent {
  id: string;
  name: string;
  state: string;
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
    async fetchActive() {
      try {
        const { data } = await api.get<ActiveEvent>('/events-active');
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
