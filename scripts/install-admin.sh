#!/usr/bin/env bash
set -euo pipefail
# Run as root on the host. The application and publisher run as separate users.
source_dir="$(cd "$(dirname "$0")/.." && pwd)"
runtime=/opt/scholay-admin/runtime
state=/var/lib/scholay-admin
stamp="$(date -u +%Y%m%d-%H%M%S)"
test -x "$runtime/bin/node"
for account in scholay-admin scholay-publisher; do
  id "$account" >/dev/null 2>&1 || useradd --system --no-create-home --shell /sbin/nologin "$account"
done
install -d -m 700 -o scholay-admin -g scholay-admin "$state" "$state/backups"
install -d -m 755 /etc/scholay-admin /etc/nginx/snippets /opt/scholay-admin/releases
install -d -m 755 -o scholay-publisher -g scholay-publisher /opt/scholay-today-web/releases
chown scholay-publisher:scholay-publisher /opt/scholay-today-web /opt/scholay-today-web/releases
export SCHOLAY_ADMIN_DB="$state/admin.sqlite"
if [[ -f "$SCHOLAY_ADMIN_DB" ]]; then
  "$runtime/bin/node" "$source_dir/admin/cli.mjs" backup "$state/backups/before-upgrade-$stamp.sqlite"
fi
"$runtime/bin/node" "$source_dir/admin/cli.mjs" seed /opt/scholay-today-web/current
if [[ ! -f /etc/scholay-admin/worker.env ]]; then
  "$runtime/bin/node" "$source_dir/admin/cli.mjs" worker-token /etc/scholay-admin/worker.env
fi
if [[ ! -f /etc/scholay-admin/initialized ]]; then
  "$runtime/bin/node" "$source_dir/admin/cli.mjs" setup /etc/scholay-admin/first-setup-code
  touch /etc/scholay-admin/initialized
fi
cat > /etc/scholay-admin/admin.env <<'ENV'
SCHOLAY_ADMIN_DB=/var/lib/scholay-admin/admin.sqlite
SCHOLAY_ADMIN_ORIGIN=https://today.scholay.com
PORT=4180
ENV
chown -R scholay-admin:scholay-admin "$state"
chown root:scholay-admin /etc/scholay-admin/admin.env
chown root:scholay-publisher /etc/scholay-admin/worker.env
chmod 640 /etc/scholay-admin/admin.env /etc/scholay-admin/worker.env
chmod 600 /etc/scholay-admin/first-setup-code
app_release="/opt/scholay-admin/releases/$stamp"
mv "$source_dir" "$app_release"
chown -R root:root "$app_release"
chmod 755 "$app_release"
previous_app="$(readlink /opt/scholay-admin/current || true)"
previous_config="/etc/scholay-admin/nginx-before-$stamp.conf"
cp /etc/nginx/conf.d/today.scholay.com.conf "$previous_config"
restore_on_error() {
  cp "$previous_config" /etc/nginx/conf.d/today.scholay.com.conf
  nginx -t && systemctl reload nginx
  if [[ -n "$previous_app" ]]; then
    ln -sfn "$previous_app" /opt/scholay-admin/next
    mv -Tf /opt/scholay-admin/next /opt/scholay-admin/current
    systemctl restart scholay-admin scholay-publisher
  else
    systemctl stop scholay-publisher scholay-admin || true
  fi
}
trap restore_on_error ERR
systemctl stop scholay-publisher 2>/dev/null || true
ln -sfn "$app_release" /opt/scholay-admin/next
mv -Tf /opt/scholay-admin/next /opt/scholay-admin/current
install -m 644 "$app_release/deploy/scholay-admin.service" "$app_release/deploy/scholay-publisher.service" /etc/systemd/system/
install -m 644 "$app_release/deploy/scholay-admin-proxy.conf" /etc/nginx/snippets/
install -m 644 "$app_release/deploy/today.scholay.com.nginx.conf" /etc/nginx/conf.d/today.scholay.com.conf
nginx -t
systemctl daemon-reload
systemctl enable scholay-admin scholay-publisher
systemctl restart scholay-admin
for attempt in $(seq 1 20); do
  if curl --noproxy '*' --fail --silent http://127.0.0.1:4180/manage/health >/dev/null; then break; fi
  sleep 1
done
curl --noproxy '*' --fail --silent http://127.0.0.1:4180/manage/health >/dev/null
systemctl reload nginx
systemctl start scholay-publisher
for attempt in $(seq 1 15); do
  if curl --noproxy '*' --fail --silent --resolve today.scholay.com:443:127.0.0.1 https://today.scholay.com/manage/health >/dev/null; then break; fi
  sleep 1
done
curl --noproxy '*' --fail --silent --resolve today.scholay.com:443:127.0.0.1 https://today.scholay.com/manage/health >/dev/null
trap - ERR
echo "Admin deployed: $app_release"
