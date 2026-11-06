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

```sh
# 1. Dry-run against the live public clusters (default).
node scripts/calendar-data-batch.mjs plan \
  --campus /secure/path/yearOfficialCampusSeeds.json \
  --history /secure/path/history-entries.json

# 2. Confirm the plan: originals/already-public are skipped_already_public,
#    queued items are additive, conflicts/invalid dates are not published.

# 3. After Center device login for workspace academic / site scholay-today,
#    and after this branch is reviewed and deployed to the operator machine:
node scripts/calendar-data-batch.mjs publish \
  --campus /secure/path/yearOfficialCampusSeeds.json \
  --history /secure/path/history-entries.json \
  --workspace /secure/path/calendar-batch-workspace \
  --authorize-publish
```

`plan` / `validate` read public JSON only. `publish` without `--authorize-publish` is a plan. `--dry-run` never calls Center. Authorized `publish` always re-reads live `calendar-index.json`; local `--live-year` / `--live-history` files cannot substitute for the public clusters.

Live baseline guards: by default the public year list must have ≥1000 rows and history ≥400 rows. That blocks an empty or 100-row local history mirror from being treated as the public cluster. Tests may pass `--skip-live-min`. Same-day similar titles are `conflict` and stay unpublished until an operator reviews them; they are not updates.

Identity:

- Campus/year: skip when live `id`, `title+start` or `sourceUrl+start` already match. Same-day similar titles are `conflict`, not updates.
- History: skip when live `title+dateKey+year` match. Same-day similar titles are `conflict`.
- Replay uses the frozen packet and original `requestKey`. An `unknown` / `unconfirmed` row is held; it is not submitted again.

## Credentials and access

Required for the publish step, not for plan/validate:

- RSSD Center device connection for the academic workspace (desktop Settings or `rssd center login`). See `docs/center-login.md`.
- The Center workspace must be writable (`writable: true`) and bound to `scholay-today`.
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

1. Review and merge of this PR (do not merge from the implementing agent unless asked).
2. Operator machine updated to the merged revision.
3. Center device authorization for `academic` / `site-scholay-today`.
4. `plan` against **live** `calendar-index.json` (counts move; do not reuse an old baseline).
5. Authorized `publish` of queued items only.
6. Independent public readback of index, clusters and item URLs.
