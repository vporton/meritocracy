# M1 dependency-closure inventory

Status: partial local evidence, 2026-10-30. This is not an approval to ship a
legacy rollback or target frontend bundle.

## Locked scopes

The root `package-lock.json` is lockfile version 3 and covers the workspaces.
The deployable legacy rollback bundle is `backend`; the retained target
frontend build chain is `frontend`. Their direct runtime dependency manifests
are `backend/package.json` and `frontend/package.json`; transitive resolution
is committed in the root lockfile. Node itself is a build dependency for the
future certified frontend asset bundle, not a canister runtime dependency.

The required local closure command is:

```sh
nvm use stable
npm ls --omit=dev --all --json
```

On 2026-10-30 it enumerated 2,499 installed production-package nodes but
failed integrity/completeness validation. It reported invalid installed copies
of `@icp-sdk/core@6.1.1`, `utf-8-validate@6.0.6`, and
`@base-org/account@2.4.0`, plus missing `smoldot@2.0.26` and
`@polkadot-api/substrate-client` versions required through the Polkadot
light-client closure. This is a blocking closure discrepancy: no affected
bundle is eligible for shipment until a clean, reproducible root-workspace
install produces a complete lockfile-conforming closure and compatibility tests
pass. This record deliberately does not repair or remove wallet adapters;
that is a separate approved compatibility change.

## Advisory boundary

An online `npm audit --omit=dev --json` was attempted only to obtain current
advisory metadata. The sandbox could not resolve the npm registry. A request
to transmit the manifest/lock metadata to the registry was denied because the
user had not explicitly authorized that disclosure. Therefore no current
advisory result is claimed. Before G2, an authorized audit must record each
high/critical finding's affected bundle, reachability, owner, containment, and
upgrade/removal or accepted-risk decision. A high/critical finding without
that disposition blocks shipment.

## M1 consequence

This document establishes the exact local evidence command and reports the
observed failure; it does not satisfy the M1 dependency acceptance criterion.
No dependency, production system, database, canister, or asset was changed.
