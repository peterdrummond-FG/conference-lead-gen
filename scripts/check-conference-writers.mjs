// Guards "one conference everywhere": a rep's app conference
// (profiles.current_event_id) and their phone's (phone_event_bindings) are kept
// in step by two SQL functions, profile_set_current_event and
// profile_link_event_by_phone. A function that writes the column directly puts
// the two back out of sync, which is how a rep who only texted SETUP ended up
// with a linked phone and an app that said "choose a conference".
//
// Also holds twilio-webhook to re-checking events.is_active wherever a bound
// phone files something, because a binding outlives its conference.
//
// Run: node scripts/check-conference-writers.mjs   (exit 1 on a violation)
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FUNCTIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'functions');
const problems = [];

for (const name of readdirSync(FUNCTIONS)) {
  let src;
  try { src = readFileSync(join(FUNCTIONS, name, 'index.ts'), 'utf8'); } catch { continue; }
  // `current_event_id:` as an object key is a write payload; reads are `.select("current_event_id")`
  // or `x.current_event_id`, neither of which has the colon.
  if (/current_event_id\s*:/.test(src.replace(/\/\/.*$/gm, ''))) {
    problems.push(`${name}: writes current_event_id directly. Call rpc("profile_set_current_event") so the phone follows.`);
  }
}

const hook = readFileSync(join(FUNCTIONS, 'twilio-webhook', 'index.ts'), 'utf8');
const binds = (hook.match(/from\("phone_event_bindings"\)\.upsert\(/g) ?? []).length;
const links = (hook.match(/await linkProfileToEvent\(/g) ?? []).length;
if (links < binds - 1) {
  // The already-linked SETUP path binds to the profile's own conference, so it needs no link back.
  problems.push(`twilio-webhook: ${binds} bind upserts but only ${links} linkProfileToEvent calls (one bind may skip it).`);
}
if ((hook.match(/await boundEventState\(/g) ?? []).length < 2) {
  problems.push('twilio-webhook: a bound phone files notes and media without re-checking events.is_active (boundEventState).');
}
if (!/\.eq\("is_active", true\)/.test(hook)) {
  problems.push('twilio-webhook: the folder-code lookup no longer requires an active event.');
}

if (problems.length) {
  console.error(problems.map((p) => `FAIL ${p}`).join('\n'));
  process.exit(1);
}
console.log('ok: conference writers go through the shared helpers; the webhook re-checks is_active');
