// Run: cd frontend && npm test
// Node strips the TypeScript types itself, so no build step is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  accountBadge, appendNote, eventRecency, groupByEvent, isProcessing, isReady, leadCue, leadFlags, readinessChecklist, readyIds, searchLeads, sortLeads, statusCounts,
  filterBySource, sourceFilterOptions, sourceKey, sourceLabel, sourceTone, SOURCE_OPTIONS,
} from './contactsList.ts';

function lead(over = {}) {
  return {
    id: 'c1', firstName: 'Dana', lastName: 'Whitfield', email: 'dana@example.org', phone: null, title: null,
    source: 'card_photo', qrChannel: null, intakePath: null, noteOrigin: null, repId: 'r1', repName: 'Rep', eventId: 'e1', eventName: 'Event One',
    state: 'TN', schoolDistrictId: 'd1', districtName: 'Knox County', schoolDistrictNameRaw: null,
    schoolId: null, schoolName: null, schoolNameRaw: null, matchStatus: 'new_account', matchAttempts: 0,
    matchedZohoAccountLevel: null, localDuplicateOfContactName: null, reviewStatus: 'needs_review',
    interactionNotes: null, followedUp: false, createdAt: '2026-09-01T10:00:00Z',
    ...over,
  };
}

test('a complete, matched lead is ready', () => {
  assert.equal(isReady(lead()), true);
  assert.deepEqual(leadFlags(lead()), []);
});

test('each blocking rule keeps a lead out of ready', () => {
  assert.equal(isReady(lead({ matchStatus: 'pending' })), false);
  assert.equal(leadFlags(lead({ matchStatus: 'pending' }))[0].key, 'matching');
  assert.equal(leadFlags(lead({ matchStatus: 'pending', matchAttempts: 3 }))[0].key, 'stuck');
  assert.equal(isReady(lead({ localDuplicateOfContactName: 'Dana W.' })), false);
  assert.equal(isReady(lead({ email: null, phone: null })), false);
  assert.equal(isReady(lead({ schoolDistrictId: null, districtName: null })), false);
});

test('email alone or phone alone is enough contact info', () => {
  assert.equal(isReady(lead({ email: null, phone: '615-555-0100' })), true);
  assert.equal(isReady(lead({ email: 'a@b.co', phone: null })), true);
});

test('school-only or raw-text org still counts as an organisation', () => {
  assert.equal(isReady(lead({ schoolDistrictId: null, districtName: null, schoolNameRaw: 'Lincoln Elementary' })), true);
  assert.equal(isReady(lead({ schoolDistrictId: null, districtName: null, schoolDistrictNameRaw: 'Metro ISD' })), true);
});

test('ambiguous match with candidates informs but does not block', () => {
  const c = lead({ matchStatus: 'ambiguous', candidateMatches: [{ type: 'account', zohoId: 'z', name: 'Rivera County', score: 0.8 }] });
  assert.equal(isReady(c), true);
  assert.equal(leadFlags(c)[0].key, 'unclear');
  assert.equal(leadFlags(c)[0].label, 'Pick a Zoho match');
  assert.equal(leadFlags(c)[0].blocking, false);
  assert.equal(accountBadge(c).label, 'Pick a Zoho match');
});

test('ambiguous match with no candidates shows no pill and no flag, and stays approvable', () => {
  for (const candidateMatches of [null, []]) {
    const c = lead({ matchStatus: 'ambiguous', candidateMatches });
    assert.equal(isReady(c), true);
    assert.deepEqual(leadFlags(c), []);
    assert.equal(accountBadge(c), null);
  }
});

test('only needs_review leads can be ready, and readyIds filters', () => {
  assert.equal(isReady(lead({ reviewStatus: 'approved' })), false);
  const list = [lead({ id: 'a' }), lead({ id: 'b', matchStatus: 'pending' }), lead({ id: 'c', reviewStatus: 'rejected' })];
  assert.deepEqual(readyIds(list), ['a']);
});

test('account badge says new vs existing, school vs district', () => {
  assert.equal(accountBadge(lead({ matchStatus: 'pending' })), null);
  assert.equal(accountBadge(lead({ matchStatus: 'new_account' })).label, 'New district');
  assert.equal(accountBadge(lead({ matchStatus: 'new_account', schoolNameRaw: 'Lincoln' })).label, 'New school');
  assert.equal(accountBadge(lead({ matchStatus: 'new_contact_existing_account', matchedZohoAccountLevel: 'school' })).label, 'Existing school');
  assert.equal(accountBadge(lead({ matchStatus: 'new_contact_existing_account', matchedZohoAccountLevel: 'district' })).label, 'Existing district');
  assert.equal(accountBadge(lead({ matchStatus: 'existing_contact', matchedZohoAccountLevel: 'district' })).label, 'Existing district · contact on file');
  // Rows matched before matchedZohoAccountLevel existed fall back to the contact's own fields.
  assert.equal(accountBadge(lead({ matchStatus: 'new_contact_existing_account', schoolName: 'Lincoln' })).label, 'Existing school');
});

