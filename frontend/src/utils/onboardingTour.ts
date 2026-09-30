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

// A step is one of two kinds, and the difference is the whole reliability story:
//
//  - 'spotlight' points at a real element that is ALWAYS on its page and stays
//    put (a nav tab, a header button, a Setup card). The first version pointed
//    at things that depended on app state instead: the Connect step at a form
//    that only renders once a conference is joined (a new user sees "Join a
//    conference first" and the tour highlighted a blank box), and the sample
//    lead injected into Review's list (which pushed the list down and left the
//    highlight behind). A spotlight target must exist for a brand-new account.
//  - 'illustrated' draws its own picture, so it can't depend on the page behind
//    it or on any data. Everything that needs a mock-up is one of these.
export type StepKind = 'spotlight' | 'illustrated';

// Where a spotlight can point. Each id is a `data-tour="…"` attribute placed on
// a real element; a step whose target isn't in the page falls back to a plain
// centred card (see TourSpotlight) instead of getting stuck.
export type TourTarget =
  | 'setup-conference'
  | 'setup-capture-head'
  | 'setup-text-in'
  | 'review-tabs'
  | 'review-note-button'
  | 'export-button'
  | 'nav-admin'
  | 'tour-replay';

// Which picture an illustrated step draws (components/onboarding/mocks).
export type TourVisual = 'connect-form' | 'sms-setup' | 'sms-media' | 'sample-lead';

export interface TourStep {
  id: string;
  kind: StepKind;
  // Page to be on for this step. Null keeps whatever page the person is on
  // (always the case for illustrated steps: they don't need one).
  route: string | null;
  target?: TourTarget;
  visual?: TourVisual;
  // Small label in the card, so a longer tour still reads as a few chapters.
  chapter: string;
  title: string;
  // `**word**` renders bold and `{number}` becomes the text-in number (filled
  // in by TourCard from utils/smsNumber.ts, which Setup uses too, so the two
  // can't disagree). Nothing else is markup.
  body: string;
  // One quieter line under the body, for the "what if" that not everyone needs.
  note?: string;
  roles: Role[];
  // A way past a section a person may already have done.
  skipTo?: { id: string; label: string };
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'conference',
    kind: 'spotlight',
    route: '/setup',
    target: 'setup-conference',
    chapter: 'Get set up',
    title: 'Start here',
    body: "Pick the conference you're at, so every new lead lands in the right place.",
    roles: EVERYONE,
  },
  {
    id: 'capture',
    kind: 'spotlight',
    route: '/setup',
    target: 'setup-capture-head',
    chapter: 'Collect leads',
    title: 'Choose how to meet people',
    body: 'There are three ways: share a QR code, text in photos and voice notes from your phone, or set up an iPad for people to fill in themselves. Use one or all of them.',
    roles: EVERYONE,
  },
  {
    id: 'phone-text',
    kind: 'illustrated',
    visual: 'sms-setup',
    route: null,
    chapter: 'Set up your phone',
    title: 'Text SETUP to our number',
    body: 'From your phone, text **SETUP** to **{number}**. That links your phone to your conference.',
    note: "Haven't joined one in the app yet? We'll ask which one, and you just reply with its name. If Setup says Phone number needed, ask your admin to add yours.",
    roles: EVERYONE,
    skipTo: { id: 'connect', label: "I've already done this" },
  },
  {
    id: 'phone-media',
    kind: 'illustrated',
    visual: 'sms-media',
    route: null,
    chapter: 'Set up your phone',
    title: 'Then send a photo',
    body: 'Text a photo of a business card, or a few cards laid out together. If you like, send a voice note about the chat right after.',
    roles: EVERYONE,
  },
  {
    id: 'phone-try',
    kind: 'spotlight',
    route: '/setup',
    target: 'setup-text-in',
    chapter: 'Set up your phone',
    title: 'Try it now',
    body: 'On your phone, tap **Text the code SETUP** here and your message is filled in for you. On a laptop, text SETUP from your phone.',
    roles: EVERYONE,
  },
  {
    id: 'connect',
    kind: 'illustrated',
    visual: 'connect-form',
    route: null,
    chapter: 'Collect leads',
    title: 'What people see',
    body: "This is what people see when they scan your code. They add a few details and you're connected.",
    roles: EVERYONE,
  },
  {
    id: 'review-tabs',
    kind: 'spotlight',
    route: '/review',
    target: 'review-tabs',
    chapter: 'Review',
    title: 'Your leads live here',
    body: "Every lead you collect shows up here. New ones wait under Needs review until you've had a look.",
    roles: EVERYONE,
  },
  {
    id: 'review-sample',
    kind: 'illustrated',
    visual: 'sample-lead',
    route: null,
    chapter: 'Review',
    title: 'Ready to approve',
    body: "A green Ready means we've found everything we need, so you can approve it in one tap. You can also add a note about your chat, and it goes to Zoho with the lead.",
    roles: EVERYONE,
  },
  {
    id: 'review-note',
    kind: 'spotlight',
    route: '/review',
    target: 'review-note-button',
    chapter: 'Review',
    title: 'Jotted down a few names?',
    body: "Paste your notes here and we'll turn them into one lead per person.",
    roles: EVERYONE,
  },
  {
    id: 'export',
    kind: 'spotlight',
    route: '/export',
    target: 'export-button',
    chapter: 'Send to Zoho',
    title: 'Send to Zoho',
    body: 'When your leads are approved, this sends them on to Zoho.',
    roles: MANAGERS,
  },
  {
    id: 'admin',
    kind: 'spotlight',
    route: '/review',
    target: 'nav-admin',
    chapter: 'Your team',
    title: 'Look after your team',
    body: 'Start and end conferences, and manage your team, from Admin.',
    roles: MANAGERS,
  },
  {
    id: 'replay',
    kind: 'spotlight',
    route: null,
    target: 'tour-replay',
    chapter: 'All done',
    title: "That's the tour",
    body: 'You can take it again whenever you like, from this button.',
    roles: EVERYONE,
  },
];

