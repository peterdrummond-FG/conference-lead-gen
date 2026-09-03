// Stage 14 (revised) — local, open-source Whisper transcription instead of
// OpenAI's cloud API, mirroring the same "keep it on this Mac, not a
// metered API key" reasoning already applied to research-contact/
// match-contact/process-cards. Verified locally before building this:
// `openai-whisper` (pip) and ffmpeg were already installed, and a real
// speech sample (generated via macOS `say`, converted to .m4a) transcribed
// correctly with the "base" model in ~2s on this machine.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DEFAULT_MODEL = process.env.WHISPER_MODEL ?? 'base';
const DEFAULT_TIMEOUT_MS = Number(process.env.WHISPER_TIMEOUT_MS ?? 300_000);

function runWhisperCli(audioPath, outDir, model, timeoutMs) {
  return new Promise((resolve, reject) => {
    // --fp16 False: this Mac has no CUDA GPU: whisper would otherwise print
    // a "FP16 is not supported on CPU" warning and fall back anyway — this
    // just skips straight to that fallback.
    const proc = spawn('whisper', [
      audioPath,
      '--model', model,
      '--output_format', 'txt',
      '--output_dir', outDir,
      '--fp16', 'False',
    ]);
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, timeoutMs);

    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode, timedOut });
    });
  });
}

// Transcribes one local audio file and returns the trimmed transcript text.
// Whisper names its output <input-basename>.txt in --output_dir; each call
// gets its own throwaway temp dir so concurrent/successive runs never
// collide and cleanup is a single recursive rm.
export async function transcribeAudio(localAudioPath, opts = {}) {
  const model = opts.model ?? DEFAULT_MODEL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const outDir = await mkdtemp(path.join(tmpdir(), 'whisper-out-'));

  try {
    const { stderr, exitCode, timedOut } = await runWhisperCli(localAudioPath, outDir, model, timeoutMs);
    if (timedOut) throw new Error(`whisper timed out after ${timeoutMs}ms`);
    if (exitCode !== 0) throw new Error(`whisper exited ${exitCode}: ${stderr.trim()}`);

    const base = path.basename(localAudioPath, path.extname(localAudioPath));
    const txtPath = path.join(outDir, `${base}.txt`);
    const transcript = (await readFile(txtPath, 'utf8')).trim();
    if (!transcript) throw new Error('whisper produced an empty transcript');
    return transcript;
  } finally {
    await rm(outDir, { recursive: true, force: true }).catch(() => {});
  }
}
