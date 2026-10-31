#!/usr/bin/env bash
set -euo pipefail
# Run a reviewed allowlisted release on the target host. Never operates on the
# legacy Today installation, existing frontends or another site's state.
site_id="${1:?site id required}"
site_port="${2:?loopback port required}"
[[ "$site_id" =~ ^[a-z][a-z0-9-]{1,30}$ && "$site_id" != scholay-today ]]
[[ "$site_port" =~ ^[0-9]{4,5}$ && "$site_port" -gt 1024 && "$site_port" -lt 65536 ]]
source_dir="$(cd "$(dirname "$0")/.." && pwd)"
node_bin="${SCHOLAY_NODE:-/opt/scholay-admin/runtime/bin/node}"
"$node_bin" -e 'if(Number(process.versions.node.split(".")[0])<24)process.exit(1)'
base="/opt/scholay-sites/$site_id"
state="/var/lib/scholay-sites/$site_id"
config="/etc/scholay-sites/$site_id"
admin_user="schs-$site_id"
publisher_user="schp-$site_id"
stamp="$(date -u +%Y%m%d-%H%M%S)"
for account in "$admin_user" "$publisher_user"; do
  id "$account" >/dev/null 2>&1 || useradd --system --no-create-home --shell /sbin/nologin "$account"
done
install -d -m 755 "$base/app/releases" "$config" /etc/nginx/snippets
install -d -m 755 -o "$publisher_user" -g "$publisher_user" "$base/web" "$base/web/releases"
install -d -m 700 -o "$admin_user" -g "$admin_user" "$state" "$state/backups"
backup_config="$config/backups/$stamp"
install -d -m 700 "$backup_config"
for file in site.json admin.env worker.env; do
  if [[ -f "$config/$file" ]]; then cp -p "$config/$file" "$backup_config/$file"; fi
done
previous="$(readlink "$base/app/current" || true)"
activated=0
rollback(){
  for file in site.json admin.env worker.env; do
    if [[ -f "$backup_config/$file" ]]; then cp -p "$backup_config/$file" "$config/$file"; fi
  done
  if [[ "$activated" == 1 && -n "$previous" ]]; then
    ln -sfn "$previous" "$base/app/next"; mv -Tf "$base/app/next" "$base/app/current"
    systemctl restart "scholay-$site_id-admin" "scholay-$site_id-publisher"
  fi
}
trap rollback ERR
"$node_bin" --input-type=module - "$source_dir" "$site_id" "$config/site.json" <<'JS'
import {readFile,writeFile,copyFile} from 'node:fs/promises';
const [root,id,file]=process.argv.slice(2),profiles=JSON.parse(await readFile(root+'/sites/profiles.json','utf8')),site=profiles.find(x=>x.id===id);
if(!site||site.legacy)throw Error('Unknown independent site');
try{
 const old=JSON.parse(await readFile(file,'utf8'));
 if(old.id!==site.id||old.spaceId!==site.spaceId||(old.origin!==site.origin&&!site.aliases?.includes(old.origin))||JSON.stringify(old.columns)!==JSON.stringify(site.columns))throw Error('Existing site identity differs; migrate explicitly');
 await copyFile(file,file+'.before-'+Date.now());
 await writeFile(file,JSON.stringify({...old,...site},null,2)+'\n');
}catch(e){if(e.code!=='ENOENT')throw e;await writeFile(file,JSON.stringify(site,null,2)+'\n',{flag:'wx',mode:0o644});}
JS
origin="$("$node_bin" -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).origin' "$config/site.json")"
if curl --noproxy '*' -sf "http://127.0.0.1:$site_port/manage/api/site" > "$config/port-probe.json"; then
  "$node_bin" -e 'const f=require("fs");if(JSON.parse(f.readFileSync(process.argv[1])).siteId!==process.argv[2])throw Error("Port belongs to another site")' "$config/port-probe.json" "$site_id"
fi
export SCHOLAY_ADMIN_DB="$state/admin.sqlite"
if [[ -f "$SCHOLAY_ADMIN_DB" ]]; then "$node_bin" "$source_dir/scripts/run-site.mjs" "$config/site.json" cli backup "$state/backups/before-$stamp.sqlite"; fi
if [[ ! -f "$config/worker-token.env" ]]; then "$node_bin" "$source_dir/scripts/run-site.mjs" "$config/site.json" cli worker-token "$config/worker-token.env"; fi
if [[ ! -f "$config/editorial-token" ]]; then "$node_bin" "$source_dir/scripts/run-site.mjs" "$config/site.json" cli editorial-token "$config/editorial-token"; fi
if [[ ! -f "$config/first-setup-code" ]]; then "$node_bin" "$source_dir/scripts/run-site.mjs" "$config/site.json" cli setup "$config/first-setup-code"; fi
cat > "$config/admin.env" <<ENV
SCHOLAY_ADMIN_DB=$state/admin.sqlite
SCHOLAY_ADMIN_ORIGIN=$origin
PORT=$site_port
ENV
cat > "$config/worker.env" <<ENV
SCHOLAY_ADMIN_API=http://127.0.0.1:$site_port/manage/api
SCHOLAY_PUBLIC_ROOT=$base/web
SCHOLAY_PUBLIC_ORIGIN=$origin
SCHOLAY_VERIFY_LOCAL=1
ENV
chown -R "$admin_user:$admin_user" "$state"
chown root:"$admin_user" "$config/admin.env"
chown root:"$publisher_user" "$config/worker.env" "$config/worker-token.env"
chmod 640 "$config/admin.env" "$config/worker.env" "$config/worker-token.env"
chmod 600 "$config/editorial-token" "$config/first-setup-code"
release="$base/app/releases/$stamp"
mv "$source_dir" "$release"
chown -R root:root "$release"
chmod 755 "$release"
activated=1
systemctl stop "scholay-$site_id-publisher" 2>/dev/null || true
ln -sfn "$release" "$base/app/next"
mv -Tf "$base/app/next" "$base/app/current"
cat > "/etc/systemd/system/scholay-$site_id-admin.service" <<UNIT
[Unit]
Description=Content administration for $site_id
After=network.target
[Service]
User=$admin_user
Group=$admin_user
WorkingDirectory=$base/app/current
EnvironmentFile=$config/admin.env
ExecStart=$node_bin $base/app/current/scripts/run-site.mjs $config/site.json server
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$state
UMask=0077
[Install]
WantedBy=multi-user.target
UNIT
cat > "/etc/systemd/system/scholay-$site_id-publisher.service" <<UNIT
[Unit]
Description=Content publisher for $site_id
After=network.target scholay-$site_id-admin.service
Requires=scholay-$site_id-admin.service
[Service]
User=$publisher_user
Group=$publisher_user
WorkingDirectory=$base/app/current
EnvironmentFile=$config/worker.env
EnvironmentFile=$config/worker-token.env
ExecStart=$node_bin $base/app/current/scripts/run-site.mjs $config/site.json worker
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$base/web
UMask=0022
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable "scholay-$site_id-admin" "scholay-$site_id-publisher"
systemctl restart "scholay-$site_id-admin"
for attempt in $(seq 1 15); do
  if curl --noproxy '*' -sf "http://127.0.0.1:$site_port/manage/health" >/dev/null; then break; fi
  sleep 1
done
curl --noproxy '*' -sf "http://127.0.0.1:$site_port/manage/api/site" > "$config/installed-site.json"
systemctl start "scholay-$site_id-publisher"
trap - ERR
echo "Independent instance ready: $site_id on 127.0.0.1:$site_port"
