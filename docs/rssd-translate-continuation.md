# Existing-work English continuation

This is the application companion to [rssd-center PR 9](https://github.com/scholay-rssd/rssd-center/pull/9). It does not merge, deploy, claim, submit or publish. `cloud-sync` remains old artifact readback, not a launch path.

## What already existed

- Protocol `kind=translate` with a source edition, and `edition.translationOf`.
- Device HTTP `POST /demands`, `claim`, `submit` and receipt lookup by original `requestId`.
- Headless `rssd center work --agent <id> --workspace <id> [--section <id>] [--id <demandId>] [--once] [--resume]` and `rssd center recover [requestId]`.
- The production worker already continues a claimed translate demand: it uses `payload.source` as `translationOf` and keeps `source.workId`.

## What was missing

Deployed center `createDemand` accepted a source revision but did not bind the Chinese hash, skip a present English edition, reuse one open task, expire claims, or expose MCP `rssd_create_demand`. The desktop `create_demand` bridge still only allows 研究方法 `write` topics and must stay that way. Devices therefore could not legally enqueue an English continuation of an existing work.

PR 9 is the center contract. This repository now:

- Binds `workId` + current `zh-CN` revision + hash from `GET /works/:id`
- Enqueues `kind: "translate"`, `requiredLocales: ["en"]`, `source: {workId, locale: "zh-CN", revision}`
- Skips when English already exists
- Reuses the same open task for the same bind; refuses a second open task for the same work after the Chinese head moves
- Leaves claiming, producing, idempotent submit and receipt recovery on the original executor
- Refuses to rewrite Chinese, submit without `translationOf`, or mint a new work identity

## Post-deploy launch (do not run until Owner confirms)

Requires a live center at PR 9 (`177f5f87008ff51750be7eae74f439ec6a2fe9ee` or later) and a device that can read the workspace. Probe: MCP `tools/list` includes `rssd_create_demand`. If that tool is absent, enqueue refuses.

```sh
rssd center enqueue-translate --work <existingWorkId>
rssd center work --agent <authorized-agent> --workspace <workspaceId> --section <sectionId> --id <demandId> --once
rssd center recover <requestId>
```

Desktop native method: `enqueue_translate` with `{workId}` or `{workId, revision}` where `revision` must be the current zh-CN head. The 研究方法 `create_demand` write fence is unchanged.

One work at a time. Do not loop 93 missing English editions until Owner names the work IDs and the live device. Do not pass `--resume` unless recovering that device's own blocked claim. Do not create a new Chinese work, steal another device's claim, or substitute a local translation.

Expired claims return to `queued` after 24 hours on a PR 9 center. The original token cannot submit. Another authorized device may then `work --id <demandId>`. After a source-conflict rejection, keep the local packet, do not rewrite Chinese, and only enqueue again after the old open task has expired, been released, or completed.

Scheduling is separate: Owner may grant `publicationScheduling` on a named device without `admin=true`. This companion does not grant, schedule or post.

## Owner confirmations

1. Merge and deploy center PR 9 before any production enqueue.
2. Name the live device and the first `workId` (English only, original Chinese revision unchanged).
3. Confirm no other executor already holds that work's claim.
4. Grant scheduling later, if at all; enqueue and accept are not publication.

## Center follow-up for PR 9 (do not open a second center PR here)

Open-task reuse in PR 9 is keyed on source revision and hash. After a Chinese update, a second `createDemand` for the same work currently returns `created`. Application enqueue refuses that case with `open_translate_conflict`. A center test that should fail on PR 9 today:

```js
const created=await store.createDemand(owner,{workspaceId,sectionId,kind:'translate',title:'补英文',requiredLocales:['en'],source:{workId,locale:'zh-CN',revision:1}});
await submitNewerChinese(workId);
const again=await store.createDemand(owner,{workspaceId,sectionId,kind:'translate',title:'新绑定',requiredLocales:['en'],source:{workId,locale:'zh-CN',revision:2}});
assert.equal(again.status,'existing'); // today: created
assert.equal(again.id,created.id);
```
