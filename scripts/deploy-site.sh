#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -x /opt/homebrew/opt/node@24/bin/node ]]; then export PATH="/opt/homebrew/opt/node@24/bin:$PATH"; fi
node -e 'if(Number(process.versions.node.split(".")[0])<24)throw Error("Node.js 24+ required")'
site_id="${1:?site id required}"
deploy_host="${2:?SSH target required}"
site_port="${3:?loopback port required}"
[[ "$site_id" =~ ^[a-z][a-z0-9-]{1,30}$ && "$site_id" != scholay-today ]]
[[ "$deploy_host" =~ ^[a-zA-Z0-9_.@-]+$ && "$site_port" =~ ^[0-9]{4,5}$ ]]
ssh_options=(-o BatchMode=yes -o LogLevel=ERROR -o ConnectTimeout=30 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o IPQoS=none)
if [[ -n "${SCHOLAY_SSH_CONTROL:-}" ]]; then ssh_options+=(-o "ControlPath=$SCHOLAY_SSH_CONTROL"); fi
# A code-only repair can reuse a reviewed package prepared from the active
# release, including its checksum-validated homepage. Never package unrelated
# local work or rebuild an unchanged custom homepage for this path.
if [[ -n "${SCHOLAY_DEPLOY_PREPARED:-}" ]]; then
  remote="$SCHOLAY_DEPLOY_PREPARED"
  [[ "$remote" =~ ^/tmp/scholay-site-$site_id-[a-zA-Z0-9-]+$ ]]
  ssh "${ssh_options[@]}" "$deploy_host" "set -e; test -d '$remote'; test ! -L '$remote'; cd '$remote'; test -f package.json; test -f scripts/run-site.mjs; test ! -e desktop; test ! -e editorial; test ! -e .git; test ! -e .local; export PATH=/opt/scholay-admin/runtime/bin:\$PATH; npm ci --omit=dev --no-audit --no-fund; if [ -d theme-homepages ]; then python3 scripts/activate-theme-site.py '$site_id' '$site_port'; else bash scripts/install-site.sh '$site_id' '$site_port'; fi"
  exit 0
fi
stage="$(mktemp -d /tmp/scholay-site-package.XXXXXX)"
chmod 755 "$stage"
archive="$stage.tar.gz"
trap 'rm -rf "$stage"; rm -f "$archive"' EXIT
# Explicit code allowlist. No desktop, manuscripts, caches or credentials.
cp -R admin scripts sites contracts "$stage/"
# Ship the private seed overlay (docs/private-data-overlay.md) when present.
seeds="$(node --input-type=module -e "import {overlayDirectory,SITE_SEEDS_DIR} from './scripts/data-overlay.mjs';console.log(overlayDirectory(SITE_SEEDS_DIR).directory)")"
rm -rf "$stage/sites/seeds"
cp -R "$seeds" "$stage/sites/seeds"
node scripts/package-web-engine.mjs "$stage"
cp package.json package-lock.json "$stage/"
if node --input-type=module - "$site_id" <<'JS'
import {profiles} from './scripts/site-config.mjs';import {themeForSite} from './web/themes/registry.mjs';
process.exit(themeForSite(profiles.find(s=>s.id===process.argv[2])||{})?.homepage?0:1);
JS
then
  node scripts/build-theme-home.mjs "$site_id" "$stage/theme-homepages"
fi
COPYFILE_DISABLE=1 tar --no-xattrs --exclude='__pycache__' --exclude='*.pyc' -C "$stage" -czf "$archive" .
remote="/tmp/scholay-site-$site_id-$(date -u +%Y%m%d-%H%M%S)"
scp "${ssh_options[@]}" "$archive" "$deploy_host:$remote.tar.gz"
ssh "${ssh_options[@]}" "$deploy_host" "set -e; mkdir '$remote'; tar -xzf '$remote.tar.gz' -C '$remote'; cd '$remote'; export PATH=/opt/scholay-admin/runtime/bin:\$PATH; npm ci --omit=dev --no-audit --no-fund; if [ -d theme-homepages ]; then python3 scripts/activate-theme-site.py '$site_id' '$site_port'; else bash scripts/install-site.sh '$site_id' '$site_port'; fi; rm '$remote.tar.gz'"
