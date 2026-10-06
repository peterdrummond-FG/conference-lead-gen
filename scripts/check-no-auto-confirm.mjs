// Guards "nothing is ever auto-confirmed" (decision: Peter, 2026-10-06).
//
// A lead used to reach review_status 'approved', and so the Zoho export, with no
// person pressing anything: finalize_contact_match did it when a match came back
// high-confidence. That rested on model output nobody had read, and one run had
// already produced a fabricated Zoho id beside a "high" label. The rule now: reps
// always confirm. The only writers of 'approved' are human actions:
//   * a lead's Confirm and Undo/restore -- contacts-patch (takes the status from the
//     person's request, no literal in the code)
//   * "Confirm all N" -- contacts-bulk-approve
// This fails CI if anything else starts writing review_status 'approved' or
// auto_approved = true: server code, the agents, the n8n pipelines and workflow JSON,
// or any migration from the decision onward. (The database also refuses
// auto_approved = true: contacts_never_auto_approved.)
//
// It checks what code WRITES, so reading 'approved' (the export's filter, the
// frontend's tab) is fine. The frontend is not scanned: a button press is the
// human action.
//
// Run: node scripts/check-no-auto-confirm.mjs   (exit 1 on a violation)
//      node --test scripts/check-no-auto-confirm.test.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Human actions that may name 'approved' as a value they write.
export const HUMAN_WRITERS = ['supabase/functions/contacts-bulk-approve/index.ts'];

// The migration that removed auto-approval. Anything from this version on may not
// write 'approved' (older ones describe the history and stay untouched: migrations
// are append-only).
export const DECISION_MIGRATION = '20261007110000';

const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');

// review_status: 'approved' / review_status = 'approved' / reviewStatus: "approved".
// `===`, `.eq("review_status", "approved")` and `.select(...)` don't match: those read.
const WRITES_APPROVED = /review_?[sS]tatus["']?\s*[:=]\s*["']approved["']/;
const SETS_AUTO_FLAG = /auto_?[aA]pproved["']?\s*[:=]\s*true\b/;
// SQL: `then 'approved'` is how the old function chose the value.
const SQL_APPROVES = /review_status\s*=\s*'approved'|then\s+'approved'|auto_approved\s*=\s*true/i;

// files: [{ path: repo-relative with forward slashes, text }]
export function findViolations(files) {
  const out = [];
  for (const { path, text } of files) {
    if (/\.test\.(m?js|ts)$/.test(path)) continue;
    if (path.startsWith('supabase/migrations/')) {
      const version = path.split('/').pop().split('_')[0];
      if (version >= DECISION_MIGRATION && SQL_APPROVES.test(stripSql(text))) {
        out.push(`${path}: a migration after the no-auto-confirm decision writes review_status 'approved' / auto_approved = true.`);
      }
      continue;
    }
    if (path.endsWith('.json')) {
      // Sticky notes are prose (the pipeline's own description still says "auto-approve"
      // until its next redeploy); only nodes that DO something can write.
      let doc;
      try { doc = JSON.parse(text); } catch { out.push(`${path}: not valid JSON.`); continue; }
      const live = JSON.stringify((doc.nodes ?? []).filter((n) => n.type !== 'n8n-nodes-base.stickyNote'));
      if (/review_status[^\n]{0,60}approved|auto_approved[^\n]{0,20}true/i.test(live)) {
        out.push(`${path}: a workflow node writes review_status 'approved' / auto_approved = true.`);
      }
      continue;
    }
    const code = stripJs(text);
    if (WRITES_APPROVED.test(code) && !HUMAN_WRITERS.includes(path)) {
      out.push(`${path}: writes review_status 'approved'. Only a person's action may (contacts-patch, contacts-bulk-approve).`);
    }
    if (SETS_AUTO_FLAG.test(code)) {
      out.push(`${path}: sets auto_approved = true. Nothing is auto-confirmed.`);
    }
  }
  return out;
}

const SCAN = [
  ['supabase/functions', /\.(ts|mjs|js)$/],
  ['supabase/migrations', /\.sql$/],
  ['local-agent', /\.(mjs|js)$/],
  ['n8n/pipelines', /\.(ts|mjs|js)$/],
  ['n8n/schemas', /\.(ts|mjs|js)$/],
  ['n8n/scripts', /\.(ts|mjs|js)$/],
  ['n8n/workflows', /\.json$/],
  ['watcher', /\.(mjs|js|sh|command)$/],
];

function* walk(dir, pattern) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p, pattern);
    else if (pattern.test(name)) yield p;
  }
}

export function repoFiles(root = ROOT) {
  const files = [];
  for (const [dir, pattern] of SCAN) {
    try { statSync(join(root, dir)); } catch { continue; }
    for (const p of walk(join(root, dir), pattern)) {
      files.push({ path: relative(root, p).split('\\').join('/'), text: readFileSync(p, 'utf8') });
    }
  }
  return files;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = findViolations(repoFiles());
  if (problems.length) {
    console.error(problems.map((p) => `FAIL ${p}`).join('\n'));
    process.exit(1);
  }
  console.log('ok: only a person\'s Confirm (contacts-patch, contacts-bulk-approve) writes review_status approved');
}
