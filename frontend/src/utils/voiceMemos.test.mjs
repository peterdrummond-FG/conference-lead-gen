// Run: cd frontend && npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUTO_ATTEMPTS, ASSIGN_HINT, MAX_CREATE_ATTEMPTS, assignedToast, candidateName, canCreate, canRetry, clock, createNote,
  filterCandidates, isBusy, memoState, memoTime, sectionCount, sectionHelp, SECTION_TITLE, canRetryFailed, failedDelete, failedRetryToast, failedState, failedText,
} from './voiceMemos.ts';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(SRC, '..', '..');
const fn = (name) => readFileSync(join(REPO, 'supabase/functions', name, 'index.ts'), 'utf8');

const memo = (over = {}) => ({ linkStatus: 'unlinked', create: null, ...over });

test('a memo is Needs review only once matching has given up', () => {
  assert.equal(memoState(memo()), 'matching');
  assert.equal(memoState(memo({ linkStatus: 'no_candidate_found' })), 'review');
});

test('while Create contacts runs the memo is creating, whatever its link status, and nothing can be done to it', () => {
  const working = { status: 'working', error: null, attempts: 1 };
  for (const linkStatus of ['unlinked', 'no_candidate_found']) {
    const m = memo({ linkStatus, create: working });
    assert.equal(memoState(m), 'creating');
    assert.equal(isBusy(m), true);
    assert.equal(canRetry(m), false);
    assert.equal(canCreate(m), false);
  }
});

test('Retry matching is only offered on a memo that gave up', () => {
  assert.equal(canRetry(memo()), false);
  assert.equal(canRetry(memo({ linkStatus: 'no_candidate_found' })), true);
});

test('Create contacts stops being offered after the same number of tries the server allows', () => {
  const tried = (n) => memo({ create: { status: 'none', error: null, attempts: n } });
  assert.equal(canCreate(memo()), true);
  assert.equal(canCreate(tried(MAX_CREATE_ATTEMPTS - 1)), true);
  assert.equal(canCreate(tried(MAX_CREATE_ATTEMPTS)), false);
  assert.match(fn('inbound-messages-create-contacts'), new RegExp(`MAX_ATTEMPTS = ${MAX_CREATE_ATTEMPTS};`));
});

test('the note under the buttons says what happened and what is left to do', () => {
  assert.equal(createNote(memo()), null);
  assert.equal(createNote(memo({ create: { status: 'working', error: null, attempts: 1 } })), null);
  assert.match(createNote(memo({ create: { status: 'none', error: null, attempts: 1 } })), /try again/);
  assert.doesNotMatch(createNote(memo({ create: { status: 'none', error: null, attempts: MAX_CREATE_ATTEMPTS } })), /try again/i);
  assert.match(createNote(memo({ create: { status: 'failed', error: 'x', attempts: 1 } })), /Try again/);
  assert.doesNotMatch(createNote(memo({ create: { status: 'failed', error: 'x', attempts: MAX_CREATE_ATTEMPTS } })), /Try again/);
});

