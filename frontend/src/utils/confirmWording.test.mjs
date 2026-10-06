// Run: cd frontend && npm test
// "Approve" became "Confirm" everywhere a person reads it (2026-10-06). The stored
// status is still 'approved' and the API names still say approve, so code
// identifiers (approve, onApprove, bulkApprove, 'approved') are fine; this holds
// the WORDS. It looks for a capitalised Approve/Approved/Approving at the start of
// a word, and a few lowercase phrases that appear in sentences. A new screen that
// says "Approve" again fails here instead of reaching Peter's reps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('..', import.meta.url));

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(vue|ts)$/.test(name)) yield p;
  }
}

// Terms of Use talks about written *approval* from The Flippen Group: a legal
// word, not the button.
const SKIP = ['pages/TermsOfUsePage.vue'];
const BAD = /(?<![A-Za-z])Approv(e|ed|ing)|to approve|can be approved|approved lead|approve all|approve it|then approve|approve or/;

test('no screen or script says Approve any more (it says Confirm)', () => {
  const hits = [];
  for (const f of files(SRC)) {
    const rel = f.slice(SRC.length);
    if (SKIP.includes(rel)) continue;
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (BAD.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 90)}`);
    });
  }
  assert.deepEqual(hits, []);
});
