# Existing-work English continuation

This is the application companion to [rssd-center PR 9](https://github.com/scholay-rssd/rssd-center/pull/9) at `ffb0886cd18b39a007eebe784e4c08eab11188b0`. It does not merge, deploy, claim, submit or publish. Do not treat `177f5f87` or `9632f4fd` as the advertised contract version.

`cloud-sync` remains old website-artifact readback, not a launch path. `SCHOLAY_CLOUD_EXECUTOR` and `rssd produce` are also not this path.

## Official executor

The official continuation executor is the existing Center production worker, not a default local editorial generate and not the website cloud translator.

| Command | What it actually starts |
| --- | --- |
| `rssd center work` | Device HTTP claim → `produceCenterEdition` (ACP on this device) → Center submit → receipt by original `requestId` |
| `rssd produce` | Local editorial task store. No Center demand, claim, or receipt |
| `publishing-flow` / `SCHOLAY_CLOUD_EXECUTOR=1` | Website frozen-plan translator to `/manage/api/news/publish`. No Center work identity |
| `cloud-sync` | Readback of old website cloud jobs. Cannot mint a translate demand |

`center work` hardcodes `CENTER_WORK_PRODUCER = produceCenterEdition`. That producer launches the Agent Registry ACP CLI named by `--agent` on this device (`mcpServers: []`), then the worker submits only through Center. Codex/Cursor may call their own vendor models; that is still the Center device executor, not `SCHOLAY_CLOUD_EXECUTOR`. There is no Center-side LLM job for `kind=translate`.

## Command parameter semantics

Enqueue (does not claim, produce, or submit):

```sh
rssd center enqueue-translate --work <existingWorkId> [--revision n]
```

| Flag | Meaning |
| --- | --- |
| `--work` | Existing Center `workId`. Never a new Chinese work |
| `--revision` | Optional. Must equal the current `zh-CN` head. Any other value is `409 source_conflict` and leaves the Chinese edition unchanged |

Desktop native method: `enqueue_translate` with `{workId}` or `{workId, revision}`. The 研究方法 `create_demand` write fence is unchanged.

Work (starts the official executor for an already queued demand):

```sh
rssd center work --agent <agentId> --workspace <workspaceId> [--section <sectionId>] [--id <demandId>] [--once] [--resume]
```

| Flag | Meaning |
| --- | --- |
| `--agent` | Agent Registry ACP id on **this device**, not a cloud job id. Built-ins: `cursor`, `codex`, `claude`, `hermes`, `gemini`, `copilot`, `opencode`, `kimi`, `qwen`. Custom ids must be `custom-*` and enabled. The CLI must be installed, not disabled, and already authorized. Unscoped translate does **not** pin Codex / `gpt-6.1-terra` (that pin is metho auto-pilot / scoped production only) |
| `--workspace` | Repeatable. Device identity must already include these workspace ids. Continuation of enter works uses `enter` |
| `--section` | Optional claim filter (`forums`, `software`, `search`, `courses` for enter) |
| `--id` | Claim this queued translate `demandId` only |
| `--once` | One production turn, then exit (idle, accepted, blocked, or pending). Omit only when Owner explicitly starts a loop |
| `--resume` | Resume this device's own blocked/active claim. Do not use to take another device's claim |

Receipt recovery (no regenerate unless `--retry` after a 4xx that Center still treats as unsubmitted):

```sh
rssd center recover [<requestId>] [--retry]
```

## Required configured capabilities

Needed before Owner-confirmed production `work` (this repository does not start that):

1. Device already connected (`center login` / `connect`). Token stays in `RSSD_CENTER_HOME`; commands here never read or print it.
2. `identity.workspaceIds` includes the work's workspace.
3. `--agent` launches via Agent Registry (official CLI or configured path).
4. Site profile and column writing skills exist for that workspace/section (`centerSkillSnapshot`).
5. Live center advertises `contracts.translateContinuation` as below (PR 9 `ffb0886c`, undeployed).
6. Translate demand is `queued`. Device is not `worker_busy`.

Not required for enqueue or unscoped `center work`: `publicationScheduling`, `admin=true`, `SCHOLAY_CLOUD_EXECUTOR`, grok queue, `cloud-sync` jobs. `contracts.translateContinuation` is not a permission grant; scheduling stays `capabilities.publicationScheduling`.

## Center contract at ffb0886c

`POST /demands` for `kind=translate`:

| Situation | Result |
| --- | --- |
| Same open task, same source revision + hash + target locales | `existing`; original source bind is not rewritten |
| Target `en` already present | `skipped` / `locale_present` |
| Requested source revision is not the current zh-CN head | `409 source_conflict` |
| Open rev1 task exists, Chinese moved to rev2, enqueue of the new bind | `409 open_translate_conflict`; no second demand; rev1 bind kept |
| Eight concurrent same-bind creates | one `created`, the rest `existing`, one demand id |
| Concurrent rev2 while rev1 is open | all `open_translate_conflict` |

Partial unique index `rssd_demands_open_translate_work` on `("orgId", payload.source.workId)` where `kind='translate'` and state is `queued`/`claimed`/`blocked`.

Submit:

| Situation | Result |
| --- | --- |
| Rewrite Chinese, source hash/head moved, or `translationOf` mismatch | `409 source_conflict` |
| Same `requestId` replay | original accepted receipt |
| Another device holds the claim | `409 claim_conflict`; expired claims return to `queued` after 24h and the old token is `claim_revoked` |

## Contract probe (fail-closed)

Entry: device `GET /api/rssd/v1/coordination/overview` or MCP `rssd_overview`. Same JSON. Official pack at `ffb0886c`:

```json
"contracts": {
  "translateContinuation": {
    "version": 1,
    "guarantees": ["sourceHash", "currentHead", "uniqueOpenWork", "claimLease", "englishOnly", "sourceChangeReject", "receipt"]
  }
}
```

Accept only when `version` is an integer `>= 1` **and** `guarantees` is an array containing all seven tokens. Top-level `contractVersion: 1` does not mean this pack is supported. The field is not a grant: `capabilities.publicationScheduling` may remain `false`.

Fail-closed (`409 contract_unavailable`): missing key, `true`, `version: 0`, string `'1'`, missing or incomplete `guarantees`, MCP tool name/description only. Live production overview today still lacks `contracts.translateContinuation`, so enqueue refuses until PR 9 is deployed.

## Audit: call path, job state, artifacts

Wiring (not a vendor model run):

1. Installed CLI `rssd center …` → `desktop/scripts/agent/headless/cli.mjs` lines 14–18 imports `centerCommand`.
2. Enqueue only: `center.mjs` 35–39 → `enqueueTranslateContinuation` (`scripts/rssd-translate-continuation.mjs`). No claim.
3. Official work: `center.mjs` 13 and 53–62 pass `producer:CENTER_WORK_PRODUCER` where `CENTER_WORK_PRODUCER === produceCenterEdition`. Desktop daemon `desktop/scripts/rssd-center.mjs` 133–187 defaults the same producer.
4. Turn: `scripts/rssd-production-worker.mjs` claim 201, heartbeat `running` 241–242, EN-only locales 245–246, `producer(...)` 268, `requireTranslatePacket` 280/294, durable `en.packet.json` 282, outbox enqueue/flush 296–297, heartbeat `idle`/`blocked` 304, return `accepted`/`pending` 305, failure `blocked` + `failure.json` 307–309.
5. ACP producer: `desktop/scripts/agent/center-producer.mjs` `AgentRegistry.launch(agentId)` 83, `spawn` 87, strip Center tokens 85, `session/new` with `mcpServers: []` 121, freeze `en.prompt.txt` 126, `session/prompt` 127, retain `en.agent-output.txt` 137.
6. Artifact recovery: `center recover` `center.mjs` 47 → `CenterOutbox.flushOne` `scripts/rssd-center-client.mjs` 79–101: GET `/submissions/:requestId` first, POST submit only on 404. `center status` `center.mjs` 32 lists outbox `pending`/`accepted`/`needs_attention` without reprinting credentials.

On-disk job (under `RSSD_CENTER_HOME`, never in the runtime package):

| Path | Role |
| --- | --- |
| `active-claim.json` | Current exclusive claim |
| `jobs/<sha256(claimId:generation)>/claim.json` | Frozen claim |
| `…/context.json` | Bound zh-CN source edition |
| `…/en.result.json` | Producer output before submit |
| `…/en.packet.json` | Durable EN-only submission (`translationOf`) |
| `…/en.prompt.txt` | ACP prompt (only if `produceCenterEdition` ran) |
| `…/en.agent-output.txt` | Raw ACP stream |
| `…/failure.json` | Blocked turn |
| `outbox/<sha256(requestId)>.json` | `pending` → `accepted` (with `receipt`) or `needs_attention` |
| `worker.json` | Desktop daemon: `starting`/`working`/`idle`/`blocked` |

`--agent` is the Agent Registry ACP id on this device (`cursor`, `codex`, …), not a Center job id and not `SCHOLAY_CLOUD_EXECUTOR`.

## What each test layer proves (do not mix)

**A. Center protocol fixture** — `tests/rssd-translate-continuation.test.mjs` with `tests/fixtures/rssd-translate-center.mjs`. Injected producer, no ACP, no credentials, no live Center.

| Claim | Test |
| --- | --- |
| Enqueue binds hash, creates once, skips present `en`, never claims | 21–37 |
| Non-head → `source_conflict`; open rev1 + zh-CN rev2 → `open_translate_conflict`; missing contracts → `contract_unavailable` | 39–54 |
| Fail-closed: missing key, `true`, `version: 0`, string `'1'`, missing/incomplete guarantees, `contractVersion: 1` only, tool-name-only; safe pack has `publicationScheduling: false` | 56–84 |
| Eight concurrent same-bind: one `created`, rest `existing`; rev2 concurrent: all `open_translate_conflict` | 86–101 |
| `center work` identity is `produceCenterEdition`, not website cloud | 103–109 |
| Turn: `claim({demandId})` → producer once `locale=en` + zh-CN source + `--agent` passthrough → submit EN `translationOf` → GET receipt miss then POST → `accepted`; job files; outbox receipt; lost HTTP still one POST | 111–167 |

**B. Isolated ACP transport** — `tests/rssd-agent-transport.test.mjs` 19–47. `produceCenterEdition` against a local Node ACP **script** (`registry.launch` stub). Proves initialize / `session/new` / permission deny-writes / `en.prompt.txt` / `en.agent-output.txt`. The stub `modelId` is `null`. This is not Codex, Cursor, or any billed provider.

**C. Real billed provider — t575 isolated acceptance, pending Owner-run of the bundle, not passed.** t575: local ACP writing through `produceCenterEdition` is the correct path; the old cloud-translator restriction is superseded. The harness is `scripts/rssd-translate-isolated-acceptance.mjs` and the copyable bundle `rssd-t575-isolated-acceptance.tar.gz`. It uses a fixture Center plus the official `@agentclientprotocol/codex-acp` adapter and the already-installed `codex` CLI. It does not connect to live Center and does not enqueue, claim, submit or schedule production work. The labeled source `work-t575-isolated-acceptance` is not one of the 93 missing Enter English editions. This cloud-agent VM has no `codex` CLI (only unrelated `cursor-agent-store-fuse`); that describes **this VM only**. The shared computer already has `codex-cli 0.163.0` and `cursor-agent 2026.10.16`. Do not require a new account. Do not unpack onto the shared dirty tree. This agent does not run the provider turn. See `docs/rssd-translate-isolated-acceptance.md`.

## Post-deploy launch (do not run until Owner confirms)

```sh
rssd center enqueue-translate --work <existingWorkId>
rssd center work --agent <authorized-agent> --workspace <workspaceId> --section <sectionId> --id <demandId> --once
rssd center recover <requestId>
```

One work at a time. Do not loop 93 missing English editions until Owner names the work IDs and the live device. After `open_translate_conflict` or `source_conflict`, keep the original Chinese edition and the original open task; only enqueue a new bind after expiry, release, or completion.

Scheduling is separate: Owner may grant `publicationScheduling` on a named device without `admin=true`. This companion does not grant, schedule or post.

## Deployable conditions (none of these are done here)

1. Center PR 9 **deployed** at `ffb0886cd18b39a007eebe784e4c08eab11188b0` or a later head that keeps the same demand codes and `contracts.translateContinuation` pack. Live overview still lacks that field.
2. This app PR merged **after** Owner says so (not in t572).
3. Named device already connected; `identity.workspaceIds` includes the work workspace. Shared-computer CLIs (`codex-cli 0.163.0`, `cursor-agent 2026.10.16`) are present; login/quota are Owner-side, not asserted here.
4. Overview `contracts.translateContinuation` has integer `version >= 1` and all seven guarantees. Presence of `rssd_create_demand` is not enough.
5. One named `workId` first. Not a loop of 93. Owner-run on the named device; this agent does not drive the shared computer.

## Owner exact authorization items

t572 is final acceptance of this companion only. Still required before any live enqueue/`work`:

1. Deploy center PR 9 at `ffb0886c` or later so live overview advertises the `translateContinuation` pack.
2. Name the live device. Shared computer already has the two CLIs above; do not invent a new account. Login state is not asserted in this PR.
3. Name the first existing `workId` (English only; Chinese revision unchanged). Confirm no other device holds that claim.
4. Explicitly allow one Owner-run `enqueue-translate` and one `center work --once --id <demandId>` on that pair. Quota spend is a separate yes. This agent must not be used as the runner.
5. `publicationScheduling` later, if at all; enqueue and accept are not publication.
6. Do not authorize merge/deploy of this app PR, 93-work loops, `admin=true`, credential reads, local-repo execution, `cloud-sync`, or `SCHOLAY_CLOUD_EXECUTOR` as a substitute.
