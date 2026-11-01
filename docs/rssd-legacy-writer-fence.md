# Legacy content writer fence

The legacy admin can stop accepting content writes while continuing to serve authenticated reads, login, guestbook submission/moderation, labels and the signed Discourse webhook. Deploy this support before a site's handover. Activating or removing the marker does not require restarting the admin.

The default marker is the resolved content database path followed by `.rssd-readonly`, for example `/var/lib/rssd/metho/admin.sqlite.rssd-readonly`. `SCHOLAY_CONTENT_FENCE_FILE` can select another absolute filename. Each database must have its own marker. Keep the marker in a private directory writable only by the operator.

An enabled marker contains:

```json
{"version":1,"siteId":"metho","readOnly":true}
```

Write the marker to a temporary file beside its final path, then atomically rename it. The `siteId` must match the admin's configured site. A malformed, oversized, unreadable or mismatched marker blocks content writes as well; its contents and private path are not returned over HTTP.

`GET /manage/api/content-write-status` reports:

```json
{"siteId":"metho","readOnly":true,"state":"read_only","inFlight":0}
```

`state` is `writable` when the marker is absent, `read_only` for a valid marker, `invalid_marker` for an invalid marker, or `unavailable` when it cannot be read. Only `writable` permits content mutations.

The fence covers every non-read request under `/manage/api/documents`, `/manage/api/news`, `/manage/api/jobs`, `/manage/api/import` and `/manage/api/worker`: creation, revision, review, version restoration, scheduling, publication, cancellation/retry, withdrawal/deletion, original archives, and worker claims/receipts. Responses use HTTP 409 and code `legacy_content_read_only`. It runs before body parsing and again before the handler, so an upload started before the marker cannot finish into an unfenced handler afterward.

For handover:

1. Pause new work for the site on every legacy producer and reconcile retained requests.
2. Confirm the existing publication queue is empty and no job is running.
3. Atomically create the marker, verify its `siteId` and `readOnly: true`, and wait for `inFlight: 0`.
4. Recheck both ordinary and site-build queues. If something arrived before the fence completed, reconcile it before proceeding. Worker completion HTTP requests are fenced too.
5. Stop the site's legacy publisher, retain the admin for auxiliary services, then take and verify the final content snapshot.
6. Keep the marker after activating center writes. A rollback that resumes the legacy writer must first stop/reconcile center writes; removing the marker alone is not a rollback procedure.

The fence protects the HTTP content API. Privileged maintenance scripts or direct SQLite access remain operator actions. It does not replace stopping the old publisher during final handover.

Validation: `node --test tests/admin-content-fence.test.mjs tests/admin.test.mjs tests/guestbook.test.mjs tests/community-links.test.mjs`. The focused tests use real HTTP, including an upload held open across the freeze, every content mutation route, independent database markers, public messages/moderation and a signed forum webhook.