// What the layout should do about the tour right now. Pulled out of the
// component so the cases are testable, because one of them was wrong: a 401
// signs the person out (boot/axios.ts) but used to leave the tour "in
// progress" in memory, so the next person to sign in on that tab resumed the
// previous person's tour, in the previous person's role. No user means no tour.
//  - 'reset': drop any tour in progress, without counting it as seen
//  - 'begin': resume a refreshed tab, or start it for someone who hasn't seen it
//  - 'none':  leave it alone
export type TourStartAction = 'reset' | 'begin' | 'none';
export function tourStartAction(o: {
  hasUser: boolean;
  kioskLocked: boolean;
  viewingAs: boolean;
  phase: 'idle' | 'splash' | 'tour';
}): TourStartAction {
  if (o.kioskLocked || !o.hasUser) return o.phase !== 'idle' ? 'reset' : 'none';
  if (o.viewingAs || o.phase !== 'idle') return 'none';
  return 'begin';
}

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
      body: "Meet people at your conference, and we'll take care of the paperwork. Let's take a quick look around. It takes about three minutes.",
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
  for (const s of TOUR_STEPS) out.push(s.chapter, s.title, s.body, ...(s.note ? [s.note] : []), ...(s.skipTo ? [s.skipTo.label] : []));
  out.push(
    SAMPLE_LEAD_LABEL,
    ...SAMPLE_CALLOUTS.map((c) => c.text),
    CONNECT_MOCK.subtitle,
    CONNECT_MOCK.hint,
    SMS_MOCK.caption,
    ...TOUR_FALLBACK_COPY,
  );
  return out;
}

export const SAMPLE_LEAD_LABEL = 'Sample. Not a real lead.';

// Shown when a spotlight target can't be found (for example the person keeps
// Review on its Classic layout), so the step reads as a plain card instead.
export const TOUR_FALLBACK_COPY = ["We couldn't find that part of the page, so here's the idea in words instead."];

// What the attendee form looks like, for the illustrated Connect step. The real
// form only renders once a conference is joined, so a new person would see a
// blank box instead. These are the labels IntakePage.vue really shows; the test
// fails if any of them drifts from that file.
export const CONNECT_MOCK = {
  title: 'Sample conference',
  subtitle: 'Tell us a bit about yourself.',
  fields: ['First name *', 'Last name *', 'Email', 'Phone'],
  hint: 'Add your email and phone number',
  optional: 'Optional',
  optionalFields: ['State', 'School district'],
  submit: 'Submit',
};

// The text conversation, for the "Set up your phone" steps. The reply is what
// twilio-webhook sends a rep who is already linked to a conference when they
// text SETUP; the test fails if that wording changes there.
export const SMS_MOCK = {
  out: 'SETUP',
  conference: 'Sample conference',
  replyPrefix: "You're already set up for ",
  replyRest: ". Text photo(s) of business cards, conference tags, etc. (and an optional voice memo right after) whenever you're ready. Not the right conference? Reply CHANGE.",
  voiceLength: '0:14',
  caption: 'A few minutes later it shows up in Review.',
};

// What to notice on the sample lead. A list under the card rather than arrows
// pointing into it: arrows drift the moment the row's layout changes.
export const SAMPLE_CALLOUTS = [
  { icon: 'check', text: "Ready means we've found everything we need." },
  { icon: 'note_add', text: 'Add note saves a dated note, and it goes to Zoho with the lead.' },
  { icon: 'thumb_up', text: 'Approve when you are happy with it. One tap.' },
];

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
