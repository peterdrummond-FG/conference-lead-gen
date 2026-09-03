#!/usr/bin/env bash
# Double-clickable, and usable as a macOS Login Item — same reasoning as
# watcher/watch-cards.command. Runs the Stage 11 matching-poll agent, which
# replaces MatchingQueue/MatchingBackgroundService/MatchingRetryScanner now
# that matching state lives in Supabase instead of an in-process .NET
# background service. Kept as its own process, separate from
# watch-cards.command, since the two have different failure modes and
# restart cadences (a long claude -p OCR run shouldn't block a 20s matching
# poll tick).
#
# One-time setup: copy local-agent/.env.example to local-agent/.env and
# fill in SUPABASE_SERVICE_ROLE_KEY from the Supabase dashboard.
#
# To add as a macOS Login Item (one-time, manual): System Settings >
# General > Login Items > "+" > select this file.

set -uo pipefail

AGENT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$AGENT_DIR"
mkdir -p logs

if [[ ! -d node_modules ]]; then
  echo "Installing dependencies (first run)..."
  npm install
fi

# --env-file-if-exists (not --env-file) so a missing .env doesn't crash the
# wrapper outright — agent.mjs's own supabase-client.mjs prints a clear
# error and exits instead, which the restart loop below then surfaces.
while true; do
  node --env-file-if-exists=.env agent.mjs >> logs/agent.log 2>&1
  code=$?
  printf '%s local-agent exited (code %s) — restarting in 5s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$code" | tee -a logs/agent.log
  sleep 5
done
