// The first-time welcome: a three-screen intro, then a spotlight walkthrough of
// the real pages. Everything a new person reads lives here, as plain data, so
// the wording can be reviewed and edited without touching any layout code.
//
// Two rules the tests (onboardingTour.test.mjs) hold this file to:
//  - The words are for a rep at a busy booth, not a developer. No technical
//    vocabulary (BANNED_WORDS below), and every label points at something that
//    is actually on screen under that name.
//  - Every claim is true of the app today. The Review step promises a green
//    "Ready" lead, so the sample lead is checked against the same isReady()
//    rule Review uses. If that rule changes, the test fails and this copy has
//    to be revisited (same lesson as Review's Notes tooltip: a UI promise has
//    to be true in the pipeline behind it).
import type { ContactListItem, Role } from '@/types/review';

const EVERYONE: Role[] = ['admin', 'solutionsSuccess', 'sales'];
// Matches the /export and /admin routes' own meta.roles in router/routes.ts.
const MANAGERS: Role[] = ['admin', 'solutionsSuccess'];

// Where a spotlight can point. Each id is a `data-tour="…"` attribute placed on
// a real element; a step whose target isn't in the page falls back to a plain
// centred card (see TourOverlay) instead of getting stuck.
export type TourTarget =
  | 'setup-conference'
  | 'setup-capture'
  | 'connect-form'
  | 'review-tabs'
  | 'review-sample'
  | 'review-note-button'
  | 'export-button'
  | 'nav-admin'
  | 'tour-replay';

export interface TourStep {
  id: string;
  // Page to be on for this step. Null keeps whatever page the person is on.
  route: string | null;
  target: TourTarget;
  title: string;
  body: string;
  roles: Role[];
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'conference',
    route: '/setup',
    target: 'setup-conference',
    title: 'Start here',
    body: "Pick the conference you're at, so every new lead lands in the right place.",
    roles: EVERYONE,
  },
  {
    id: 'capture',
    route: '/setup',
    target: 'setup-capture',
    title: 'Choose how to meet people',
    body: 'Share a QR code, text in photos of business cards and voice notes, or set up an iPad for people to fill in themselves. Use one or all of them.',
    roles: EVERYONE,
  },
  {
    id: 'connect',
    route: '/connect',
    target: 'connect-form',
    title: 'What people see',
    body: "This is what people see when they scan your code. They add a few details and you're connected.",
    roles: EVERYONE,
  },
  {
    id: 'review-tabs',
    route: '/review',
    target: 'review-tabs',
    title: 'Your leads live here',
    body: "Every lead you collect shows up here. New ones wait under Needs review until you've had a look.",
    roles: EVERYONE,
  },
  {
    id: 'review-sample',
    route: '/review',
    target: 'review-sample',
    title: 'Ready to approve',
    body: "A green Ready means we've found everything we need, so you can approve it in one tap. You can also add a note about your chat, and it goes to Zoho with the lead.",
    roles: EVERYONE,
  },
  {
    id: 'review-note',
    route: '/review',
    target: 'review-note-button',
    title: 'Jotted down a few names?',
    body: "Paste your notes here and we'll turn them into one lead per person.",
    roles: EVERYONE,
  },
  {
    id: 'export',
    route: '/export',
    target: 'export-button',
    title: 'Send to Zoho',
    body: 'When your leads are approved, this sends them on to Zoho.',
    roles: MANAGERS,
  },
  {
    id: 'admin',
    route: '/review',
    target: 'nav-admin',
    title: 'Look after your team',
    body: 'Start and end conferences, and manage your team, from Admin.',
    roles: MANAGERS,
  },
  {
    id: 'replay',
    route: null,
    target: 'tour-replay',
    title: "That's the tour",
    body: 'You can take it again whenever you like, from this button.',
    roles: EVERYONE,
  },
];

export function stepsForRole(role: Role): TourStep[] {
  return TOUR_STEPS.filter((s) => s.roles.includes(role));
}

export interface SplashSlide {
  id: 'welcome' | 'steps' | 'ready';
  icon: string;
  title: string;
  body: string;
  // Only the "four easy steps" slide: the journey as numbered stops.
  stops?: { label: string; icon: string }[];
}

