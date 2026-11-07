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

`--probe` must print `adapterPresent: true`, `cliOk: true`, `codexPathBound: true`, a `codex-acp` launch path, and `cliVersion` containing `0.163.0`. `codexPathBound` means the adapter will spawn the installed CLI via `CODEX_PATH`, not a bundled `@openai/codex` (this tarball does not ship that package). If `adapterPresent` is false, stop: the official adapter is missing. Do not install a substitute ACP and do not call `codex` directly.

Previous blocked run (2026-11-07 09:01:50 Asia/Shanghai): probe looked fine, then `produceCenterEdition` spawned the adapter **without** `CODEX_PATH`. The adapter `require`d `@openai/codex/bin/codex.js`, exited 1 in 368ms with 0 stdout. stderr was discarded and the generic message blamed login/quota. That attribution was wrong.

This cloud VM has no `codex` CLI; `--probe` here is expected to report `cliOk: false` and `codexPathBound: false`. That is not the shared computer.

## Read-only handshake (optional, no edition, no Center submit)

```sh
cd /tmp/rssd-t575
node scripts/rssd-translate-isolated-acceptance.mjs --handshake --agent codex
```

This still calls `produceCenterEdition` (`handshakeOnly`), sends ACP `initialize`, then stops. It does not `session/prompt`, does not write an English edition, and does not submit. Evidence is `evidence.json` with `mode: handshake` or `mode: failed` plus `failure.diagnostics` (`phase`, `exitCode`, `signal`, `stdoutBytes`, redacted `stderr`). A process exit or adapter RPC error is **not** classified as login/quota unless those words appear in redacted stderr. This cloud VM has no real `codex` CLI; a dummy-CLI handshake here can only prove the adapter spawned `app-server` and recorded diagnostics. That is not a billed-provider success.

## Owner-run read-only probes (optional, no production write)

Do not read `~/.codex`, `auth.json`, tokens, or env dumps. Do not change login.

```sh
node --version          # expected v24.x
codex --version         # expected 0.163.0
which -a codex          # native CLI path only; do not cat auth files
cd /tmp/rssd-t575
node scripts/rssd-translate-isolated-acceptance.mjs --probe
# expect adapterPresent, cliOk, and codexPathBound all true
node scripts/rssd-translate-isolated-acceptance.mjs --handshake --agent codex
```

`--handshake` is still `produceCenterEdition`. If initialize completes, stop and inspect `evidence.json` (`mode: handshake`). If it fails, `failure.diagnostics.stderr` should show the adapter/CLI spawn result, not a generic 授权/额度 line.

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
| `evidence.json` | `producer: produceCenterEdition`, `codexPathBound: true`, `liveCenter: false`, labeled `workId`; on failure also `failure.diagnostics` |
| `jobs/<id>/claim.json` | `kind=translate`, fixture demand |
| `jobs/<id>/failure.json` | Present only on a blocked turn; includes `diagnostics`, not env/tokens |
| `jobs/<id>/en.prompt.txt` | `private-notes-first-pass-v2` and the isolated source mark |
| `jobs/<id>/en.agent-output.txt` | Real Codex ACP stream (not the injected fixture sentence) |
| `jobs/<id>/en.result.json` | English edition |
| `jobs/<id>/en.packet.json` | One `en` edition; `translationOf={workId:work-t575-isolated-acceptance,locale:zh-CN,revision:1}` |
| `outbox/<sha>.json` | Fixture `accepted` receipt |

`ok: true` and `turn.state: accepted` mean the **fixture** accepted the packet. That is not a production Center receipt and does not mark any Enter work as translated.

## Blockers (accurate, no substitutes)

- Missing `@agentclientprotocol/codex-acp` in `desktop/runtime/node_modules`: unpack this tarball, do not invent an ACP.
- `codexPathBound: false` while `cliOk: true`: launch-config bug; do not treat as login/quota.
- Adapter stderr `Cannot find module '@openai/codex/bin/codex.js'`: `CODEX_PATH` was not bound; this pack does not include `@openai/codex`.
- `codex` not on `PATH`: use the shared computer's 0.163.0 install; do not install a CLI in the cloud VM.
- Public image URLs in the model output: isolated mode refuses the fetch (`RSSD_ISOLATED_ACCEPTANCE=1`).
- Do not read `~/.codex`, token files, or env dumps. If a later run's redacted stderr actually contains login/quota words, report those bytes; do not infer them from a generic exit.
