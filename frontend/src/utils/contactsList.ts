// Pure list logic for the Contacts page — readiness flags, the plain-language
// account badge, sorting, search and past-event grouping. Kept free of Vue and
// Quasar so it can be exercised directly (see contactsList.test.mjs).
//
// (There used to be a second, "Classic" Contacts view with its own copies of these
// rules; it was retired, so this is the only place they live.)
import type { ContactListItem } from '@/types/review';

// These keep their "review" names on purpose: they are the database's own words
// (contacts.review_status, the 'needs_review' value, contacts-* function params).
// The page was renamed Review -> Contacts on 2026-10-06; renaming the stored status
// would be a migration and a redeploy of every function for no change a person sees.
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
  // A blocking flag keeps the lead out of one-tap confirm and "Confirm N
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
// already gone wrong for real: a still-pending match can't be confirmed at all
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
// "it'll be done in a few minutes" would be a lie. Confirm is impossible while
// processing (contacts-patch and bulk-approve both refuse a pending match), and
// Reject is hidden too so a half-processed lead can't be discarded by a stray
// tap before the rep has seen what the pipeline found.
export function isProcessing(c: ContactListItem): boolean {
  return c.reviewStatus === 'needs_review' && c.matchStatus === 'pending' && c.matchAttempts < MAX_AUTO_MATCH_ATTEMPTS;
}

export function isReady(c: ContactListItem): boolean {
  return c.reviewStatus === 'needs_review' && !leadFlags(c).some((f) => f.blocking);
}

// The one name for "nothing left for you to do but confirm". (The stored status is
// still 'approved' and the API names still say approve: only the words people read
// changed, 2026-10-06.) "Ready" alone never
// said what it was ready for, so every chip, count and button uses this wording.
export const READY_LABEL = 'Ready to confirm';

// What a lead that can't be confirmed yet asks of the rep, as the short call to
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

// Which status a lead is in, one answer per lead, decided by the same rules as its
// chip and button so a count and the list it filters to can never disagree with the
// cards. The first three are the unconfirmed leads (the old "To review" tab);
// 'confirmed' and 'rejected' are the stored statuses 'approved' and 'rejected'.
export type LeadBucket = 'ready' | 'needsInfo' | 'processing';
export function leadBucket(c: ContactListItem): LeadBucket | null {
  if (c.reviewStatus !== 'needs_review') return null;
  if (isProcessing(c)) return 'processing';
  return isReady(c) ? 'ready' : 'needsInfo';
}

export type RowStatus = LeadBucket | 'confirmed' | 'rejected';
export function rowStatus(c: ContactListItem): RowStatus {
  if (c.reviewStatus === 'approved') return 'confirmed';
  if (c.reviewStatus === 'rejected') return 'rejected';
  return leadBucket(c) ?? 'needsInfo';
}

// The status bar above the list: one joined control, All and then one segment per
// status. Rejected is not a segment: those contacts are hidden and reached only
// through Filter -> Show: Rejected.
export type StatusSegment = 'all' | LeadBucket | 'confirmed';
export const STATUS_SEGMENTS: { key: StatusSegment; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'ready', label: 'Ready' },
  { key: 'needsInfo', label: 'Needs info' },
  { key: 'processing', label: 'Processing' },
  { key: 'confirmed', label: 'Confirmed' },
];

export function inSegment(c: ContactListItem, seg: StatusSegment): boolean {
  const st = rowStatus(c);
  if (st === 'rejected') return false;
  return seg === 'all' || st === seg;
}

// The counts under each segment. Rejected contacts are in none of them, and All is
// the sum of the other four, so the numbers always add up to the list.
export function statusCounts(list: ContactListItem[]): Record<StatusSegment, number> {
  const n: Record<StatusSegment, number> = { all: 0, ready: 0, needsInfo: 0, processing: 0, confirmed: 0 };
  for (const c of list) {
    const st = rowStatus(c);
    if (st === 'rejected') continue;
    n[st] += 1;
    n.all += 1;
  }
  return n;
}

// Why "ready to confirm" means what it means, one line per condition of
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