test('a new account with no school or district gets no misleading "New district" badge', () => {
  assert.equal(accountBadge(lead({ matchStatus: 'new_account', schoolDistrictId: null, districtName: null })), null);
});

test('follow-up sort: not-yet-called first, newest first, followed-up last; input not mutated', () => {
  const list = [
    lead({ id: 'done-new', followedUp: true, createdAt: '2026-09-05T10:00:00Z' }),
    lead({ id: 'todo-old', createdAt: '2026-09-01T10:00:00Z' }),
    lead({ id: 'todo-new', createdAt: '2026-09-03T10:00:00Z' }),
  ];
  const before = list.map((c) => c.id);
  assert.deepEqual(sortLeads(list, 'followup').map((c) => c.id), ['todo-new', 'todo-old', 'done-new']);
  assert.deepEqual(list.map((c) => c.id), before);
});

test('name sort orders by last then first name', () => {
  const list = [lead({ id: 'b', firstName: 'Bo', lastName: 'Zed' }), lead({ id: 'a', firstName: 'Al', lastName: 'Adams' })];
  assert.deepEqual(sortLeads(list, 'name').map((c) => c.id), ['a', 'b']);
});

test('search matches name, org, email and phone digits; empty query returns everything', () => {
  const list = [
    lead({ id: 'a', firstName: 'Marcus', lastName: 'Bell', email: 'mb@lincoln.org', phone: '(615) 555-0100', districtName: 'Lincoln ISD' }),
    lead({ id: 'b', firstName: 'Priya', lastName: 'Nair', districtName: 'Metro ISD' }),
  ];
  assert.equal(searchLeads(list, '').length, 2);
  assert.deepEqual(searchLeads(list, 'marc').map((c) => c.id), ['a']);
  assert.deepEqual(searchLeads(list, 'metro').map((c) => c.id), ['b']);
  assert.deepEqual(searchLeads(list, '615-555').map((c) => c.id), ['a']);
  assert.deepEqual(searchLeads(list, 'LINCOLN.ORG').map((c) => c.id), ['a']);
  assert.deepEqual(searchLeads(list, 'zzz'), []);
});

test('search treats regex and SQL wildcards as plain text', () => {
  const list = [lead({ id: 'a' })];
  assert.deepEqual(searchLeads(list, '.*'), []);
  assert.deepEqual(searchLeads(list, '%'), []);
});

test('short digit strings do not match every phone number', () => {
  const list = [lead({ id: 'a', phone: '615-555-0100' })];
  assert.deepEqual(searchLeads(list, '61'), []);
});

test('past events are ordered newest to oldest by most recent lead, across all statuses', () => {
  const all = [
    lead({ id: '1', eventId: 'old', eventName: 'Old', createdAt: '2026-05-01T00:00:00Z' }),
    lead({ id: '2', eventId: 'new', eventName: 'New', createdAt: '2026-08-01T00:00:00Z' }),
    lead({ id: '3', eventId: 'mid', eventName: 'Mid', createdAt: '2026-07-01T00:00:00Z' }),
    // A rejected lead captured at "old" in mid-July: that event's newest lead, so it must rank
    // above "mid" even on a tab where only the May lead is visible.
    lead({ id: '4', eventId: 'old', eventName: 'Old', reviewStatus: 'rejected', createdAt: '2026-07-15T00:00:00Z' }),
  ];
  const recency = eventRecency(all);
  const approvedTabOnly = all.filter((c) => c.reviewStatus !== 'rejected');
  assert.deepEqual(groupByEvent(approvedTabOnly, recency).map((g) => g.eventId), ['new', 'old', 'mid']);
  // Same order when computed from the visible subset alone would differ — that is the bug this avoids.
  assert.deepEqual(groupByEvent(approvedTabOnly, eventRecency(approvedTabOnly)).map((g) => g.eventId), ['new', 'mid', 'old']);
});

test('grouping keeps every lead exactly once', () => {
  const list = [lead({ id: '1', eventId: 'a' }), lead({ id: '2', eventId: 'b' }), lead({ id: '3', eventId: 'a' })];
  const groups = groupByEvent(list, eventRecency(list));
  assert.equal(groups.reduce((n, g) => n + g.leads.length, 0), 3);
});

test('appendNote adds a dated line and keeps what was there', () => {
  const d = new Date(2026, 8, 29, 12);
  assert.equal(appendNote(null, '  Left a voicemail ', d), 'Sep 29: Left a voicemail');
  assert.equal(appendNote('', 'Hi', d), 'Sep 29: Hi');
  assert.equal(appendNote('Wants a demo.\n', 'Called back', d), 'Wants a demo.\nSep 29: Called back');
  assert.equal(appendNote('Sep 28: first', 'second', d), 'Sep 28: first\nSep 29: second');
});

