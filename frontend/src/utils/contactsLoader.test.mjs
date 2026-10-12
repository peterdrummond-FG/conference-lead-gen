// Run: cd frontend && npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createContactsLoader } from './contactsLoader.ts';

// A fake server: for each job key (status + scope) a list of rows, served 100 per page,
// with an optional per-request delay so tests can interleave loads.
function setup({ lists, writes = { n: 0 }, busy = { n: 0 } }) {
  const buckets = { needs_review: [], approved: [], rejected: [] };
  const state = { loading: false, loaded: false, loadingMore: false, loadError: false, tooMany: false, loadedCount: 0, totalCount: 0 };
  const requests = [];
  const gates = [];
  let failPage = null;
  const key = (job) => `${job.status}`;
  const fetchPage = async (job, page) => {
    requests.push(`${key(job)}#${page}`);
    // Tests can hold a request until they release it.
    const gate = gates.shift();
    if (gate) await gate;
    if (failPage === page) throw new Error('network');
    const all = lists[key(job)] ?? [];
    return { items: all.slice((page - 1) * 100, page * 100), total: all.length };
  };
  const deps = {
    buildJobs: () => ['needs_review', 'approved', 'rejected'].map((status) => ({ status, extra: {} })),
    fetchPage, buckets, state, writes: () => writes.n, busyCount: () => busy.n,
  };
  const loader = createContactsLoader(deps);
  return { loader, buckets, state, requests, gates, writes, busy, failOn: (p) => { failPage = p; } };
}
const rows = (prefix, n) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));
const ids = (list) => list.map((r) => r.id);
const settle = () => new Promise((r) => setTimeout(r, 0));

test('a short list is one request per list and no "loading more"', async () => {
  const t = setup({ lists: { needs_review: rows('n', 30), approved: rows('a', 5) } });
  await t.loader.load();
  assert.equal(t.buckets.needs_review.length, 30);
  assert.equal(t.state.loaded, true);
  assert.equal(t.state.loadingMore, false);
  assert.equal(t.state.totalCount, 35);
  assert.equal(t.requests.length, 3);
});

test('a long list shows its first 100 at once, then the rest arrive', async () => {
  const t = setup({ lists: { needs_review: rows('n', 342) } });
  let completed = 0;
  // Hold the second page open (the first page of each of the three lists goes straight through).
  let release; t.gates.push(null, null, null, new Promise((r) => { release = r; }));
  await t.loader.load({ onComplete: () => { completed++; } });
  // load() has returned: first page is on screen, the rest is still coming.
  assert.equal(t.buckets.needs_review.length, 100);
  assert.equal(t.state.loaded, true);
  assert.equal(t.state.loadingMore, true);
  assert.equal(t.state.totalCount, 342);
  release();
  await settle();
  assert.equal(t.buckets.needs_review.length, 342);
  assert.equal(t.state.loadedCount, 342);
  assert.equal(t.state.loadingMore, false);
  assert.equal(completed, 1);
  assert.deepEqual(new Set(ids(t.buckets.needs_review)).size, 342);
});

test('a lead confirmed while pages load is not put back by a later page that still lists it', async () => {
  const lists = { needs_review: rows('n', 250) };
  const t = setup({ lists });
  let release; t.gates.push(null, null, null, new Promise((r) => { release = r; }));
  await t.loader.load();
  assert.equal(t.state.loadingMore, true);
  // The person confirms n5 (on page 1): it moves to the confirmed list locally...
  const moved = t.buckets.needs_review.find((r) => r.id === 'n5');
  t.buckets.needs_review = t.buckets.needs_review.filter((r) => r.id !== 'n5');
  t.buckets.approved = [...t.buckets.approved, moved];
  // ...but the server answers page 2 from before that change, and a new contact has pushed
  // n5 down onto it.
  lists.needs_review = [...rows('z', 100), { id: 'n5' }, ...rows('m', 149)];
  release();
  await settle();
  assert.equal(t.buckets.needs_review.some((r) => r.id === 'n5'), false, 'not back in the unconfirmed list');
  assert.equal(t.buckets.approved.filter((r) => r.id === 'n5').length, 1, 'still confirmed, once');
});

test('a row that appears on two pages is kept once', async () => {
  const lists = { needs_review: rows('n', 150) };
  const t = setup({ lists });
  await t.loader.load();
  // A contact created meanwhile shifts the server list: the old row 99 now also leads page 2.
  lists.needs_review = [{ id: 'new' }, ...lists.needs_review];
  await settle();
  const all = ids(t.buckets.needs_review);
  assert.equal(new Set(all).size, all.length);
});

test('a quiet refresh does not change the lists until every page is in', async () => {
  const lists = { needs_review: rows('n', 250) };
  const t = setup({ lists });
  await t.loader.load();
  await settle();
  assert.equal(t.buckets.needs_review.length, 250);
  lists.needs_review = rows('q', 250);
  // Hold page 2 of the refresh open and look in the middle.
  let release; t.gates.push(null, null, new Promise((r) => { release = r; }));
  const quiet = t.loader.load({ quiet: true });
  await settle();
  assert.equal(t.buckets.needs_review.length, 250);
  assert.equal(t.buckets.needs_review[0].id, 'n0', 'still the old list while the refresh is half done');
  release();
  await quiet;
  assert.equal(t.buckets.needs_review.length, 250);
  assert.equal(t.buckets.needs_review[0].id, 'q0');
});

test('a quiet refresh that overlaps a write is dropped', async () => {
  const lists = { needs_review: rows('n', 30) };
  const t = setup({ lists });
  await t.loader.load();
  lists.needs_review = rows('q', 30);
  let release; t.gates.push(new Promise((r) => { release = r; }));
  const quiet = t.loader.load({ quiet: true });
  t.writes.n++;           // a write starts while the refresh is in flight
  release();
  await quiet;
  assert.equal(t.buckets.needs_review[0].id, 'n0');
});

test('a quiet refresh is skipped while a list is still loading its later pages', async () => {
  const t = setup({ lists: { needs_review: rows('n', 342) } });
  let release; t.gates.push(null, null, null, new Promise((r) => { release = r; }));
  await t.loader.load();
  assert.equal(t.state.loadingMore, true);
  const before = t.requests.length;
  await t.loader.load({ quiet: true });
  assert.equal(t.requests.length, before, 'no new requests were made');
  release();
  await settle();
  assert.equal(t.buckets.needs_review.length, 342);
});

test('a newer load stops an older one from filling the lists', async () => {
  const lists = { needs_review: rows('old', 342) };
  const t = setup({ lists });
  await t.loader.load();
  lists.needs_review = rows('new', 120);
  await t.loader.load();
  await settle();
  assert.equal(t.buckets.needs_review.length, 120);
  assert.ok(t.buckets.needs_review.every((r) => r.id.startsWith('new')));
});

test('over 5,000 shows only the first page and says so', async () => {
  const t = setup({ lists: { needs_review: rows('n', 5001) } });
  await t.loader.load();
  await settle();
  assert.equal(t.state.tooMany, true);
  assert.equal(t.buckets.needs_review.length, 100);
  assert.equal(t.state.loadingMore, false);
  assert.equal(t.requests.length, 3, 'only the first page of each list was requested');
});

test('a page that fails leaves the list marked as not fully loaded', async () => {
  const t = setup({ lists: { needs_review: rows('n', 250) } });
  t.failOn(2);
  await t.loader.load();
  await settle();
  assert.equal(t.state.loadError, true);
  assert.equal(t.state.loadingMore, false);
  assert.equal(t.buckets.needs_review.length, 100);
});
