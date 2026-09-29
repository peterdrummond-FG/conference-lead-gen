// Run: cd frontend && npm test
// Node strips the TypeScript types itself, so no build step is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountBadge, eventRecency, groupByEvent, isReady, leadFlags, readyIds, searchLeads, sortLeads,
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

test('ambiguous match informs but does not block', () => {
  const c = lead({ matchStatus: 'ambiguous' });
  assert.equal(isReady(c), true);
  assert.equal(leadFlags(c)[0].key, 'unclear');
  assert.equal(leadFlags(c)[0].blocking, false);
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

test('attention sort floats blocked leads up, newest first within each group', () => {
  const list = [
    lead({ id: 'ok-old', createdAt: '2026-09-01T00:00:00Z' }),
    lead({ id: 'bad-old', email: null, phone: null, createdAt: '2026-09-02T00:00:00Z' }),
    lead({ id: 'ok-new', createdAt: '2026-09-04T00:00:00Z' }),
    lead({ id: 'bad-new', matchStatus: 'pending', createdAt: '2026-09-03T00:00:00Z' }),
  ];
  assert.deepEqual(sortLeads(list, 'attention').map((c) => c.id), ['bad-new', 'bad-old', 'ok-new', 'ok-old']);
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
