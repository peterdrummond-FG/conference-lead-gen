// Run: cd frontend && npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CONTACTS_PAGE_SIZE, MAX_CONTACTS_PER_LIST, appendUnseen, isTooMany, loadingLine, pageCount, remainingPages, skippedSummary,
} from './contactsPaging.ts';

test('a list is requested 100 contacts at a time', () => {
  assert.equal(CONTACTS_PAGE_SIZE, 100);
});

test('page counts: 0, 1, 100, 101, 342 contacts', () => {
  assert.deepEqual([0, 1, 100, 101, 342].map(pageCount), [0, 1, 1, 2, 4]);
});

test('pages still to fetch after the first', () => {
  assert.deepEqual(remainingPages(0), []);
  assert.deepEqual(remainingPages(100), []);
  assert.deepEqual(remainingPages(101), [2]);
  assert.deepEqual(remainingPages(342), [2, 3, 4]);
});

test('over 5,000 in one list is too many; exactly 5,000 is not', () => {
  assert.equal(MAX_CONTACTS_PER_LIST, 5000);
  assert.equal(isTooMany(5000), false);
  assert.equal(isTooMany(5001), true);
});

test('appendUnseen skips an id already seen, and records new ones', () => {
  const seen = new Set(['a']);
  const out = appendUnseen(seen, [{ id: 'a' }], [{ id: 'a' }, { id: 'b' }, { id: 'b' }, { id: 'c' }]);
  assert.deepEqual(out.map((r) => r.id), ['a', 'b', 'c']);
  assert.deepEqual([...seen].sort(), ['a', 'b', 'c']);
});

test('a lead the person already moved is not put back by a stale page', () => {
  // L was confirmed locally (so it is in the approved list and in `seen`); a page of the
  // unconfirmed list fetched earlier still contains it.
  const seen = new Set(['L']);
  assert.deepEqual(appendUnseen(seen, [], [{ id: 'L' }, { id: 'M' }]).map((r) => r.id), ['M']);
});

test('the words on screen match the approved mockup', () => {
  assert.equal(loadingLine(100, 342), 'Loading all contacts: 100 of 342');
});

test('the skipped summary names each kind in a rep\'s words', () => {
  const skipped = [
    { id: '1', reason: 'still pending' },
    { id: '2', reason: 'no longer waiting for confirmation' },
    { id: '3', reason: 'no longer waiting for confirmation' },
    { id: '4', reason: 'not found' },
  ];
  assert.equal(skippedSummary(skipped), '1 still matching, 2 already confirmed or rejected, 1 not found');
  assert.equal(skippedSummary([]), '');
});

test('the reasons it understands are the ones contacts-bulk-approve really returns', () => {
  const src = readFileSync(new URL('../../../supabase/functions/_shared/bulkApprove.ts', import.meta.url), 'utf8');
  assert.match(src, /REASON_STILL_PENDING = "still pending"/);
  assert.match(src, /REASON_NOT_WAITING = "no longer waiting for confirmation"/);
});

test('the page size here is one contacts-list accepts and the cap is the one it enforces', () => {
  const page = readFileSync(new URL('../../../supabase/functions/_shared/pageParams.ts', import.meta.url), 'utf8');
  assert.match(page, /MAX_PAGE_SIZE = 100/);
  const refs = readFileSync(new URL('../../../supabase/functions/_shared/referenceLists.ts', import.meta.url), 'utf8');
  assert.match(refs, /MAX_ROWS = 5000/);
});
