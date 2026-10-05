// Made-up people for the animated tour. They are only ever handed to
// components rendered inside a TourDevice; none of them is ever added to a real
// Review list, count or bulk selection ("Approve all N" acts on lead ids, and
// these ids don't exist). Each scene asks for a fresh copy so a loop always
// starts from the same state.
import type { ContactListItem, UpdateContactPayload } from '@/types/review';
import { SAMPLE_LEAD } from '@/utils/onboardingTour';

export const TOUR_CONFERENCE = 'TASSP Summer Conference';

// state is the full name, as the app stores it: the edit panel compares it to
// its own state list, and an abbreviation made it think every lead had unsaved
// changes before the finger touched anything.
function lead(o: Partial<ContactListItem>): ContactListItem {
  return { ...SAMPLE_LEAD, eventName: TOUR_CONFERENCE, interactionNotes: null, state: 'Texas', ...o };
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
export const SMS_REPLIES = {
  alreadySetUp: (conference: string) =>
    `You're already set up for ${conference}. Text photo(s) of business cards, conference tags, etc. (and an optional voice memo right after) whenever you're ready. Not the right conference? Reply CHANGE.`,
  received: (n: number) => `Got it — ${n} item(s) received.`,
  noteLogged: "Got it — that contact's logged and will show up in Review in a few minutes.",
};

export const SAMPLE_CARD = {
  name: 'Dana Whitfield',
  title: 'Principal',
  org: 'Oak Ridge Middle School',
  email: 'dwhitfield@oakridgeisd.org',
  phone: '(936) 555-0187',
};

// The attendee who scans the rep's QR code, and the lead it makes.
export const SAMPLE_LEAD_FORM = {
  firstName: 'Grace',
  lastName: 'Kim',
  email: 'gkim@cedarisd.org',
  title: 'Dean of Students',
  get lead(): ContactListItem {
    return lead({
      id: 'tour-grace',
      firstName: 'Grace',
      lastName: 'Kim',
      title: 'Dean of Students',
      email: 'gkim@cedarisd.org',
      phone: null,
      schoolDistrictId: 'tour-cedar',
      districtName: 'Cedar ISD',
      matchStatus: 'new_account',
      source: 'form',
      qrChannel: null,
      createdAt: '2026-01-01T15:20:00Z',
    });
  },
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

// Review's "To review" list for the Check it, then approve it scene. Maria is
// the one the finger works on: she arrives missing a phone and email, so she
// shows the real "Needs a phone or email" chip, and adding her email is what
// turns her Ready. The other two are already Ready, so the list looks like a
// real morning after a conference.
export function reviewLeads(): ContactListItem[] {
  return [
    lead({
      id: 'tour-maria',
      firstName: 'Maria',
      lastName: 'Lopez',
      title: 'Curriculum Director',
      email: null,
      phone: null,
      state: 'Texas',
      schoolDistrictId: 'tour-elm-grove',
      districtName: 'Elm Grove ISD',
      matchStatus: 'new_contact_existing_account',
      matchedZohoAccountName: 'Elm Grove ISD',
      matchedZohoAccountLevel: 'district',
      source: 'card_photo',
      createdAt: '2026-01-01T15:10:00Z',
    }),
    lead({
      id: 'tour-sam',
      firstName: 'Sam',
      lastName: 'Ortiz',
      title: 'Assistant Principal',
      email: 'sortiz@lakeviewisd.org',
      phone: '(512) 555-0142',
      state: 'Texas',
      schoolDistrictId: 'tour-lakeview',
      districtName: 'Lakeview ISD',
      schoolId: 'tour-lakeview-hs',
      schoolName: 'Lakeview High School',
      matchStatus: 'existing_contact',
      matchedZohoContactName: 'Sam Ortiz',
      matchedZohoAccountName: 'Lakeview High School',
      matchedZohoAccountLevel: 'school',
      source: 'voice_memo',
      createdAt: '2026-01-01T14:55:00Z',
    }),
    lead({
      id: 'tour-jordan',
      source: 'form',
      qrChannel: 'booth',
      createdAt: '2026-01-01T14:40:00Z',
    }),
  ];
}
