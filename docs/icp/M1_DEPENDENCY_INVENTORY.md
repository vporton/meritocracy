# M1 dependency-closure inventory

Status: partial local evidence, updated 2026-11-06. This is not an approval to
ship a legacy rollback or target frontend bundle.

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
light-client closure.

On 2026-11-06, two fresh root `npm ci` installations under pinned Node
v26.5.0/npm 12.0.1 reproduced the same seven `npm ls --omit=dev --all --json`
problems. `npm install --package-lock-only --ignore-scripts` made no lockfile
change, so this is not stale `node_modules` or a repairable omission in the
current lock resolution. The concrete incompatible edges are:

- local PocketIC proof tool `@dfinity/pic@0.25.0` requires
  `@icp-sdk/core@^6`, while the retained backend packages
  `@dfinity/utils@4.2.1` and `@icp-sdk/canisters@3.5.0` require core `^5`;
  npm hoists core 6 and reports the latter peer edges invalid;
- the Reown/Wagmi chain resolves `@base-org/account@2.4.0`, while nested
  `@wagmi/connectors` requires `^2.5.1`;
- `@substrate/connect@0.8.11` is optional through the retained Polkadot client
  but its required `smoldot@2.0.26` and
  `@polkadot-api/substrate-client` children are absent; and
- `utf-8-validate@6.0.6` is hoisted for current WebSocket users but does not
  satisfy retained nested `ws` consumers requiring `^5.0.2`.

This is a blocking closure discrepancy: no affected bundle is eligible for
shipment until a clean, reproducible root-workspace install produces a complete
lockfile-conforming closure and compatibility tests pass. On 2026-11-06, the
owner authorized a separate, reviewable compatibility change to remediate or
remove dependencies. It must preserve the legacy rollback path until its
compatibility tests pass and must not silently remove a wallet capability.

### 2026-11-06 closure repair

The repair retains every affected capability. Root `@icp-sdk/core` is pinned to
5.4.0 for the legacy backend's v5 peer contracts; the core-v6
`@dfinity/pic@0.25.0` local test dependency moved to the separately locked,
non-production `tools/m1-pocketic` installation. `npm run
install:m1-pocketic-tooling` installs it before the local proof. The frontend
explicitly pins `@base-org/account@2.5.1`; the backend explicitly pins the
Polkadot light-client's `smoldot@2.0.26` and
`@polkadot-api/substrate-client@0.1.4`; and the root lock forces the compatible
`utf-8-validate@5.0.10` line. A fresh root `npm ci` followed by `npm ls
--omit=dev --all --json` exits successfully. The isolated PocketIC installation
has its own committed lockfile and `npm run test:m1-private-store-upgrade`
passes after it is installed.

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
one is a separately reviewable remediation task, now authorized by the owner.

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