test('processing means still in the automatic pipeline, not stuck or finished', () => {
  assert.equal(isProcessing(lead({ matchStatus: 'pending' })), true);
  assert.equal(isProcessing(lead({ matchStatus: 'pending', matchAttempts: 2 })), true);
  // Given up: nothing will finish it, so it must not promise "a few minutes".
  assert.equal(isProcessing(lead({ matchStatus: 'pending', matchAttempts: 3 })), false);
  assert.equal(isProcessing(lead({ matchStatus: 'new_account' })), false);
  assert.equal(isProcessing(lead({ matchStatus: 'pending', reviewStatus: 'approved' })), false);
});

test('the cue names the first thing to fix, and only for a lead that can be worked on', () => {
  assert.equal(leadCue(lead()), null); // ready: has a check and a cross instead
  assert.equal(leadCue(lead({ matchStatus: 'pending' })), null); // processing: has a bar
  assert.equal(leadCue(lead({ matchStatus: 'pending', matchAttempts: 3 })), 'Open to retry');
  assert.equal(leadCue(lead({ localDuplicateOfContactName: 'Dana W.' })), 'Resolve duplicate');
  assert.equal(leadCue(lead({ email: null, phone: null })), 'Add missing info');
  assert.equal(leadCue(lead({ schoolDistrictId: null, districtName: null })), 'Add missing info');
  // A duplicate comes before missing info, same order as the flags.
  assert.equal(leadCue(lead({ localDuplicateOfContactName: 'Dana W.', email: null })), 'Resolve duplicate');
  assert.equal(leadCue(lead({ reviewStatus: 'approved', email: null, phone: null })), null);
});

test('the summary puts every lead in exactly one bucket, agreeing with its chip', () => {
  const list = [
    lead({ id: 'a' }),
    lead({ id: 'b' }),
    lead({ id: 'c', email: null, phone: null }),
    lead({ id: 'd', matchStatus: 'pending' }),
    lead({ id: 'e', matchStatus: 'pending', matchAttempts: 3 }),
    lead({ id: 'f', reviewStatus: 'approved' }),
  ];
  const n = statusCounts(list);
  assert.deepEqual(n, { all: 6, ready: 2, needsInfo: 2, processing: 1, confirmed: 1 });
  assert.equal(n.ready + n.needsInfo + n.processing, list.filter((c) => c.reviewStatus === 'needs_review').length);
  assert.equal(n.ready, readyIds(list).length);
});

test('the checklist is all ticks exactly when the lead is ready to confirm', () => {
  const cases = [
    lead(),
    lead({ email: null, phone: null }),
    lead({ schoolDistrictId: null, districtName: null }),
    lead({ matchStatus: 'pending' }),
    lead({ matchStatus: 'pending', matchAttempts: 3 }),
    lead({ localDuplicateOfContactName: 'Dana W.' }),
    lead({ email: null, phone: null, matchStatus: 'pending', localDuplicateOfContactName: 'Dana W.' }),
  ];
  for (const c of cases) {
    const allOk = readinessChecklist(c).every((i) => i.state === 'ok');
    assert.equal(allOk, isReady(c), JSON.stringify(c));
  }
  const waiting = readinessChecklist(lead({ matchStatus: 'pending' })).find((i) => i.key === 'match');
  assert.equal(waiting.state, 'wait');
  assert.equal(readinessChecklist(lead({ matchStatus: 'pending', matchAttempts: 3 })).find((i) => i.key === 'match').state, 'todo');
});

// ── Order ────────────────────────────────────────────────────────────────
// 2026-10-01: "Needs attention first" sorted on the readiness flags, so adding
// a district to the newest lead flipped it to Ready and sent it from row 1 to
// row 41; the rep reloaded twice and never found it. To review is now plain
// arrival order, and the sorts that still read editable fields are frozen.

import { buildRank, leadBucket, orderByRank, SORT_OPTIONS, DEFAULT_SORT } from './contactsList.ts';

const SORTS = { needs_review: 'newest', approved: 'followup', rejected: 'newest' };

function crowd() {
  const older = Array.from({ length: 12 }, (_, i) => lead({
    id: `old${i}`, schoolDistrictId: null, districtName: null, // all need info
    createdAt: `2026-09-${String(10 + i).padStart(2, '0')}T10:00:00Z`,
  }));
  const jim = lead({ id: 'jim', schoolDistrictId: null, districtName: null, followedUp: false, createdAt: '2026-10-01T15:11:00Z' });
  return { older, jim };
}

