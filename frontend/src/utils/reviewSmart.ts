// Pure list logic for Review's "Smart" view — readiness flags, the plain-language
// account badge, sorting, search and past-event grouping. Kept free of Vue and
// Quasar so it can be exercised directly (see reviewSmart.test.mjs).
//
// Deliberately NOT shared with ReviewContactCard.vue: the Classic view stays as
// it was, and its own copies of these rules keep working untouched.
import type { ContactListItem } from '@/types/review';

export type ReviewStatus = 'needs_review' | 'approved' | 'rejected';
export const REVIEW_STATUSES: ReviewStatus[] = ['needs_review', 'approved', 'rejected'];

export type Tone = 'red' | 'orange' | 'blue' | 'green' | 'grey';

// Mirrors MatchingRetryScanner's MaxAutoAttempts — past this the background
// sweep has given up and only a manual "Retry match" moves the contact on.
export const MAX_AUTO_MATCH_ATTEMPTS = 3;

export interface LeadFlag {
  key: 'stuck' | 'matching' | 'duplicate' | 'no-contact' | 'no-org' | 'unclear';
  label: string;
  tone: Tone;
  // A blocking flag keeps the lead out of one-tap approve and "Approve N
  // ready". Non-blocking flags are information only.
  blocking: boolean;
}

export function hasOrg(c: ContactListItem): boolean {
  return Boolean(
    c.schoolDistrictId || c.schoolId || c.districtName || c.schoolDistrictNameRaw || c.schoolName || c.schoolNameRaw,
  );
}

// Why a lead needs a human look, in the order a rep should fix them. An
// empty list means Ready. Each blocking rule maps to something that has
// already gone wrong for real: a still-pending match can't be approved at all
// (contacts-patch rejects it), a duplicate needs a decision, and a lead with no
// way to reach the person or no organisation is not worth exporting as-is.
export function leadFlags(c: ContactListItem): LeadFlag[] {
  const flags: LeadFlag[] = [];
  if (c.matchStatus === 'pending') {
    flags.push(
      c.matchAttempts >= MAX_AUTO_MATCH_ATTEMPTS
        ? { key: 'stuck', label: 'Match stuck', tone: 'red', blocking: true }
        : { key: 'matching', label: 'Checking match…', tone: 'grey', blocking: true },
    );
  }
  if (c.localDuplicateOfContactName) {
    flags.push({ key: 'duplicate', label: 'Possible duplicate', tone: 'orange', blocking: true });
  }
  if (!c.email && !c.phone) {
    flags.push({ key: 'no-contact', label: 'Needs a phone or email', tone: 'red', blocking: true });
  }
  if (!hasOrg(c)) {
    flags.push({ key: 'no-org', label: 'Needs a school or district', tone: 'orange', blocking: true });
  }
  // Ambiguous is approvable today (it exports as a new lead), so it informs
  // rather than blocks. It only earns a flag when there is something to pick:
  // with no candidates there is nothing for the rep to do, so a pill would
  // just be noise (the editor still explains it in words).
  if (c.matchStatus === 'ambiguous' && c.candidateMatches?.length) {
    flags.push({ key: 'unclear', label: 'Pick a Zoho match', tone: 'blue', blocking: false });
  }
  return flags;
}

// Still in the automatic pipeline (research, then the Zoho match), as opposed
// to stuck: a stuck lead has been given up on and will not finish by itself, so
// "it'll be done in a few minutes" would be a lie. Approve is impossible while
// processing (contacts-patch and bulk-approve both refuse a pending match), and
// Reject is hidden too so a half-processed lead can't be discarded by a stray
// tap before the rep has seen what the pipeline found.
export function isProcessing(c: ContactListItem): boolean {
  return c.reviewStatus === 'needs_review' && c.matchStatus === 'pending' && c.matchAttempts < MAX_AUTO_MATCH_ATTEMPTS;
}

export function isReady(c: ContactListItem): boolean {
  return c.reviewStatus === 'needs_review' && !leadFlags(c).some((f) => f.blocking);
}

// The one name for "nothing left for you to do but approve". "Ready" alone never
// said what it was ready for, so every chip, count and button uses this wording.
export const READY_LABEL = 'Ready to approve';

