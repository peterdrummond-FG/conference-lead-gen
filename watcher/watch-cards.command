#!/usr/bin/env bash
# Double-clickable, and usable as a macOS Login Item so it inherits
# Terminal's already-granted folder access instead of a background
# LaunchAgent silently losing it — same reasoning and same mechanism as
# fg-ai-utilities/good-wrap-main's start_scanfolder_watcher.command.
#
# Layout:
#   inbox/<event-folder-code>/        rep drops photos here by hand
#   .processing/<event-folder-code>/  staged mid-run
#   processed/<event-folder-code>/<hash>.<ext>  local archive + Storage upload source;
#                                                Storage key <code>/<hash>.<ext> is the
#                                                actual SourceImagePath value (Stage 12)
#   failed/<event-folder-code>/<hash>.<ext> + <hash>.error.txt
#
# Idempotency: hash the ORIGINAL bytes as dropped (before any HEIC
# conversion) with shasum -a 256. A file already present as
# processed/<code>/<hash>.* means this exact photo was already fully
# processed — skipped locally, without ever invoking claude.
#
# Stage 12: process-cards POSTs to the Supabase Edge Function
# (contacts-from-ocr) instead of the old local .NET API, and this script
# additionally uploads each archived photo/crop to Supabase Storage
# (bucket contact-photos) so /review can display it regardless of which
# machine is running this watcher. The local processed/<code>/ archive is
# kept unchanged for local dedup and crash recovery.
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

# Stage 12: process-cards now POSTs to the Supabase Edge Function
# (contacts-from-ocr) instead of a local .NET process, and this script
# uploads archived photos/crops to Supabase Storage instead of just serving
# them off local disk. SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY live in
# watcher/.env (gitignored, same convention as the repo-root .env) and are
# exported here so claude -p's subprocess inherits them, same as everything
# else in this script's environment.
if [[ -f "$WATCHER_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$WATCHER_DIR/.env"
  set +a
fi

POLL_SECONDS="${WATCH_POLL_SECONDS:-45}"
# 15 minutes, not 180s: a photo can carry many cards laid out together, and
# process-cards now reads/crops/POSTs each one individually — a sheet with
# 15+ cards needs well past what a single-card photo ever did.
CLAUDE_TIMEOUT_SECONDS="${WATCH_CLAUDE_TIMEOUT_SECONDS:-900}"
MIN_AGE_SECONDS=5   # skip a file still mid-copy/AirDrop

mkdir -p "$INBOX" "$PROCESSING" "$PROCESSED" "$FAILED" "$WATCHER_DIR/logs"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" | tee -a "$LOG"; }

# No `timeout`/`gtimeout` on stock macOS (confirmed absent on this machine) —
# a portable pure-bash equivalent: background the command, poll whether its
# PID is still alive, kill it past the limit.
run_claude_with_timeout() {
  local timeout_secs="$1" prompt="$2" outfile="$3"
  # `exec` replaces the backgrounded subshell's own process image with
  # claude, rather than forking claude as its child — without it, $! below
  # is the subshell's PID, not claude's, and `kill -9 "$pid"` on timeout
  # kills the wrapper while claude itself keeps running as an orphan.
  # Redirections set up on the subshell still apply after the replacement.
  (cd "$REPO_ROOT" && exec claude -p "$prompt" --dangerously-skip-permissions > "$outfile" 2>>"$LOG") &
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

# Content-type for a Storage upload — same extension set contacts-photo
# expects on the read side.
content_type_for() {
  case "${1##*.}" in
    jpg|jpeg|JPG|JPEG) echo "image/jpeg" ;;
    png|PNG) echo "image/png" ;;
    heic|heif|HEIC|HEIF) echo "image/heic" ;;
    *) echo "application/octet-stream" ;;
  esac
}

