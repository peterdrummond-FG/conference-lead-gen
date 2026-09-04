// Stage 14 (revised) — local, open-source Whisper transcription instead of
// OpenAI's cloud API, mirroring the same "keep it on this Mac, not a
// metered API key" reasoning already applied to research-contact/
// match-contact/process-cards. Verified locally before building this:
// `openai-whisper` (pip) and ffmpeg were already installed, and a real
// speech sample (generated via macOS `say`, converted to .m4a) transcribed
// correctly with the "base" model in ~2s on this machine.
//
// Bumped default "base" -> "small" -> "medium" and added initial_prompt
// support after a real noisy-room memo came back with "Chad Schmeller"
// misheard as "our church melody" / "Judge Miller" on "base". Tested
// against that memo: "base" got the surname wrong ("Schmellon"); "small"
// and "medium" both got it exactly right. Went with "medium" (not the
// smallest fix that worked) on the reasoning that noise-suppression
// preprocessing (afftdn/arnndn) was tested here too and made things
// flat-to-worse on the same memo — model size is the lever that actually
// moves accuracy, so it's worth spending more of it. --initial_prompt
// biasing (agent.mjs passes the event's candidate contact names)
// independently also fixed the same failure, and stacks with the model.
//
// Model is the multilingual "medium", not "medium.en", with --language en
// forced: reps' memos are assumed English, but occasionally reference
// Spanish names/districts, and the .en weights have never seen Spanish at
// all — the multilingual weights forced to English output get the "assume
// English" speed/consistency win (no per-file language auto-detect) without
// giving up whatever Spanish-phoneme handling the multilingual model has.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DEFAULT_MODEL = process.env.WHISPER_MODEL ?? 'medium';
const DEFAULT_LANGUAGE = process.env.WHISPER_LANGUAGE ?? 'en';
const DEFAULT_TIMEOUT_MS = Number(process.env.WHISPER_TIMEOUT_MS ?? 300_000);

function runWhisperCli(audioPath, outDir, model, language, timeoutMs, prompt) {
  return new Promise((resolve, reject) => {
    // --fp16 False: this Mac has no CUDA GPU: whisper would otherwise print
    // a "FP16 is not supported on CPU" warning and fall back anyway — this
    // just skips straight to that fallback.
    const args = [
      audioPath,
      '--model', model,
      '--output_format', 'txt',
      '--output_dir', outDir,
      '--fp16', 'False',
    ];
    if (language) args.push('--language', language);
    if (prompt) args.push('--initial_prompt', prompt);
    const proc = spawn('whisper', args);
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
  const language = opts.language ?? DEFAULT_LANGUAGE;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const outDir = await mkdtemp(path.join(tmpdir(), 'whisper-out-'));

  try {
    const { stderr, exitCode, timedOut } = await runWhisperCli(localAudioPath, outDir, model, language, timeoutMs, opts.prompt);
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
