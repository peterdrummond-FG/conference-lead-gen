#!/usr/bin/env bash
# Double-clickable, and usable as a macOS Login Item so it inherits
# Terminal's already-granted folder access instead of a background
# LaunchAgent silently losing it — same reasoning and same mechanism as
# fg-ai-utilities/good-wrap-main's start_scanfolder_watcher.command.
#
# Layout:
#   inbox/<event-folder-code>/        rep drops photos here by hand
#   .processing/<event-folder-code>/  staged mid-run
#   processed/<event-folder-code>/<hash>.<ext>  permanent archive (= SourceImagePath)
#   failed/<event-folder-code>/<hash>.<ext> + <hash>.error.txt
#
# Idempotency: hash the ORIGINAL bytes as dropped (before any HEIC
# conversion) with shasum -a 256. A file already present as
# processed/<code>/<hash>.* means this exact photo was already fully
# processed — skipped locally, without ever invoking claude.
#
# To add as a macOS Login Item (one-time, manual): System Settings >
# General > Login Items > "+" > select this file.

set -uo pipefail

WATCHER_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$WATCHER_DIR/.." && pwd)"
INBOX="$WATCHER_DIR/inbox"
PROCESSING="$WATCHER_DIR/.processing"
PROCESSED="$WATCHER_DIR/processed"
FAILED="$WATCHER_DIR/failed"
LOG="$WATCHER_DIR/logs/watch.log"
POLL_SECONDS="${WATCH_POLL_SECONDS:-45}"
CLAUDE_TIMEOUT_SECONDS="${WATCH_CLAUDE_TIMEOUT_SECONDS:-180}"
MIN_AGE_SECONDS=5   # skip a file still mid-copy/AirDrop

mkdir -p "$INBOX" "$PROCESSING" "$PROCESSED" "$FAILED" "$WATCHER_DIR/logs"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" | tee -a "$LOG"; }

# No `timeout`/`gtimeout` on stock macOS (confirmed absent on this machine) —
# a portable pure-bash equivalent: background the command, poll whether its
# PID is still alive, kill it past the limit.
run_claude_with_timeout() {
  local timeout_secs="$1" prompt="$2" outfile="$3"
  (cd "$REPO_ROOT" && claude -p "$prompt" --dangerously-skip-permissions > "$outfile" 2>>"$LOG") &
  local pid=$! elapsed=0
  while kill -0 "$pid" 2>/dev/null; do
    if (( elapsed >= timeout_secs )); then
      kill -9 "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null
      return 124
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  wait "$pid"
}

reconcile_stale() {
  find "$PROCESSING" -mindepth 2 -maxdepth 2 -type f ! -name '.*' 2>/dev/null | while read -r stale; do
    code="$(basename "$(dirname "$stale")")"
    mkdir -p "$INBOX/$code"
    mv "$stale" "$INBOX/$code/"
    log "reconciled stale staged file after apparent crash: $stale"
  done
}

process_one() {
  local file="$1" code="$2"
  local base ext lower_ext hash processing_path final_path

  base="$(basename "$file")"
  ext="${base##*.}"
  lower_ext="$(printf '%s' "$ext" | tr '[:upper:]' '[:lower:]')"

  # Skip anything still being written (drag-and-drop/AirDrop takes a moment).
  local mtime now
  mtime=$(stat -f %m "$file" 2>/dev/null || echo 0)
  now=$(date +%s)
  if (( now - mtime < MIN_AGE_SECONDS )); then
    return
  fi

  # Hash the ORIGINAL bytes, before any HEIC conversion — that's the
  # identity "re-dropping the same photo" should key off, independent of
  # whatever format it eventually gets converted to.
  hash="$(shasum -a 256 "$file" | awk '{print $1}')"

  # Already fully processed — safe no-op, no claude invocation at all.
  if compgen -G "$PROCESSED/$code/${hash}.*" > /dev/null; then
    rm -f "$file"
    log "skip duplicate (already processed): $base -> $hash"
    return
  fi

  mkdir -p "$PROCESSING/$code" "$PROCESSED/$code" "$FAILED/$code"

  if [[ "$lower_ext" == "heic" || "$lower_ext" == "heif" ]]; then
    processing_path="$PROCESSING/$code/${hash}.jpg"
    if ! sips -s format jpeg "$file" --out "$processing_path" >>"$LOG" 2>&1; then
      log "FAIL converting HEIC, leaving in inbox for manual look: $file"
      return
    fi
    rm -f "$file"
  else
    processing_path="$PROCESSING/$code/${hash}.${lower_ext}"
    mv "$file" "$processing_path"
  fi

  final_path="$PROCESSED/$code/$(basename "$processing_path")"

  local prompt
  prompt="Use the process-cards skill on the photo at ${processing_path}. Event folder code: ${code}. Content hash: ${hash}. Its permanent archive path — include this exact string as sourceImagePath in your POST body — is: ${final_path}. Print only PROCESS_CARDS_OK ${hash} or PROCESS_CARDS_FAIL ${hash} <reason> as your entire final message."

  local outfile exit_code output last_line
  outfile="$(mktemp)"
  run_claude_with_timeout "$CLAUDE_TIMEOUT_SECONDS" "$prompt" "$outfile"
  exit_code=$?
  output="$(cat "$outfile")"
  rm -f "$outfile"
  last_line="$(printf '%s' "$output" | tail -n 1)"
  printf '%s\n' "$output" >> "$LOG"

  if [[ $exit_code -eq 0 && "$last_line" == PROCESS_CARDS_OK* ]]; then
    mv "$processing_path" "$final_path"
    log "OK: $base -> $final_path"
  else
    local failed_path="$FAILED/$code/$(basename "$processing_path")"
    mv "$processing_path" "$failed_path"
    local reason="$last_line"
    if [[ $exit_code -eq 124 ]]; then
      reason="claude timed out after ${CLAUDE_TIMEOUT_SECONDS}s"
    elif [[ $exit_code -ne 0 ]]; then
      reason="claude exited $exit_code: $last_line"
    fi
    printf '%s\n' "$reason" > "$FAILED/$code/${hash}.error.txt"
    log "FAIL: $base -> $failed_path ($reason)"
  fi
}

log "=== watch-cards starting (poll every ${POLL_SECONDS}s) ==="

while true; do
  reconcile_stale

  find "$INBOX" -mindepth 2 -maxdepth 2 -type f ! -name '.*' 2>/dev/null | while read -r file; do
    code="$(basename "$(dirname "$file")")"
    process_one "$file" "$code"
  done

  sleep "$POLL_SECONDS"
done
