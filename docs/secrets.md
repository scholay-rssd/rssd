# Secrets

RSSD code reads secrets only from environment variables and never from a
hard-coded credential location. Every such variable is declared in the schema of
[`scholay-rssd/rssd-secrets`](https://github.com/scholay-rssd/rssd-secrets),
which also resolves values (environment, values directory, macOS Keychain or
Windows Credential Manager, server directory) and injects them:

```sh
rssd-secrets check --component admin-worker
rssd-secrets exec --component admin-cli -- node admin/cli.mjs import items.json year
```

Delivery stays where it is today:

- Services: systemd `EnvironmentFile` (for example `/etc/scholay-admin/worker.env`).
- Desktop: the app reads center and website credentials from its own credential
  store and passes them to child processes; per-session bridge keys are
  generated at runtime. Child processes that must stay neutral remove them.
- Builds: `TAURI_SIGNING_PRIVATE_KEY` or `SCHOLAY_UPDATER_KEY_FILE`; without
  either, desktop builds skip update signatures.

When code starts reading a new secret, add it to the `rssd-secrets` schema
first. The `secrets-schema` CI job fails for any secret-like variable
(`*_TOKEN`, `*_SECRET`, `*_KEY`, `*_PASSWORD`, …) that the schema does not
declare. Real values never belong in this repository or its CI.
