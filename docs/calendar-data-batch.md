# Calendar-data batch publication (今日学术)

Supported operator entry for adding verified `kind=year` and `kind=history` records to the public 今日学术 calendar clusters. It does not write social destinations and does not replace the public snapshot.

## Architecture

Public `https://today.scholay.com/calendar-index.json` points at content-addressed year and history collections. Those collections are built when Center editorial publishes a structured record and the site receiver merges it into the current snapshot (`receiver/build.mjs` `snapshotForPackets` → theme `writeCalendarData`). Clustering is:

- year records: `category` (校园培养节点 use `培养节点`) and `start` (`YYYY-MM-DD`)
- history records: `dateKey` (`MM-DD`) and `year`

Maintained write path:

1. This repository (`scholay-rssd/rssd`): `scripts/calendar-data-batch.mjs`
2. RSSD Center editorial: `/api/rssd/v1/editorial/:workspaceId/publish` (existing manuscript protocol, original `requestKey`)
3. Site receiver: additive merge into the live year/history arrays

Not used, and refused by this entry:

- Retired `/manage/api/import`, `/manage/api/news`, `/manage/api/documents` (legacy writer fence)
- `scripts/publish.sh` / `scripts/deploy-site.sh` (code/seed package deploy, not append)
- Local `data.json` / overlay history mirrors, including an incomplete 100-row history file
- MCP `rssd_submit` claim/demand production (this batch is already-prepared calendar data, not a new writing demand)
- Invented bulk-import APIs in `rssd-center`, `rssd-sites` or a non-existent `rssd-editorial` repo

`rssd-sites` only holds public manifests. `rssd-center` already exposes editorial publish and request recovery; a new Center bulk route is not required and must not be invented from this client. `web/themes` (`rssd-themes`) only renders clusters after the receiver snapshot changes.

## Operator procedure

Operator files stay outside this public repository (private overlay or a run directory). Do not commit receipts, tokens or live snapshots.

`plan` / `validate` / `--dry-run` are operator-local and read public JSON only. They can run from this branch checkout without merging to `main` and without deploying site, theme, or receiver code. `plan` exits `1` when the summary contains `conflict` or `invalid` rows so those holds are visible; that is not a write.

Authorized `publish` is also an operator-local CLI. It talks to already-deployed Center editorial and the already-deployed site receiver, which appends by new record id and does not replace the year/history arrays. No production code rollout of receiver/theme is required for this batch. Merging the PR is for the official `main` checkout, not a website deploy. Do not run `publish` until a human authorizes production writes.

```sh
# 1. Dry-run against the live public clusters (default). Safe on this branch.
node scripts/calendar-data-batch.mjs plan \
  --campus /secure/path/yearOfficialCampusSeeds.json \
  --history /secure/path/history-entries.json

# 2. Confirm the plan: originals/already-public are skipped_already_public,
#    queued items are additive, conflicts/invalid dates are not published.

# 3. After Center device login for workspace academic / site scholay-today,
#    and only after production writes are explicitly authorized:
node scripts/calendar-data-batch.mjs publish \
  --campus /secure/path/yearOfficialCampusSeeds.json \
  --history /secure/path/history-entries.json \
  --workspace /secure/path/calendar-batch-workspace \
  --authorize-publish
```

`publish` without `--authorize-publish` is a plan. `--dry-run` never calls Center. Authorized `publish` always re-reads live `calendar-index.json`; local `--live-year` / `--live-history` files cannot substitute for the public clusters. Today's Center `storeOnlyTranslate` / `translateContinuation` contracts are unrelated; this entry must not use `rssd_submit`, `store-en`, or `enqueue-translate`.

Live baseline guards: by default the public year list must have ≥1000 rows and history ≥400 rows. That blocks an empty or 100-row local history mirror from being treated as the public cluster. Tests may pass `--skip-live-min`. Same-day similar titles are `conflict` and stay unpublished until an operator reviews them; they are not updates.

Identity:

- Campus/year: skip when live `id`, `title+start` or `sourceUrl+start` already match. Same-day similar titles are `conflict`, not updates.
- History: skip when live `title+dateKey+year` match. Same-day similar titles are `conflict`.
- Replay uses the frozen packet and original `requestKey`. An `unknown` / `unconfirmed` row is held; it is not submitted again.

## Pacing (site calendar only)

`--gap` default **75 seconds** is a **client courtesy sleep** copied from `scripts/history-batch.mjs`. It is not a Center editorial rate, not a receiver contract, and not a 今日学术 site quota. Academic Center destinations for this workspace are the site only (`site-scholay-today`); Postiz/DEV.to cooldowns (300–360s after a social 429) do not apply here and must not be used.

