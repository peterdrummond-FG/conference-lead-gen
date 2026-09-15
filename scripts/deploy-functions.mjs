#!/usr/bin/env node
// Deploys Edge Functions from supabase/functions/ via the Management API.
//
// Exists because this project has no Supabase CLI on the deploy host (see
// docs/ARCHITECTURE.md) and deploying by hand through the MCP tools does not
// scale past a couple of functions -- which matters whenever a file under
// _shared/ changes, since every consumer must be redeployed to pick it up.
// A change to _shared/auth.ts or _shared/http.ts that is only partially
// deployed leaves functions running different versions of the security
// helpers, which is exactly the drift audit N1 was about.
//
// Usage:
//   SUPABASE_ACCESS_TOKEN=... node scripts/deploy-functions.mjs            # all
//   SUPABASE_ACCESS_TOKEN=... node scripts/deploy-functions.mjs export-csv # some
//   ... --dry-run                                                          # plan only
//
// Get a token at https://supabase.com/dashboard/account/tokens
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const functionsDir = path.join(repoRoot, 'supabase/functions');
const sharedDir = path.join(functionsDir, '_shared');

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF ?? 'yrvppufkerbjpvrxniot';
const dryRun = process.argv.includes('--dry-run');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));

if (!token && !dryRun) {
  console.error('SUPABASE_ACCESS_TOKEN is required (https://supabase.com/dashboard/account/tokens).');
  process.exit(1);
}

// verify_jwt must be preserved per function. twilio-webhook and
// session-notifications authenticate themselves (X-Twilio-Signature and a
// vault-stored cron secret respectively) and would break if the gateway
// started requiring a Supabase JWT they never carry.
const NO_JWT = new Set(['twilio-webhook', 'session-notifications']);

const shared = Object.fromEntries(
  readdirSync(sharedDir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => [f, readFileSync(path.join(sharedDir, f), 'utf8')]),
);

const all = readdirSync(functionsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== '_shared')
  .map((d) => d.name)
  .filter((n) => existsSync(path.join(functionsDir, n, 'index.ts')))
  .sort();

const targets = only.length > 0 ? only : all;
const unknown = targets.filter((t) => !all.includes(t));
if (unknown.length > 0) {
  console.error(`unknown function(s): ${unknown.join(', ')}`);
  process.exit(1);
}

let failed = 0;
for (const name of targets) {
  const index = readFileSync(path.join(functionsDir, name, 'index.ts'), 'utf8');
  // Ship every shared module rather than parsing imports: they are small, and
  // a missed transitive import is a boot error in production.
  const files = [
    { name: 'index.ts', content: index },
    ...Object.entries(shared).map(([f, content]) => ({ name: `../_shared/${f}`, content })),
  ];
  const verifyJwt = !NO_JWT.has(name);

  if (dryRun) {
    console.log(`[dry run] ${name} (verify_jwt=${verifyJwt}, ${files.length} files)`);
    continue;
  }

  const body = new FormData();
  body.append(
    'metadata',
    new Blob([JSON.stringify({
      name,
      entrypoint_path: 'index.ts',
      verify_jwt: verifyJwt,
    })], { type: 'application/json' }),
  );
  for (const f of files) {
    body.append('file', new Blob([f.content], { type: 'application/typescript' }), f.name);
  }

  const res = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/functions/deploy?slug=${encodeURIComponent(name)}`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body },
  );

  if (!res.ok) {
    console.error(`FAIL ${name}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    failed++;
  } else {
    console.log(`ok   ${name} (verify_jwt=${verifyJwt})`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} function(s) failed to deploy.`);
  process.exit(1);
}
console.log(`\n${targets.length} function(s) ${dryRun ? 'planned' : 'deployed'}.`);
