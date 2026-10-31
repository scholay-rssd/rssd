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

Omit `--once` only when explicitly starting ongoing work. Use `--section` to
limit scope and `--resume` to resume a blocked claim. A quota failure retains
the task and generated result; it does not switch subscriptions or reassign
the claim. `center recover` queries the original submission before retrying.

Runtime releases are immutable. `rssd update /path/to/new/extracted-artifact
--manifest-sha256 <hash>` verifies the candidate and refuses activation while
any production command holds a lease. After work stops, rerun the update.
The previous runtime remains on disk. `RSSD_RUNTIME_HOME` changes the install
location; `RSSD_CENTER_HOME` changes the private device-state location. Keep
them separate. Credentials, local drafts, jobs and receipts never enter the
runtime package, and old Git-based private-repository auto-updates are not used.
