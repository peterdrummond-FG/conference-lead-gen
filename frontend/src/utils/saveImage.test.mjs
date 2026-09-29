// Run: cd frontend && npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickSaveStrategy } from './saveImage.ts';

const file = new File([new Uint8Array([1])], 'slide.png', { type: 'image/png' });
const sharing = { share: async () => {}, canShare: () => true };

test('desktop always downloads, even where navigator.share exists', () => {
  assert.equal(pickSaveStrategy(sharing, file, false), 'download');
  assert.equal(pickSaveStrategy({}, file, false), 'download');
});

test('mobile with file sharing opens the share sheet (Save Image -> Photos)', () => {
  assert.equal(pickSaveStrategy(sharing, file, true), 'share');
});

test('mobile that cannot share files falls back to the long-press image, not a silent download', () => {
  assert.equal(pickSaveStrategy({}, file, true), 'manual');
  assert.equal(pickSaveStrategy({ share: async () => {} }, file, true), 'manual');
  assert.equal(pickSaveStrategy({ share: async () => {}, canShare: () => false }, file, true), 'manual');
});
