# Receiver installation and staged activation

Download the Linux x64 artifact and its SHA-256 file from the same successful
`Receiver package` CI run. Run `scripts/install-receiver.py ARCHIVE --sha256 HASH`
on Linux with Python 3.12+. It verifies the archive, every contained file and the
protocol version, and installs an immutable release under `/opt/rssd-receiver`.
It does not switch releases, start a writer or alter Nginx.

Create the `rssd-receiver` system user, private configuration directory
`/etc/rssd-receiver` (root-owned, service group readable), state directory
`/var/lib/rssd-receiver` and public release directory `/opt/rssd-public` (both
service-owned). Install `receiver/rssd-receiver.service` into systemd. Point
`/opt/rssd-receiver/current` at the verified release before starting the service.
The artifact includes Node 24 and dependencies; no server-side npm build occurs.

Configuration is JSON: `home`, `source`, `port`, and `sites`. Use
`home: /var/lib/rssd-receiver`, `source: /opt/rssd-receiver/current`, and a free
loopback port (default 4190). Each site contains its validated public site profile,
`publicRoot: /opt/rssd-public/sites/SITE`, a private `baseline` JSON path, the
SHA-256 `tokenHash` of a separately stored random credential, and `accepting: false`
during preparation. Never put the credential or baseline in the public release.

The authenticated `/api/rssd-receiver/v1/sites/SITE/status` response must show
paused intake, zero unresolved requests and the expected baseline hash. A staged
installation does not transfer ownership from the old publisher. Keep the old
public release serving until final delta import and handoff have passed.

At cutover, stop the old site writer, reconcile in-flight requests, install the
final baseline, then enable this site's intake. Nginx proxies only this site's
receiver API path to loopback; public routes point to its own `current` release.
Preserve existing special locations for downloads, domain verification, community
links and dynamic services. Do not expose the receiver state or source directories.

For updates, pause new intake, let accepted builds finish, verify status, and stop
the receiver gracefully before switching its code symlink. Keep its SQLite files
and media. Restart, verify status and restore intake. Retain the current release
and two verified rollback releases; archive older directories before removal.
