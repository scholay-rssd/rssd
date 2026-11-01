#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ "$(uname -s)" == Darwin ]] || { echo 'This installer is for macOS.' >&2; exit 1; }
if [[ -x /opt/homebrew/opt/node@24/bin/node ]]; then export PATH="/opt/homebrew/opt/node@24/bin:$PATH"; fi

# Let the app save its UI state before replacing its bundle. Never force-kill
# a running reader or cleaning job.
if pgrep -x papr-desktop >/dev/null; then
  echo '请先退出 RSSD，再运行 npm run desktop:release。' >&2
  exit 1
fi
bundle="$PWD/desktop/target/release/bundle/macos/RSSD.app"
destination='/Applications/RSSD.app'
legacy_paths=('/Applications/today.app' '/Applications/scholay today.app')
previous="$destination"
if [[ ! -d "$previous" ]]; then
  for legacy in "${legacy_paths[@]}"; do
    if [[ -d "$legacy" ]]; then previous="$legacy"; break; fi
  done
fi
maintenance="$HOME/Library/Application Support/Scholay Today Maintenance"
stamp="$(date -u +%Y%m%d-%H%M%S)"
backup="${SCHOLAY_DESKTOP_BACKUPS:-$maintenance/backups}/$stamp"
stage="/Applications/.rssd-install-$stamp.app"
mkdir -p "$backup" "$maintenance"
chmod 700 "$backup" "$maintenance"

python3 - "$backup" <<'PY'
from pathlib import Path
import sqlite3, shutil, sys, os
source=Path.home()/'Library/Application Support/com.thomas.papr'
backup=Path(sys.argv[1])
spaces=[source]+([p for p in (source/'spaces').iterdir() if p.is_dir()] if (source/'spaces').is_dir() else [])
for space in spaces:
    target=backup/space.relative_to(source); target.mkdir(parents=True,exist_ok=True)
    for name in ['papr.db','hot-board.db']:
        path=space/name
        if not path.exists(): continue
        src=sqlite3.connect(path.as_uri()+'?mode=ro',uri=True)
        dest=sqlite3.connect(target/name)
        src.backup(dest)
        if dest.execute('PRAGMA quick_check').fetchone()[0]!='ok':
            raise RuntimeError('Database backup check failed: '+str(path))
        src.close(); dest.close(); os.chmod(target/name,0o600)
    for name in ['spaces.json','site.json','editorial-workspace.json','writing-brands.json','publication-queue.json']:
        path=space/name
        if path.exists(): shutil.copy2(path,target/name)
