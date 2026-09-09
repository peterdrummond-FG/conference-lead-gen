import { defineBoot } from '#q-app';
import axios, { type AxiosInstance } from 'axios';
import { Notify } from 'quasar';
import { useKioskStore } from '@/stores/kiosk-store';

declare module 'vue' {
  interface ComponentCustomProperties {
    $axios: AxiosInstance;
    $api: AxiosInstance;
  }
}

// Stage 15: baseURL now points at the Supabase Edge Functions, not the old
// same-origin /api proxy — this is what changes when the .NET backend goes
// away. Both values are safe to expose in a public frontend build: the
// anon key is meant to be embeddable (it's what the Supabase gateway's own
// JWT check accepts as a valid caller — a real security boundary is the
// staff-PIN check inside each privileged function, not this key), and the
// functions URL is just a public HTTPS endpoint.
const FUNCTIONS_BASE_URL =
  import.meta.env.VITE_FUNCTIONS_BASE_URL || 'https://yrvppufkerbjpvrxniot.supabase.co/functions/v1';
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlydnBwdWZrZXJianB2cnhuaW90Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzODA4NzYsImV4cCI6MjEwMzk1Njg3Nn0.PZADuNtJi-N9wq95t-nolGblWaYVKCLeB9q5-V8e394';

const api = axios.create({ baseURL: FUNCTIONS_BASE_URL });

// Set from the boot callback below (Quasar hands every boot file the app's
// router instance) so the 401 handler can navigate, not just lock the
// store — this module has no component context of its own to call
// useRouter() from.
let router: import('vue-router').Router | undefined;

// Every Edge Function needs a valid Supabase JWT to pass the gateway's own
// check (verify_jwt) — the anon key satisfies that for every call this app
// makes. x-staff-pin is the app's OWN privilege check on top of that,
// attached whenever the kiosk is unlocked; privileged functions 401 without
// it, public ones (contacts-create, districts-list, etc.) just ignore it.
api.interceptors.request.use((config) => {
  config.headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
  config.headers.apikey = SUPABASE_ANON_KEY;

  const kioskStore = useKioskStore();
  if (kioskStore.pin) {
    config.headers['x-staff-pin'] = kioskStore.pin;
  }
  return config;
});

// No page anywhere in this app catches a rejected API call today — a failed
// request was previously just an unhandled promise rejection with zero user
// feedback. Every backend endpoint (including the global exception handler's
// fallback) responds with a consistent `{ error: string }` shape, so this
// interceptor can read it reliably and surface it once, centrally, for every
// call site. Re-throws afterward so existing `finally` blocks (loading-flag
// resets) keep working unchanged.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // A stored PIN that's since been changed (or was never valid server-
    // side) shows up as a 401 from a privileged function — treat that as
    // "session died," same as the kiosk always booting locked. Locking
    // alone only hides the header (MainLayout's v-if) — without also
    // navigating away, a reviewer sitting on /review or /export keeps
    // seeing (and can keep interacting with) whatever contact data was
    // already loaded on screen. Same lock()-then-navigate pattern
    // MainLayout's own lockAndGoToIntake() already uses.
    if (error.response?.status === 401) {
      useKioskStore().lock();
      if (router && router.currentRoute.value.path !== '/intake') {
        void router.push('/intake');
      }
    }

    const message: string =
      error.response?.data?.error ??
      (error.request ? 'Network error — check your connection.' : 'Something went wrong.');
    Notify.create({ type: 'negative', message });
    return Promise.reject(error);
  },
);

export default defineBoot(({ app, router: appRouter }) => {
  router = appRouter;
  app.config.globalProperties.$axios = axios;
  app.config.globalProperties.$api = api;
});

export { api };
