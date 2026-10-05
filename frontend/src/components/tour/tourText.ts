// What the animated tour's phone shows our number saying, word for word from
// supabase/functions/twilio-webhook/index.ts. Pure data (no imports), so a test can
// compare every string to the webhook's source and fail when either side changes.
export const TOUR_CONFERENCE = 'TASSP Summer Conference';

// A candidate in the "Here's what I found" list: an already-active conference
// (picking it just links the phone) or one Zoho has but nobody has activated yet
// (picking it activates it first). Same two shapes twilio-webhook builds.
export interface TourCandidate { kind: 'event' | 'campaign'; name: string; state: string | null }

export const SMS_REPLIES = {
  askName: "What's the name of the conference? (as much as you remember)",
  // The list line and the wrapper, built with the webhook's own templates.
  candidateLine: (c: TourCandidate, i: number) =>
    c.kind === 'event'
      ? `${i + 1}. ${c.name} (${c.state}) — already active, I'll just link your phone`
      : `${i + 1}. ${c.name}${c.state ? ` (${c.state})` : ''} — not active yet, I'll set it up when you pick it`,
  candidates: (list: TourCandidate[]) =>
    `Here's what I found — reply with the number:\n${list.map((c, i) => SMS_REPLIES.candidateLine(c, i)).join('\n')}\n(If none of these are right, try texting the name again with more detail.)`,
  // Picking an already-active conference.
  linked: (conference: string) =>
    `You're linked to ${conference}. Text photo(s) of business cards, conference tags, etc. (and an optional voice memo right after) whenever you're ready.`,
  alreadySetUp: (conference: string) =>
    `You're already set up for ${conference}. Text photo(s) of business cards, conference tags, etc. (and an optional voice memo right after) whenever you're ready. Not the right conference? Reply CHANGE.`,
  received: (n: number) => `Got it — ${n} item(s) received.`,
  noteLogged: "Got it — that contact's logged and will show up in Review in a few minutes.",
};

// What a brand-new rep types and is shown while setting up from scratch.
export const SETUP_CANDIDATES: TourCandidate[] = [
  { kind: 'event', name: TOUR_CONFERENCE, state: 'TX' },
  { kind: 'campaign', name: 'TASSP Fall Leadership Summit', state: 'TX' },
];
