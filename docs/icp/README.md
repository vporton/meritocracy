# ICP migration contract

This directory and `../../icp/` contain the Stage 0 baseline for the rewrite
approved in [`PLANS.md`](../../PLANS.md). The legacy Node/PostgreSQL application
remains the source of truth until the cutover in Stage 8.

## Baseline artifacts

- `MIGRATION_INVENTORY.md` maps every persisted Prisma model and Express route
  to an ICP owner, an external attestation, retained legacy history, or an
  explicit retirement reason.
- `SERIALIZATION_V1.md` defines the bytes used for identifiers, hashes, route
  keys, subaccounts, allocation versions, transfer memos, idempotency keys, and
  timestamps.
- `../../icp/candid/v1/` is the immutable v1 interface baseline for the six
  target canisters. An incompatible change requires a new version directory.
- `../../icp/fixtures/v1/` contains sanitized, production-shaped fixtures and
  the scenarios that later Motoko, PocketIC, and browser tests must preserve.
- `OPERATIONS.md` defines publication, governance, low-value canary, incident,
  and cutover gates. The release manifest and fail-closed preflight live under
  `../../icp/release/` and `../../scripts/icp/release-preflight.mjs`.

## Locked Stage 0 decisions

The target authority boundaries and issuers come from `PLANS.md`; Stage 0 does
not broaden them.

1. The frontend has no application or treasury authority.
2. Browser calls are authenticated by a seven-day session principal. A raw
   bearer/session secret is neither stable state nor a Candid argument.
3. Ethereum wallet proof, Internet Identity, and OAuth are the v1 session
   issuers. Legacy email registration/login is retired at cutover. A verified
   email may survive only as an externally issued attestation/reference.
4. Legacy ban votes are retained as read-only history. They do not silently
   become payout disputes or transfer authority; new payout disputes belong to
   `rounds` and freeze only the named allocation.
5. Only `rounds` may reserve, execute, and reconcile a vault round. Governance
   may pause execution but has no withdrawal or arbitrary-transfer endpoint.
6. Raw KYC data, personal numbers, verification/email/OAuth tokens, provider
   responses, API keys, private keys, and legacy secrets are never migrated to
   replicated canister state.
7. Monetary values are token atoms (`Nat`) and ratios use explicit integer
   scales. Legacy `Float`, `Decimal`, and JavaScript `number` monetary values
   are migration inputs only and must be converted and reconciled explicitly.
8. The `llm` integration is synchronous. Legacy OpenAI asynchronous/batch
   orchestration is history or an external adapter, not an on-chain `llm` path.

## Stage gate

Stage 1 may begin only after all v1 Candid files parse, fixture JSON validates,
the inventory has no unclassified model or route, and the deterministic codec
has matching Motoko/TypeScript vectors. Later implementation may refine an
additive v1 interface, but it must not erase this baseline or weaken an
authority boundary.
