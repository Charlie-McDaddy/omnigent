#!/usr/bin/env bash
# Playwright pre/post comparison: swaps main's chatStore.ts for PRE, restores for POST.
#
# Prerequisites: same as session_switch_playwright.sh (vite dev + .env.local).
#
# Usage:
#   ./loadtest/session_switch_playwright_compare.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHAT_STORE="$ROOT/web/src/store/chatStore.ts"
CHAT_PAGE="$ROOT/web/src/pages/ChatPage.tsx"
BACKUP_STORE="/tmp/omnigent-chatStore.post.ts"
BACKUP_PAGE="/tmp/omnigent-chatPage.post.tsx"
RUNS="${SESSION_SWITCH_RUNS:-3}"
OUT_DIR="${TMPDIR:-/tmp}/session-switch-playwright-compare"
BASE_URL="${PLAYWRIGHT_BASE_URL:-http://127.0.0.1:5173}"
mkdir -p "$OUT_DIR"

cleanup() {
  if [[ -n "${VITE_PID:-}" ]]; then kill "$VITE_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT

cp "$CHAT_STORE" "$BACKUP_STORE"
cp "$CHAT_PAGE" "$BACKUP_PAGE"

run_side() {
  local label="$1"
  local outfile="$OUT_DIR/${label}.json"
  SESSION_SWITCH_RUNS="$RUNS" SESSION_SWITCH_LABEL="$label" \
    "$ROOT/loadtest/session_switch_playwright.sh" 2>&1 \
    | tee "$OUT_DIR/${label}.log" \
    | rg 'SESSION_SWITCH_PERF_JSON' \
    | tail -1 \
    | sed 's/^SESSION_SWITCH_PERF_JSON //' > "$outfile"
  [[ -s "$outfile" ]] || { echo "error: empty $label result" >&2; exit 1; }
}

echo "==> PRE (main chatStore + ChatPage) — restart Vite"
git show main:"web/src/store/chatStore.ts" > "$CHAT_STORE"
git show main:"web/src/pages/ChatPage.tsx" > "$CHAT_PAGE"
if [[ -n "${VITE_PID:-}" ]]; then kill "$VITE_PID" 2>/dev/null || true; fi
(
  cd "$ROOT/web"
  set -a && source .env.local && set +a
  npm run dev
) > "$OUT_DIR/vite.log" 2>&1 &
VITE_PID=$!
for _ in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/" || true)"
  [[ "$code" == "200" ]] && break
  sleep 1
done
run_side pre

echo "==> POST (branch chatStore + ChatPage) — restart Vite"
cp "$BACKUP_STORE" "$CHAT_STORE"
cp "$BACKUP_PAGE" "$CHAT_PAGE"
kill "$VITE_PID" 2>/dev/null || true
(
  cd "$ROOT/web"
  set -a && source .env.local && set +a
  npm run dev
) >> "$OUT_DIR/vite.log" 2>&1 &
VITE_PID=$!
for _ in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/" || true)"
  [[ "$code" == "200" ]] && break
  sleep 1
done
run_side post

python3 - "$OUT_DIR/pre.json" "$OUT_DIR/post.json" "$RUNS" <<'PY'
import json, sys
pre_path, post_path, runs = sys.argv[1:4]
pre = json.load(open(pre_path))
post = json.load(open(post_path))

def row(name, key, lower_better=True):
    a, b = pre[key], post[key]
    if a == 0:
        delta = "n/a"
    else:
        pct = (b - a) / a * 100
        sign = "-" if lower_better and b < a else ("+" if b > a else "")
        delta = f"{sign}{abs(pct):.0f}%"
    return f"| {name} | {a:.0f} | {b:.0f} | {delta} |"

print()
print(f"### Session-switch latency (Playwright e2e, real API, n={runs} p50)")
print()
print(f"Sessions: `{pre['fromId']}` → `{pre['toId']}`")
print()
print("| Metric | main (pre) | branch (post) | Δ |")
print("|--------|------------|---------------|---|")
for name, key, lb in [
    ("historyHydratedMs (instrumented)", "historyHydratedMs", True),
    ("blankScreenMs", "blankScreenMs", True),
    ("transcriptReadyMs", "transcriptReadyMs", True),
    ("bubbleVisibleMs", "bubbleVisibleMs", True),
    ("snapshotHydratedMs", "snapshotHydratedMs", True),
    ("historyFetchMs", "historyFetchMs", True),
    ("snapshotFetchMs", "snapshotFetchMs", True),
    ("snapshotLeadObservedMs", "snapshotLeadObservedMs", False),
]:
    print(row(name, key, lb))
print()
print("_historyHydratedMs is 0 on PRE when main lacks sessionPerf instrumentation — use blankScreenMs / bubbleVisibleMs for pre/post on older baselines._")
PY

echo "==> Done. Raw: $OUT_DIR/pre.json $OUT_DIR/post.json"