The receiver (`receiver/server.mjs`) holds `build.lock` and runs **one host-wide build at a time**. `claim()` takes one queued request; `snapshotForPackets` then rebuilds from all already-published packets plus that one new packet. Replay of the same `requestId` returns the original receipt without another build (`docs/receiver-deployment.md`). Measured submit→public (~78s) is that serialized build, not `--gap`.

**Sanctioned configuration for sequential idempotent publication:** `--gap 0`. The writer still waits until the current item is `published` (or held/failed) before minting the next key. That removes the extra 75s sleep; it does not overlap writers and does not skip readback. `--pause 600` remains the backoff only after HTTP 429/5xx.

There is **no supported website-editorial multi-record packet**. Grouping N calendar items into one receiver job would be a new Center/receiver feature (partial failure vs one `requestKey`, identity/resume, and a full-snapshot rebuild still ~78s once). Do not invent it for this batch. Do not pipeline the next `publish` while the previous build is still running unless a later review accepts extra in-flight unknown states.

## Pause and resume

Do not SIGKILL. The running process should finish the current item.

- **Current tested CLI (no stop handler):** wait until the item logs `published` / `unconfirmed` / `error` / `auth_failed`, then SIGTERM during the courtesy `--gap` sleep. File locks with a dead pid are stale and resume can take them.
- **This revision:** SIGINT/SIGTERM sets `stop_at_boundary`, finishes the in-flight item, and does not start the next key. `--limit N` also stops after N newly published items in this process.
- **Resume:** same `--workspace` and `--state`, same campus/history files. Published and `skipped_already_public` keys are skipped. `unconfirmed`/`unknown` keep the original `requestKey` and are not submitted again. `error` after a saved receipt is status-only recovery, not a second request.

```sh
# After a confirmed-item stop, same state, no courtesy sleep:
node scripts/calendar-data-batch.mjs publish \
  --campus /secure/path/yearOfficialCampusSeeds.json \
  --history /secure/path/history-entries.json \
  --workspace /secure/path/calendar-batch-workspace \
  --authorize-publish \
  --gap 0
```

If a supervisor respawns the old argv, stop that job and start one process with `--gap 0`; do not run a second writer against the same `--state`.

## Credentials and access

Required for the publish step, not for plan/validate:

- RSSD Center device connection for the academic workspace (desktop Settings or `rssd center login`). See `docs/center-login.md`.
- The Center workspace must be writable (`writable: true`), bound to `scholay-today`, and have writable `calendar` / `history` sections.
- Do not put device tokens, `SCHOLAY_TODAY_TOKEN`, or `/manage/api` credentials in command arguments, the repository, or receipts copied into tickets.

This agent / PR does not perform production Center login, merge, or deploy.

## Public readback

After each successful item the publisher checks:

- year: canonical URL, title, `start`, `sourceUrl`, and the `培养节点` cluster label when that is the category
- history: canonical URL, title, year, and every source URL (see `scripts/history-batch.mjs`)

Then re-read:

1. `https://today.scholay.com/calendar-index.json` (new hashes only after a successful receiver activation)
2. The year collection: previous public ids still present; new `培养节点` rows on the intended `start` day
3. The history collection: previous public ids still present; new rows on `dateKey` `MM-DD`
4. The article URL returned in the item receipt

Do not treat a local overlay calendar (desktop `yearOfficialCampusSeeds.json` / a 100-row history file) as public verification.

## Rollback

- A failed or unverified receiver build leaves the previous public release active.
- Skipped already-public rows were never written.
- Queued-but-unconfirmed rows keep `requestKey`. Recover with Center `GET /editorial/academic/requests/:key` (or the website publisher `status`). Do not prepare a second packet.
- Do not remove the legacy content-write fence to “roll back” this path.
- Do not restore an incomplete local history snapshot onto the public site.

## Remaining coordinated work after this PR

This PR only adds the supported entry, tests and docs. The prepared 504 campus additions + 100 history entries become publicly verified only after a live plan (counts move: already-public rows and same-day conflicts are held) and:

1. Human review. Merge is optional for operator-local CLI; required before treating this as the `main` script. Do not merge from the implementing agent unless asked.
2. Operator machine has this revision (branch checkout is enough for CLI; production receiver/theme deploy is not).
3. Center device authorization for `academic` / `site-scholay-today` (editorial publish, not MCP claim/submit).
4. `plan` against **live** `calendar-index.json` (counts move; do not reuse an old baseline).
5. Explicit authorization for production writes, then `publish` of queued items only.
6. Independent public readback of index, clusters and item URLs. Existing public year/history rows must still be present.