// ── Signup source ────────────────────────────────────────────────────────
//
// How a lead got into the system. contacts.source says the broad kind; two more
// facts say which kind of "form" or "note" it was, because Contacts' labels tell
// them apart (2026-10-06):
//
//   * intakePath: which door the public form came in by (contacts.intake_path,
//     recorded by contacts-create from 2026-10-07: 'rep_qr' a rep's own reusable
//     QR, 'event_qr' an old per-event QR, 'kiosk' the in-app Kiosk tab). Null on
//     every form lead from before it was recorded, and on a form submitted with
//     no QR and nobody signed in. Those can't be told apart, so they stay "Form"
//     rather than being relabelled as something they might not be.
//   * noteOrigin: where a pasted note came from, read from the note_submissions
//     row the contact points at ('sms' = one contact texted in, from_phone set;
//     'import' = pasted on the Import page, submitted_by set). It is derived at
//     read time, not stored a second time, so it can't drift from the note row.
//
// qrChannel (booth / session) is a field the attendee picks themselves on the
// form's "How did you hear about us?" and rides along on every door, so it only
// names the lead's source when the door doesn't: an old per-event QR or a form
// from before intakePath. A rep's own QR or the Kiosk tab keeps its own label
// even when the attendee also said "At the booth".
//
// Source never changes after capture, which is why (unlike the heat it replaced)
// it can sort live without a row jumping under a rep's finger.

export type SourceKey =
  | 'qr_scan' | 'qr_booth' | 'qr_session' | 'kiosk' | 'form'
  | 'card_photo' | 'list_photo' | 'voice_memo' | 'sms' | 'imported_note'
  | 'other';

type SourceFields = Pick<ContactListItem, 'source' | 'qrChannel' | 'intakePath' | 'noteOrigin'>;

// Also the order the "Source" sort groups by.
export const SOURCE_OPTIONS: { value: SourceKey; label: string }[] = [
  { value: 'qr_scan', label: 'QR scan' },
  { value: 'qr_booth', label: 'QR Booth' },
  { value: 'qr_session', label: 'QR Session' },
  { value: 'kiosk', label: 'Kiosk' },
  { value: 'form', label: 'Form' },
  { value: 'card_photo', label: 'Card photo' },
  { value: 'list_photo', label: 'List photo' },
  { value: 'voice_memo', label: 'Voice memo' },
  { value: 'sms', label: 'SMS' },
  { value: 'imported_note', label: 'Imported note' },
];

const OTHER_OPTION = { value: 'other' as SourceKey, label: 'Other' };

export function sourceKey(c: SourceFields): SourceKey {
  switch (c.source) {
    case 'form':
      if (c.intakePath === 'kiosk') return 'kiosk';
      if (c.intakePath === 'rep_qr') return 'qr_scan';
      if (c.qrChannel === 'booth') return 'qr_booth';
      if (c.qrChannel === 'session') return 'qr_session';
      // An old per-event QR the attendee gave no channel on: still a QR.
      return c.intakePath === 'event_qr' ? 'qr_scan' : 'form';
    case 'card_photo':
    case 'voice_memo':
      return c.source;
    case 'directory_photo':
      return 'list_photo';
    case 'note':
      // A note whose submission row is gone (contacts.source_note_id is ON DELETE
      // SET NULL) can't be said to be either, so it is Other, not a guess.
      return c.noteOrigin === 'sms' ? 'sms' : c.noteOrigin === 'import' ? 'imported_note' : 'other';
    // contacts_source_check has grown twice (directory_photo, voice_memo). A
    // value this file does not know yet shows as "Other" rather than vanishing
    // from the filter; the test below fails when the DB list and this one drift.
    default:
      return 'other';
  }
}

export function sourceLabel(c: SourceFields): string {
  const key = sourceKey(c);
  return [...SOURCE_OPTIONS, OTHER_OPTION].find((o) => o.value === key)?.label ?? 'Other';
}

export function sourceTone(c: Pick<ContactListItem, 'source'>): Tone {
  return c.source === 'form' ? 'blue' : 'grey';
}

// The filter's choices: the known sources always, "Other" only when a loaded
// lead needs it.
export function sourceFilterOptions(list: SourceFields[]): { value: SourceKey | null; label: string }[] {
  const extra = list.some((c) => sourceKey(c) === 'other') ? [OTHER_OPTION] : [];
  return [{ value: null, label: 'All sources' }, ...SOURCE_OPTIONS, ...extra];
}

export function filterBySource(list: ContactListItem[], key: SourceKey | null): ContactListItem[] {
  return key ? list.filter((c) => sourceKey(c) === key) : list;
}

