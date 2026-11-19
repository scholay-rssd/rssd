# Preparing cloud card renditions

Card exports can be packaged for any Center workspace. The server contract is documented in `center/rssd/RENDITIONS.md`.

## Prepare

Resolve the export's article to its canonical Center work, then read `/api/rssd/v1/editorial/<workspaceId>/renditions/source?workId=<workId>&locale=<locale>&revision=<revision>`. Save this JSON response as `source.json`. It contains the workspace, site, article and edition identities. Each must match the export. The export manifest's source version must match this revision. Keep private manifests and generated assets under an ignored output directory.

```sh
node scripts/prepare-card-rendition.mjs manifest.json workspace-id .local/cards source.json
```

The preparer verifies exported page checksums, preserves page dimensions, encodes WebP at quality 80 and creates a maximum 360 × 480 cover at quality 70. These quality settings are initial storage defaults. Review small text and formulas at the intended reading size when choosing production quality.

The output contains `article-media/<sha256>.<extension>` and `renditions/<manifest-sha256>.json`. A per-package `rendition-assets/<manifest-sha256>.json` lists its image filenames so uploads can locate missing images without scanning the shared directory. Keep it with the manifest. Identical images share a file. `outputBytes` counts unique assets referenced by this set, including its cover. Storage totals across several sets should count unique files in the output directory.

## Measured size

A local pilot of 332 PNG pages totalling 511.2 MiB encoded to 52.4 MiB of WebP at quality 80 and unchanged resolution, before covers. The pilot used the same encoder settings as this preparer. It is one measurement, not a universal compression ratio.

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

New uploads require the source identity returned by Center. Previously saved renditions can still be recovered by their original ID. Reprepare older unsaved packages from the export. The uploader verifies the manifest filename against its exact bytes before contacting Center. It asks Center once which of the set's images are missing, transfers only those, four at a time, then saves the manifest. A Center without the combined status request is asked about each image instead. Run the same command again after an interrupted response. It first looks for the immutable rendition ID, so a completed request is recovered without another upload.

The Center PR must be deployed before this command can upload. Local packaging can be reviewed independently. Existing local Card View samples require their canonical Center source identities and normalized layout exports when imported.

## Layouts as raster fallbacks

A website shows raster card sets only. Per edition revision the Center chooses an `ai-image` set first, then `ai-code` (智能排版), then `algorithm` (算法排版), then any other variant; the newest set of that variant. A layout set reaches a website only after it is drawn as a raster set of the same variant:

```sh
node scripts/rasterize-card-layout.mjs --workspace <workspaceId> [--locale zh-CN] [--id <layout rendition id>]... [--out .local/card-rasters] [--upload]
```

The script lists current layout sets that have no raster set of the same variant for the same revision, renders each page in headless Chrome or Edge at the set's declared pixel size, encodes WebP at quality 80 with a 360 × 480 cover, and writes the same package as the preparer. It loads only the page and the layout's declared Center media; any other request is refused. Pages whose content overflows its sheet are reported and are not uploaded. Without `--upload` nothing is sent; review the pages first. It uses the device connection, or `RSSD_CENTER_ORIGIN` and `RSSD_CENTER_TOKEN`.

Fonts come from the machine that renders. A layout that names fonts the machine lacks is drawn with fallbacks, so wrapping can differ from the producer's preview.
