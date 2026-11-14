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

For a task with an explicit body target, record a structured budget in the
overrides, for example
`{"bodyLength":{"unit":"han","minimum":720,"target":800,"maximum":880}}`.
Units are `han` (Unicode Han characters) or `words`. This is an explicit task
range, not an inferred tolerance or a new default for all columns. Count only
ready paragraph/markdown body text; headings, captions, reference paragraphs,
summary and private notes do not count. Mark references `purpose:reference` or
place them under a reference heading. The prompt reserves a separate notes
budget; that suggestion imposes no minimum length on private notes.

Build a complete file-authoring request from the frozen context and your brief:

```sh
npm --silent run headless -- writing-defaults --request context.json --brief brief.txt --output request.txt
```

Read that request before writing. It asks for one flat Notebook v2 JSON object,
with `summary` in the same root. The adapter wraps valid flat JSON for the existing
Center envelope; it also accepts valid legacy envelopes. It never repairs broken
JSON, trims alt text or rewrites prose. New catalog versions check alt length at
20–60 Unicode code points, with a suggested writing target of 28–45. Historical
frozen baselines retain their original checks.

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
rule identity, Notebook structure, alt bounds and any explicit body budget. It
reports body and private-note counts separately; it does not conduct an AI prose review or
grant publication permission. A failed check returns a nonzero CLI status.

An unsigned file draft can obtain bounded machine feedback:

```sh
npm --silent run headless -- writing-defaults --feedback raw-output.txt --file-draft --context context.json --brief brief.txt --assets assets.json --output feedback.txt
```

`revision-requested` writes a complete request containing the exact validation
errors and unchanged raw candidate. Give it to the same writing client and save
its next response as a separate file; the tool does not repair or edit article
bytes. `writing-feedback.json` binds the context, brief, asset manifest and actual
image bytes, retains at most two feedback requests, and reuses a request for the
same candidate. `ready` means the candidate passed the checks; `exhausted` stops
without delivery. Failed/revision-needed states return a nonzero CLI status.
Keep every attempt and actual client receipt. Do not reset the ledger to obtain
more retries or label a later success as first-pass compliance.

This path rejects signed, claimed, revisioned or protected inputs. Center claims
and their original packets, request keys and generation evidence continue through
the existing recovery flow. The feedback command does not invoke a model, submit
an article or add publication authority.

Baseline text, local adjustments, source hashes and task snapshots remain private
run evidence. Runtime-generated signatures record the baseline reference; models
must not invent those signatures. Center-bound new publications reject a wrong
baseline or missing required body images/captions. The existing media pipeline
downloads and registers the actual file before submission. Partial drafts can
still be stored without being represented as complete articles.
