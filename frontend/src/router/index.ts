import { defineRouter } from '#q-app';
import {
  createMemoryHistory,
  createRouter,
  createWebHashHistory,
  createWebHistory,
} from 'vue-router';

import routes from './routes';
import { useKioskStore } from '@/stores/kiosk-store';
import { useRoleStore } from '@/stores/role-store';
import type { Role } from '@/stores/role-store';

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

  // Locked kiosk mode only ever shows Intake, regardless of what URL was
  // typed or bookmarked. Once unlocked, a route can still declare which
  // roles may see it (see routes.ts) — Sales can't reach /export by URL
  // any more than by clicking a tab that isn't there.
  Router.beforeEach((to) => {
    const kioskStore = useKioskStore();
    if (kioskStore.locked && to.path !== '/intake') {
      return '/intake';
    }

    const allowedRoles = to.meta.roles as Role[] | undefined;
    if (allowedRoles) {
      const roleStore = useRoleStore();
      if (!allowedRoles.includes(roleStore.role)) {
        return '/intake';
      }
    }

    return true;
  });

  return Router;
});
