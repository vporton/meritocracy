# ICP v1 sanitized fixtures

These fixtures are synthetic Stage 0 contract vectors. They contain no production data, credentials, raw email addresses, OAuth tokens, KYC payloads, personal numbers, private keys, or reusable session secrets.

All durable IDs, timestamps, ledger block indexes, fixed-scale values, and token atoms are decimal strings in JSON. Consumers must parse them as Motoko `Nat`/`Nat64`/`Int` or TypeScript `bigint`; converting them to JavaScript `number` is an error. Hex hashes and memos are lowercase, fixed-length test bytes.

## Files

- `users.json` covers legacy-ID mapping, public profiles, identity-reference hashes, eligibility attestations, multiple payout routes, a legacy-imported inactive route, a normalized-address conflict, and a carried balance larger than JavaScript's safe-integer limit.
- `sessions.json` covers valid, expired, revoked, and revoke-all behavior plus Ethereum challenge binding and replay failures. Principals and signatures are fixture inputs only.
- `assessments.json` covers normalized results, fixed rational weights, malformed/provider/conflicting responses, prompt-injection resistance, and the rule that proposals have no vault authority.
- `rounds.json` covers all initially supported ICP/ICRC assets, exact atom arithmetic, funding/disputes, frozen and carried allocations, sent and retryable transfers, duplicate protection, changed fees, and reconciliation.
- `serialization.json` is the byte-exact cross-language vector for the v1 asset,
  route, vault subaccount, allocation-version and memo encodings.

## Legacy-to-ICP scenario map

| Current source | Current behavior | Future test target |
|---|---|---|
| `backend/tests/security.test.ts` | token digests, OAuth state tampering, fail-closed privileged auth, endpoint rate limits | Registry session-key principals, issuer state integrity, governance principals, and per-method rate limiting; no bearer/admin/cron secrets in Candid |
| `backend/tests/payment-cycle.test.ts` | repeated cycles, high-gas deferral, EU residency fund selection | Immutable round versions, exact atom/fee handling, carried balances, and deterministic fund selection |
| `backend/tests/crypto-distribution.test.ts` | global versus country funds and payout backlog | Vault subaccounts by asset/fund/round, recipient snapshots, transfer idempotency, and carried-balance reconciliation |
| `backend/test-evaluation.js` | evaluation workflow | Assessment normal/malformed/provider-failure/duplicate/conflict vectors and allocation proposals without payment authority |
| `backend/test-multi-network.js` | network adapter distribution | ICP/ICRC ledgers in Stages 3–4; non-ICRC adapters remain deferred to Stage 9 |
| `backend/test-cleanup-kyc.js` | KYC cleanup | Attestation expiry and redaction tests proving raw KYC data never enters canister state |

## Required new integration coverage

1. Wallet, Internet Identity, and OAuth each issue the same seven-day session abstraction; expiry, individual revocation, and revoke-all are enforced.
2. Linking an identity already bound to another user fails without merging accounts.
3. A user may have multiple accounts, but only one active default per `(network, asset)` route; imported addresses require fresh proof before activation or change.
4. Large atoms, shares, and block indexes round-trip without precision loss.
5. Finalization snapshots recipients and opens exactly a seven-day dispute window. A valid dispute freezes only its allocation.
6. Duplicate batch/timer delivery and retry after temporary ledger failure pay at most once using the same memo and `created_at_time`.
7. A changed ledger fee is read at execution, reservations reconcile with the ledger, and permanent/no-route failures become carried balances.
8. Browser E2E: Ethereum session login, add/prove/select payout account, start evaluation, view dispute/frozen status, and view paid block receipt without Express.

Tests should copy fixtures into isolated mutable state; fixture files themselves are immutable versioned baselines.
