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

With owner authorization, `npm audit --omit=dev --json` ran on 2026-10-30
against the root lockfile. It reported 53 production-tree findings: 3 critical,
39 high, 10 moderate, and 1 low. The critical chains are
`concurrently -> shell-quote` and a `proxy-addr` chain; the remaining critical
finding is `shell-quote` itself. High findings include direct runtime/build
dependencies `@reown/appkit`, `@reown/appkit-adapter-bitcoin`,
`@reown/appkit-adapter-solana`, `@reown/appkit-adapter-wagmi`,
`@stellar/stellar-sdk`, `axios`, `nodemailer`, `prisma`, `serve`, `viem`, and
`vite`, plus their transitive closures. The Reown/Sats-connect/Solana chain has
no offered automatic fix. The audit also reports fixes for some chains,
including `concurrently`, `prisma`, `nodemailer`, `viem`, and `vite`; applying
one is deliberately out of scope for this M1 evidence change.

Every high/critical advisory is currently **untriaged**: affected production
bundle, actual reachability, owner, containment, and upgrade/removal or
accepted-risk decision remain unrecorded. Consequently neither the legacy
rollback bundle nor the target frontend/toolchain bundle is eligible for
shipment. This audit is an evidence snapshot, not a remediation or risk
acceptance.

## M1 consequence

This document establishes the exact local evidence command and reports the
observed failure; it does not satisfy the M1 dependency acceptance criterion.
No dependency, production system, database, canister, or asset was changed.