test('section words agree with the number and with what is in it', () => {
  assert.equal(SECTION_TITLE, 'Unlinked Voice Memos / Errors');
  assert.equal(sectionCount(1), '1 item');
  assert.equal(sectionCount(3), '3 items');
  assert.equal(sectionHelp(1, 0), "We couldn't tell who this is about.");
  assert.equal(sectionHelp(2, 0), "We couldn't tell who these are about.");
  assert.equal(sectionHelp(0, 1), "This couldn't be read.");
  assert.equal(sectionHelp(0, 2), "These couldn't be read.");
  assert.match(sectionHelp(1, 1), /match to a contact.*couldn't read/);
});

test('a failed item can be retried by hand only where the system has given up', () => {
  assert.equal(canRetryFailed({ errorClass: 'terminal' }), true);
  assert.equal(canRetryFailed({ errorClass: null }), true);
  assert.equal(canRetryFailed({ errorClass: 'transient' }), false);
  assert.equal(failedState({ errorClass: 'transient' }), 'Retrying automatically');
  assert.equal(failedState({ errorClass: 'terminal' }), 'Needs manual retry');
});

test('a failed item says what it was and why, and the delete words match the kind', () => {
  assert.equal(failedText({ kind: 'photo', errorClass: 'terminal', error: 'no legible business card detected in photo' }), 'Card photo: no legible business card detected in photo');
  assert.equal(failedText({ kind: 'audio', errorClass: null, error: null }), "Voice memo: couldn't be processed");
  assert.equal(failedDelete({ kind: 'photo' }).title, 'Delete this photo?');
  assert.equal(failedDelete({ kind: 'audio' }).title, 'Delete voice memo?');
  assert.match(failedRetryToast({ kind: 'photo' }), /card reads/);
});

test('a memo from today shows the time, an older one shows the day too', () => {
  const now = new Date(2026, 9, 7, 16, 0);
  assert.equal(memoTime(new Date(2026, 9, 7, 14, 14).toISOString(), now), '2:14 PM');
  assert.equal(memoTime(new Date(2026, 9, 6, 9, 5).toISOString(), now), 'Oct 6, 9:05 AM');
});

test('the player clock never shows a negative or odd number', () => {
  assert.equal(clock(48.7), '0:48');
  assert.equal(clock(125), '2:05');
  assert.equal(clock(NaN), '0:00');
  assert.equal(clock(-3), '0:00');
});

test('the candidate search wants every word and ignores case and order', () => {
  const list = [
    { id: '1', firstName: 'Marcus', lastName: 'Bell', email: 'mbell@x.org', title: 'Assistant Principal' },
    { id: '2', firstName: 'Tom', lastName: 'Okafor', email: null, title: 'Principal' },
  ];
  assert.deepEqual(filterCandidates(list, '').map((c) => c.id), ['1', '2']);
  assert.deepEqual(filterCandidates(list, 'bell marcus').map((c) => c.id), ['1']);
  assert.deepEqual(filterCandidates(list, 'PRINCIPAL').map((c) => c.id), ['1', '2']);
  assert.deepEqual(filterCandidates(list, 'zzz'), []);
  assert.equal(candidateName({ firstName: '', lastName: '' }), '(no name)');
  assert.equal(assignedToast('Marcus Bell'), "Added to Marcus Bell's notes");
});

// ── Promises the words make about the pipeline ──────────────────────────────────

test("'the whole transcript is added to their notes' is what inbound-messages-assign does", () => {
  assert.match(ASSIGN_HINT, /whole transcript.*notes/);
  const src = fn('inbound-messages-assign');
  assert.match(src, /interaction_notes/);
  assert.match(src, /message\.transcript/);
});

test('"goes to Zoho with the import" is true: export-csv reads interaction_notes', () => {
  assert.match(readFileSync(join(REPO, 'supabase/functions/export-csv/index.ts'), 'utf8'), /interaction_notes/);
});

test('the auto-retry count in the help line is the one the agent and the n8n sweep use', () => {
  assert.equal(AUTO_ATTEMPTS, 20);
  assert.match(readFileSync(join(REPO, 'local-agent/agent.mjs'), 'utf8'), /LINK_MAX_ATTEMPTS \?\? 20/);
  assert.match(readFileSync(join(REPO, 'n8n/workflows/pipeline-relink-unlinked-audio.json'), 'utf8'), /claim_unlinked_audio_messages\(50, 20, 3\)/);
});

test('Create contacts files people as voice memos and only marks the memo done once someone exists', () => {
  const note = fn('contacts-from-note');
  assert.match(note, /source: memoId \? "voice_memo" : "note"/);
  // The memo is updated after the insert, never before: a run that finds nobody must
  // leave it in the list.
  assert.ok(note.indexOf('insert_contact_with_duplicate_check') < note.indexOf('contact_created'));
  assert.match(readFileSync(join(REPO, 'supabase/migrations/20261008100000_voice_memo_actions.sql'), 'utf8'), /source_message_id uuid references public\.inbound_messages\(id\) on delete set null/);
});

test('the automatic retry sweep skips a memo a person is creating contacts from', () => {
  assert.match(readFileSync(join(REPO, 'supabase/migrations/20261008100000_voice_memo_actions.sql'), 'utf8'), /ns\.source_message_id = m\.id[\s\S]*pending_extraction/);
});

test('delete refuses while contacts are being created, and the list only shows memos that have a transcript', () => {
  assert.match(fn('inbound-messages-delete'), /pending_extraction/);
  assert.match(fn('inbound-messages-unresolved-list'), /\.not\("transcript", "is", null\)/);
});

test('delete accepts a failed photo or memo, from the right bucket, and still guards against a stale tab', () => {
  const del = fn('inbound-messages-delete');
  assert.match(del, /status === "failed"/);
  assert.match(del, /kind === "photo" \? "contact-photos" : "voice-memos"/);
  // The photo viewer's function reads the same bucket the webhook stores photos in.
  assert.match(fn('inbound-messages-photo'), /from\("contact-photos"\)/);
  assert.match(readFileSync(join(REPO, 'supabase/functions/twilio-webhook/index.ts'), 'utf8'), /kind === "photo" \? "contact-photos" : "voice-memos"/);
});

test('a batch of only voice memos never gets a "0 contacts" text, and a zero-contact photo batch says what went wrong', () => {
  const src = fn('session-notifications');
  assert.doesNotMatch(src, /`\$\{label\} received\.`\);/, 'the count text must go through the zero-contact check');
  assert.match(src, /n > 0\s*\? `\$\{label\} received\.`/);
  assert.match(src, /photos > 0/);
  assert.match(src, /if \(text === null\) continue;/);
  // The watermark is claimed BEFORE the silent skip, so a settled batch is not re-read every minute.
  assert.ok(src.indexOf('contacts_confirmed_through: newest.received_at') < src.indexOf('if (text === null) continue;'));
});
