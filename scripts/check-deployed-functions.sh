#!/usr/bin/env bash
# Deployed Edge Functions must be accounted for in supabase/functions/.
#
# Why this exists (audit N1): on 2026-09-14 the project had eleven deployed
# functions with no source in the repo. Nine were already 410 stubs -- the
# project's own retirement convention, correctly applied -- but two
# (districts-create, schools-create) were still fully live, public,
# unauthenticated INSERT endpoints into school_districts/schools, months
# after the migration that cleaned up the junk they produced. Nothing
# compared the two lists, so nobody knew.
#
# A retired function can either stay deployed as a 410 stub (RETIRED below)
# or be deleted outright via the Management API's
# `DELETE /v1/projects/{ref}/functions/{slug}` (needs SUPABASE_ACCESS_TOKEN;
# there's no MCP tool for it, so it's a one-off curl, not part of
# deploy-functions.mjs). Deleted is preferred when nothing still calls or
# links the slug anywhere (docs, monitoring, a client that hardcodes the
# URL) -- ten stubs with no such references (auth-*, bootstrap-admins-
# oneoff, debug-embed, districts-create, reps-*, schools-create) were
# deleted 2026-09-22. `transcribe-voice-memo` stays as a stub instead: it's
# referenced by name in docs/ARCHITECTURE.md and README.md as the
# now-retired precursor to local-agent's Whisper-CLI transcription path,
# and keeping it 410ing is what makes that history checkable rather than
# just asserted. Anything deployed that is neither in supabase/functions/
# nor in RETIRED is a finding.
set -euo pipefail

ref="${SUPABASE_PROJECT_REF:-yrvppufkerbjpvrxniot}"

# Deployed-but-intentionally-absent-from-the-repo: 410 stubs for endpoints
# that have been retired. Adding a name here is a deliberate decision --
# verify it really does answer 410 before you do (see the probe below).
RETIRED=(
  transcribe-voice-memo
)

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# This project deploys through the Supabase MCP tools, so the CLI is not
# necessarily installed anywhere this runs. Prefer the Management API (needs
# only SUPABASE_ACCESS_TOKEN, which CI has anyway) and fall back to the CLI
# when it happens to be present.
list_deployed() {
  if [[ -n "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
    curl -sf -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
      "https://api.supabase.com/v1/projects/${ref}/functions" \
      | python3 -c 'import json,sys; print("\n".join(sorted(f["slug"] for f in json.load(sys.stdin))))'
  elif command -v supabase >/dev/null 2>&1; then
    supabase functions list --project-ref "$ref" -o json \
      | python3 -c 'import json,sys; print("\n".join(sorted(f["slug"] for f in json.load(sys.stdin))))'
  else
    return 2
  fi
}

if ! deployed=$(list_deployed); then
  echo "SKIP: cannot list deployed functions -- set SUPABASE_ACCESS_TOKEN (preferred) or install the Supabase CLI." >&2
  echo "      The 410 probe below still runs if SUPABASE_ANON_KEY is set." >&2
  deployed=""
fi

intree=$(find "$repo_root/supabase/functions" -maxdepth 1 -mindepth 1 -type d \
  ! -name '_shared' -exec basename {} \; | sort)

expected=$(printf '%s\n' $intree "${RETIRED[@]}" | sort -u)

status=0

if [[ -n "$deployed" ]]; then
undeclared=$(comm -23 <(echo "$deployed") <(echo "$expected") || true)
if [[ -n "$undeclared" ]]; then
  echo "FAIL: deployed but neither in supabase/functions/ nor RETIRED (audit N1):" >&2
  echo "$undeclared" | sed 's/^/  - /' >&2
  status=1
fi

missing=$(comm -13 <(echo "$deployed") <(echo "$intree") || true)
if [[ -n "$missing" ]]; then
  echo "WARN: in supabase/functions/ but not deployed:" >&2
  echo "$missing" | sed 's/^/  - /' >&2
fi
fi

# A name on the RETIRED list that answers anything other than 410 is not
# retired -- that is exactly the districts-create situation this guard exists
# to prevent recurring. Needs an anon key; skipped when unavailable so the
# structural check above still runs in a bare CI job.
anon="${SUPABASE_ANON_KEY:-}"
if [[ -n "$anon" ]]; then
  for fn in "${RETIRED[@]}"; do
    [[ -n "$deployed" ]] && { echo "$deployed" | grep -qx "$fn" || continue; }
    code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
      "https://${ref}.supabase.co/functions/v1/${fn}" \
      -H "Authorization: Bearer ${anon}" \
      -H 'Content-Type: application/json' -d '{}' --max-time 20 || echo 000)
    if [[ "$code" != "410" ]]; then
      echo "FAIL: '$fn' is listed as RETIRED but answered HTTP $code, not 410 (audit N1)" >&2
      status=1
    fi
  done
else
  echo "note: SUPABASE_ANON_KEY unset -- skipped the 410 probe of retired functions." >&2
fi

[[ $status -eq 0 ]] && echo "OK: deployed Edge Functions match the repo (+ ${#RETIRED[@]} retired stubs)."
exit $status
