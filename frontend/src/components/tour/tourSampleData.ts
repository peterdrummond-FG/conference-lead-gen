// Made-up people for the animated tour. They are only ever handed to
// components rendered inside a TourDevice; none of them is ever added to a real
// Review list, count or bulk selection ("Approve all N" acts on lead ids, and
// these ids don't exist). Each scene asks for a fresh copy so a loop always
// starts from the same state.
import type { ContactListItem, UnassignedSubmission, UpdateContactPayload } from '@/types/review';

import { TOUR_CONFERENCE } from './tourText.ts';
export { TOUR_CONFERENCE };

// The blank every sample lead starts from (tourSampleData.ts overrides what makes
// each person different). The tour's leads are only ever handed to components
// drawn inside a TourDevice and must never be added to a real list: Review's
// "Approve all N" acts on ids, and these don't exist.
const BASE_LEAD: ContactListItem = {
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

// state is the full name, as the app stores it: the edit panel compares it to
// its own state list, and an abbreviation made it think every lead had unsaved
// changes before the finger touched anything.
function lead(o: Partial<ContactListItem>): ContactListItem {
  return { ...BASE_LEAD, eventName: TOUR_CONFERENCE, interactionNotes: null, state: 'Texas', ...o };
}

// One text in the Messages screen.
export interface TourText {
  id: string;
  from: 'me' | 'them';
  kind: 'text' | 'card' | 'voice' | 'typing';
  text?: string;
  card?: { name: string; title: string; org: string; email: string; phone: string };
}

// What our number really says back, word for word from twilio-webhook. If the
// webhook's wording changes, these change with it (the test checks).
export { SMS_REPLIES, SETUP_CANDIDATES, type TourCandidate } from './tourText.ts';

export const SAMPLE_CARD = {
  name: 'Dana Whitfield',
  title: 'Principal',
  org: 'Oak Ridge Middle School',
  email: 'dwhitfield@oakridgeisd.org',
  phone: '(936) 555-0187',
};

// The attendee who scans the rep's QR code. Their lead is TOUR_PEOPLE.grace below.
export const SAMPLE_LEAD_FORM = {
  firstName: 'Grace',
  lastName: 'Kim',
  email: 'gkim@cedarisd.org',
  title: 'Dean of Students',
  state: 'Texas',
  district: 'Cedar ISD',
};

// What the real page would get back from the server after a save, applied to
// the sample lead instead. Only fields the lead already has are copied.
export function patchLead(
  leads: ContactListItem[],
  id: string,
  payload: UpdateContactPayload | Partial<ContactListItem>,
): ContactListItem[] {
  return leads.map((l) => {
    if (l.id !== id) return l;
    const next = { ...l } as Record<string, unknown>;
    for (const [k, v] of Object.entries(payload)) if (k in next) next[k] = v;
    return next as unknown as ContactListItem;
  });
}

// The people one first-time rep sends over the whole tour, in the order they
// send them, so the tour reads as one story and every scene agrees:
//   Dana   a card photo (and the voice memo right after it)
//   Sam    one person typed out in a text
//   Priya, Tom, Ana   the pasted note (Priya has no phone or email in the note,
//          so she is the real "Needs a phone or email" lead the Check it scene fixes)
//   Grace  the attendee who scanned the QR code
// A brand-new rep has nothing else: Approved and Rejected start at 0.
export type TourPerson = 'dana' | 'sam' | 'priya' | 'tom' | 'ana' | 'grace';

// How the lead looks once the Zoho match has finished.
const MATCHED: Record<TourPerson, ContactListItem> = {
  dana: lead({
    id: 'tour-dana', firstName: 'Dana', lastName: 'Whitfield', title: 'Principal',
    email: 'dwhitfield@oakridgeisd.org', phone: '(936) 555-0187',
    schoolDistrictId: 'tour-oak-ridge', districtName: 'Oak Ridge ISD', schoolId: 'tour-oak-ridge-ms', schoolName: 'Oak Ridge Middle School',
    matchStatus: 'new_contact_existing_account', matchedZohoAccountName: 'Oak Ridge ISD', matchedZohoAccountLevel: 'district',
    source: 'card_photo', interactionNotes: 'Wants to bring her leadership team to the fall workshop.',
    createdAt: '2026-01-01T14:00:00Z',
  }),
  sam: lead({
    id: 'tour-sam', firstName: 'Sam', lastName: 'Ortiz', title: 'Assistant Principal',
    email: 'sortiz@lakeviewisd.org', phone: null,
    schoolDistrictId: 'tour-lakeview', districtName: 'Lakeview ISD', schoolId: 'tour-lakeview-hs', schoolName: 'Lakeview High School',
    matchStatus: 'existing_contact', matchedZohoContactName: 'Sam Ortiz', matchedZohoAccountName: 'Lakeview High School', matchedZohoAccountLevel: 'school',
    source: 'note', createdAt: '2026-01-01T14:06:00Z',
  }),
  priya: lead({
    id: 'tour-priya', firstName: 'Priya', lastName: 'Shah', title: 'Superintendent', email: null, phone: null,
    schoolDistrictId: 'tour-cedar', districtName: 'Cedar ISD',
    matchStatus: 'new_contact_existing_account', matchedZohoAccountName: 'Cedar ISD', matchedZohoAccountLevel: 'district',
    source: 'note', interactionNotes: 'Wants a call about spring PD.', createdAt: '2026-01-01T14:21:00Z',
  }),
  tom: lead({
    id: 'tour-tom', firstName: 'Tom', lastName: 'Reyes', title: 'Counselor', email: 'tom.reyes@pvisd.org', phone: null,
    schoolDistrictId: 'tour-pine-valley', districtName: 'Pine Valley ISD', schoolId: 'tour-pine-valley-hs', schoolName: 'Pine Valley High School',
    matchStatus: 'new_account', source: 'note', createdAt: '2026-01-01T14:21:20Z',
  }),
  ana: lead({
    id: 'tour-ana', firstName: 'Ana', lastName: 'Cruz', title: 'Assistant Principal', email: null, phone: null,
    schoolDistrictId: 'tour-westlake', districtName: 'Westlake ISD', schoolId: 'tour-westlake-ms', schoolName: 'Westlake Middle School',
    matchStatus: 'new_contact_existing_account', matchedZohoAccountName: 'Westlake ISD', matchedZohoAccountLevel: 'district',
    source: 'note', interactionNotes: 'Met at the keynote.', createdAt: '2026-01-01T14:21:40Z',
  }),
  grace: lead({
    id: 'tour-grace', firstName: 'Grace', lastName: 'Kim', title: 'Dean of Students', email: 'gkim@cedarisd.org', phone: null,
    schoolDistrictId: 'tour-cedar', districtName: 'Cedar ISD',
    matchStatus: 'new_contact_existing_account', matchedZohoAccountName: 'Cedar ISD', matchedZohoAccountLevel: 'district',
    source: 'form', qrChannel: null, createdAt: '2026-01-01T15:20:00Z',
  }),
};

const NEWEST_FIRST: TourPerson[] = ['grace', 'ana', 'tom', 'priya', 'sam', 'dana'];

// A lead that has just arrived: matching takes minutes, so for a while it is
// the real "Checking match…" chip and counts under "processing", not Ready. The
// "already checked against Zoho" part belongs to the Review scene, after matching.
function processing(l: ContactListItem): ContactListItem {
  return {
    ...l,
    matchStatus: 'pending',
    matchAttempts: 0,
    matchedZohoAccountName: null,
    matchedZohoAccountLevel: null,
    matchedZohoContactName: null,
  };
}

// Review's "To review" list for a scene: the people who exist at that point in
// the story, newest first. `processing` are the ones whose match hasn't finished.
export function tourLeads(who: TourPerson[], opts: { processing?: TourPerson[] } = {}): ContactListItem[] {
  return NEWEST_FIRST.filter((k) => who.includes(k)).map((k) => (opts.processing?.includes(k) ? processing(MATCHED[k]) : MATCHED[k]));
}

// Everyone, matched: the Review and manager scenes, a while after the leads came in.
export function reviewLeads(): ContactListItem[] {
  return tourLeads(['dana', 'sam', 'priya', 'tom', 'ana', 'grace']);
}

// What Review's amber banner lists for a manager in the tour: scans nobody could
// place under a conference. Made-up people (not the ones in the rep's story).
const HOUR = 3_600_000;
export function tourUnassigned(): UnassignedSubmission[] {
  const base = { title: null, state: null, districtName: null, schoolName: null, eventHintId: null, eventHintName: null };
  return [
    {
      ...base, id: 'tour-unassigned-1', firstName: 'Casey', lastName: 'Morgan', email: 'casey.morgan@example.org', phone: '(555) 010-2233',
      reason: 'rep_no_conference', repId: 'tour-rep-jamie', repName: 'Jamie Cole', createdAt: new Date(Date.now() - 2 * HOUR).toISOString(),
    },
    {
      ...base, id: 'tour-unassigned-2', firstName: 'Riley', lastName: 'Brooks', email: 'riley.brooks@example.org', phone: null,
      reason: 'event_ended', repId: 'tour-rep-chris', repName: 'Chris Park', eventHintName: 'TASSP Fall Leadership Summit',
      createdAt: new Date(Date.now() - 26 * HOUR).toISOString(),
    },
  ];
}