// What a lead that can't be approved yet asks of the rep, as the short call to
// action shown on its phone card (the card opens the lead where the fix is). Null
// for a lead that is ready or still processing: those have a ✓ / ✕ or a bar.
// Order follows leadFlags, so the first thing to fix is the one named.
export function leadCue(c: ContactListItem): string | null {
  if (c.reviewStatus !== 'needs_review' || isProcessing(c)) return null;
  const first = leadFlags(c).find((f) => f.blocking);
  switch (first?.key) {
    case 'stuck': return 'Open to retry';
    case 'duplicate': return 'Resolve duplicate';
    case 'no-contact':
    case 'no-org': return 'Add missing info';
    default: return null;
  }
}

// Which of the three summary pills a lead falls under. Each lead is in exactly
// one, decided by the same rules as its chip and button, so a pill's count and
// the list it filters to can never disagree with the cards.
export type LeadBucket = 'ready' | 'needsInfo' | 'processing';
export function leadBucket(c: ContactListItem): LeadBucket | null {
  if (c.reviewStatus !== 'needs_review') return null;
  if (isProcessing(c)) return 'processing';
  return isReady(c) ? 'ready' : 'needsInfo';
}

// The counts under "2 ready to approve · 1 needs info · 1 processing".
export function summaryCounts(list: ContactListItem[]): { ready: number; needsInfo: number; processing: number } {
  const n = { ready: 0, needsInfo: 0, processing: 0 };
  for (const c of list) {
    const b = leadBucket(c);
    if (b) n[b] += 1;
  }
  return n;
}

// Why "ready to approve" means what it means, one line per condition of
// isReady. The open lead shows these: four ticks when it is ready, and a cross
// with the fix where it isn't. Derived from the same fields as leadFlags; the
// test holds the two together (all ticks <=> ready).
export interface ReadinessItem {
  key: 'contact' | 'org' | 'match' | 'duplicate';
  label: string;
  state: 'ok' | 'todo' | 'wait';
  // What to do, only when state isn't ok.
  fix?: string;
}
export function readinessChecklist(c: ContactListItem): ReadinessItem[] {
  const matchWait = c.matchStatus === 'pending';
  const stuck = matchWait && c.matchAttempts >= MAX_AUTO_MATCH_ATTEMPTS;
  return [
    c.email || c.phone
      ? { key: 'contact', label: 'Phone or email on file', state: 'ok' }
      : { key: 'contact', label: 'Phone or email', state: 'todo', fix: "Add one below, or reject if you can't reach them." },
    hasOrg(c)
      ? { key: 'org', label: 'School or district filled in', state: 'ok' }
      : { key: 'org', label: 'School or district', state: 'todo', fix: 'Pick one below.' },
    !matchWait
      ? { key: 'match', label: 'Checked against Zoho', state: 'ok' }
      : stuck
        ? { key: 'match', label: 'Checked against Zoho', state: 'todo', fix: `The automatic match gave up after ${c.matchAttempts} tries.` }
        : { key: 'match', label: 'Checked against Zoho', state: 'wait', fix: 'Still processing.' },
    c.localDuplicateOfContactName
      ? { key: 'duplicate', label: 'Not a duplicate', state: 'todo', fix: `Possible duplicate of ${c.localDuplicateOfContactName}.` }
      : { key: 'duplicate', label: 'Not a duplicate', state: 'ok' },
  ];
}