state=source/'.window-state.json'
if state.exists(): shutil.copy2(state,backup/state.name)
# Center drafts, outbox and archived organization contexts are independent of SQLite.
center=source/'center'
if center.is_dir(): shutil.copytree(center,backup/'center',symlinks=True)
PY
# Local task state is independent of the RSS SQLite databases. Preserve it too.
SCHOLAY_BACKUP_DIR="$backup" node --input-type=module - <<'JS'
import {configuredWorkspace} from './scripts/editorial-location.mjs';
import {cp,mkdir,access,readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
const roots=[{id:'academic',path:configuredWorkspace()}],data=join(homedir(),'Library/Application Support/com.thomas.papr');
try{const registry=JSON.parse(await readFile(join(data,'spaces.json'),'utf8'));for(const site of registry.sites.filter(s=>!s.legacy)){const state=join(data,'spaces',site.spaceId);let path=join(state,'workspace');try{path=JSON.parse(await readFile(join(state,'editorial-workspace.json'),'utf8')).path;}catch{}roots.push({id:site.spaceId,path});}}catch{}
for(const item of roots){const root=item.path,out=join(process.env.SCHOLAY_BACKUP_DIR,'editorial-state',item.id);
for(const relative of ['.local/workbench','.local/cursor','.local/today','.local/sites','.local/publication-center','.local/publishing-flow','.local/publication-queue.json','_ops/publishing/variants/en','_ops/inventory/article-index.json']){
  try{await access(join(root,relative));}catch{continue;}
  await mkdir(join(out,relative,'..'),{recursive:true,mode:0o700});
  await cp(join(root,relative),join(out,relative),{recursive:true});
}}
JS
if [[ -d "$previous" ]]; then
  ditto -c -k --keepParent "$previous" "$backup/previous-app.zip"
fi

npm run desktop:test
# Only the generated bundle; Rust's compilation cache and user data are kept.
rm -rf -- "$bundle"
npm run desktop:build
test -x "$bundle/Contents/MacOS/papr-desktop"
test -x "$bundle/Contents/Resources/mcp/scholay-mcp"

replacing=0
restore_on_exit() {
  result=$?
  if [[ "$result" != 0 && "$replacing" == 1 && -f "$backup/previous-app.zip" ]]; then
    rm -rf -- "$destination"
    ditto -xk "$backup/previous-app.zip" /Applications
    echo 'Installation failed; restored the previous app bundle.' >&2
  fi
  rm -rf -- "$stage"
}
trap restore_on_exit EXIT
ditto "$bundle" "$stage"
xattr -cr "$stage"
cmp "$bundle/Contents/MacOS/papr-desktop" "$stage/Contents/MacOS/papr-desktop"
node desktop/scripts/macos-signing.mjs verify "$stage" "$previous" > "$backup/signing.json"
# Building can take several minutes. Do not replace a bundle the user reopened
# during that time: its process would keep running the previous mapped binary.
if pgrep -x papr-desktop >/dev/null; then
  echo '构建已完成，但 RSSD 在此期间重新打开了。请正常退出后重新安装；本次未替换应用。' >&2
  exit 1
fi
replacing=1
rm -rf -- "$destination"
mv "$stage" "$destination"
# Archive only this product's old bundle names; preserve its native identity.
for legacy in "${legacy_paths[@]}"; do
  if [[ -d "$legacy" && "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$legacy/Contents/Info.plist" 2>/dev/null)" == 'com.thomas.papr' ]]; then
    mv "$legacy" "$backup/legacy-$(basename "$legacy")"
  fi
done
python3 - "$destination" "$maintenance/current-desktop.json" "$backup" <<'PY'
from pathlib import Path
import datetime, hashlib, json, plistlib, subprocess, sys
bundle=Path(sys.argv[1])
with (bundle/'Contents/Info.plist').open('rb') as f: info=plistlib.load(f)
assert info['CFBundleIdentifier']=='com.thomas.papr'
receipt={'installedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
    'sourceRoot':str(Path.cwd()),'installedBundle':str(bundle),
    'version':info['CFBundleShortVersionString'],'backup':sys.argv[3],
    'codeSigning':json.loads(Path(sys.argv[3],'signing.json').read_text()),
    'binarySha256':hashlib.sha256((bundle/'Contents/MacOS/papr-desktop').read_bytes()).hexdigest()}
Path(sys.argv[2]).write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n')
Path(sys.argv[3],'installation.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n')
PY
replacing=0
# Cursor's existing local MCP command must follow the renamed app bundle.
# Update only this executable path and retain a private byte-for-byte backup.
python3 - "$destination" "$backup" <<'PY'
from pathlib import Path
import json, os, shutil, stat, sys
destination=Path(sys.argv[1]); backup=Path(sys.argv[2])
path=Path.home()/'.cursor/mcp.json'
if path.is_file():
    raw=path.read_text(); config=json.loads(raw)
    old_commands={str(Path(old)/'Contents/Resources/mcp/scholay-mcp') for old in ['/Applications/today.app','/Applications/scholay today.app']}
    commands={server.get('command') for server in config.get('mcpServers',{}).values() if isinstance(server,dict) and isinstance(server.get('command'),str)} & old_commands
    if commands:
        target=backup/'client-config/cursor-mcp.json'; target.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
        shutil.copyfile(path,target); target.chmod(0o600)
        replacement=str(destination/'Contents/Resources/mcp/scholay-mcp')
        for command in commands: raw=raw.replace(command,replacement)
        temporary=path.with_name(path.name+'.rssd-install-tmp')
        temporary.write_text(raw); temporary.chmod(stat.S_IMODE(path.stat().st_mode)); os.replace(temporary,path)
        (backup/'client-config/migration.json').write_text(json.dumps({'client':'Cursor','commandsUpdated':len(commands),'command':replacement},indent=2)+'\n')
PY
# Keep only the newest few release backups (database copies + previous app zip);
# every install adds ~400 MB. Override with SCHOLAY_KEEP_BACKUPS.
backup_root="${SCHOLAY_DESKTOP_BACKUPS:-$maintenance/backups}"
keep="${SCHOLAY_KEEP_BACKUPS:-3}"
find "$backup_root" -mindepth 1 -maxdepth 1 -type d -name '[0-9]*-[0-9]*' | sort -r | tail -n +"$((keep + 1))" | while IFS= read -r old; do
  [[ "$old" != "$backup" ]] && rm -rf -- "$old"
done
echo "Installed: $destination"
echo "Backup: $backup"
echo '本次安装保留原用户数据目录。'
# Start the freshly installed app; set SCHOLAY_NO_OPEN=1 to skip (e.g. headless).
if [[ -z "${SCHOLAY_NO_OPEN:-}" ]]; then open "$destination" && echo '已启动 RSSD。'; fi
