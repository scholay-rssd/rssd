# Versioned writing defaults

The core GitHub repository owns the writing rules. Center publishes one validated
catalog; devices load the selected column's public protocol, common skill, content
family, domain skill and referenced image guidance before starting a new article.
`contracts/writing-column-families.json` maps all forty enabled columns. Four
retired academic IDs stay disabled. The catalog is independent of the daily plan.

Rules are maintained as Markdown in `contracts/writing-skills/`; column-specific
elements and image policy are in `contracts/writing-defaults.mjs`. The first
version requires at least one relevant body image, actual objects for visual and
animal profiles, and actual calculations for data figures. Historical batch image
counts do not become global defaults. No fixed article length is imposed.

## Publish a version

After merging and checking out a clean source commit:

```sh
node scripts/export-writing-defaults.mjs /private/rule-export
```

The export records the commit and every public input's SHA-256. Deploy the catalog
through Center's `rssd/writing-defaults.cjs publish` command; publish before
starting a Center version that freezes defaults for new write claims. Catalogs
are retained by content hash, and the active pointer is replaced atomically.
The GET-only `/api/rssd/public/v1/writing-defaults` endpoint exposes public rule
text only; no device token or private workspace material is needed.

## Start an article

```sh
npm --silent run headless -- writing-defaults --workspace metho --section methods --session article-example --output .local/article-example/context.json
```

Read `instructions` in that file before writing. A new session fetches online;
resuming the same session restores its exact baseline even while offline. A fresh
session fails explicitly if Center is unavailable. Rule changes do not silently
relabel old drafts, claims or receipts.

Local preferences are a separate `--overrides preferences.json` input, for example
`{"origin":"local","instructions":"面向初学者，用一个完整例子展开。"}`.
They apply after the baseline and do not change its hash. They cannot silently
remove required images or substitute an illustration for an actual visual object.
Explicit instructions for the current task retain their normal priority and are
recorded with `origin:task`. Source/provenance and publication authority remain
unchanged.

Install the managed entry point in an existing workspace explicitly:

```sh
npm --silent run headless -- writing-defaults --install /private/author-workspace --workspace metho
```

This backs up changed `site-writing`, `rssd-writing` and AGENTS entries under the
workspace's ignored `.local/writing-defaults/` directory. It preserves unrelated
guidance and manuscripts. Managed desktop new-article tasks fetch/freeze the same
baseline automatically; Center freezes it for new write claims. Legacy in-flight
claims and existing saved manuscripts keep their original evidence.

## Check a completed draft

```sh
npm --silent run headless -- writing-defaults --check draft.json --context context.json --assets assets.json
```

`draft.json` contains a notebook v2 object, optionally under `notebook`.
`assets.json` is an array with each image's `blockId`, actual `file` (relative to
the manifest), and `kind` (`owned`, `licensed-source`, `generated` or `computed`).
Licensed images include `sourceUrl`, `creator`, `license` and `licenseEvidence`;
computed figures include `computationRecord`. Every ready image needs alt text and
a caption annotation with its `targetId`. The command checks actual image bytes,
rule identity and concrete fields; it does not conduct an AI prose review or
grant publication permission. A failed check returns a nonzero CLI status.

Baseline text, local adjustments, source hashes and task snapshots remain private
run evidence. Runtime-generated signatures record the baseline reference; models
must not invent those signatures. Center-bound new publications reject a wrong
baseline or missing required body images/captions. The existing media pipeline
downloads and registers the actual file before submission. Partial drafts can
still be stored without being represented as complete articles.
