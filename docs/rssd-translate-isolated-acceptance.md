# t575 isolated Codex acceptance

t575: local ACP writing through `produceCenterEdition` is the correct path. This is **not** `SCHOLAY_CLOUD_EXECUTOR` and not a live Center enqueue.

Extract this bundle into a **new empty directory**. Do not unpack onto the shared computer's dirty repo tree, and do not touch other PIDs.

## What this run is

- Fixture Center only (`https://center.example`). No live `GET`/`POST` to production.
- One labeled source: `work-t575-isolated-acceptance` (enter/forums). It is **not** one of the 93 missing Enter English editions.
- Official producer: `produceCenterEdition` → Agent Registry → `@agentclientprotocol/codex-acp@2.2.2` → already-installed `codex` CLI.
- Frozen writing protocol `private-notes-first-pass-v2`.
- Fixture claim → EN-only packet with `translationOf` → fixture receipt.
- Isolated `agents.json` names the `codex` executable only. Existing Codex login is reused. Auth files are not read and not packed.

## What this run is not

Merge, deploy, Owner grant, live enqueue/claim/submit/schedule, `cloud-sync`, `rssd produce`, a fake ACP, or a direct `codex exec` that bypasses `produceCenterEdition`. No new account, login, or paid upgrade.

## Preflight

```sh
mkdir -p /tmp/rssd-t575
tar -xzf rssd-t575-isolated-acceptance.tar.gz -C /tmp/rssd-t575
cd /tmp/rssd-t575
node --version          # >= 24
codex --version         # expected 0.163.0 on the shared computer
node scripts/rssd-translate-isolated-acceptance.mjs --probe
```

`--probe` must print `adapterOk: true` and a `codex-acp` launch path. `cliOk: true` with `cliVersion` containing `0.163.0`. If `adapterOk` is false, stop: the official adapter is missing. Do not install a substitute ACP and do not call `codex` directly.

This cloud VM has no `codex` CLI; `--probe` here is expected to report `cliOk: false`. That is not the shared computer.

## One authorized provider turn

```sh
cd /tmp/rssd-t575
node scripts/rssd-translate-isolated-acceptance.mjs --run --i-accept-isolated-provider --agent codex
```

Optional:

```sh
node scripts/rssd-translate-isolated-acceptance.mjs --run --i-accept-isolated-provider --agent codex \
  --home /tmp/rssd-t575-home --timeout-ms 1800000 --codex-path /absolute/path/to/codex
```

`--codex-path` must be the native CLI binary. It cannot be `~/.codex`, `auth.json`, or a token file.

## Timeout and stop

- Default ACP timeout: 30 minutes (`--timeout-ms` milliseconds).
- Stop: `Ctrl+C` or `kill -TERM <pid>`. The producer aborts the ACP session and kills the child.
- Do not `kill -9` first; give `produceCenterEdition` a chance to keep `en.agent-output.txt`.

## Expected evidence (under `--home`, default a temp dir printed as `home`)

| Path | Must show |
| --- | --- |
| `agents.json` | `{id:codex, command:codex}` only |
| `evidence.json` | `producer: produceCenterEdition`, `adapterOk`, `liveCenter: false`, labeled `workId`, `translationOf` |
| `jobs/<id>/claim.json` | `kind=translate`, fixture demand |
| `jobs/<id>/en.prompt.txt` | `private-notes-first-pass-v2` and the isolated source mark |
| `jobs/<id>/en.agent-output.txt` | Real Codex ACP stream (not the injected fixture sentence) |
| `jobs/<id>/en.result.json` | English edition |
| `jobs/<id>/en.packet.json` | One `en` edition; `translationOf={workId:work-t575-isolated-acceptance,locale:zh-CN,revision:1}` |
| `outbox/<sha>.json` | Fixture `accepted` receipt |

`ok: true` and `turn.state: accepted` mean the **fixture** accepted the packet. That is not a production Center receipt and does not mark any Enter work as translated.

## Blockers (accurate, no substitutes)

- Missing `@agentclientprotocol/codex-acp` in `desktop/runtime/node_modules`: unpack this tarball, do not invent an ACP.
- `codex` not on `PATH`: use the shared computer's 0.163.0 install; do not install a CLI in the cloud VM.
- Login/quota errors from Codex: reuse the existing login; t575 does not authorize a new account.
- Public image URLs in the model output: isolated mode refuses the fetch (`RSSD_ISOLATED_ACCEPTANCE=1`).