test('To review is newest first, and readiness is not a sort option', () => {
  assert.equal(DEFAULT_SORT.needs_review, 'newest');
  assert.deepEqual(SORT_OPTIONS.needs_review.map((o) => o.value), ['newest', 'source', 'name']);
});

test('making a lead Ready does not move it', () => {
  const { older, jim } = crowd();
  const list = [...older, jim];
  assert.equal(sortLeads(list, 'newest')[0].id, 'jim');
  Object.assign(jim, { schoolDistrictId: 'd9', districtName: 'Mesa USD' });
  assert.equal(sortLeads(list, 'newest')[0].id, 'jim');
});

test('the live follow-up sort moves a lead the moment it is ticked (why it is frozen)', () => {
  const { older, jim } = crowd();
  const list = [...older, jim];
  assert.equal(sortLeads(list, 'followup')[0].id, 'jim');
  Object.assign(jim, { followedUp: true });
  assert.notEqual(sortLeads(list, 'followup')[0].id, 'jim');
});

test('a frozen order keeps an edited lead where it was', () => {
  const { older, jim } = crowd();
  const buckets = { needs_review: [...older, jim], approved: [], rejected: [] };
  const sorts = { ...SORTS, needs_review: 'followup' };
  const rank = buildRank(buckets, sorts);
  Object.assign(jim, { followedUp: true });
  assert.equal(orderByRank(buckets.needs_review, 'needs_review', rank)[0].id, 'jim');
  // A fresh rank (a deliberate re-sort) does apply the edit.
  assert.notEqual(orderByRank(buckets.needs_review, 'needs_review', buildRank(buckets, sorts))[0].id, 'jim');
});

test('leads the order has not seen yet float to the top, newest first', () => {
  const { older, jim } = crowd();
  const buckets = { needs_review: older, approved: [], rejected: [] };
  const rank = buildRank(buckets, SORTS);
  const fresh = lead({ id: 'fresh', createdAt: '2026-10-02T09:00:00Z' });
  const ordered = orderByRank([...older, jim, fresh], 'needs_review', rank);
  assert.deepEqual(ordered.slice(0, 2).map((c) => c.id), ['fresh', 'jim']);
  assert.equal(ordered.length, 14);
});

test('a lead keeps its place across approve then undo', () => {
  const { older, jim } = crowd();
  const rank = buildRank({ needs_review: [...older, jim], approved: [], rejected: [] }, SORTS);
  const back = orderByRank([...older.slice(0, 5), jim, ...older.slice(5)], 'needs_review', rank);
  assert.equal(back[0].id, 'jim');
});

test('leadBucket puts every to-review lead in exactly one pill, matching statusCounts', () => {
  const list = [
    lead({ id: 'a' }),
    lead({ id: 'b', schoolDistrictId: null, districtName: null }),
    lead({ id: 'c', matchStatus: 'pending', matchAttempts: 0 }),
    lead({ id: 'd', matchStatus: 'pending', matchAttempts: 3 }),
    lead({ id: 'e', reviewStatus: 'approved' }),
  ];
  assert.deepEqual(list.map(leadBucket), ['ready', 'needsInfo', 'processing', 'needsInfo', null]);
  assert.deepEqual(statusCounts(list), { all: 5, ready: 1, needsInfo: 2, processing: 1, confirmed: 1 });
});

// ── Signup source ────────────────────────────────────────────────────────

const src = (over) => ({ source: 'form', qrChannel: null, intakePath: null, noteOrigin: null, ...over });

test('a form lead is named by the door it came in by, then by the QR channel, else just "Form"', () => {
  assert.equal(sourceKey(src({ intakePath: 'rep_qr' })), 'qr_scan');
  assert.equal(sourceKey(src({ intakePath: 'kiosk' })), 'kiosk');
  assert.equal(sourceKey(src({ qrChannel: 'booth' })), 'qr_booth');
  assert.equal(sourceKey(src({ qrChannel: 'session' })), 'qr_session');
  assert.equal(sourceKey(src({ intakePath: 'event_qr', qrChannel: 'booth' })), 'qr_booth');
  assert.equal(sourceKey(src({ intakePath: 'event_qr' })), 'qr_scan');
  // Legacy: before the door was recorded QR and Kiosk can't be told apart, so
  // they are NOT relabelled as one of them.
  assert.equal(sourceKey(src()), 'form');
});

test("the attendee's own booth/session answer never renames a rep's QR or the Kiosk", () => {
  assert.equal(sourceKey(src({ intakePath: 'rep_qr', qrChannel: 'booth' })), 'qr_scan');
  assert.equal(sourceKey(src({ intakePath: 'kiosk', qrChannel: 'session' })), 'kiosk');
});

