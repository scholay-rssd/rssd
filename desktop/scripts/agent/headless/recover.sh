#!/bin/bash
# Compatibility entry point; receipt selection and recovery live in Node.
set -eu
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
exec "${SCHOLAY_HEADLESS_NODE:-node}" "$ROOT/desktop/scripts/agent/headless/recover.mjs" "$@"
