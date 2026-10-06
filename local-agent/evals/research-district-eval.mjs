// A live eval for research-contact step 5b (resolvedDistrict), 2026-10-06. It calls the
// real model with web search, so it is run by hand, not in CI (`npm test` stays offline):
//
//   cd local-agent && node evals/research-district-eval.mjs
//
// It runs SKILL.md the way the n8n skill workflow does (the file, frontmatter stripped, as
// the instructions; the contact JSON as the message) and checks the three things that
// matter. Last run 2026-10-06: all three passed.
//   1. a school with NO district     -> resolvedDistrict is filled in, evidence is an http(s)
//      address, and districtName stays empty (rule 5: never overwritten).
//   2. a school WITH a district      -> resolvedDistrict is null and districtName is
//      untouched, even though the school's real district is findable.
//   3. a name too generic to pin down -> null, not a guess.
// The cwd is a scratch directory with no skills or credentials, as the old runner used.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { extractJson, runClaudeRaw } from '../skill-runner.mjs';
import { ResearchOutput } from '../schemas.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const skill = readFileSync(path.join(here, '../../.claude/skills/research-contact/SKILL.md'), 'utf8').replace(/^---[\s\S]*?---\n/, '');
const cwd = mkdtempSync(path.join(tmpdir(), 'research-eval-'));

async function research(contact) {
  const input = { contactId: null, firstName: 'Test', lastName: 'Person', email: null, phone: null, title: 'Principal', districtName: null, schoolName: null, source: 'form', extractionConfidence: null, ...contact };
  const prompt = 'Runtime note: the input JSON is the entire user message below; return only the final JSON object as your answer.\n\n---\n\n' + skill + '\n\n---\n\nINPUT:\n' + JSON.stringify(input);
  const { stdout } = await runClaudeRaw(prompt, cwd, 420_000, 'research-contact');
  return ResearchOutput.parse(extractJson(stdout));
}

const given = await research({ schoolName: 'Ruleville Central Elementary', eventState: 'Mississippi' });
assert.ok(given.resolvedDistrict, '1: a school-only contact gets a resolvedDistrict');
assert.match(given.resolvedDistrict.name, /sunflower/i, '1: it is the Sunflower County district');
assert.match(given.resolvedDistrict.evidenceUrl, /^https?:\/\//, '1: evidence is an address');
assert.equal(given.districtName ?? null, null, '1: districtName is left empty');
console.log('1 ok', given.resolvedDistrict);

const typed = await research({ schoolName: 'Ruleville Central Elementary', districtName: 'Some District I Typed', eventState: 'Mississippi' });
assert.equal(typed.resolvedDistrict, null, '2: a given district is never second-guessed');
assert.equal(typed.districtName, 'Some District I Typed', '2: districtName passes through');
console.log('2 ok');

const generic = await research({ schoolName: 'Central Elementary', eventState: 'Mississippi' });
assert.equal(generic.resolvedDistrict, null, '3: a generic school name is null, not a guess');
console.log('3 ok');
