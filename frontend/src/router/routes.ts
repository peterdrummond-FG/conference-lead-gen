import type { RouteRecordRaw } from 'vue-router';
import type { Role } from '@/types/review';

// Routes with no `roles` (Intake, its aliases, and Login) are public — no
// session required. Everything else is a staff route: index.ts's guard
// redirects an unauthenticated visitor to /login, and a logged-in visitor
// whose role isn't listed to /review.
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('@/layouts/MainLayout.vue'),
    children: [
      { path: '', redirect: '/intake' },
      { path: 'login', component: () => import('@/pages/LoginPage.vue') },
      { path: 'setup', component: () => import('@/pages/SetupPage.vue'), meta: { roles: ['admin', 'solutionsSuccess', 'sales'] as Role[] } },
      { path: 'intake', component: () => import('@/pages/IntakePage.vue') },
      // Short, easy-to-hand-type aliases for the two QR codes SetupPage.vue
      // generates (booth vs. breakout session) — the QR itself is always
      // scanned, but the slide also spells the URL out for anyone who can't
      // scan, so it needs to be short enough to type on a phone keyboard.
      { path: 'booth', redirect: { path: '/intake', query: { channel: 'booth' } } },
      { path: 'session', redirect: { path: '/intake', query: { channel: 'session' } } },
      { path: 'review', component: () => import('@/pages/ReviewPage.vue'), meta: { roles: ['admin', 'solutionsSuccess', 'sales'] as Role[] } },
      { path: 'export', component: () => import('@/pages/ExportPage.vue'), meta: { roles: ['admin', 'solutionsSuccess'] as Role[] } },
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
