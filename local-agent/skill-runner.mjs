// Invokes a Claude Code skill headlessly. Originally a near-verbatim port of
// backend/Services/SkillRunner.cs — same temp-file input hand-off, same 180s
// timeout / 2 attempts / 5s backoff, same defensive brace-counting JSON
// extraction (the CLI can prepend markdown fences or prose despite being told
// to print only JSON).
//
// Hardened 2026-09-14 (audit A1/A2/A4/A5). Three things changed, all of them
// load-bearing:
//
//  1. --strict-mcp-config + --allowedTools, from skill-profiles.mjs. Without
//     these the CLI inherits the operator's account-level MCP connectors —
//     Gmail, Google Drive, Supabase project admin, a write-capable Zoho CRM —
//     into a permission-skipped session whose context holds OCR'd card text
//     and voice transcripts. An instruction printed on a business card had all
//     of that in reach.
//  2. An explicit `env` allowlist instead of inheriting process.env, which
//     carries SUPABASE_SERVICE_ROLE_KEY.
//  3. cwd is AGENT_WORKDIR (a directory holding only a .claude/skills symlink)
//     rather than the repo root, which holds .env with the Zoho client secret
//     and refresh token.
//
// --dangerously-skip-permissions stays: these run unattended with nobody to
// approve a prompt. It is the allowlist, not the prompt suppression, that
// bounds what a skill can do.
import { spawn } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { profileFor } from './skill-profiles.mjs';

const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 5_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Finds the first `{`, then walks forward tracking brace depth (respecting
// quoted strings/escapes) to the matching close.
function parseBalancedFrom(text, start) {
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
      if (depth === 0) {
        try {
          return { value: JSON.parse(text.slice(start, i + 1)), end: i };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// Prefers the LAST balanced JSON object in the output rather than the first
// (audit A6). Every skill is told to print JSON as its entire final message,
// but a run that reasons in prose first can emit a JSON-looking fragment
// earlier — taking the first match silently parses that fragment instead, and
// every real field comes back undefined and is written as null.
export function extractJson(text) {
  const objects = [];
  let cursor = text.indexOf('{');
  while (cursor !== -1) {
    const parsed = parseBalancedFrom(text, cursor);
    if (parsed) {
      objects.push(parsed.value);
      cursor = text.indexOf('{', parsed.end + 1);
    } else {
      cursor = text.indexOf('{', cursor + 1);
    }
  }

  if (objects.length === 0) throw new Error('No JSON object found in skill output');
  if (objects.length > 1) {
    console.log(
      `${new Date().toISOString()} WARN skill output contained ${objects.length} JSON objects — using the last one`,
    );
  }
  return objects[objects.length - 1];
}

function buildArgs(prompt, skillName) {
  const profile = profileFor(skillName);
  const args = ['-p', prompt, '--strict-mcp-config'];
  if (profile.mcpConfig) args.push('--mcp-config', profile.mcpConfig);
  args.push('--allowedTools', profile.allowedTools.join(','));
  if (profile.disallowedTools?.length) {
    args.push('--disallowedTools', profile.disallowedTools.join(','));
  }
  args.push('--dangerously-skip-permissions');
  return args;
}

// Deliberately NOT process.env. SUPABASE_SERVICE_ROLE_KEY lives in this
// process's environment (the agent needs it to write) and must never be
// visible to a session whose context holds untrusted card text or a
// transcript. PATH/HOME are what the CLI itself needs to run.
function skillEnv() {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    // USER is required, not cosmetic: without it the CLI cannot reach its
    // credentials in the macOS Keychain and every run fails with "Not logged
    // in · Please run /login". Determined by bisecting the environment --
    // LOGNAME/SHELL/TMPDIR are not needed, USER alone is.
    USER: process.env.USER,
    LANG: process.env.LANG ?? 'en_US.UTF-8',
    ...(process.env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY } : {}),
  };
}

// Exported separately from runSkill: process-cards has a plain-text prompt /
// PROCESS_CARDS_OK-line contract, not the temp-file-JSON-in / JSON-out
// contract runSkill wraps around the others — but both share the same
// invocation mechanics, so this is the one place that logic lives.
export function runClaudeRaw(prompt, cwd, timeoutMs, skillName) {
  return new Promise((resolve, reject) => {
    let proc;
    try {
      // stdin: 'ignore' -- the default 'pipe' leaves an open stdin the CLI
      // waits on ("no stdin data received in 3s"), and these are unattended
      // runs with nothing to pipe in. The prompt arrives via -p.
      proc = spawn('claude', buildArgs(prompt, skillName), {
        cwd,
        env: skillEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      reject(err);
      return;
    }
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

async function invokeOnce(skillName, input, workdir, timeoutMs, schema) {
  const inputPath = path.join(tmpdir(), `${crypto.randomUUID()}.json`);
  await writeFile(inputPath, JSON.stringify(input));
  try {
    const prompt = `Use the ${skillName} skill on the contact JSON at ${inputPath}. Print only the final JSON.`;
    const { stdout, stderr, exitCode, timedOut } = await runClaudeRaw(prompt, workdir, timeoutMs, skillName);
    if (timedOut) throw new Error(`${skillName} timed out after ${timeoutMs}ms`);
    if (exitCode !== 0) throw new Error(`${skillName} exited ${exitCode}: ${stderr.trim() || stdout.trim()}`);

    const raw = extractJson(stdout);
    if (!schema) return raw;

    // A schema failure is a pipeline failure, never a result to persist:
    // runSkill retries, and past the attempt cap the row simply stays pending
    // for a human. See schemas.mjs (audit A6).
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      throw new Error(`${skillName} output failed schema validation: ${detail}`);
    }
    return parsed.data;
  } finally {
    await unlink(inputPath).catch(() => {});
  }
}

export async function runSkill(skillName, input, workdir, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const schema = opts.schema ?? null;

  // Fail fast and loudly if the skill has no declared tool profile, before
  // writing a temp file or spawning anything.
  profileFor(skillName);

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await invokeOnce(skillName, input, workdir, timeoutMs, schema);
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) await sleep(RETRY_DELAY_MS);
    }
  }
  throw new Error(`${skillName} failed after ${maxAttempts} attempts: ${lastError?.message ?? lastError}`);
}