test('a note is SMS or Imported note by where its note row came from; a note with no row is Other', () => {
  assert.equal(sourceKey(src({ source: 'note', noteOrigin: 'sms' })), 'sms');
  assert.equal(sourceKey(src({ source: 'note', noteOrigin: 'import' })), 'imported_note');
  assert.equal(sourceKey(src({ source: 'note', noteOrigin: null })), 'other');
});

test('other sources ignore the form fields', () => {
  assert.equal(sourceKey(src({ source: 'card_photo', qrChannel: 'booth', intakePath: 'kiosk' })), 'card_photo');
  assert.equal(sourceKey(src({ source: 'directory_photo' })), 'list_photo');
  assert.equal(sourceKey(src({ source: 'voice_memo' })), 'voice_memo');
  assert.equal(sourceKey(src({ source: 'something_new' })), 'other');
});

test('the words people see: chip and filter agree', () => {
  const labels = (over) => sourceLabel(src(over));
  assert.equal(labels({ intakePath: 'rep_qr' }), 'QR scan');
  assert.equal(labels({ qrChannel: 'booth' }), 'QR Booth');
  assert.equal(labels({ qrChannel: 'session' }), 'QR Session');
  assert.equal(labels({ intakePath: 'kiosk' }), 'Kiosk');
  assert.equal(labels({}), 'Form');
  assert.equal(labels({ source: 'card_photo' }), 'Card photo');
  assert.equal(labels({ source: 'directory_photo' }), 'List photo');
  assert.equal(labels({ source: 'voice_memo' }), 'Voice memo');
  assert.equal(labels({ source: 'note', noteOrigin: 'sms' }), 'SMS');
  assert.equal(labels({ source: 'note', noteOrigin: 'import' }), 'Imported note');
  assert.equal(labels({ source: 'something_new' }), 'Other');
  assert.deepEqual(SOURCE_OPTIONS.map((o) => o.label), [
    'QR scan', 'QR Booth', 'QR Session', 'Kiosk', 'Form', 'Card photo', 'List photo', 'Voice memo', 'SMS', 'Imported note',
  ]);
  assert.equal(sourceTone(src({})), 'blue');
  assert.equal(sourceTone({ source: 'note' }), 'grey');
});

