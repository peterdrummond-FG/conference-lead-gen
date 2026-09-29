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
    flags.push({ key: 'no-contact', label: 'No email or phone', tone: 'red', blocking: true });
  }
  if (!hasOrg(c)) {
    flags.push({ key: 'no-org', label: 'No school or district', tone: 'orange', blocking: true });
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

export function isReady(c: ContactListItem): boolean {
  return c.reviewStatus === 'needs_review' && !leadFlags(c).some((f) => f.blocking);
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

export type SortKey = 'attention' | 'newest' | 'hot' | 'name' | 'followup';

export const SORT_OPTIONS: Record<ReviewStatus, { value: SortKey; label: string }[]> = {
  needs_review: [
    { value: 'attention', label: 'Needs attention first' },
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
  needs_review: 'attention',
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
function needsAttention(c: ContactListItem): boolean {
  return leadFlags(c).some((f) => f.blocking);
}

export function sortLeads(list: ContactListItem[], key: SortKey): ContactListItem[] {
  const out = [...list];
  const newestFirst = (a: ContactListItem, b: ContactListItem) => created(b) - created(a);
  switch (key) {
    case 'attention':
      return out.sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a)) || newestFirst(a, b));
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
