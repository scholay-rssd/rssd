# Headless runtime

Each packaged runtime includes Node.js and the production protocol for one
platform: Linux x64, macOS Apple Silicon (`darwin-arm64`), or macOS Intel
(`darwin-x64`). Install a package only on that same platform and architecture.
It needs no desktop app, browser, private repository, or inbound server.
Installed coding agents retain their own subscriptions and authentication on
the device.

Download the matching artifact from this repository's CI or protected release.
The archive name ends in `linux-x64`, `darwin-arm64`, or `darwin-x64`. Verify
its `SHA256SUMS.txt`, extract it to an empty directory, and install with:

```sh
./node desktop/scripts/agent/headless/standalone.mjs install --manifest-sha256 <runtime-manifest.sha256>
~/.local/share/rssd/headless/rssd center connect https://your-center.example --token-file /private/device-token
~/.local/share/rssd/headless/rssd center registry
~/.local/share/rssd/headless/rssd center work --agent codex --workspace example --once
```

English continuation of an existing Chinese work is documented in
`docs/rssd-translate-continuation.md`. After center PR 9 at `ffb0886c` is
deployed and overview advertises `contracts.translateContinuation` with
integer `version >= 1` and all seven guarantees, enqueue then run the
official Center worker on the Owner-named device. `--agent` selects that
device's Agent Registry ACP CLI (`codex`, `cursor`, …), not a cloud job
id and not `SCHOLAY_CLOUD_EXECUTOR`. `cloud-sync` is not this path.

```sh
rssd center enqueue-translate --work <existingWorkId>
rssd center work --agent codex --workspace <workspaceId> --section <sectionId> --id <demandId> --once
```

That default path may publish. For one existing work stored as English only (zero publications, creating device only), after center PR 10 `f38d8e6b` is deployed and overview advertises `contracts.storeOnlyTranslate` v1 with all eleven guarantees:

```sh
rssd center store-en --work <existingWorkId>
rssd center work --agent codex --workspace <workspaceId> --id <demandId> --once --store-only
```

See `docs/rssd-store-only-translate.md`. Center CI success is not a live deploy.

Omit `--once` only when explicitly starting ongoing work. Use `--section` to
limit scope and `--resume` to resume this device's blocked claim. A quota failure retains
the task and generated result; it does not switch subscriptions or reassign
the claim. `center recover` queries the original submission before retrying.

### Topic pool

Topics can be queued ahead of time and wait to be claimed. A pool topic is a
title and a brief; whoever claims it does the sourcing. These commands need a
Center that includes the demand pool change (scholay-rssd/rssd-center#33).

```
rssd center pool-leads --platform douyin --query 猫 --limit 30
rssd center pool-add --workspace pets --section daily-cat --file topics.json --dry-run
rssd center pool-add --workspace pets --section daily-cat --file topics.json
rssd center demands --workspace pets --section daily-cat --states queued --total
rssd center withdraw --id <queued demandId>
```

`topics.json` is an array (or `{"topics":[…]}`) of
`{title, brief, workType?, topicKey?, lead?, priority?}`. `pool-add` prints one
result per topic: `created`, `existing` (queued before), `repeat` (the Center
says which work or open demand it repeats), `conflict`, or `invalid` (not
sent). Sending the same file again creates nothing new. A work type must be
one the section takes.

`pool-leads` lists hot-board terms the Center has collected. A lead suggests a
topic; it is not a fact or a source. Copy a lead into a topic's `lead` field
to record what prompted it.

### Persona byline

The owner may set, per section in the Center, the persona that signs its new
works: an ID and the name printed as the byline. A claim freezes it with the
other section rules, and the writer signs a new work with that name. A
translation or update keeps the byline of the edition it came from. Update
every writing device before binding a section: the Center refuses a new work
of a signed section that carries another byline.

```
rssd center personas --pack /private/persona-pack.json
rssd center personas --pack /private/persona-pack.json --check
```

The pack is kept outside this repository. Only each persona's ID and name are
read. `--check` lists the sections that name a persona and whether the ID and
name match the pack.

Runtime releases are immutable. `rssd update /path/to/new/extracted-artifact
--manifest-sha256 <hash>` verifies the candidate and refuses activation while
any production command holds a lease. After work stops, rerun the update.
The previous runtime remains on disk. `RSSD_RUNTIME_HOME` changes the install
location; `RSSD_CENTER_HOME` changes the private device-state location. Keep
them separate. Credentials, local drafts, jobs and receipts never enter the
runtime package. Nothing updates itself: a new runtime takes effect only
through `rssd update`.

### From a source checkout

`npm run headless -- <command>` runs the same entry, `standalone.mjs`, from a
checkout of this repository, for example `writing-defaults` or `center`. It
runs the checkout's code as it is; `install` and `version` need an extracted
runtime. This is the only headless entry: the older per-site commands
(`produce`, `queue`, `recover`, `jobs`, `flow <site>`, `agents`, `spaces`,
`verify`, `briefs`) and their Git self-update have been removed.