export function readyIds(list: ContactListItem[]): string[] {
  return list.filter(isReady).map((c) => c.id);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

// What a rep needs to know about the account: is this school / district
// already in Zoho or new. Everything else the match produced (score,
// reasoning, raw ids) is admin detail. Null while pending — the "Checking
// match…" flag already says so.
export function accountBadge(c: ContactListItem): { label: string; tone: Tone } | null {
  const hasSchool = Boolean(c.schoolName || c.schoolNameRaw);
  switch (c.matchStatus) {
    case 'pending':
      return null;
    case 'existing_contact':
    case 'new_contact_existing_account': {
      // matchedZohoAccountLevel is null on rows matched before that field
      // existed — fall back to the contact's own school/district fields.
      const level = c.matchedZohoAccountLevel ?? (hasSchool ? 'school' : 'district');
      const base = `Existing ${level}`;
      return { label: c.matchStatus === 'existing_contact' ? `${base} · contact on file` : base, tone: 'green' };
    }
    case 'new_account':
      // With no school or district at all there is nothing to call "new";
      // the No-school-or-district flag already says what's wrong.
      if (!hasOrg(c)) return null;
      return { label: hasSchool ? 'New school' : 'New district', tone: 'blue' };
    case 'ambiguous':
      // Same rule as the flag: no candidates, nothing to pick, no pill.
      return c.candidateMatches?.length ? { label: 'Pick a Zoho match', tone: 'orange' } : null;
    default:
      return { label: capitalize(c.matchStatus), tone: 'grey' };
  }
}

// The wording Admin and Solutions Success already know from Classic.
export function accountDetailLabel(c: ContactListItem): string {
  const hasSchool = Boolean(c.schoolName || c.schoolNameRaw);
  switch (c.matchStatus) {
    case 'pending':
      return 'Account: Matching…';
    case 'existing_contact':
      return 'Account: Existing contact';
    case 'new_contact_existing_account':
      return (c.matchedZohoAccountLevel ?? (hasSchool ? 'school' : 'district')) === 'school'
        ? 'Account: New contact, existing school'
        : 'Account: New contact, existing district';
    case 'new_account':
      return hasSchool ? 'Account: New school' : 'Account: New district';
    case 'ambiguous':
      return 'Account: Needs review';
    default:
      return `Account: ${capitalize(c.matchStatus)}`;
  }
}

export function intentTone(intent: ContactListItem['contactIntent']): Tone {
  if (intent === 'hot') return 'red';
  if (intent === 'warm') return 'orange';
  if (intent === 'cold') return 'blue';
  return 'grey';
}

export function fullName(c: ContactListItem): string {
  return `${c.firstName} ${c.lastName}`.trim() || '(no name)';
}

// Empty when there is no organisation — the row hides the line and shows the
// "No school or district" flag instead of saying it twice.
export function orgLine(c: ContactListItem): string {
  const district = c.districtName || c.schoolDistrictNameRaw;
  const school = c.schoolName || c.schoolNameRaw;
  if (district && school) return `${district} · ${school}`;
  return district || school || '';
}

// ── Sorting ──────────────────────────────────────────────────────────────

export type SortKey = 'newest' | 'hot' | 'name' | 'followup';

export const SORT_OPTIONS: Record<ReviewStatus, { value: SortKey; label: string }[]> = {
  needs_review: [
    { value: 'newest', label: 'Newest first' },
    { value: 'hot', label: 'Hot first' },
    { value: 'name', label: 'Name A–Z' },
  ],
  approved: [
    { value: 'followup', label: 'Follow up first' },
    { value: 'newest', label: 'Newest first' },
    { value: 'hot', label: 'Hot first' },
    { value: 'name', label: 'Name A–Z' },
  ],
  rejected: [
    { value: 'newest', label: 'Newest first' },
    { value: 'name', label: 'Name A–Z' },
  ],
};

export const DEFAULT_SORT: Record<ReviewStatus, SortKey> = {
  needs_review: 'newest',
  approved: 'followup',
  rejected: 'newest',
};

const INTENT_RANK: Record<string, number> = { hot: 0, warm: 1, cold: 2 };
function intentRank(c: ContactListItem): number {
  return c.contactIntent ? (INTENT_RANK[c.contactIntent] ?? 3) : 3;
}
function created(c: ContactListItem): number {
  const t = Date.parse(c.createdAt);
  return Number.isNaN(t) ? 0 : t;
}
export function sortLeads(list: ContactListItem[], key: SortKey): ContactListItem[] {
  const out = [...list];
  const newestFirst = (a: ContactListItem, b: ContactListItem) => created(b) - created(a);
  switch (key) {
    case 'hot':
      return out.sort((a, b) => intentRank(a) - intentRank(b) || newestFirst(a, b));
    case 'followup':
      // Who still needs a call, hottest first. Already-followed-up sink.
      return out.sort(
        (a, b) => Number(a.followedUp) - Number(b.followedUp) || intentRank(a) - intentRank(b) || newestFirst(a, b),
      );
    case 'name':
      return out.sort(
        (a, b) => a.lastName.localeCompare(b.lastName, undefined, { sensitivity: 'base' })
          || a.firstName.localeCompare(b.firstName, undefined, { sensitivity: 'base' }),
      );
    default:
      return out.sort(newestFirst);
  }
}

// ── Frozen order ─────────────────────────────────────────────────────────
//
// To review defaults to plain arrival order (newest first), which an edit can't
// change. It used to sort "Needs attention first" on the readiness flags: on
// 2026-10-01 a rep added a district to the newest lead, it flipped to Ready and
// dropped from row 1 to row 41, and they reloaded twice without finding it.
// "Hot first" and "Follow up first" still read fields an edit changes (tap Hot
// and the row would move under the finger), so the page sorts once (on load, or
// when the rep picks a sort) and keeps that order until the next deliberate
// re-sort.
//
// Keyed by status AND id: a lead that moves tab (approve, then Undo) is only
// ranked against the leads it was sorted with, so Undo drops it back in place.

export type SortChoice = Record<ReviewStatus, SortKey>;
export type LeadRank = Map<string, number>;

const rankKey = (status: ReviewStatus, id: string) => `${status}:${id}`;

export function buildRank(buckets: Record<ReviewStatus, ContactListItem[]>, sorts: SortChoice): LeadRank {
  const rank: LeadRank = new Map();
  for (const status of REVIEW_STATUSES) {
    sortLeads(buckets[status], sorts[status]).forEach((c, i) => rank.set(rankKey(status, c.id), i));
  }
  return rank;
}

// Leads the rank has not seen (a new arrival, a lead just approved into this
// tab) go first, newest first: that is where a rep looks for what just
// happened. The next full re-sort files them properly.
export function orderByRank(list: ContactListItem[], status: ReviewStatus, rank: LeadRank): ContactListItem[] {
  const ranked: { c: ContactListItem; r: number }[] = [];
  const unseen: ContactListItem[] = [];
  for (const c of list) {
    const r = rank.get(rankKey(status, c.id));
    if (r === undefined) unseen.push(c);
    else ranked.push({ c, r });
  }
  ranked.sort((a, b) => a.r - b.r);
  return [...sortLeads(unseen, 'newest'), ...ranked.map((x) => x.c)];
}

// ── Search ───────────────────────────────────────────────────────────────

function digits(s: string): string {
  return s.replace(/\D/g, '');
}

// Plain substring match over what a rep would type to find someone: name,
// email, phone, school / district, title and event. Phone is compared on
// digits only so "(615) 555" finds "615-555-0100". Never a regex or ILIKE —
// what's typed is data, not a pattern.
export function searchLeads(list: ContactListItem[], query: string): ContactListItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  const qDigits = digits(q);
  return list.filter((c) => {
    const haystack = [
      c.firstName, c.lastName, `${c.firstName} ${c.lastName}`, c.email, c.title, c.districtName,
      c.schoolDistrictNameRaw, c.schoolName, c.schoolNameRaw, c.eventName, c.repName, c.interactionNotes,
    ].filter(Boolean).join(' ').toLowerCase();
    if (haystack.includes(q)) return true;
    return qDigits.length >= 3 && digits(c.phone ?? '').includes(qDigits);
  });
}