export function splashSlides(role: Role): SplashSlide[] {
  const manager = MANAGERS.includes(role);
  const stops = [
    { label: 'Get set up', icon: 'event_available' },
    { label: 'Collect leads', icon: 'qr_code_2' },
    { label: 'Check and approve', icon: 'fact_check' },
    ...(manager ? [{ label: 'Send to Zoho', icon: 'send' }] : []),
  ];
  return [
    {
      id: 'welcome',
      icon: 'waving_hand',
      title: 'Welcome to CKH Connect',
      body: "Meet people at your conference, and we'll take care of the paperwork. Let's take a quick look around. It takes about two minutes.",
    },
    {
      id: 'steps',
      icon: 'route',
      title: manager ? 'Four easy steps' : 'Three easy steps',
      body: manager
        ? 'From the moment you arrive to the moment leads reach Zoho.'
        : 'Your team sends approved leads on to Zoho, so you can stay with the people in front of you.',
      stops,
    },
    {
      id: 'ready',
      icon: 'thumb_up',
      title: 'Ready when you are',
      body: manager
        ? "You'll do all that, and you can also start conferences, manage your team, and send leads to Zoho."
        : "You'll pick your conference, share your QR code, and approve the leads you meet.",
    },
  ];
}

// Words that mean something to us but nothing to a rep at a booth. The test
// fails if any appears in user-facing text.
export const BANNED_WORDS = [
  'api', 'csv', 'json', 'database', 'sync', 'pipeline', 'ocr', 'token', 'endpoint',
  'webhook', 'flag', 'badge', 'pin', 'session', 'function', 'query',
];

// Every string the tour can show, for the copy check.
export function allTourCopy(): string[] {
  const out: string[] = [];
  for (const role of EVERYONE) {
    for (const s of splashSlides(role)) {
      out.push(s.title, s.body, ...(s.stops?.map((x) => x.label) ?? []));
    }
  }
  for (const s of TOUR_STEPS) out.push(s.title, s.body);
  out.push(SAMPLE_LEAD_LABEL, ...TOUR_FALLBACK_COPY);
  return out;
}

export const SAMPLE_LEAD_LABEL = 'Sample. Not a real lead.';

// Shown when a spotlight target can't be found (for example the person keeps
// Review on its Classic layout), so the step reads as a plain card instead.
export const TOUR_FALLBACK_COPY = ["We couldn't find that part of the page, so here's the idea in words instead."];

// A made-up lead, only ever drawn by TourSampleLead. It must never be added to
// a real list: Review's "Approve N ready" acts on ids, and this one doesn't
// exist. It is written to be Ready on purpose (matched, reachable, has a
// school), because the step explains what Ready looks like.
export const SAMPLE_LEAD: ContactListItem = {
  id: 'tour-sample-lead',
  firstName: 'Jordan',
  lastName: 'Rivera',
  email: 'jordan.rivera@example.org',
  phone: null,
  title: 'Assistant Principal',
  source: 'card_photo',
  qrChannel: null,
  repId: null,
  repName: null,
  eventId: 'tour-sample-event',
  eventName: 'Sample conference',
  state: 'TN',
  schoolDistrictId: 'tour-sample-district',
  districtName: 'Riverside Unified',
  schoolDistrictNameRaw: null,
  schoolId: null,
  schoolName: null,
  schoolNameRaw: null,
  extractionConfidence: null,
  researchConfidence: null,
  personVerified: null,
  matchStatus: 'new_account',
  matchConfidence: null,
  matchedZohoContactId: null,
  matchedZohoContactName: null,
  matchedZohoContactEmail: null,
  matchedZohoContactPhone: null,
  matchedZohoContactTitle: null,
  matchedZohoAccountId: null,
  matchedZohoAccountName: null,
  matchedZohoAccountLevel: null,
  hasActiveOpportunity: null,
  activeOpportunityName: null,
  candidateMatches: null,
  localDuplicateOfContactId: null,
  localDuplicateOfContactName: null,
  localDuplicateOfContactContext: null,
  reviewStatus: 'needs_review',
  notes: null,
  glanceSummary: null,
  interactionNotes: 'Loved the leadership workshop. Wants to hear about a school visit.',
  contactIntent: 'warm',
  followedUp: false,
  hasPhoto: false,
  hasCroppedPhoto: false,
  matchAttempts: 0,
  lastMatchAttemptAt: null,
  syncedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
};
