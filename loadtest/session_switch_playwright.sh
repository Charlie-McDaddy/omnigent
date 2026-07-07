#!/usr/bin/env bash
# Playwright session-switch benchmark against a live Omnigent deployment.
#
# Prerequisites:
#   1. web/.env.local — OMNIGENT_URL, OMNIGENT_AUTH_TOKEN
#   2. Vite dev server on PLAYWRIGHT_BASE_URL (default http://127.0.0.1:5173)
#      Must be started with the same .env.local so the proxy authenticates:
#        cd web && npm run dev
#   3. Optional Arca Chrome on your laptop:
#        PLAYWRIGHT_CDP_URL=http://127.0.0.1:29222 ./loadtest/session_switch_playwright.sh
#
# Usage (from repo root):
#   ./loadtest/session_switch_playwright.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/web"
ENV_FILE="$WEB/.env.local"
BASE_URL="${PLAYWRIGHT_BASE_URL:-http://127.0.0.1:5173}"
RUNS="${SESSION_SWITCH_RUNS:-5}"
LABEL="${SESSION_SWITCH_LABEL:-e2e}"
OUT_LOG="${TMPDIR:-/tmp}/session-switch-playwright.log"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: missing $ENV_FILE (need OMNIGENT_URL + OMNIGENT_AUTH_TOKEN)" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a && source "$ENV_FILE" && set +a

if [[ -z "${OMNIGENT_URL:-}" || -z "${OMNIGENT_AUTH_TOKEN:-}" ]]; then
  echo "error: OMNIGENT_URL and OMNIGENT_AUTH_TOKEN must be set in .env.local" >&2
  exit 1
fi

probe="$(curl -s -H "Authorization: Bearer $OMNIGENT_AUTH_TOKEN" "${OMNIGENT_URL%/}/v1/sessions?limit=1" | head -c 40)"
if [[ "$probe" != '{"object"'* ]]; then
  echo "error: OMNIGENT_AUTH_TOKEN looks invalid or expired (API did not return JSON)." >&2
  echo "  Refresh web/.env.local — e.g. export a new token from databricks auth." >&2
  exit 1
fi

code="$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/" || true)"
if [[ "$code" != "200" ]]; then
  echo "error: Vite dev server not reachable at $BASE_URL (got HTTP $code)" >&2
  echo "Start it in another terminal:  cd web && npm run dev" >&2
  exit 1
fi

echo "==> Playwright session-switch perf (target API: $OMNIGENT_URL, UI: $BASE_URL, runs=$RUNS)"
(
  cd "$WEB"
  PLAYWRIGHT_BASE_URL="$BASE_URL" \
  SESSION_SWITCH_RUNS="$RUNS" \
  SESSION_SWITCH_LABEL="$LABEL" \
  npm run bench:session-switch:e2e 2>&1 | tee "$OUT_LOG"
)

summary="$(rg 'SESSION_SWITCH_PERF_JSON' "$OUT_LOG" | rg '"kind":"summary"' | tail -1 | sed 's/^SESSION_SWITCH_PERF_JSON //')"
if [[ -z "$summary" ]]; then
  # Back-compat: summary without kind field
  summary="$(rg 'SESSION_SWITCH_PERF_JSON' "$OUT_LOG" | rg -v '"kind":"sample"' | tail -1 | sed 's/^SESSION_SWITCH_PERF_JSON //')"
fi
if [[ -z "$summary" ]]; then
  echo "error: no SESSION_SWITCH_PERF_JSON line in output (see $OUT_LOG)" >&2
  exit 1
fi

python3 - "$summary" <<'PY'
import json, sys
s = json.loads(sys.argv[1])
print()
print(f"### Session-switch latency (Playwright e2e, real API, n={s['runs']} p50)")
print()
print(f"Sessions: `{s['fromId']}` → `{s['toId']}`")
print()
print("| Metric | ms |")
print("|--------|-----|")
for key, label in [
    ("historyHydratedMs", "historyHydratedMs (instrumented store gate)"),
    ("blankScreenMs", "blankScreenMs (loading placeholder hidden)"),
    ("transcriptReadyMs", "transcriptReadyMs (transcript shell)"),
    ("bubbleVisibleMs", "bubbleVisibleMs (first message bubble)"),
    ("snapshotHydratedMs", "snapshotHydratedMs (metadata hydrated)"),
    ("historyFetchMs", "historyFetchMs (GET /items done)"),
    ("snapshotFetchMs", "snapshotFetchMs (GET /sessions done)"),
    ("snapshotLeadObservedMs", "snapshotLeadObservedMs (snapshot − history)"),
]:
    print(f"| {label} | {s[key]:.0f} |")
print()
PY

echo "Raw JSON: $summary"
echo "Full log: $OUT_LOG"
