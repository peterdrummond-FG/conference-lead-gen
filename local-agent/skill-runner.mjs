// Near-verbatim port of backend/Services/SkillRunner.cs — same temp-file
// input hand-off, same `claude -p ... --dangerously-skip-permissions`
// invocation, same 180s timeout / 2 attempts / 5s backoff, same defensive
// brace-counting JSON extraction (the CLI can prepend markdown fences or
// prose despite being told to print only JSON).
import { spawn } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 5_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Finds the first `{`, then walks forward tracking brace depth (respecting
// quoted strings/escapes) to the matching close — same algorithm as
// SkillRunner.cs's ExtractJson.
export function extractJson(text) {
  const start = text.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in skill output');

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error('Unbalanced braces in skill output — never found the matching close');
}

// Exported separately from runSkill: process-cards (Stage 13's SMS-photo
// poll loop) has a plain-text prompt / PROCESS_CARDS_OK-line contract, not
// the temp-file-JSON-in / JSON-out contract runSkill wraps around
// research-contact/match-contact — but both share the same underlying
// claude -p invocation mechanics, so this is the one place that logic lives.
export function runClaudeRaw(prompt, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['-p', prompt, '--dangerously-skip-permissions'], { cwd });
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

async function invokeOnce(skillName, input, repoRoot, timeoutMs) {
  const inputPath = path.join(tmpdir(), `${crypto.randomUUID()}.json`);
  await writeFile(inputPath, JSON.stringify(input));
  try {
    const prompt = `Use the ${skillName} skill on the contact JSON at ${inputPath}. Print only the final JSON.`;
    const { stdout, stderr, exitCode, timedOut } = await runClaudeRaw(prompt, repoRoot, timeoutMs);
    if (timedOut) throw new Error(`${skillName} timed out after ${timeoutMs}ms`);
    if (exitCode !== 0) throw new Error(`${skillName} exited ${exitCode}: ${stderr.trim() || stdout.trim()}`);
    return extractJson(stdout);
  } finally {
    await unlink(inputPath).catch(() => {});
  }
}

export async function runSkill(skillName, input, repoRoot, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await invokeOnce(skillName, input, repoRoot, timeoutMs);
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) await sleep(RETRY_DELAY_MS);
    }
  }
  throw new Error(`${skillName} failed after ${maxAttempts} attempts: ${lastError?.message ?? lastError}`);
}
