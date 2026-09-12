import { defineRouter } from '#q-app';
import {
  createMemoryHistory,
  createRouter,
  createWebHashHistory,
  createWebHistory,
} from 'vue-router';

import routes from './routes';
import { useSessionStore } from '@/stores/session-store';
import { useKioskModeStore } from '@/stores/kiosk-mode-store';
import type { Role } from '@/types/review';

/*
 * If not building with SSR mode, you can
 * directly export the Router instantiation;
 *
 * The function below can be async too; either use
 * async/await or return a Promise which resolves
 * with the Router instance.
 */

export default defineRouter((/* { store, ssrContext } */) => {
  const createHistory = import.meta.env.QUASAR_SERVER
    ? createMemoryHistory
    : (import.meta.env.QUASAR_VUE_ROUTER_MODE === 'history' ? createWebHistory : createWebHashHistory);

  const Router = createRouter({
    scrollBehavior: () => ({ left: 0, top: 0 }),
    routes,

    // Leave this as is and make changes in quasar.conf.js instead!
    // quasar.conf.js -> build -> vueRouterMode
    // quasar.conf.js -> build -> publicPath
    history: createHistory(import.meta.env.QUASAR_VUE_ROUTER_BASE)
  });

  // Intake and its /booth, /session aliases carry no `meta.roles` — they're
  // the public attendee-facing QR form and stay reachable regardless of
  // auth state. Every other route requires a real login (Review is the
  // default landing page once logged in, not Setup or Intake).
  Router.beforeEach(async (to) => {
    // This device being locked into kiosk mode overrides everything else,
    // including an active login — the whole point is that whoever's
    // physically at this screen only ever sees Intake, regardless of who's
    // signed in underneath.
    const kioskModeStore = useKioskModeStore();
    if (kioskModeStore.locked && to.path !== '/intake') return '/intake';

    const sessionStore = useSessionStore();
    await sessionStore.initialize();
    const isLoggedIn = !!sessionStore.user;

    if (to.path === '/login') {
      return isLoggedIn ? '/review' : true;
    }

    const allowedRoles = to.meta.roles as Role[] | undefined;
    if (!allowedRoles) return true;

    if (!isLoggedIn) return { path: '/login', query: { redirect: to.fullPath } };
    if (!allowedRoles.includes(sessionStore.user!.role)) return '/review';

    return true;
  });

  return Router;
});
