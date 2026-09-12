import { defineBoot } from '#q-app';
import axios, { type AxiosInstance } from 'axios';
import { Notify } from 'quasar';
import { currentAccessToken } from '@/lib/supabase';

declare module 'vue' {
  interface ComponentCustomProperties {
    $axios: AxiosInstance;
    $api: AxiosInstance;
  }
}

// Stage 15: baseURL points at the Supabase Edge Functions, not a same-origin
// /api proxy. Both values below are safe to expose in a public frontend
// build: the anon key is meant to be embeddable (it's what the Edge
// Functions gateway's own JWT check accepts from an unauthenticated caller
// — the real privilege boundary is requireUser()/role checks inside each
// function, not this key), and the functions URL is just a public HTTPS
// endpoint.
const FUNCTIONS_BASE_URL =
  import.meta.env.VITE_FUNCTIONS_BASE_URL || 'https://yrvppufkerbjpvrxniot.supabase.co/functions/v1';
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlydnBwdWZrZXJianB2cnhuaW90Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzODA4NzYsImV4cCI6MjEwMzk1Njg3Nn0.PZADuNtJi-N9wq95t-nolGblWaYVKCLeB9q5-V8e394';

const api = axios.create({ baseURL: FUNCTIONS_BASE_URL });

// Set from the boot callback below (Quasar hands every boot file the app's
// router instance) so the 401 handler can navigate — this module has no
// component context of its own to call useRouter() from.
let router: import('vue-router').Router | undefined;

// Every Edge Function still needs a valid Supabase-signed JWT to pass the
// gateway's own check (verify_jwt) — the anon key satisfies that for a
// logged-out caller (the public Intake/booth/session forms), and a real
// user's own access token satisfies it once they're logged in, which is
// also what lets requireUser() on the server resolve who's actually
// calling. currentAccessToken (lib/supabase.ts) is kept live via
// onAuthStateChange, so this read is synchronous — no per-request await.
api.interceptors.request.use((config) => {
  config.headers.Authorization = `Bearer ${currentAccessToken || SUPABASE_ANON_KEY}`;
  config.headers.apikey = SUPABASE_ANON_KEY;
  return config;
});

// No page anywhere in this app catches a rejected API call today — a failed
// request was previously just an unhandled promise rejection with zero user
// feedback. Every backend endpoint responds with a consistent
// `{ error: string }` shape, so this interceptor can read it reliably and
// surface it once, centrally, for every call site. Re-throws afterward so
// existing `finally` blocks (loading-flag resets) keep working unchanged.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // A stale/expired/revoked session shows up as a 401 from a staff-gated
    // function — treat that as "you're logged out," same as a fresh visit.
    // Intake/booth/session never call a staff-gated endpoint, so this path
    // is staff-only; redirect to /login, not /intake.
    if (error.response?.status === 401 && router && router.currentRoute.value.path !== '/login') {
      // Lazy import avoids a module-load-order cycle with session-store.ts
      // (which itself imports `api` from this file) — mirrors how
      // kiosk-store.ts used to be reached from here.
      void import('@/stores/session-store').then(({ useSessionStore }) => useSessionStore().logout());
      void router.push('/login');
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