// The lesson of contacts_source_check growing twice: a source added to the DB
// but not here would show as "Other" forever. Read the real constraint.
test('every source the database allows has its own filter option', () => {
  const dir = new URL('../../../supabase/migrations/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  let allowed = null;
  for (const f of files) {
    const m = readFileSync(new URL(f, dir), 'utf8').match(/add constraint contacts_source_check\s+check \(source = any \(array\[([^\]]+)\]/);
    if (m) allowed = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  }
  assert.ok(allowed && allowed.length >= 5, 'could not find contacts_source_check');
  // A note has no filter option of its own (it is SMS or Imported note), so give
  // it the origin the way the API does.
  for (const source of allowed) {
    assert.notEqual(sourceKey(src({ source, noteOrigin: 'sms' })), 'other', `${source} needs a source option`);
  }
});

// Same lesson for the new column: a door the database allows but this file
// doesn't know would silently read as "Form".
test('every intake_path the database allows is a door sourceKey knows', () => {
  const dir = new URL('../../../supabase/migrations/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  let allowed = null;
  for (const f of files) {
    const m = readFileSync(new URL(f, dir), 'utf8').match(/add column intake_path text check \(intake_path in \(([^)]+)\)\)/);
    if (m) allowed = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  }
  assert.ok(allowed && allowed.length === 3, 'could not find intake_path check');
  for (const intakePath of allowed) {
    assert.notEqual(sourceKey(src({ intakePath })), 'form', `${intakePath} needs a source option`);
  }
});

test('filter options list every source and add Other only when a lead needs it', () => {
  assert.deepEqual(sourceFilterOptions([lead()]).map((o) => o.value), [null, ...SOURCE_OPTIONS.map((o) => o.value)]);
  assert.equal(sourceFilterOptions([lead({ source: 'sms_v2' })]).at(-1).value, 'other');
});

test('filtering by source keeps only that source; null keeps all', () => {
  const list = [
    lead({ id: 'a', source: 'form', qrChannel: 'booth' }),
    lead({ id: 'b', source: 'form', intakePath: 'kiosk' }),
    lead({ id: 'c', source: 'card_photo' }),
    lead({ id: 'd', source: 'note', noteOrigin: 'import' }),
  ];
  assert.deepEqual(filterBySource(list, 'qr_booth').map((c) => c.id), ['a']);
  assert.deepEqual(filterBySource(list, 'kiosk').map((c) => c.id), ['b']);
  assert.deepEqual(filterBySource(list, 'card_photo').map((c) => c.id), ['c']);
  assert.deepEqual(filterBySource(list, 'imported_note').map((c) => c.id), ['d']);
  assert.equal(filterBySource(list, null).length, 4);
});

test('source sort groups in the filter order, newest first inside a group', () => {
  const list = [
    lead({ id: 'sms-new', source: 'note', noteOrigin: 'sms', createdAt: '2026-09-05T10:00:00Z' }),
    lead({ id: 'session', source: 'form', qrChannel: 'session', createdAt: '2026-09-02T10:00:00Z' }),
    lead({ id: 'card-old', source: 'card_photo', createdAt: '2026-09-01T10:00:00Z' }),
    lead({ id: 'kiosk', source: 'form', intakePath: 'kiosk', createdAt: '2026-09-03T10:00:00Z' }),
    lead({ id: 'card-new', source: 'card_photo', createdAt: '2026-09-04T10:00:00Z' }),
    lead({ id: 'scan', source: 'form', intakePath: 'rep_qr', createdAt: '2026-09-02T09:00:00Z' }),
  ];
  assert.deepEqual(sortLeads(list, 'source').map((c) => c.id), ['scan', 'session', 'kiosk', 'card-new', 'card-old', 'sms-new']);
});

test('search finds a lead by its source word', () => {
  const list = [
    lead({ id: 'a', source: 'voice_memo' }), lead({ id: 'b' }),
    lead({ id: 'k', source: 'form', intakePath: 'kiosk' }), lead({ id: 's', source: 'note', noteOrigin: 'sms' }),
  ];
  assert.deepEqual(searchLeads(list, 'voice memo').map((c) => c.id), ['a']);
  assert.deepEqual(searchLeads(list, 'kiosk').map((c) => c.id), ['k']);
  assert.deepEqual(searchLeads(list, 'sms').map((c) => c.id), ['s']);
});

// A school typed with no district (the quiet fallback on the pickers) is a school: the lead
// is Ready on it, the org line shows it, and it isn't flagged "no school or district".
test('a typed school with no district counts as an organisation', () => {
  const c = lead({ schoolDistrictId: null, districtName: null, schoolDistrictNameRaw: null, schoolNameRaw: 'Grace Lutheran School' });
  assert.equal(isReady(c), true);
  assert.deepEqual(leadFlags(c), []);
  assert.ok(readinessChecklist(c).find((i) => i.key === 'org').state === 'ok');
});

// ── The status bar ───────────────────────────────────────────────────────

import { STATUS_SEGMENTS, inSegment, rowStatus } from './contactsList.ts';

test('the status bar is All, Ready, Needs info, Processing, Confirmed, in that order', () => {
  assert.deepEqual(STATUS_SEGMENTS.map((s) => s.label), ['All', 'Ready', 'Needs info', 'Processing', 'Confirmed']);
});

test('statusCounts: every non-rejected lead is in exactly one segment, and All is their sum', () => {
  const list = [
    lead({ id: 'a' }),
    lead({ id: 'b', schoolDistrictId: null, districtName: null }),
    lead({ id: 'c', matchStatus: 'pending' }),
    lead({ id: 'd', reviewStatus: 'approved' }),
    lead({ id: 'e', reviewStatus: 'approved' }),
    lead({ id: 'f', reviewStatus: 'rejected' }),
  ];
  const n = statusCounts(list);
  assert.deepEqual(n, { all: 5, ready: 1, needsInfo: 1, processing: 1, confirmed: 2 });
  for (const c of list) {
    const segs = STATUS_SEGMENTS.filter((s) => s.key !== 'all' && inSegment(c, s.key));
    assert.equal(segs.length, c.reviewStatus === 'rejected' ? 0 : 1, c.id);
    assert.equal(inSegment(c, 'all'), c.reviewStatus !== 'rejected');
  }
});

test('statusCounts of nothing is all zeros, so the bar can still be drawn grey', () => {
  assert.deepEqual(statusCounts([]), { all: 0, ready: 0, needsInfo: 0, processing: 0, confirmed: 0 });
});

test('rowStatus names the edge colour a card gets', () => {
  assert.equal(rowStatus(lead()), 'ready');
  assert.equal(rowStatus(lead({ email: null, phone: null })), 'needsInfo');
  assert.equal(rowStatus(lead({ matchStatus: 'pending' })), 'processing');
  assert.equal(rowStatus(lead({ matchStatus: 'pending', matchAttempts: 3 })), 'needsInfo');
  assert.equal(rowStatus(lead({ reviewStatus: 'approved' })), 'confirmed');
  assert.equal(rowStatus(lead({ reviewStatus: 'rejected' })), 'rejected');
});

// ── The deck: unconfirmed first, confirmed after; confirming settles later ──

import { orderDeck } from './contactsList.ts';

function deckFixture() {
  // Newest first: n3 (ready), n2 (needs info), n1 (ready), then an older confirmed c1.
  const n3 = lead({ id: 'n3', createdAt: '2026-09-30T10:00:00Z' });
  const n2 = lead({ id: 'n2', email: null, phone: null, createdAt: '2026-09-29T10:00:00Z' });
  const n1 = lead({ id: 'n1', createdAt: '2026-09-28T10:00:00Z' });
  const c1 = lead({ id: 'c1', reviewStatus: 'approved', createdAt: '2026-09-01T10:00:00Z' });
  const buckets = { needs_review: [n1, n2, n3], approved: [c1], rejected: [] };
  const rank = buildRank(buckets, SORTS);
  return { n1, n2, n3, c1, buckets, rank };
}
const ids = (list) => list.map((c) => c.id);

test('the deck is unconfirmed newest-first, interleaving Ready / Needs info / Processing, then confirmed', () => {
  const { n1, n2, n3, c1, buckets, rank } = deckFixture();
  const proc = lead({ id: 'p', matchStatus: 'pending', createdAt: '2026-09-29T20:00:00Z' });
  buckets.needs_review.push(proc);
  const r = buildRank(buckets, SORTS);
  assert.deepEqual(ids(orderDeck(buckets.needs_review, buckets.approved, r, new Set())), ['n3', 'p', 'n2', 'n1', 'c1']);
  assert.deepEqual(ids(orderDeck([n1, n2, n3], [c1], rank, new Set())), ['n3', 'n2', 'n1', 'c1']);
});

test('a lead confirmed one at a time is held: it turns confirmed where it stands', () => {
  const { n1, n2, n3, c1, rank } = deckFixture();
  // n2 was just confirmed: its status is now approved, but the page is holding it.
  n2.reviewStatus = 'approved';
  const held = new Set(['n2']);
  assert.deepEqual(ids(orderDeck([n1, n3], [c1, n2], rank, held)), ['n3', 'n2', 'n1', 'c1']);
  assert.equal(rowStatus(n2), 'confirmed');
});

test('settling a held lead slides it to the top of the confirmed group, below every unconfirmed one', () => {
  const { n1, n2, n3, c1, rank } = deckFixture();
  n2.reviewStatus = 'approved';
  assert.deepEqual(ids(orderDeck([n1, n3], [c1, n2], rank, new Set())), ['n3', 'n1', 'n2', 'c1']);
});

test('several held leads settle together, newest first, ahead of older confirmed ones', () => {
  const { n1, n2, n3, c1, rank } = deckFixture();
  n1.reviewStatus = 'approved';
  n3.reviewStatus = 'approved';
  assert.deepEqual(ids(orderDeck([n2], [c1, n1, n3], rank, new Set())), ['n2', 'n3', 'n1', 'c1']);
});

test('a held id that is no longer confirmed (undone) is ignored and keeps its place', () => {
  const { n1, n2, n3, c1, rank } = deckFixture();
  assert.deepEqual(ids(orderDeck([n1, n2, n3], [c1], rank, new Set(['n2']))), ['n3', 'n2', 'n1', 'c1']);
});

test('the order is frozen: a confirmed lead is not re-sorted by being confirmed, only by settling', () => {
  const { n1, n2, n3, c1, rank } = deckFixture();
  const before = ids(orderDeck([n1, n2, n3], [c1], rank, new Set()));
  n3.reviewStatus = 'approved';
  const held = ids(orderDeck([n1, n2], [c1, n3], rank, new Set(['n3'])));
  assert.deepEqual(held, before, 'confirming changes the look, not the position');
});

// ── Which conference ─────────────────────────────────────────────────────

import {
  conferenceLine, conferenceOptions, groupedByConference, homeConference, homeRadioLabel, inConferenceView,
  activeFilterCount, filterByFollowUp, DEFAULT_FILTERS,
} from './contactsList.ts';

function history() {
  return [
    lead({ id: 'a1', eventId: 'e-new', eventName: 'MoASSP Fall 2026', createdAt: '2026-10-02T10:00:00Z' }),
    lead({ id: 'a2', eventId: 'e-new', eventName: 'MoASSP Fall 2026', createdAt: '2026-10-01T10:00:00Z' }),
    lead({ id: 'b1', eventId: 'e-old', eventName: 'Region 4 Spring', createdAt: '2026-04-01T10:00:00Z' }),
  ];
}
const repView = (over) => ({ isSales: true, scope: 'current', eventId: null, home: { id: 'e-new', name: 'MoASSP Fall 2026', kind: 'current' }, searching: false, ...over });

test('a rep with a current conference sees that conference', () => {
  const all = history();
  const home = homeConference(all, { id: 'e-old', name: 'Region 4 Spring' });
  assert.deepEqual(home, { id: 'e-old', name: 'Region 4 Spring', kind: 'current' });
  assert.deepEqual(all.filter((c) => inConferenceView(c, repView({ home }))).map((c) => c.id), ['b1']);
});

test('a rep with no current conference sees their most recent one, and the line says so', () => {
  const all = history();
  const home = homeConference(all, { id: null, name: null });
  assert.deepEqual(home, { id: 'e-new', name: 'MoASSP Fall 2026', kind: 'recent' });
  const v = repView({ home });
  assert.deepEqual(all.filter((c) => inConferenceView(c, v)).map((c) => c.id), ['a1', 'a2']);
  assert.equal(conferenceLine(v, null), 'Your most recent conference: MoASSP Fall 2026');
  assert.equal(homeRadioLabel(home), 'Most recent conference (MoASSP Fall 2026)');
});

test('a rep with no conference and no contacts has nothing to default to', () => {
  const home = homeConference([], { id: null, name: null });
  assert.deepEqual(home, { id: null, name: null, kind: 'none' });
  assert.equal(conferenceLine(repView({ home }), null), 'No conference yet');
});

test('the current conference falls back to the name on a lead when the session has none', () => {
  assert.equal(homeConference(history(), { id: 'e-old', name: null }).name, 'Region 4 Spring');
});

test('a rep choosing Earlier or All conferences gets grouping; this conference is one flat list', () => {
  const all = history();
  assert.deepEqual(all.filter((c) => inConferenceView(c, repView({ scope: 'earlier' }))).map((c) => c.id), ['b1']);
  assert.deepEqual(all.filter((c) => inConferenceView(c, repView({ scope: 'all' }))).length, 3);
  assert.equal(groupedByConference(repView({ scope: 'current' })), false);
  assert.equal(groupedByConference(repView({ scope: 'earlier' })), true);
  assert.equal(groupedByConference(repView({ scope: 'all' })), true);
});

test('typing a search looks across ALL the rep\'s conferences and shows them flat', () => {
  const all = history();
  const v = repView({ searching: true });
  assert.equal(all.filter((c) => inConferenceView(c, v)).length, 3);
  assert.equal(groupedByConference(repView({ scope: 'all', searching: true })), false);
  assert.equal(conferenceLine(v, null), 'Searching all your conferences');
});

test('managers default to All conferences and may pick one; a search still looks across all', () => {
  const all = history();
  const mgr = (over) => ({ isSales: false, scope: 'current', eventId: null, home: { id: null, name: null, kind: 'none' }, searching: false, ...over });
  assert.equal(all.filter((c) => inConferenceView(c, mgr())).length, 3);
  assert.equal(conferenceLine(mgr(), null), 'All conferences');
  assert.deepEqual(all.filter((c) => inConferenceView(c, mgr({ eventId: 'e-old' }))).map((c) => c.id), ['b1']);
  assert.equal(conferenceLine(mgr({ eventId: 'e-old' }), 'Region 4 Spring'), 'Region 4 Spring');
  assert.equal(all.filter((c) => inConferenceView(c, mgr({ eventId: 'e-old', searching: true }))).length, 3);
  assert.equal(groupedByConference(mgr()), false);
});

test('the manager\'s conference select lists every conference with contacts, newest first', () => {
  assert.deepEqual(conferenceOptions(history()), [
    { value: 'e-new', label: 'MoASSP Fall 2026' },
    { value: 'e-old', label: 'Region 4 Spring' },
  ]);
});

// ── The Filter button's count ────────────────────────────────────────────

test('the Filter badge counts what differs from the defaults, and only what the role can see', () => {
  assert.equal(activeFilterCount(DEFAULT_FILTERS, true), 0);
  assert.equal(activeFilterCount({ ...DEFAULT_FILTERS, show: 'rejected' }, true), 1);
  assert.equal(activeFilterCount({ ...DEFAULT_FILTERS, scope: 'all', follow: 'todo', source: 'kiosk', sort: 'name' }, true), 4);
  // A rep's leftover manager fields never show as a number they cannot clear.
  assert.equal(activeFilterCount({ ...DEFAULT_FILTERS, repId: 'r9', synced: 'true', eventId: 'e1' }, true), 0);
  assert.equal(activeFilterCount({ ...DEFAULT_FILTERS, repId: 'r9', synced: 'true', eventId: 'e1' }, false), 3);
  assert.equal(activeFilterCount({ ...DEFAULT_FILTERS, scope: 'all' }, false), 0);
});

test('Followed up: Any keeps everything, Not yet and Done split it', () => {
  const list = [lead({ id: 'a', followedUp: true }), lead({ id: 'b' })];
  assert.equal(filterByFollowUp(list, 'any').length, 2);
  assert.deepEqual(filterByFollowUp(list, 'todo').map((c) => c.id), ['b']);
  assert.deepEqual(filterByFollowUp(list, 'done').map((c) => c.id), ['a']);
});