function sourceRank(c: ContactListItem): number {
  const i = SOURCE_OPTIONS.findIndex((o) => o.value === sourceKey(c));
  return i === -1 ? SOURCE_OPTIONS.length : i;
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

export type SortKey = 'newest' | 'source' | 'name' | 'followup';

export const SORT_OPTIONS: Record<ReviewStatus, { value: SortKey; label: string }[]> = {
  needs_review: [
    { value: 'newest', label: 'Newest first' },
    { value: 'source', label: 'Source' },
    { value: 'name', label: 'Name A–Z' },
  ],
  approved: [
    { value: 'followup', label: 'Follow up first' },
    { value: 'newest', label: 'Newest first' },
    { value: 'source', label: 'Source' },
    { value: 'name', label: 'Name A–Z' },
  ],
  rejected: [
    { value: 'newest', label: 'Newest first' },
    { value: 'source', label: 'Source' },
    { value: 'name', label: 'Name A–Z' },
  ],
};

export const DEFAULT_SORT: Record<ReviewStatus, SortKey> = {
  needs_review: 'newest',
  approved: 'followup',
  rejected: 'newest',
};

function created(c: ContactListItem): number {
  const t = Date.parse(c.createdAt);
  return Number.isNaN(t) ? 0 : t;
}
export function sortLeads(list: ContactListItem[], key: SortKey): ContactListItem[] {
  const out = [...list];
  const newestFirst = (a: ContactListItem, b: ContactListItem) => created(b) - created(a);
  switch (key) {
    case 'source':
      return out.sort((a, b) => sourceRank(a) - sourceRank(b) || newestFirst(a, b));
    case 'followup':
      // Who still needs a call, newest first. Already-followed-up sink.
      return out.sort((a, b) => Number(a.followedUp) - Number(b.followedUp) || newestFirst(a, b));
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
// "Follow up first" still reads a field an edit changes (tick Followed up and
// the row would move under the finger), so the page sorts once (on load, or
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

// ── The deck: unconfirmed first, confirmed after ─────────────────────────
//
// One list, no tabs. Unconfirmed contacts (Ready / Needs info / Processing,
// interleaved, newest first by default and NEVER sorted on readiness: that is the
// 2026-10-01 incident above) come first, then confirmed contacts at the bottom.
//
// Confirming a contact must not move it under the person's finger, which is the
// same failure as the readiness sort in a new place. So a contact confirmed one at
// a time is HELD: it turns confirmed where it stands (its rank is still the one it
// had as an unconfirmed contact) and only slides down to the confirmed group when
// the page settles it, i.e. when the person goes on to another contact. Once
// settled it has no confirmed-group rank, so it files at the top of the confirmed
// group (newest first), the nearest thing to "the one I just did". The next full
// re-sort files everything properly. `held` is a set of ids owned by the page;
// ids that are not (or no longer) confirmed are ignored here.
export function orderDeck(
  unconfirmed: ContactListItem[],
  confirmed: ContactListItem[],
  rank: LeadRank,
  held: ReadonlySet<string>,
): ContactListItem[] {
  const heldNow = confirmed.filter((c) => held.has(c.id));
  const settled = confirmed.filter((c) => !held.has(c.id));
  return [
    ...orderByRank([...unconfirmed, ...heldNow], 'needs_review', rank),
    ...orderByRank(settled, 'approved', rank),
  ];
}

// ── Which conference ─────────────────────────────────────────────────────
//
// A rep's page opens on one conference, not on everything they ever captured:
//   * their current conference, if they have one;
//   * otherwise their most recent one (the newest lead's), so a rep who has not
//     (re)joined a conference still sees what they have, with the line saying so;
//   * typing a search looks across ALL their conferences, because someone who
//     types a name is looking for a person, not for a conference.
// Managers (admin / Solutions Success) see everything by default and may pick one.
// "Earlier conferences" and "All conferences" keep the per-conference grouping
// (groupByEvent) so a big history stays tidy.

export type ConferenceScope = 'current' | 'earlier' | 'all';

export interface HomeConference {
  id: string | null;
  name: string | null;
  kind: 'current' | 'recent' | 'none';
}

export function homeConference(
  all: ContactListItem[],
  current: { id: string | null; name: string | null },
): HomeConference {
  const nameOf = (id: string) => all.find((c) => c.eventId === id)?.eventName ?? null;
  if (current.id) return { id: current.id, name: current.name ?? nameOf(current.id), kind: 'current' };
  let best: { id: string; at: number } | null = null;
  for (const [id, at] of eventRecency(all)) {
    if (!best || at > best.at) best = { id, at };
  }
  return best ? { id: best.id, name: nameOf(best.id), kind: 'recent' } : { id: null, name: null, kind: 'none' };
}

export interface ConferenceView {
  isSales: boolean;
  scope: ConferenceScope; // reps
  eventId: string | null; // managers: one conference, or null for all
  home: HomeConference;
  searching: boolean;
}

export function inConferenceView(c: ContactListItem, v: ConferenceView): boolean {
  if (v.searching) return true;
  if (!v.isSales) return !v.eventId || c.eventId === v.eventId;
  if (v.scope === 'all') return true;
  const isHome = c.eventId === v.home.id;
  return v.scope === 'current' ? isHome : !isHome;
}

// Whether the list is shown grouped under a header per conference. A rep's current
// conference is one flat list; earlier / all is grouped; a search is flat (the cards
// then name their own conference); a manager's list is flat with the conference on
// each card.
export function groupedByConference(v: ConferenceView): boolean {
  return v.isSales && !v.searching && v.scope !== 'current';
}

// The words on the line under the status bar, and on the Filter panel's radio.
export function conferenceLine(v: ConferenceView, eventName: string | null): string {
  if (v.searching) return v.isSales ? 'Searching all your conferences' : 'Searching all conferences';
  if (!v.isSales) return v.eventId ? (eventName ?? 'One conference') : 'All conferences';
  if (v.scope === 'earlier') return 'Earlier conferences';
  if (v.scope === 'all') return 'All conferences';
  if (v.home.kind === 'recent') return `Your most recent conference: ${v.home.name ?? 'unknown'}`;
  return v.home.name ?? 'No conference yet';
}

export function homeRadioLabel(home: HomeConference): string {
  if (home.kind === 'recent') return `Most recent conference (${home.name ?? 'unknown'})`;
  return home.name ? `This conference (${home.name})` : 'This conference';
}

// Every conference the loaded contacts belong to, newest first: the manager's select.
export function conferenceOptions(all: ContactListItem[]): { value: string; label: string }[] {
  const names = new Map<string, string>();
  for (const c of all) if (!names.has(c.eventId)) names.set(c.eventId, c.eventName);
  const recency = eventRecency(all);
  return [...names.entries()]
    .sort((a, b) => (recency.get(b[0]) ?? 0) - (recency.get(a[0]) ?? 0))
    .map(([value, label]) => ({ value, label }));
}

// ── The Filter panel's state ─────────────────────────────────────────────

export type FollowFilter = 'any' | 'todo' | 'done';

export interface ContactFilters {
  show: 'contacts' | 'rejected';
  scope: ConferenceScope;
  eventId: string | null;
  follow: FollowFilter;
  source: SourceKey | null;
  // Applies within the unconfirmed group; confirmed contacts keep their own order.
  sort: SortKey;
  // Managers only: the server slices by these two.
  repId: string | null;
  synced: string | null;
}

export const DEFAULT_FILTERS: ContactFilters = {
  show: 'contacts', scope: 'current', eventId: null, follow: 'any', source: null,
  sort: DEFAULT_SORT.needs_review, repId: null, synced: null,
};

// The number on the Filter button: how many things differ from the defaults. The
// conference counts only where it is a choice the person made (a rep off "this
// conference", a manager on one conference), and the manager-only filters only
// count for a manager, so a rep never sees a number for something they cannot see.
export function activeFilterCount(f: ContactFilters, isSales: boolean): number {
  let n = 0;
  if (f.show !== 'contacts') n += 1;
  if (isSales ? f.scope !== 'current' : f.eventId !== null) n += 1;
  if (f.follow !== 'any') n += 1;
  if (f.source) n += 1;
  if (f.sort !== DEFAULT_FILTERS.sort) n += 1;
  if (!isSales && f.repId) n += 1;
  if (!isSales && f.synced) n += 1;
  return n;
}

export function filterByFollowUp(list: ContactListItem[], f: FollowFilter): ContactListItem[] {
  if (f === 'any') return list;
  return list.filter((c) => c.followedUp === (f === 'done'));
}

// ── Search ───────────────────────────────────────────────────────────────

function digits(s: string): string {
  return s.replace(/\D/g, '');
}

// Plain substring match over what a rep would type to find someone: name,
// email, phone, school / district, title, event and source. Phone is compared on
// digits only so "(615) 555" finds "615-555-0100". Never a regex or ILIKE —
// what's typed is data, not a pattern.
export function searchLeads(list: ContactListItem[], query: string): ContactListItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  const qDigits = digits(q);
  return list.filter((c) => {
    const haystack = [
      c.firstName, c.lastName, `${c.firstName} ${c.lastName}`, c.email, c.title, c.districtName,
      c.schoolDistrictNameRaw, c.schoolName, c.schoolNameRaw, c.eventName, c.repName, c.interactionNotes, sourceLabel(c),
    ].filter(Boolean).join(' ').toLowerCase();
    if (haystack.includes(q)) return true;
    return qDigits.length >= 3 && digits(c.phone ?? '').includes(qDigits);
  });
}

// ── Past-event grouping ──────────────────────────────────────────────────

// The list carries no event date, so "newest event" is the event whose most
// recent lead is newest. Computed over EVERY status the rep has loaded, not
// just the visible tab, so the section order doesn't reshuffle when they
// switch between Needs Review / Confirmed / Rejected.
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
