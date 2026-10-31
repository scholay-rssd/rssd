#!/bin/bash
# Sequential headless production for one site (one writer per workspace).
set -u
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
if [ "${SCHOLAY_HEADLESS_SKIP_UPDATE:-}" != 1 ]; then
  exec "${SCHOLAY_HEADLESS_NODE:-node}" "$ROOT/desktop/scripts/agent/headless/cli.mjs" queue "$@"
fi
export SCHOLAY_HEADLESS_HOME="${SCHOLAY_HEADLESS_HOME:-$ROOT/.local/headless}"
site=${1:-}; shift || true
if [ -z "${site:-}" ] || [ "$#" -lt 1 ]; then
  echo "Usage: queue.sh <siteId> <section:mode> [section:mode...]" >&2
  exit 1
fi
errors=0
failures=0
limit=${SCHOLAY_HEADLESS_ERROR_LIMIT:-2}
case "$limit" in ''|*[!0-9]*|0) echo 'error limit must be a positive integer' >&2; exit 1;; esac
[ "$site" != today ] || site=scholay-today
for spec in "$@"; do
  sec=${spec%%:*}
  mode=${spec##*:}
  brief="$SCHOLAY_HEADLESS_HOME/briefs/${site}-${sec}.txt"
  if [ ! -f "$brief" ]; then
    echo "== $site $sec missing brief $brief" >&2
    errors=$((errors+1))
    failures=$((failures+1))
  elif "${SCHOLAY_HEADLESS_NODE:-node}" "$ROOT/desktop/scripts/agent/headless/produce.mjs" "$site" "$sec" "$mode" "$brief" < /dev/null; then
    echo "== $site $sec ok"
    errors=0
  else
    errors=$((errors+1))
    failures=$((failures+1))
    echo "== $site $sec failed ($errors/$limit)"
  fi
  if [ "$errors" -ge "$limit" ]; then
    echo "error limit reached" >&2
    exit 1
  fi
done
[ "$failures" -eq 0 ]
