// The first-time welcome: a three-screen intro, then a spotlight walkthrough of
// the real pages. Everything a new person reads lives here, as plain data, so
// the wording can be reviewed and edited without touching any layout code.
//
// Two rules the tests (onboardingTour.test.mjs) hold this file to:
//  - The words are for a rep at a busy booth, not a developer. No technical
//    vocabulary (BANNED_WORDS below), and every label points at something that
//    is actually on screen under that name.
//  - Every claim is true of the app today. The Review step promises a green
//    "Ready to approve" lead, so the sample lead is checked against the same isReady()
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
  | 'setup-text-in'
  | 'setup-qr'
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
  // The spotlighted element can be tapped. Default is a dimmed, untouchable page;
  // "Try it now" sets this because the step's whole point is to press the
  // button it points at (the overlay used to swallow that tap).
  interactive?: boolean;
  // A way past a section a person may already have done.
  skipTo?: { id: string; label: string };
}

// The chapters are the same four stops the welcome screens promise (Set up your
// event and phone, Collect leads however you like, Edit, approve and follow up,
// Export to Zoho), in the order someone does
// them at a conference. The phone used to be its own chapter and the QR code was
// never shown at all, though it is how most people reach the form.
export const TOUR_STEPS: TourStep[] = [
  {
    id: 'conference',
    kind: 'spotlight',
    route: '/setup',
    target: 'setup-conference',
    chapter: 'Set up your event and phone',
    title: 'Start here',
    body: "Choose the conference you're at. All leads are linked to that event.",
    note: "Your QR code will only work when you're linked to an event.",
    roles: ['sales'],
  },
  {
    // Managers hold no QR code of their own, so they get the same step without
    // the line about it. Same id as the rep's, like the QR steps below.
    id: 'conference',
    kind: 'spotlight',
    route: '/setup',
    target: 'setup-conference',
    chapter: 'Set up your event and phone',
    title: 'Start here',
    body: "Choose the conference you're at. All leads are linked to that event.",
    roles: MANAGERS,
  },
  {
    id: 'phone-text',
    kind: 'illustrated',
    visual: 'sms-setup',
    route: null,
    chapter: 'Set up your event and phone',
    title: 'Link your phone',
    body: "From your phone, text **SETUP** to **{number}**. We'll ask which conference you're at.",
    note: "Reply with the conference name and your phone is linked. If you've already chosen one in the app, we just confirm it. If Setup says Phone number needed, ask your Solutions Success rep to add yours.",
    roles: EVERYONE,
    skipTo: { id: 'qr', label: "I've already done this" },
  },
  {
    id: 'phone-try',
    kind: 'spotlight',
    route: '/setup',
    target: 'setup-text-in',
    chapter: 'Set up your event and phone',
    title: 'Try it now',
    interactive: true,
    body: 'On your phone, tap **Text the code SETUP** here and your message is filled in for you. On a laptop, text SETUP from your phone.',
    roles: EVERYONE,
  },
  {
    id: 'qr',
    kind: 'spotlight',
    route: '/setup',
    target: 'setup-qr',
    chapter: 'Set up your event and phone',
    title: 'Your QR code',
    body: 'People scan this to fill in their details, and it credits the lead to you. It works at any conference, and leads go to the one you chose. Save it as a slide for your booth, or as a code to hold up on your phone.',
    roles: ['sales'],
  },
  {
    // Same id as the rep's step on purpose: "I've already done this" targets 'qr',
    // and stepsForRole only ever keeps one of the two.
    id: 'qr',
    kind: 'spotlight',
    route: '/setup',
    target: 'setup-qr',
    chapter: 'Set up your event and phone',
    title: "Your reps' QR codes",
    body: 'Every Sales rep has a reusable QR code. Download theirs here to send it to them, as a slide or a code for their phone screen.',
    note: 'It only works once they have chosen a conference.',
    roles: MANAGERS,
  },
  {
    id: 'phone-media',
    kind: 'illustrated',
    visual: 'sms-media',
    route: null,
    chapter: 'Collect leads however you like',
    title: 'Send leads by text',
    body: 'Text a photo of a business card, a conference ID or a contact list. If you like, send a voice note about the chat right after. You can also type a short note about one person.',
    roles: EVERYONE,
  },
  {
    id: 'connect',
    kind: 'illustrated',
    visual: 'connect-form',
    route: null,
    chapter: 'Collect leads however you like',
    title: 'What people fill in',
    body: "People reach this form by scanning a QR code or by using the kiosk feature if you set up an iPad at the booth. They add a few details and you're connected.",
    roles: EVERYONE,
  },
  {
    id: 'review-tabs',
    kind: 'spotlight',
    route: '/review',
    target: 'review-tabs',
    chapter: 'Edit, approve and follow up',
    title: 'Your leads live here',
    body: 'Every lead you collect starts under To review, a few minutes after you send it, already checked against existing Zoho contacts and accounts. Add missing info or add a note before approving the new lead.',
    roles: EVERYONE,
  },
  {
    id: 'review-sample',
    kind: 'illustrated',
    visual: 'sample-lead',
    route: null,
    chapter: 'Edit, approve and follow up',
    title: 'Ready to approve',
    body: 'A green **Ready to approve** means a lead has everything we need, so you can approve it in one tap.',
    roles: EVERYONE,
  },
  {
    id: 'review-note',
    kind: 'spotlight',
    route: '/review',
    target: 'review-note-button',
    chapter: 'Edit, approve and follow up',
    title: 'Jotted down a few names?',
    body: "Paste your notes here and we'll turn them into one lead per person.",
    roles: EVERYONE,
  },
  {
    id: 'export',
    kind: 'spotlight',
    route: '/export',
    target: 'export-button',
    chapter: 'Export to Zoho',
    title: 'Export to Zoho',
    body: 'This downloads a file of your approved leads, ready to import into Zoho. A lead with no Zoho account is flagged so you know to create one.',
    note: "After it downloads, confirm it here so those leads aren't in your next file.",
    roles: MANAGERS,
  },
  {
    id: 'admin',
    kind: 'spotlight',
    route: '/review',
    target: 'nav-admin',
    chapter: 'Your team',
    title: 'Look after your team',
    body: 'Activate and end conferences, and manage who is on each event team, from Admin.',
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
    { label: 'Set up your event and phone', icon: 'event_available' },
    { label: 'Collect leads however you like', icon: 'qr_code_2' },
    { label: 'Edit, approve and follow up', icon: 'fact_check' },
    ...(manager ? [{ label: 'Export to Zoho', icon: 'send' }] : []),
  ];
  return [
    {
      id: 'welcome',
      icon: 'waving_hand',
      title: 'Welcome to CKH Connect',
      body: "Easily and quickly capture leads. Then review them already matched against Zoho! Let's take a quick look around. It takes about three minutes.",
    },
    {
      id: 'steps',
      icon: 'route',
      title: manager ? 'Four easy steps' : 'Three easy steps',
      body: manager
        ? 'Full live visibility over events, leads and reps.'
        : 'Intelligent from start to finish so you can focus on the people in front of you.',
      stops,
    },
    {
      id: 'ready',
      icon: 'thumb_up',
      title: 'Ready when you are',
      body: manager
        ? "You can also activate conferences for reps and manage your teams."
        : "You'll learn how to choose your conference, share your unique QR code and follow up on leads.",
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
    SMS_MOCK.setupCaption,
    SMS_MOCK.caption,
    ...TOUR_FALLBACK_COPY,
  );
  return out;
}

export const SAMPLE_LEAD_LABEL = 'Sample. Not a real lead.';

// Shown when a spotlight target can't be found (for example a part of the page
// that is hidden at this screen size), so the step reads as a plain card instead.
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
// twilio-webhook sends when a phone that isn't linked texts SETUP; the test fails
// if that wording changes there.
export const SMS_MOCK = {
  out: 'SETUP',
  reply: "What's the name of the conference? (as much as you remember)",
  // What twilio-webhook sends back for each photo or voice note. Without it the
  // picture was a one-way conversation, and a new rep couldn't tell a text had
  // landed.
  received: 'Got it — 1 item(s) received.',
  voiceLength: '0:14',
  setupCaption: 'Then reply with the conference name and your phone is linked.',
  caption: 'A few minutes later it shows up in Review.',
};

// What to notice on the sample lead. A list under the card rather than arrows
// pointing into it: arrows drift the moment the row's layout changes. The first
// line names what a rep has to supply for a lead to be Ready to approve; Review
// also needs the Zoho match finished and no possible duplicate, which it shows
// on the lead itself.
export const SAMPLE_CALLOUTS = [
  { icon: 'check', text: 'Ready to approve means a phone or email and a school or district.' },
  { icon: 'edit_note', text: "Not ready? The lead says what's missing. Open it to fix it." },
  { icon: 'note_add', text: 'Open any lead to add a note about your chat. It goes to Zoho with the lead.' },
  { icon: 'thumb_up', text: "Approve in one tap. You can also indicate that you've already followed up." },
];

// A made-up lead, only ever drawn by TourSampleLead. It must never be added to
// a real list: Review's "Approve all N" acts on ids, and this one doesn't
// exist. It is written to be Ready on purpose (matched, reachable, has a
// school), because the step explains what Ready to approve looks like.
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
  followedUp: false,
  hasPhoto: false,
  hasCroppedPhoto: false,
  matchAttempts: 0,
  lastMatchAttemptAt: null,
  syncedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
};
