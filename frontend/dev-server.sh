#!/usr/bin/env bash
# Bypasses `npm run dev` — npm's own engines-validation step (added in
# recent npm versions) calls process.cwd() before npm has finished setting
# up, and that call fails with EPERM under this preview tool's process
# spawning. Invoking the quasar binary directly sidesteps npm entirely.
cd "$(dirname "$0")" || exit 1
exec node_modules/.bin/quasar dev
