// Run: cd frontend && npm test
// Node strips the TypeScript types itself, so no build step is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountBadge, appendNote, eventRecency, groupByEvent, isProcessing, isReady, leadCue, leadFlags, readinessChecklist, readyIds, searchLeads, sortLeads, summaryCounts,
} from './reviewSmart.ts';

function lead(over = {}) {
  return {
    id: 'c1', firstName: 'Dana', lastName: 'Whitfield', email: 'dana@example.org', phone: null, title: null,
    source: 'card_photo', qrChannel: null, repId: 'r1', repName: 'Rep', eventId: 'e1', eventName: 'Event One',
    state: 'TN', schoolDistrictId: 'd1', districtName: 'Knox County', schoolDistrictNameRaw: null,
    schoolId: null, schoolName: null, schoolNameRaw: null, matchStatus: 'new_account', matchAttempts: 0,
    matchedZohoAccountLevel: null, localDuplicateOfContactName: null, reviewStatus: 'needs_review',
    interactionNotes: null, contactIntent: null, followedUp: false, createdAt: '2026-09-01T10:00:00Z',
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

test('follow-up sort: not-yet-called first, hottest first, followed-up last; input not mutated', () => {
  const list = [
    lead({ id: 'done-hot', followedUp: true, contactIntent: 'hot' }),
    lead({ id: 'todo-cold', contactIntent: 'cold' }),
    lead({ id: 'todo-hot', contactIntent: 'hot' }),
    lead({ id: 'todo-none' }),
  ];
  const before = list.map((c) => c.id);
  assert.deepEqual(sortLeads(list, 'followup').map((c) => c.id), ['todo-hot', 'todo-cold', 'todo-none', 'done-hot']);
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
  const n = summaryCounts(list);
  assert.deepEqual(n, { ready: 2, needsInfo: 2, processing: 1 });
  assert.equal(n.ready + n.needsInfo + n.processing, list.filter((c) => c.reviewStatus === 'needs_review').length);
  assert.equal(n.ready, readyIds(list).length);
});

test('the checklist is all ticks exactly when the lead is ready to approve', () => {
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

import { buildRank, leadBucket, orderByRank, SORT_OPTIONS, DEFAULT_SORT } from './reviewSmart.ts';

const SORTS = { needs_review: 'newest', approved: 'followup', rejected: 'newest' };

function crowd() {
  const older = Array.from({ length: 12 }, (_, i) => lead({
    id: `old${i}`, schoolDistrictId: null, districtName: null, contactIntent: 'warm', // all need info
    createdAt: `2026-09-${String(10 + i).padStart(2, '0')}T10:00:00Z`,
  }));
  const jim = lead({ id: 'jim', schoolDistrictId: null, districtName: null, contactIntent: 'hot', createdAt: '2026-10-01T15:11:00Z' });
  return { older, jim };
}

test('To review is newest first, and readiness is not a sort option', () => {
  assert.equal(DEFAULT_SORT.needs_review, 'newest');
  assert.deepEqual(SORT_OPTIONS.needs_review.map((o) => o.value), ['newest', 'hot', 'name']);
});

test('making a lead Ready does not move it', () => {
  const { older, jim } = crowd();
  const list = [...older, jim];
  assert.equal(sortLeads(list, 'newest')[0].id, 'jim');
  Object.assign(jim, { schoolDistrictId: 'd9', districtName: 'Mesa USD' });
  assert.equal(sortLeads(list, 'newest')[0].id, 'jim');
});

test('the live Hot sort moves a lead the moment its heat is set (why it is frozen)', () => {
  const { older, jim } = crowd();
  const list = [...older, jim];
  assert.equal(sortLeads(list, 'hot')[0].id, 'jim');
  Object.assign(jim, { contactIntent: 'cold' });
  assert.notEqual(sortLeads(list, 'hot')[0].id, 'jim');
});

test('a frozen order keeps an edited lead where it was', () => {
  const { older, jim } = crowd();
  const buckets = { needs_review: [...older, jim], approved: [], rejected: [] };
  const sorts = { ...SORTS, needs_review: 'hot' };
  const rank = buildRank(buckets, sorts);
  Object.assign(jim, { contactIntent: 'cold' });
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

test('leadBucket puts every to-review lead in exactly one pill, matching summaryCounts', () => {
  const list = [
    lead({ id: 'a' }),
    lead({ id: 'b', schoolDistrictId: null, districtName: null }),
    lead({ id: 'c', matchStatus: 'pending', matchAttempts: 0 }),
    lead({ id: 'd', matchStatus: 'pending', matchAttempts: 3 }),
    lead({ id: 'e', reviewStatus: 'approved' }),
  ];
  assert.deepEqual(list.map(leadBucket), ['ready', 'needsInfo', 'processing', 'needsInfo', null]);
  assert.deepEqual(summaryCounts(list), { ready: 1, needsInfo: 2, processing: 1 });
});
