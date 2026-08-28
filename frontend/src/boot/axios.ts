import { defineBoot } from '#q-app';
import axios, { type AxiosInstance } from 'axios';

declare module 'vue' {
  interface ComponentCustomProperties {
    $axios: AxiosInstance;
    $api: AxiosInstance;
  }
}

// baseURL is relative and relies entirely on the Vite dev server's /api
// proxy (see quasar.config.ts) — no hardcoded host anywhere in frontend
// code. This is what makes the QR code's LAN-IP-agnostic origin work: the
// kiosk hits whatever origin loaded the page, and /api resolves the same
// way on that same origin.
const api = axios.create({ baseURL: '/api' });

export default defineBoot(({ app }) => {
  app.config.globalProperties.$axios = axios;
  app.config.globalProperties.$api = api;
});

export { api };
