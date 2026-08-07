# Dependency closure and advisory inventory

Status: M1 evidence, **not a shipment approval**. Reviewed 2026-08-07.

## Scope and reproducibility

The legacy rollback build is the root npm workspace: the Dockerfile copies the
whole repository and runs `npm ci`. `package-lock.json` is therefore the one
authoritative production closure for the root, `backend`, and `frontend`
workspaces. The separately tracked `backend/package-lock.json` and
`frontend/package-lock.json` predate the workspace closure and are not used by
the Docker build; they are not evidence for a rollback or target shipment.

`DEPENDENCY_INVENTORY.json` records the reviewed lock hash and package-entry
count. All root/workspace direct dependencies and build dependencies are pinned
to the exact version resolved by that lock. Verify this invariant without the
network:

```sh
npm run inventory:dependencies
```

Any lock or direct-dependency change requires a new inventory review, a clean
`npm ci`, a production advisory scan, and relevant legacy/frontend compatibility
tests. The target frontend has not been deployed: this records the retained
React/Vite toolchain only, not a certified-asset approval.

## Advisory scan and shipment rule

The production-only scan was run against the root workspace with:

```sh
npm audit --omit=dev --workspaces --include-workspace-root --json
```

It reported 855 production dependencies, 13 high findings, and zero critical
findings. The exact result is time-sensitive; re-run it before any rollback or
frontend shipment. A high or critical result fails closed: no affected legacy
rollback bundle or certified frontend asset may ship until a compatibility-tested
upgrade/removal is reviewed and its acceptance is recorded here. `npm audit`
currently returns a non-zero exit status; that is the expected enforcement
signal, not an accepted exception.

| Finding path | Actual reachability | Owner | Containment and decision |
| --- | --- | --- | --- |
| `@reown/appkit-adapter-bitcoin` → `sats-connect` → `@sats-connect/core` → `axios`, `valibot` | Reachable from `frontend/src/config/wagmi.ts` and the user-facing Bitcoin wallet connector | Repository maintainers | Do not remove: the connector is in use. No non-breaking audit fix is reported. Keep the affected bundle blocked; obtain a reviewed compatible Reown/sats-connect upgrade or an explicitly approved connector retirement. |
| `@reown/appkit-adapter-solana` → `@solana/spl-token`, `@solana/buffer-layout-utils`, `bigint-buffer` | Present in the root rollback closure; the only current frontend import is commented out | Repository maintainers | The adapter is not enabled, but removal is a separately reviewable compatibility change under M1. Keep it pinned and blocked until that change is approved and route/bundle tests establish no feature loss, or a compatible upgrade is tested. |
| `react-router-dom` → `react-router` | Reachable from the React application router and multiple page/components | Repository maintainers | No server-side containment applies to the shipped browser bundle. Compatibility-test a fixed supported router release before shipment; the audit's suggested version is a breaking change. |
| frontend `viem` → `ws` | Reachable from the browser wallet configuration and balance/funding components | Repository maintainers | The lock contains the vulnerable frontend `viem` line. Upgrade the direct frontend dependency through wallet-connect, build, and browser-flow tests before shipment. |

The table groups transitive reports by their reachable root cause. All 13 high
package reports are covered by these paths: `@reown/appkit-adapter-bitcoin`,
`@sats-connect/core`, `sats-connect`, `axios`, and `valibot`; then
`@reown/appkit-adapter-solana`, `@solana/spl-token`,
`@solana/buffer-layout-utils`, and `bigint-buffer`; then `react-router-dom` and
`react-router`; then `viem` and `ws`. No critical report existed at the review
time. There is no accepted advisory exception.

The 2026-08-07 review also moved ESLint to root development dependencies and
added the pinned TypeScript lint parser. They are build-time tooling, not
runtime dependencies; the production-only scan above excludes their closure.
The flat-config compatibility pin is ESLint `9.39.1`: the retained
`eslint-plugin-react@7.37.5` is incompatible with ESLint 10. No production
dependency, wallet adapter, application route, or API behavior changed.

## Boundaries

This task does not remove a wallet/browser adapter, change a legacy feature,
deploy anything, or modify production data, keys, credentials, or signing
authority. The rollback boundary is the dependency-inventory commit; reverting
it restores manifest ranges and Docker's prior installer behavior, but must not
be used to permit a shipment with unresolved findings.