# Uploads one already-archived local file to the contact-photos bucket at
# <code>/<basename>, matching exactly the Storage key process-cards reported
# as sourceImagePath/croppedImagePath in its POST — so contacts-photo's
# signed-URL lookup finds it. x-upsert makes a re-upload (e.g. resume_staged
# retrying after a crash) safe rather than erroring on a pre-existing object.
# A failure here is logged but non-fatal: the contact row already exists
# with a working DB record, just a 404'ing photo until this is retried.
upload_to_storage() {
  local local_path="$1" code="$2"
  local storage_key="$code/$(basename "$local_path")"

  if [[ -z "${SUPABASE_URL:-}" || -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
    log "WARN: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set (watcher/.env) — skipping Storage upload for $storage_key"
    return
  fi

  # Storage's raw REST endpoint (unlike the Edge Functions gateway) requires
  # an explicit apikey header alongside Authorization — confirmed by a live
  # test: the same call with only Authorization failed on Supabase's newer
  # sb_secret_... key format even though the key itself was valid.
  if curl -s -f -X POST "$SUPABASE_URL/storage/v1/object/contact-photos/$storage_key" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
      -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: $(content_type_for "$local_path")" \
      -H "x-upsert: true" \
      --data-binary "@$local_path" >>"$LOG" 2>&1; then
    log "uploaded to Storage: $storage_key"
  else
    log "WARN: Storage upload failed for $storage_key — contacts-photo will 404 until retried"
  fi
}

# Stage a freshly-dropped file into .processing/<code>/<hash>.<ext>: hash the
# ORIGINAL bytes, convert HEIC if needed, move into place. Sets the globals
# `hash` and `processing_path` for the caller (plain globals, not `local -n`
# namerefs — this machine's bash is 3.2, no bash-4 nameref support; the
# script is single-threaded/sequential so this is safe). Returns 1 if
# there's nothing further to do (still copying, or a known duplicate) —
# caller should stop, not proceed to run_and_archive.
stage_file() {
  local file="$1" code="$2"
  local base ext lower_ext

  base="$(basename "$file")"
  ext="${base##*.}"
  lower_ext="$(printf '%s' "$ext" | tr '[:upper:]' '[:lower:]')"

  # Skip anything still being written (drag-and-drop/AirDrop takes a moment).
  local mtime now
  mtime=$(stat -f %m "$file" 2>/dev/null || echo 0)
  now=$(date +%s)
  if (( now - mtime < MIN_AGE_SECONDS )); then
    return 1
  fi

  # Hash the ORIGINAL bytes, before any HEIC conversion — that's the
  # identity "re-dropping the same photo" should key off, independent of
  # whatever format it eventually gets converted to.
  hash="$(shasum -a 256 "$file" | awk '{print $1}')"

  # Already fully processed — safe no-op, no claude invocation at all.
  if compgen -G "$PROCESSED/$code/${hash}.*" > /dev/null; then
    rm -f "$file"
    log "skip duplicate (already processed): $base -> $hash"
    return 1
  fi

  mkdir -p "$PROCESSING/$code" "$PROCESSED/$code" "$FAILED/$code"

  if [[ "$lower_ext" == "heic" || "$lower_ext" == "heif" ]]; then
    processing_path="$PROCESSING/$code/${hash}.jpg"
    if ! sips -s format jpeg "$file" --out "$processing_path" >>"$LOG" 2>&1; then
      log "FAIL converting HEIC, leaving in inbox for manual look: $file"
      return 1
    fi
    rm -f "$file"
  else
    processing_path="$PROCESSING/$code/${hash}.${lower_ext}"
    if ! mv "$file" "$processing_path"; then
      log "FAIL moving to processing, leaving in inbox for manual look: $file"
      return 1
    fi
  fi
  return 0
}

# Invoke process-cards on an already-staged file — processing_path is
# already named <hash>.<ext> and already in its final processing format (no
# HEIC conversion happens here). Shared by process_one (fresh drop, via
# stage_file) and resume_staged (crash recovery).
run_and_archive() {
  local processing_path="$1" hash="$2" code="$3"

  # Safety net: a duplicate of this exact photo may have been fully
  # processed by a *different* run before a crash left this one staged.
  if compgen -G "$PROCESSED/$code/${hash}.*" > /dev/null; then
    rm -f "$processing_path"
    log "skip duplicate (already processed, found on resume): $(basename "$processing_path") -> $hash"
    return
  fi

  local final_path="$PROCESSED/$code/$(basename "$processing_path")"
  local storage_key="$code/$(basename "$processing_path")"
  local prompt
  prompt="Use the process-cards skill on the photo at ${processing_path}. Event folder code: ${code}. Content hash: ${hash}. Local archive path — write any cropped card images (Step 2) into this same directory, which already exists — is: ${final_path}. Supabase Storage object key — include this exact string as sourceImagePath in your POST body — is: ${storage_key}. Print only PROCESS_CARDS_OK ${hash} or PROCESS_CARDS_FAIL ${hash} <reason> as your entire final message."

  local outfile exit_code output last_line
  outfile="$(mktemp)"
  run_claude_with_timeout "$CLAUDE_TIMEOUT_SECONDS" "$prompt" "$outfile"
  exit_code=$?
  output="$(cat "$outfile")"
  rm -f "$outfile"
  last_line="$(printf '%s' "$output" | tail -n 1)"
  printf '%s\n' "$output" >> "$LOG"

  if [[ $exit_code -eq 0 && "$last_line" == PROCESS_CARDS_OK* ]]; then
    if mv "$processing_path" "$final_path"; then
      log "OK: $(basename "$processing_path") -> $final_path"
      upload_to_storage "$final_path" "$code"
      # Multi-card crops were already written directly into
      # $PROCESSED/$code/ by the skill during Step 2 (named
      # <hash>-crop-<NN>.<ext>) — upload those too, uniform with the
      # original. Glob matches nothing on a single-card photo; the
      # -e guard skips the unexpanded literal in that case.
      local crop
      for crop in "$PROCESSED/$code/${hash}-crop-"*; do
        [[ -e "$crop" ]] || continue
        upload_to_storage "$crop" "$code"
      done
    else
      local failed_path="$FAILED/$code/$(basename "$processing_path")"
      mv "$processing_path" "$failed_path" 2>>"$LOG"
      printf '%s\n' "PROCESS_CARDS_OK but archive move failed — contact record already exists in the DB; its photo will 404 until this file is manually placed at $final_path" > "$FAILED/$code/${hash}.error.txt"
      log "FAIL: archive move failed after OK result: $(basename "$processing_path") -> $failed_path"
    fi
  else
    local failed_path="$FAILED/$code/$(basename "$processing_path")"
    if ! mv "$processing_path" "$failed_path"; then
      log "FAIL: could not move to failed/, left in place: $processing_path"
      failed_path="$processing_path"
    fi
    local reason="$last_line"
    if [[ $exit_code -eq 124 ]]; then
      reason="claude timed out after ${CLAUDE_TIMEOUT_SECONDS}s"
    elif [[ $exit_code -ne 0 ]]; then
      reason="claude exited $exit_code: $last_line"
    fi
    printf '%s\n' "$reason" > "$FAILED/$code/${hash}.error.txt"
    log "FAIL: $(basename "$processing_path") -> $failed_path ($reason)"
  fi
}

process_one() {
  local file="$1" code="$2"
  local hash processing_path
  stage_file "$file" "$code" || return
  run_and_archive "$processing_path" "$hash" "$code"
}

# Resume anything left in .processing/ after an apparent crash. Filenames
# there are always <hash>.<ext> (baked in by stage_file) — the hash is read
# from the filename, never recomputed. Recomputing from bytes would hash the
# already-converted JPEG for any photo that crashed mid-HEIC-conversion,
# silently breaking dedup identity for that photo, since the original HEIC
# bytes are gone by that point (stage_file deletes them right after a
# successful conversion).
resume_staged() {
  find "$PROCESSING" -mindepth 2 -maxdepth 2 -type f ! -name '.*' 2>/dev/null | while read -r stale; do
    local code base hash
    code="$(basename "$(dirname "$stale")")"
    base="$(basename "$stale")"
    hash="${base%.*}"
    log "resuming staged file after apparent crash: $stale"
    run_and_archive "$stale" "$hash" "$code"
  done
}

log "=== watch-cards starting (poll every ${POLL_SECONDS}s) ==="

while true; do
  resume_staged

  find "$INBOX" -mindepth 2 -maxdepth 2 -type f ! -name '.*' 2>/dev/null | while read -r file; do
    code="$(basename "$(dirname "$file")")"
    process_one "$file" "$code"
  done

  sleep "$POLL_SECONDS"
done
