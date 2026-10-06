// Guards against a global sign-out. supabase-js's signOut() defaults to scope
// 'global', which revokes EVERY session the account has. The app's one signOut sits
// behind both the Log out button and the axios 401 handler, so a bare call meant one
// Log out on a phone, or one stray 401, signed the account out of its kiosk iPad
// mid-conference too (Peter's own account was found with zero sessions).
//
// Every signOut call in code we ship must say scope: 'local'. If "sign out
// everywhere" is ever genuinely wanted it must be an explicit, separate choice:
// put `// sign-out-everywhere: <why>` on the line above the call to allow it.
//
// Run: node scripts/check-auth-signout.mjs   (exit 1 on a violation)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', 'dist', '.git', '.quasar', '.claude']);
const EXT = /\.(ts|tsx|js|mjs|vue)$/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (EXT.test(name)) yield p;
  }
}

const problems = [];
let calls = 0;
for (const sub of ['frontend/src', 'supabase/functions', 'local-agent', 'scripts', 'watcher']) {
  let files;
  try { files = [...walk(join(ROOT, sub))]; } catch { continue; }
  for (const file of files) {
    if (file.endsWith('check-auth-signout.mjs') || /\.test\.(mjs|ts)$/.test(file)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line) || !/\bsignOut\s*\(/.test(line)) return;
      calls++;
      // The options object may wrap onto the next lines.
      const call = lines.slice(i, i + 4).join(' ');
      if (/scope\s*:\s*['"]local['"]/.test(call)) return;
      if (/sign-out-everywhere:/.test(lines[i - 1] ?? '')) return;
      problems.push(`${relative(ROOT, file)}:${i + 1}: signOut without { scope: 'local' } signs the account out of every device. Use { scope: 'local' }.`);
    });
  }
}

if (problems.length) {
  console.error(problems.map((p) => `FAIL ${p}`).join('\n'));
  process.exit(1);
}
console.log(`ok: ${calls} signOut call(s), all scope 'local'`);
