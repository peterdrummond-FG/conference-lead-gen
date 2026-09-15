#!/usr/bin/env node
// Repo guard: no skill may be invoked unsandboxed (audit A1).
//
// Two ways that regresses, both cheap to check and both invisible in review:
//   1. someone adds a skill under .claude/skills/ and forgets skill-profiles.mjs
//      -- runSkill throws at invocation time, which means it fails at an
//      event rather than in CI;
//   2. someone adds or edits a `claude -p` invocation without the sandbox
//      flags, which fails silently (it just works, with everything reachable).
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

// --- 1. every skill has a declared tool profile -------------------------
const { SKILL_PROFILES } = await import(
  path.join(repoRoot, 'local-agent/skill-profiles.mjs')
);

const skillsDir = path.join(repoRoot, '.claude/skills');
const skills = readdirSync(skillsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
  .map((d) => d.name);

for (const skill of skills) {
  if (!SKILL_PROFILES[skill]) {
    failures.push(
      `.claude/skills/${skill}/ has no entry in local-agent/skill-profiles.mjs ` +
      `— it would throw at invocation time. Most skills need only ['Read'].`,
    );
  }
}
for (const declared of Object.keys(SKILL_PROFILES)) {
  if (!skills.includes(declared)) {
    failures.push(`skill-profiles.mjs declares '${declared}', which no longer exists under .claude/skills/`);
  }
}

// --- 2. every `claude -p` invocation is sandboxed ------------------------
const INVOCATION_SITES = [
  'local-agent/skill-runner.mjs',
  'watcher/watch-cards.command',
];

for (const rel of INVOCATION_SITES) {
  const file = path.join(repoRoot, rel);
  if (!existsSync(file)) {
    failures.push(`${rel} is listed as a claude -p invocation site but does not exist — update this guard.`);
    continue;
  }
  const src = readFileSync(file, 'utf8');
  if (!src.includes('--dangerously-skip-permissions')) continue; // nothing to guard
  if (!src.includes('--strict-mcp-config')) {
    failures.push(
      `${rel}: invokes claude with --dangerously-skip-permissions but without ` +
      `--strict-mcp-config. Without it the session inherits every account-level ` +
      `MCP connector (Gmail, Drive, Supabase admin, write-capable Zoho CRM). See audit A1.`,
    );
  }
  if (!src.includes('--disallowedTools')) {
    failures.push(
      `${rel}: no --disallowedTools. --allowedTools alone does NOT restrict ` +
      `built-in tools under --dangerously-skip-permissions (verified 2026-09-14). See audit A1.`,
    );
  }
}

// --- 3. no skill is handed a credential ---------------------------------
// process-cards used to be told to curl with $SUPABASE_SERVICE_ROLE_KEY. A
// skill returns JSON; the caller does the writing (audit A2).
for (const skill of skills) {
  const md = path.join(skillsDir, skill, 'SKILL.md');
  if (!existsSync(md)) continue;
  const src = readFileSync(md, 'utf8');
  // Allow the explanatory note and the prohibition; flag an actual instruction
  // to use one (a credential inside a fenced command block).
  for (const line of src.split('\n')) {
    if (/^\s*(curl|\$\s*curl)/.test(line) && /SERVICE_ROLE_KEY|Authorization:\s*Bearer/i.test(line)) {
      failures.push(
        `.claude/skills/${skill}/SKILL.md instructs the model to make an ` +
        `authenticated call: ${line.trim().slice(0, 80)}. Skills must return ` +
        `JSON and let the caller do the writing (audit A2).`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error('FAIL: skill sandboxing guard\n');
  for (const f of failures) console.error('  - ' + f + '\n');
  process.exit(1);
}
console.log(`OK: ${skills.length} skills, all with tool profiles; all invocation sites sandboxed.`);
