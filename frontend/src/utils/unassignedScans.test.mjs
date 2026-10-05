// Run: cd frontend && npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REASONS, allQueueCopy, bannerText, reasonText, waitingText } from './unassignedScans.ts';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(SRC, '..', '..');

test('every reason the database allows has words, and the words match the approved mockup', () => {
  assert.equal(reasonText({ reason: 'rep_no_conference', repName: 'Jamie Cole', eventHintName: null }), "Jamie Cole's QR. Jamie isn't at a conference.");
  assert.equal(reasonText({ reason: 'event_ended', repName: null, eventHintName: 'TASSP Summer' }), 'Printed QR for TASSP Summer. That conference has ended.');
  assert.equal(reasonText({ reason: 'no_qr', repName: null, eventHintName: null }), 'No QR details.');
  for (const r of REASONS) assert.ok(reasonText({ reason: r, repName: null, eventHintName: null }).length > 5, r);
});

test('the reasons are exactly the ones the migration constrains the column to', () => {
  const sql = readFileSync(join(REPO, 'supabase/migrations/20261006100000_unassigned_submissions.sql'), 'utf8');
  const list = /reason in \(([^)]*)\)/.exec(sql)[1].match(/'([a-z_]+)'/g).map((s) => s.replaceAll("'", ''));
  assert.deepEqual([...list].sort(), [...REASONS].sort());
});

test('a rep is only named when the row has one', () => {
  assert.ok(!/undefined|null/.test(reasonText({ reason: 'rep_no_conference', repName: null, eventHintName: null })));
  assert.ok(!/undefined|null/.test(reasonText({ reason: 'event_ended', repName: null, eventHintName: null })));
});

test('the banner counts correctly', () => {
  assert.equal(bannerText(1), '1 scan needs a conference');
  assert.equal(bannerText(3), '3 scans need a conference');
});

test('waiting reads in minutes, hours, days', () => {
  const now = Date.parse('2026-10-06T12:00:00Z');
  assert.equal(waitingText('2026-10-06T11:59:40Z', now), 'Just now');
  assert.equal(waitingText('2026-10-06T11:15:00Z', now), 'Waiting 45m');
  assert.equal(waitingText('2026-10-06T10:00:00Z', now), 'Waiting 2h');
  assert.equal(waitingText('2026-10-03T12:00:00Z', now), 'Waiting 3d');
});

test('no staff-facing line uses developer words', () => {
  for (const line of allQueueCopy()) assert.ok(!/\b(409|404|slug|api|rpc|null|undefined|json)\b/i.test(line), line);
});