// ── Past-event grouping ──────────────────────────────────────────────────

// The list carries no event date, so "newest event" is the event whose most
// recent lead is newest. Computed over EVERY status the rep has loaded, not
// just the visible tab, so the section order doesn't reshuffle when they
// switch between Needs Review / Approved / Rejected.
export function eventRecency(all: ContactListItem[]): Map<string, number> {
  const recency = new Map<string, number>();
  for (const c of all) {
    recency.set(c.eventId, Math.max(recency.get(c.eventId) ?? 0, created(c)));
  }
  return recency;
}

export interface EventGroup {
  eventId: string;
  eventName: string;
  leads: ContactListItem[];
}

export function groupByEvent(list: ContactListItem[], recency: Map<string, number>): EventGroup[] {
  const groups = new Map<string, EventGroup>();
  for (const c of list) {
    let g = groups.get(c.eventId);
    if (!g) {
      g = { eventId: c.eventId, eventName: c.eventName, leads: [] };
      groups.set(c.eventId, g);
    }
    g.leads.push(c);
  }
  return [...groups.values()].sort((a, b) => (recency.get(b.eventId) ?? 0) - (recency.get(a.eventId) ?? 0));
}

// ── Notes ────────────────────────────────────────────────────────────────

export const MAX_NEW_NOTE_LENGTH = 1000;

// Adds one dated line to the end of a lead's notes, keeping whatever is there
// (typed text and transcribed voice memos share this one field). The date is
// the rep's own local day: "Sep 29: Left a voicemail".
export function appendNote(existing: string | null | undefined, text: string, when: Date = new Date()): string {
  const line = `${when.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}: ${text.trim()}`;
  const base = (existing ?? '').trimEnd();
  return base ? `${base}\n${line}` : line;
}
