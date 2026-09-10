import type { RouteRecordRaw } from 'vue-router';
import type { Role } from '@/stores/role-store';

// Routes with no `roles` (Intake) are open to everyone — it's the kiosk
// screen itself, shown regardless of who unlocked the laptop.
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('@/layouts/MainLayout.vue'),
    children: [
      { path: '', redirect: '/intake' },
      { path: 'setup', component: () => import('@/pages/SetupPage.vue'), meta: { roles: ['sales', 'customerSuccess'] as Role[] } },
      { path: 'intake', component: () => import('@/pages/IntakePage.vue') },
      // Short, easy-to-hand-type aliases for the two QR codes SetupPage.vue
      // generates (booth vs. breakout session) — the QR itself is always
      // scanned, but the slide also spells the URL out for anyone who can't
      // scan, so it needs to be short enough to type on a phone keyboard.
      { path: 'booth', redirect: { path: '/intake', query: { channel: 'booth' } } },
      { path: 'session', redirect: { path: '/intake', query: { channel: 'session' } } },
      { path: 'review', component: () => import('@/pages/ReviewPage.vue'), meta: { roles: ['sales', 'customerSuccess'] as Role[] } },
      { path: 'export', component: () => import('@/pages/ExportPage.vue'), meta: { roles: ['customerSuccess'] as Role[] } },
    ],
  },

  // Always leave this as last one,
  // but you can also remove it
  {
    path: '/:catchAll(.*)*',
    component: () => import('@/pages/ErrorNotFound.vue'),
  },
];

export default routes;
