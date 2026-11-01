# Receiver translation source bindings

The v1 publication packet and its hash remain unchanged. A packet alone does
not identify the Chinese revision used for an English edition. The receiver
therefore marks that revision unknown until the center supplies a separately
authenticated binding for the exact accepted request and packet. A shared
work ID can provide language navigation; it is not proof of a source revision.

The binding endpoints require the site's existing bearer credential and an
HMAC-signed envelope scoped to the site, workspace, organization and
destination. Binding requests are idempotent. They never submit a publication
or alter the original receipt. A successful binding schedules a static rebuild;
the rebuild is recoverable and does not supersede a newer publication. A
failed rebuild requires a freshly signed retry. Only the center can determine
the source revision from its retained history; if that evidence is absent it
must not fabricate a binding.

To enable verification for a site, its receiver configuration specifies an
absolute private `bindingKeyFile`, plus `bindingOrgId` and
`bindingDestinationId`. The key file is a JSON object mapping key IDs to
base64-encoded 32–64 byte HMAC keys, readable only by its owner and outside
the public release tree. It supports multiple keys during rotation. Provision
and rotate keys through a private channel; do not put them in a repository,
public release, logs, or URL. An omitted key file leaves bindings disabled.

`language-editions.json` and `en/published-content.json` retain their v1
envelopes. New records expose `sourceVersionState`: `unknown`,
`source_unavailable`, `independent`, `current`, `stale`, or `legacy`. The
`stale` field is `null` when the relationship cannot be compared or the
edition is independently authored; consumers must inspect the state rather
than treating a falsy value as proof that a translation is current. Existing
legacy records retain their previous stale calculation. New verified bindings
use `rssd-source-view-sha256-v2`, which includes ordered public source links.
The older v1 projection omitted those links, so it cannot establish that a
binding is current and is rejected for new proofs. A stored older proof is
reported as unknown; unknown algorithms fail closed. The v2 hash identifies
remote image URLs, but does not assert that bytes at such URLs are immutable.

Receiver support alone does not enable a production migration. Center-side
historical proof generation, secure key provisioning, recovery, media and
real publication verification must all be completed before rollout.
