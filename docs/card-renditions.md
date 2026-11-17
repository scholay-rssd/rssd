# Preparing cloud card renditions

Card exports can be packaged for any Center workspace. The server contract is documented in `center/rssd/RENDITIONS.md`.

## Prepare

Resolve the export's article to its canonical Center work, then read `/api/rssd/v1/works/<workId>/editions/<locale>/<revision>`. Save a local `source.json` containing `workId`, `revision` and the returned `hash`. The export manifest's source version must match this revision. Keep private manifests and generated assets under an ignored output directory.

```sh
node scripts/prepare-card-rendition.mjs manifest.json workspace-id .local/cards source.json
```

The preparer verifies exported page checksums, preserves page dimensions, encodes WebP at quality 80 and creates a maximum 360 × 480 cover at quality 70. These quality settings are initial storage defaults. Review small text and formulas at the intended reading size when choosing production quality.

The output contains `article-media/<sha256>.<extension>` and `renditions/<manifest-sha256>.json`. Identical images share a file. `outputBytes` counts unique assets referenced by this set, including its cover. Storage totals across several sets should count unique files in the output directory.

## Reproducible layouts

Algorithmic and intelligent layouts can provide an additional JSON file with shared `css`, ordered `pages` containing `html`, and `assets` containing package-relative content-addressed image paths. The page count must match the export manifest. The first exported pixel page supplies the small cover.

```sh
node scripts/prepare-card-rendition.mjs manifest.json workspace-id .local/cards source.json layout.json
```

Use `/article-media/<sha256>.<extension>` in HTML and CSS. List each corresponding `article-media/<sha256>.<extension>` file in `assets`. The preparer verifies the image identity, stores one copy and rewrites references to workspace media IDs. Layout exports retain complete page text and image references. Embedded data URLs are rejected.

## Upload and retry

Set `RSSD_CENTER_ORIGIN` and `RSSD_CENTER_TOKEN` through the existing secret environment. The uploader checks the server capability and source edition before uploading assets.

```sh
node scripts/upload-card-rendition.mjs .local/cards/renditions/<manifest-sha256>.json
```

The uploader queries each media ID before transferring missing bytes, then saves the manifest. Run the same command again after an interrupted response. It first looks for the immutable rendition ID, so a completed request is recovered without another upload.

The Center PR must be deployed before this command can upload. Local packaging can be reviewed independently. Existing local Card View samples require their canonical Center source identities and normalized layout exports when imported.
