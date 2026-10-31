#!/usr/bin/env bash
set -euo pipefail
# Apply only after the compact-snapshot worker has been validated for this site.
# Drop-ins survive ordinary code deployments; no services are stopped here.
site_id="${1:?site id required}"
[[ "$EUID" == 0 && "$site_id" =~ ^[a-z][a-z0-9-]{1,30}$ ]]
if [[ "$site_id" == scholay-today ]]; then
  admin_unit=scholay-admin.service
  publisher_unit=scholay-publisher.service
else
  [[ -f "/etc/scholay-sites/$site_id/site.json" ]]
  admin_unit="scholay-$site_id-admin.service"
  publisher_unit="scholay-$site_id-publisher.service"
fi
systemctl cat "$admin_unit" "$publisher_unit" >/dev/null
stamp="$(date -u +%Y%m%d-%H%M%S)"
backup="/var/backups/scholay-performance/$stamp-$site_id-limits"
install -d -m 700 "$backup"
for unit in "$admin_unit" "$publisher_unit"; do
  folder="/etc/systemd/system/$unit.d"
  install -d -m 755 "$folder"
  if [[ -f "$folder/50-scholay-performance.conf" ]]; then
    cp -p "$folder/50-scholay-performance.conf" "$backup/$unit.conf"
  else
    touch "$backup/$unit.absent"
  fi
done
# All publisher users can open this file read-only and take an exclusive flock.
# /run is shared even with PrivateTmp and ProtectSystem=strict.
cat > /etc/tmpfiles.d/scholay-publication.conf <<'CONFIG'
f /run/lock/scholay-publication.lock 0644 root root -
CONFIG
systemd-tmpfiles --create /etc/tmpfiles.d/scholay-publication.conf
cat > "/etc/systemd/system/$publisher_unit.d/50-scholay-performance.conf" <<'CONFIG'
[Service]
Environment=SCHOLAY_PUBLICATION_LOCK=/run/lock/scholay-publication.lock
Nice=10
CPUWeight=20
IOWeight=20
MemoryHigh=256M
MemoryMax=384M
TasksMax=32
TimeoutStopSec=120
CONFIG
cat > "/etc/systemd/system/$admin_unit.d/50-scholay-performance.conf" <<'CONFIG'
[Service]
MemoryHigh=192M
MemoryMax=256M
TasksMax=64
CONFIG
systemctl daemon-reload
printf 'Publication limits prepared for %s; restart idle services to apply. Backup: %s\n' "$site_id" "$backup"
