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

## Publication actions

The existing authenticated `submissions` endpoint also accepts `withdraw`,
`delete`, and `restore` operations. Read
`GET /api/rssd-receiver/v1/sites/SITE/heads/WORK/LOCALE` first. It returns the
accepted content `revision`, `operationSequence`, `operation`, route, content hash,
request identity and state. A missing identity returns 404. Wait for a pending
publication to settle before freezing an action.

Keep `workId`, locale, site, workspace and public route unchanged. An action
contains the normal envelope plus `operation`, `expectedRevision`,
`expectedOperationSequence` and `operationSequence` (the previous sequence plus
one). Withdrawal and deletion retain the current revision and content hash;
their public tombstone contains no article body or media. Restore supplies the
complete public content and media manifests and may retain the current revision
or explicitly advance it. A same-revision restore cannot change known content.
Normal uploads cannot revive a withdrawn/deleted identity; use explicit restore.

The action sequence is separate from the article revision. Receipts include
both, and replaying a request returns its original receipt without another build.
The SQLite upgrade is additive and retains existing packet hashes. A failed
build or public verification leaves the previous release active. Successful
removal requires the original article URL to return 404/410 and leaves a minimal
`rssd-content/KEY.json` tombstone for verifiable recovery. Keep the tombstone:
later builds must continue masking the original baseline article.

Before upgrading a receiver from the pre-action schema, take an online SQLite
backup and retain its exact binary release reference. The schema change adds
columns, but an old binary uses positional inserts and cannot safely write the
upgraded database. A content-service rollback can restore the previous static
release while preserving the new database and keeping old writers stopped.
Running the old receiver requires its matched pre-upgrade database and a reviewed
handoff of any newer accepted requests; never point the old binary at the new DB.
