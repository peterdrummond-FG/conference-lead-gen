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
      // Pre-Stage-20 QR codes — one per event per rep
      // (/connect/<eventSlug>/<repId>), kept working so anything already
      // printed still captures leads. "connect" echoes the slide's own
      // "Connect With Us" headline rather than a cryptic prefix.
      {
        path: 'connect/:slug/:repId',
        redirect: (to) => ({
          path: '/intake',
          query: { eventSlug: String(to.params.slug ?? ''), repId: String(to.params.repId ?? '') },
        }),
      },
      // A bare single-segment token is one of two things. Pre-Stage-19 QR
      // codes (/connect/<slug>-booth or -session) are kept working so
      // anything already printed still captures leads — just without a
      // specific rep credited, since that concept didn't exist for this URL
      // shape. Anything else is a Stage 20 rep's own reusable QR
      // (/connect/<repSlug> — one code for every conference that rep works;
      // see generateConnectSlide.ts and 20260916212541_add_profiles_rep_slug.sql)
      // — the event it belongs to is resolved server-side from that rep's
      // current_event_id at submission time, not from anything in the URL.
      {
        path: 'connect/:slugChannel',
        redirect: (to) => {
          const raw = String(to.params.slugChannel ?? '');
          const channelMatch = /^(.+)-(booth|session)$/.exec(raw);
          if (channelMatch) return { path: '/intake', query: { eventSlug: channelMatch[1], channel: channelMatch[2] } };
          return { path: '/intake', query: { repSlug: raw } };
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
