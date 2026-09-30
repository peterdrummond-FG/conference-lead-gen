// Run: cd frontend && npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { conferenceEndedLabel, formatPhone, cleanConferenceName } from './conferenceName.ts';

const noon = (y, m, d) => new Date(y, m - 1, d, 12);

test('nothing is said while a conference is running, upcoming or undated', () => {
  assert.equal(conferenceEndedLabel(null, noon(2026, 9, 30)), null);
  assert.equal(conferenceEndedLabel('2026-09-30', noon(2026, 9, 30)), null, 'last day is still a live day');
  assert.equal(conferenceEndedLabel('2026-10-02', noon(2026, 9, 30)), null);
});

test('a finished conference says how long ago, without saying it stopped working', () => {
  assert.equal(conferenceEndedLabel('2026-09-29', noon(2026, 9, 30)), 'Ended yesterday');
  assert.equal(conferenceEndedLabel('2026-09-28', noon(2026, 9, 30)), 'Ended 2 days ago');
  // Across a month boundary.
  assert.equal(conferenceEndedLabel('2026-09-29', noon(2026, 10, 2)), 'Ended 3 days ago');
});

test('the ended label counts calendar days, not 24-hour blocks', () => {
  assert.equal(conferenceEndedLabel('2026-09-29', new Date(2026, 8, 30, 0, 5)), 'Ended yesterday');
  assert.equal(conferenceEndedLabel('2026-09-29', new Date(2026, 8, 30, 23, 55)), 'Ended yesterday');
});

test('phone numbers are shown as (555) 123-4567 and odd ones are left alone', () => {
  assert.equal(formatPhone('+15551234567'), '(555) 123-4567');
  assert.equal(formatPhone('5551234567'), '(555) 123-4567');
  assert.equal(formatPhone('1 (555) 123-4567'), '(555) 123-4567');
  assert.equal(formatPhone('+442071838750'), '+442071838750');
  assert.equal(formatPhone(null), null);
  assert.equal(formatPhone(''), null);
});

test('the date and state prefix is stripped from a conference title', () => {
  assert.equal(cleanConferenceName('2026 09.29 (TX) Region 4 Fall Meetings'), 'Region 4 Fall Meetings');
  assert.equal(cleanConferenceName('2026 09.20-22 (MO) MoASSP Fall Conference'), 'MoASSP Fall Conference');
  assert.equal(cleanConferenceName('Peter Test Conference'), 'Peter Test Conference');
});
