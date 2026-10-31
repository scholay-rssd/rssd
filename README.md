# RSSD

RSSD connects personal writing devices to an editorial center and independent
publishing destinations. This is the public v2 development checkpoint, not a
completed production migration.

## Workspace

Clone with `git clone --recurse-submodules https://github.com/scholay-rssd/rssd.git`.
Use Node.js 24+, pnpm 9.15.4 and Rust for native builds.

```sh
npm ci
npm test
npm run demo:build
npm run desktop:install
npm run desktop:build:web
```

The root assembles `desktop/`, `receiver/`, `web/engine/` and the pinned public
submodules `web/themes/`, `sites/`, `web/demo/` and `center/`. The center is a
separate Postiz v2.25.1-derived AGPL project with its own build and lockfile.
The desktop's native identity and data paths remain `com.thomas.papr`.

Calendar seed files contain no private corpus. Existing local databases must
be preserved when upgrading; article migration and production cutover require
explicit reconciliation. Demo builds use fictional fixtures only. Personal
manuscripts, tokens, receipts, database backups and private Git history are not
part of this repository.

The new center protocol, durable outbox, worker coordination, bilingual site
receiver and desktop center panel are implemented. Destination coverage,
restoration, browser exports and production cutovers are still in progress.
