// Runs the real handler behind a real HTTP server with the real ffmpeg-static
// binary, so a bad bundle path or a bad argument shows up here rather than in
// the first live memo. The AMR sample is synthesised (a valid narrowband header
// plus 12.2 kbit/s frames of silence) because the build has no AMR encoder and
// real memos are customer audio that does not belong in the repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import handler, { keyMatches, looksLikeAmr, MAX_INPUT_BYTES } from './api/convert.mjs';

const KEY = 'test-key-not-a-secret';

function silentAmr(frames) {
  // 0x3C = frame type 7 (12.2 kbit/s), quality bit set; 31 payload bytes.
  const frame = Buffer.concat([Buffer.from([0x3c]), Buffer.alloc(31)]);
  return Buffer.concat([Buffer.from('#!AMR\n'), ...Array.from({ length: frames }, () => frame)]);
}

async function withServer(fn) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try { await fn(url); } finally { await new Promise((r) => server.close(r)); }
}

const post = (url, body, headers = {}) =>
  fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/octet-stream', ...headers } });

test('keyMatches: equal, unequal, empty and non-string', () => {
  assert.equal(keyMatches('abc', 'abc'), true);
  assert.equal(keyMatches('abd', 'abc'), false);
  assert.equal(keyMatches('abcd', 'abc'), false);
  assert.equal(keyMatches('', ''), false, 'an empty configured key must never authenticate');
  assert.equal(keyMatches(undefined, 'abc'), false);
});

test('looksLikeAmr accepts NB and WB headers, refuses other bytes', () => {
  assert.equal(looksLikeAmr(Buffer.from('#!AMR\n' + 'x'.repeat(40))), true);
  assert.equal(looksLikeAmr(Buffer.from('#!AMR-WB\n' + 'x'.repeat(40))), true);
  assert.equal(looksLikeAmr(Buffer.from('{"error":"not found"}')), false);
  assert.equal(looksLikeAmr(Buffer.alloc(0)), false);
});

test('fails closed when no key is configured', async () => {
  delete process.env.FFMPEG_SERVICE_KEY;
  await withServer(async (url) => {
    const res = await post(url, silentAmr(50), { Authorization: 'Bearer anything' });
    assert.equal(res.status, 500);
  });
});

test('refuses missing/wrong key, wrong method, non-AMR and oversize input', async () => {
  process.env.FFMPEG_SERVICE_KEY = KEY;
  await withServer(async (url) => {
    assert.equal((await post(url, silentAmr(50))).status, 401);
    assert.equal((await post(url, silentAmr(50), { Authorization: 'Bearer nope' })).status, 401);
    assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${KEY}` } })).status, 405);
    assert.equal((await post(url, Buffer.from('<html>not audio</html>'), { Authorization: `Bearer ${KEY}` })).status, 415);
    const big = Buffer.concat([Buffer.from('#!AMR\n'), Buffer.alloc(MAX_INPUT_BYTES)]);
    assert.equal((await post(url, big, { Authorization: `Bearer ${KEY}` })).status, 413);
  });
});

test('converts AMR to a playable M4A', async () => {
  process.env.FFMPEG_SERVICE_KEY = KEY;
  await withServer(async (url) => {
    const res = await post(url, silentAmr(150), { Authorization: `Bearer ${KEY}` });
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(res.headers.get('content-type'), 'audio/mp4');
    const out = Buffer.from(await res.arrayBuffer());
    // An MP4/M4A container carries an 'ftyp' box at byte 4.
    assert.equal(out.subarray(4, 8).toString('latin1'), 'ftyp');
    assert.ok(out.length > 500);
  });
});

test('a corrupt AMR body is a 502 with the ffmpeg reason, not a hang', async () => {
  process.env.FFMPEG_SERVICE_KEY = KEY;
  await withServer(async (url) => {
    const res = await post(url, Buffer.concat([Buffer.from('#!AMR\n'), Buffer.from('this is not amr data at all')]), { Authorization: `Bearer ${KEY}` });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, 'conversion failed');
  });
});
