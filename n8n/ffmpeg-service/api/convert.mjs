// AMR -> M4A for the n8n voice pipeline (pipeline-voice-transcription).
//
// Why this exists: phones send voice memos as AMR and OpenAI's transcription
// API rejects it, so something has to run ffmpeg. The n8n server's admin could
// not install it (no ffmpeg, Execute Command blocked, the community node's
// bundled binary missing libmvec.so.1), and the laptop-hosted local-agent was
// the thing we were trying to leave. This is one stateless function: bytes in,
// bytes out, nothing stored.
//
// Contract: POST raw AMR bytes with `Authorization: Bearer <FFMPEG_SERVICE_KEY>`;
// 200 + audio/mp4 on success. Anything else is an error with a JSON body and
// the caller (n8n's Converted? node) treats it as a failed conversion.

import { execFile } from 'node:child_process';
import { timingSafeEqual, randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';

const run = promisify(execFile);

// Vercel rejects request and response bodies over 4.5 MB. Cap the input below
// that, and refuse (rather than truncate) an output that would not fit, because
// a half-sent transcript source is worse than a loud failure. At the 15-minute
// cap below, mono 16 kHz AAC at 32 kbit/s is about 3.6 MB, so a real memo fits;
// AMR-NB at 12.2 kbit/s is about 1.4 MB for the same 15 minutes.
export const MAX_INPUT_BYTES = 4_000_000;
export const MAX_OUTPUT_BYTES = 4_400_000;
const MAX_SECONDS = 900;

// An AMR file starts with "#!AMR\n" (narrowband) or "#!AMR-WB\n" (wideband).
// Checking it means a stray PNG or a JSON error page is refused before it
// reaches the decoder; it is a sanity check, not a security boundary (ffmpeg is
// run without a shell, on a path we generate).
export function looksLikeAmr(buf) {
  return buf.length > 8 && buf.subarray(0, 5).toString('latin1') === '#!AMR';
}

// Compare through a hash so unequal lengths cost the same as equal ones and
// timingSafeEqual (which throws on a length mismatch) never sees them.
export function keyMatches(presented, expected) {
  if (typeof presented !== 'string' || typeof expected !== 'string' || expected === '') return false;
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

async function readBody(req, limit) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  // Fail closed: with no key configured this endpoint would be a free public
  // transcoder, so an unset env var is a 500, never "no auth required".
  const expected = process.env.FFMPEG_SERVICE_KEY;
  if (!expected) return send(res, 500, { error: 'FFMPEG_SERVICE_KEY is not configured' });

  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });

  const bearer = String(req.headers.authorization ?? '').replace(/^Bearer /i, '');
  if (!keyMatches(bearer, expected)) return send(res, 401, { error: 'unauthorized' });

  // Content-Length is checked first so an oversized upload is refused before it
  // is buffered; readBody re-checks because the header can be absent or wrong.
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_INPUT_BYTES) {
    return send(res, 413, { error: `input over ${MAX_INPUT_BYTES} bytes` });
  }
  const input = await readBody(req, MAX_INPUT_BYTES);
  if (input === null) return send(res, 413, { error: `input over ${MAX_INPUT_BYTES} bytes` });
  if (!looksLikeAmr(input)) return send(res, 415, { error: 'input is not an AMR file' });

  // Names come from randomUUID, never from the request, so nothing the caller
  // sends reaches a path or an argument.
  const dir = join(tmpdir(), 'ckh-voice');
  const id = randomUUID();
  const inPath = join(dir, `${id}.amr`);
  const outPath = join(dir, `${id}.m4a`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(inPath, input);
    // Same arguments the pipeline used on the n8n host: mono 16 kHz AAC keeps
    // the upload small and is what the transcription model wants anyway.
    await run(ffmpegPath, [
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
      '-t', String(MAX_SECONDS),
      '-i', inPath,
      '-ac', '1', '-ar', '16000', '-c:a', 'aac', '-b:a', '32k',
      outPath,
    ], { timeout: 50_000, maxBuffer: 1_000_000 });

    const output = await readFile(outPath);
    if (output.length === 0) return send(res, 502, { error: 'ffmpeg produced no audio' });
    if (output.length > MAX_OUTPUT_BYTES) return send(res, 413, { error: 'converted audio too large to return' });

    res.statusCode = 200;
    res.setHeader('Content-Type', 'audio/mp4');
    res.setHeader('Content-Length', String(output.length));
    res.setHeader('Cache-Control', 'no-store');
    res.end(output);
  } catch (err) {
    // stderr is ffmpeg's own message ("Invalid data found when processing
    // input"); it never contains the caller's bytes. Capped so a flood of junk
    // cannot make the error body the large part of the response.
    const detail = String(err?.stderr || err?.message || err).slice(0, 500);
    return send(res, 502, { error: 'conversion failed', detail });
  } finally {
    await Promise.allSettled([rm(inPath, { force: true }), rm(outPath, { force: true })]);
  }
}
