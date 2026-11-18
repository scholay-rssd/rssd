# Card rendition storage

A card set belongs to a workspace, work, locale and immutable Center edition revision. The edition hash is supplied by the Center. The export fingerprint identifies local rendering input and is a separate value. Articles of every section and record kind use this relationship through their existing work identity.

The preparation command accepts the manifest produced by the existing Card View export.

```powershell
node scripts/prepare-card-rendition.mjs manifest.json workspace-id output-directory
```

It verifies page sizes and hashes, retains dimensions, encodes WebP at quality 80, creates a 320-pixel cover, and writes content-addressed assets followed by an immutable rendition manifest. Quality 80 is a starting encoding policy. Text-heavy exports require visual review before publication. The original export stays available.

Call `uploadCardRendition` with the authenticated Center client, parsed rendition manifest, output directory, and the source binding captured when generating the export. The binding has `workId`, `revision`, `sourceHash` from the Center edition and `exportHash` from the local manifest. Resolve legacy article IDs through the editorial detail's workId. Preserve this binding through retries.

Uploads query existing media before sending missing bytes. The final registration happens after all referenced assets exist. Retrying the same set returns the same identity. Network interruption may leave unattached media available for retry. Garbage collection requires a reference-aware retention policy before automated deletion is enabled.

Generation methods map to algorithm, intelligent and image. Each has ordered page references and a cover reference. The same bytes have one content-addressed object within an organization and separate permission-controlled media references per workspace.

The Center companion change adds `/editorial/:workspaceId/renditions`. These modules prepare and register data. Existing Obsidian local samples continue using their local reader until the cloud reader integration is implemented.

The measured pilot held 332 PNG pages at 511.2 MiB. The WebP page payload was 52.4 MiB at unchanged resolution, before thumbnails. This is measurement of the pilot, not a universal compression ratio. Keeping HTML/CSS recipes with source media references can further reduce deterministic rendering storage. That recipe persistence and execution path remains future work, as does lifecycle cleanup of superseded sets.

The API indexes cover, title, method, section, language and source revision for subsequent gallery work. A gallery implementation can load bounded metadata pages first and request full card manifests on demand.
