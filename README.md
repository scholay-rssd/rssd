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

## Center account login

See [desktop and Linux device authorization](docs/center-login.md) for browser login, workspace scopes, recovery and local credential storage.

## 友链

- [<img src=".github/readme/friends/linux-do.png" width="20" height="20" alt="" align="absmiddle"> Linux.do](https://linux.do/)
- [<img src=".github/readme/friends/enterscholar.svg" width="20" height="20" alt="" align="absmiddle"> 恩特学术](https://enterscholar.com/)
- [<img src=".github/readme/friends/scholay.svg" width="20" height="20" alt="" align="absmiddle"> Scholay 学术](https://www.scholay.com/)
