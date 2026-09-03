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
