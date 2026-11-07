# Linux headless runtime

The Linux x64 artifact includes Node.js and the production protocol. It needs
no desktop, browser, private repository or inbound server. Installed coding
agents retain their own subscriptions and authentication on the device.

Download the artifact from this repository's CI or protected release. Verify
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
id and not `SCHOLAY_CLOUD_EXECUTOR`. `rssd produce` and `cloud-sync` are
not this path.

```sh
rssd center enqueue-translate --work <existingWorkId>
rssd center work --agent codex --workspace <workspaceId> --section <sectionId> --id <demandId> --once
```

Omit `--once` only when explicitly starting ongoing work. Use `--section` to
limit scope and `--resume` to resume this device's blocked claim. A quota failure retains
the task and generated result; it does not switch subscriptions or reassign
the claim. `center recover` queries the original submission before retrying.

Runtime releases are immutable. `rssd update /path/to/new/extracted-artifact
--manifest-sha256 <hash>` verifies the candidate and refuses activation while
any production command holds a lease. After work stops, rerun the update.
The previous runtime remains on disk. `RSSD_RUNTIME_HOME` changes the install
location; `RSSD_CENTER_HOME` changes the private device-state location. Keep
them separate. Credentials, local drafts, jobs and receipts never enter the
runtime package, and old Git-based private-repository auto-updates are not used.
