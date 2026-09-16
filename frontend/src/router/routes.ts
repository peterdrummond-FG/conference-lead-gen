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
      // The bare site URL is the staff login screen, not the attendee
      // Intake form — attendees only ever land on Intake via a QR code
      // (/#/booth, /#/session), never by typing the plain root URL.
      // index.ts's guard already sends an already-logged-in visitor here
      // straight on to /review.
      { path: '', redirect: '/login' },
      { path: 'login', component: () => import('@/pages/LoginPage.vue') },
      // Public, unauthenticated legal pages for the Twilio A2P 10DLC campaign
      // (Privacy Policy / Terms & Conditions URLs) — must stay reachable with
      // no login wall, per Twilio's review requirements.
      { path: 'privacy', component: () => import('@/pages/PrivacyPolicyPage.vue') },
      { path: 'terms', component: () => import('@/pages/TermsOfUsePage.vue') },
      { path: 'setup', component: () => import('@/pages/SetupPage.vue'), meta: { roles: ['admin', 'solutionsSuccess', 'sales'] as Role[] } },
      { path: 'intake', component: () => import('@/pages/IntakePage.vue') },
      // The QR codes SetupPage.vue generates — one per event per rep (Stage
      // 19: booth/session is no longer tied to which QR was scanned, so
      // there's no longer a shared per-channel code; each rep gets their
      // own, e.g. /connect/hignell/<repId>). "connect" echoes the slide's
      // own "Connect With Us" headline rather than a cryptic prefix, and the
      // slug is what lets multiple reps run concurrent conferences without
      // their leads mixing (see 20260915120000_event_slug_and_concurrent_events.sql).
      {
        path: 'connect/:slug/:repId',
        redirect: (to) => ({
          path: '/intake',
          query: { eventSlug: String(to.params.slug ?? ''), repId: String(to.params.repId ?? '') },
        }),
      },
      // Pre-Stage-19 QR codes (/connect/<slug>-booth or -session), kept
      // working so anything already printed still captures leads — just
      // without a specific rep credited, since that concept no longer
      // exists for this URL shape. channel is passed through since the
      // attendee's own channel dropdown didn't exist yet when these were
      // printed either.
      {
        path: 'connect/:slugChannel',
        redirect: (to) => {
          const raw = String(to.params.slugChannel ?? '');
          const match = /^(.+)-(booth|session)$/.exec(raw);
          if (!match) return { path: '/intake' };
          return { path: '/intake', query: { eventSlug: match[1], channel: match[2] } };
        },
      },
      // Pre-slug aliases, kept so any slide already printed/downloaded
      // before this change still works — falls back to whichever event was
      // activated most recently (ambiguous once more than one is active,
      // same as a bare /intake visit).
      { path: 'booth', redirect: { path: '/intake', query: { channel: 'booth' } } },
      { path: 'session', redirect: { path: '/intake', query: { channel: 'session' } } },
      { path: 'review', component: () => import('@/pages/ReviewPage.vue'), meta: { roles: ['admin', 'solutionsSuccess', 'sales'] as Role[] } },
      // Reached from Review's "+ Contacts from note" button rather than the
      // header nav — it's a capture action a rep takes from where they're
      // already working, not a fifth top-level section.
      { path: 'notes', component: () => import('@/pages/NotesPage.vue'), meta: { roles: ['admin', 'solutionsSuccess', 'sales'] as Role[] } },
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
