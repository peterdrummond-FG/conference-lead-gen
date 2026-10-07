// Run: cd frontend && npm test
// The lead editor's header has two layouts, chosen by the editor's own width (a container
// query, so the laptop pane and the phone sheet each get theirs). On a phone the arrows used to
// take ~150px of a 375px sheet and the chips wrapped one per line (146px of header for a
// manager). This holds the shape that fixed it, so a later edit can't quietly put it back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('..', import.meta.url));
const editor = readFileSync(join(SRC, 'components/contacts/ContactEditor.vue'), 'utf8');
const narrow = /@container le \(max-width: 560px\) \{([\s\S]*?)\n\}/.exec(editor)?.[1] ?? '';

test('on a phone the conference and rep move out of the chips into a quiet line, and "1 of N" goes with it', () => {
  assert.match(editor, /class="le-ctx"/);
  assert.match(editor, /whereText/);
  // The where-from line is for managers only: a rep's own conference is not news to them.
  assert.match(editor, /props\.isSales \? ''/);
  assert.match(narrow, /\.le-chip-ctx \{ display: none; \}/);
  assert.match(narrow, /\.le-pos-wide \{ display: none; \}/);
  // Hidden on the laptop pane, which has the room for chips and the arrows' own "1 of N".
  assert.match(editor, /\.le-ctx \{ display: none; \}/);
});

test('the phone sheet\'s previous / next / close are 44px touch targets', () => {
  assert.match(narrow, /\.le-nav :deep\(\.q-btn\.q-btn--round\) \{ width: 44px; height: 44px; min-width: 44px; min-height: 44px; \}/);
});

test('"1 of N" is read once: the phone copy is hidden from screen readers', () => {
  assert.match(editor, /<span v-if="position" class="le-pos" aria-hidden="true">/);
});
