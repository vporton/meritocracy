# Meritocracy ICP Rewrite Plan

## Status and purpose

This is the approved execution plan for rewriting Meritocracy from the
Node.js/Express/Prisma/PostgreSQL application into an Internet Computer (ICP)
application. It is deliberately prescriptive: an implementer should follow the
sequence and defaults below, rather than stop for product decisions that are
already made here.

The current application remains the production source of truth until the
cutover stage. No existing database data, secrets, or funds are deleted as part
of this plan.

## Locked architecture decisions

- Implement every application canister in **Motoko**. Retain React and
  TypeScript for the browser UI and generated Candid bindings.
- Use Mops for the Motoko workspace, dependency lockfile, builds, tests, and
  stable-interface checks. Commit `mops.toml`, `mops.lock`, generated `.did`,
  and generated `.most` stable-type artifacts used as upgrade baselines.
- Add and pin the Mops packages `liminal` (OAuth) and `llm` (AI integration).
  Package upgrades require a reviewed lockfile change, `mops install --lock
  check` (the lock-verification command in the pinned Mops CLI), and the full
  test suite.
- A user may have any number of payout accounts. A payout account is identified
  by its network, asset scope, normalized address, verification state, and
  activation state. One active default is selected for each `(network, asset)`
  route.
- Internet Identity is optional. It is never required to create a user or
  receive a payment.
- Sessions remain part of the product. They are not replaced by Internet
  Identity. A session is a short-lived browser session principal, linked to a
  Meritocracy user and valid for seven days. The browser signs calls with its
  session key; the raw session secret is not stored in canister state or sent as
  a Candid argument.
- A session can be authorized by an Ethereum-wallet proof, an optional Internet
  Identity login, or OAuth through `liminal`. New authorization methods are
  added as session issuers without changing users, sessions, or payout accounts.
- The initial treasury supports ICP and ICRC-1 assets, including the existing
  chain-key token scope: ckBTC, ckETH, ckUSDT, ckUSDC, and ckEURC.
- Funds are held by the vault canister's ledger accounts. A ledger account is
  the vault canister principal plus a deterministic 32-byte subaccount. The
  subaccount distinguishes asset, fund, and payout round.
- Payouts are direct batches after a seven-day dispute window. A finalized
  round snapshots the selected recipient account; later profile edits cannot
  redirect that payment.
- If a recipient has no valid route when a round is finalized or execution
  fails permanently, their allocation remains reserved as a carried balance for
  a later round. It is never silently redistributed.
- All monetary values are non-negative integer token atoms (`Nat`). Shares and
  weights are fixed-scale integers or explicit rationals. Do not use `Float`,
  decimal floating point, or JavaScript `number` for money.
- Raw KYC data, email tokens, OAuth secrets, LLM API keys, external-wallet
  private keys, and legacy system secrets must not be placed in canister state.
  Only status, expiry, issuer identifier, and signed/hashes references are
  allowed on chain.

## Target canisters and authority boundaries

| Canister | Owns | Is allowed to do |
|---|---|---|
| `frontend` | Certified static React assets | Serve the user interface only |
| `registry` | Users, optional identity bindings, sessions, payout accounts, public profile, KYC/eligibility attestations | Authenticate and authorize user-level changes |
| `assessment` | Evaluation requests, evidence hashes, verified LLM results, result versions | Validate authorized AI outcomes |
| `rounds` | Allocation proposals, disputes, finalization deadlines, recipient snapshots | Finalize a funded payout round and request execution |
| `vault` | Treasury and round subaccounts; transfer records | Execute only the transfers requested by `rounds` |
| `audit` | Append-only public events and compact reporting indexes | Provide historical reporting; never authorize transfers |

Only `rounds` may call `vault.execute_batch`. No user, frontend, oracle,
administrator, or `registry` method may instruct the vault to send arbitrary
funds. The vault has a narrow, governance-controlled emergency pause but no
administrative withdrawal endpoint.

## Data model

### Registry

```text
User {
  id: Nat64,
  createdAt: Int,
  publicProfile: PublicProfile,
  status: Active | Banned(until) | Deleted,
  payoutAccounts: [PayoutAccountId],
  eligibility: EligibilityState,
  carriedBalances: [CarriedBalance]
}

PayoutAccount {
  id: Nat64,
  userId: Nat64,
  network: NetworkId,
  asset: ?AssetId,
  address: Text,
  normalizedAddress: Text,
  verification: LegacyImported | Verified | Revoked,
  active: Bool,
  defaultForRoute: Bool,
  createdAt: Int,
  verifiedAt: ?Int
}

Session {
  principal: Principal,
  userId: Nat64,
  issuer: EthereumWallet | InternetIdentity | OAuth(provider),
  issuedAt: Int,
  expiresAt: Int,
  revokedAt: ?Int
}
```

`registry` accepts only the authenticated session principal for user changes.
It returns an authorization result to other application canisters only through
inter-canister calls. The optional Internet Identity principal is a linked
identity/issuer, not the permanent user ID.

### Payouts

```text
PayoutRound {
  id: Nat64,
  asset: AssetId,
  sourceFund: FundId,
  status: Draft | Funded | Disputing | Executing | Complete | Paused,
  disputeEndsAt: Int,
  requiredAtoms: Nat,
  reservedAtoms: Nat,
  vaultSubaccount: Blob,
  allocationVersion: Blob
}

Allocation {
  id: Nat64,
  roundId: Nat64,
  userId: Nat64,
  amountAtoms: Nat,
  recipient: ?RecipientSnapshot,
  evidenceHash: Blob,
  state: Pending | Frozen | Paid(blockIndex) | Carried(reason)
}

Transfer {
  allocationId: Nat64,
  state: Prepared | Executing(attempt) | Sent(blockIndex) |
         RetryableFailure(message) | PermanentFailure(message),
  memo: Blob,
  createdAtTime: Nat64
}
```

The `memo` and `createdAtTime` are deterministic from the allocation identity.
They allow a retry to be identified as a duplicate by the ICRC ledger rather
than paid twice. The ledger block index is the authoritative receipt.

## Execution stages

### Stage 0 — Record the migration contract

1. Inventory every Prisma model, Express route, and frontend API call.
2. Classify each persisted field as `on-chain`, `external attestation`,
   `legacy-history`, or `retired`.
3. Define and version Candid interfaces for all target canisters before writing
   their implementations.
4. Define deterministic serialization for IDs, hashes, payout-route keys,
   subaccounts, allocation memos, and timestamps.
5. Create fixtures from sanitized production-shaped data and from the current
   integration-test scenarios.

**Exit criterion:** each legacy field and endpoint has a documented target or
an explicit retirement reason.

### Stage 1 — Bootstrap the Motoko workspace

1. Add the Motoko workspace and canister source layout without replacing the
   current Node application.
2. Initialize Mops; pin the Motoko toolchain and install `liminal` and `llm`.
3. Configure the project to emit Candid and stable-type (`.most`) artifacts.
4. Add CI commands for formatting, type checking, `mops install --lock check`, unit
   tests, PocketIC integration tests, Candid compatibility checks, and stable
   upgrade compatibility checks.
5. Add local, staging, and mainnet configuration with distinct canister IDs and
   never hard-code deployment-specific IDs in application source.

**Exit criterion:** a clean checkout builds all empty canisters and the
frontend can consume generated Candid bindings.

### Stage 2 — Build registry, sessions, and payout accounts

1. Implement durable `User`, `Session`, `PayoutAccount`, attestation, and
   carried-balance state in the `registry` canister.
2. Implement Ethereum challenge/response login as the first session issuer.
   The signed authorization payload binds the session public key, nonce, expiry,
   application domain, and requested user action.
3. Implement optional Internet Identity authorization as another session issuer.
   It creates or renews a normal Meritocracy session rather than replacing
   sessions.
4. Implement OAuth authorization with `liminal`. Use OAuth/OIDC PKCE where the
   provider supports it; preserve only the provider subject/reference required
   by Meritocracy, never provider access or refresh tokens in stable state.
5. Allow more OAuth issuers without changing the session or user schema.
6. Implement add, prove, revoke, activate, deactivate, and select-default
   payout-account operations. Enforce a single active default per route.
7. Import existing addresses as `LegacyImported`; require a new proof before an
   imported address may be changed or newly activated.
8. Implement explicit session expiry and revocation, including revoke-all for a
   user.

**Exit criterion:** tests demonstrate wallet, Internet Identity, and OAuth
session issuance; multiple payout routes; address conflict rejection; default
route selection; session expiry; and revocation.

### Stage 3 — Build the ICP/ICRC vault

1. Implement account/subaccount derivation for `asset × fund × round`.
2. Implement ICRC-1 balance, fee, and transfer calls, reading each ledger's
   current fee at execution time.
3. Implement the persistent transfer state machine and deterministic duplicate
   protection.
4. Restrict payment execution to authenticated `rounds` inter-canister calls.
5. Implement reserve accounting and reconciliation against ledger balances.
6. Add an emergency pause which prevents new executions but does not grant a
   withdrawal right.

**Exit criterion:** duplicate batch invocation pays once; temporary ledger
failure retries safely; a changed fee is handled; and ledger balances reconcile
to internal round reservations.

### Stage 4 — Build rounds, disputes, and direct batch execution

1. Implement draft allocations and immutable allocation versions.
2. Validate all allocation arithmetic before funding: unique allocation IDs,
   non-negative atom amounts, asset match, exact total, and valid recipient
   snapshot or carried-balance state.
3. Fund the round's vault subaccount before it can be finalized.
4. On finalization, snapshot every recipient route and start the seven-day
   dispute period.
5. Allow a valid dispute to freeze only its allocation. It must include an
   audit event and deterministic resolution state.
6. Schedule execution after `disputeEndsAt`. Execute each unfrozen allocation
   directly through the vault and retain failures for retry/carry.
7. Mark the round complete only once each allocation is paid, frozen, or
   carried and the ledger reconciliation succeeds.

**Exit criterion:** PocketIC tests cover draft, funding, finalization, a
frozen allocation, automatic direct payment, duplicate timer delivery, retry,
and carried balance.

### Stage 5 — Port AI evaluation with `llm`

1. Use the Mops `llm` package in `assessment` as the Motoko integration layer
   for synchronous model requests and normalized responses. The package does
   not support OpenAI asynchronous/batch mode; legacy async batch orchestration
   is not migrated through this integration and may exist only in a controlled
   external adapter approved separately.
2. Keep every paid-provider credential out of stable canister state. Provider
   access is supplied through the package's supported secure configuration or a
   controlled external attestation path; never add a plaintext `SystemSecret`
   equivalent to a canister.
3. Persist only deterministic evaluation input, allowed source references,
   model/prompt version IDs, response/result hash, outcome, and error class.
4. Make each evaluation idempotent, versioned, rate-limited, and auditable.
5. Convert a validated evaluation outcome into an allocation proposal; the LLM
   package must never receive authority to transfer funds or finalize a round.
6. Retain the current prompt-injection defenses: treat gathered web content as
   untrusted data and limit assessment to explicitly allowed sources.

**Exit criterion:** mocked `llm` tests cover normal result, malformed result,
provider failure, duplicate response, conflicting response, and a proposal that
cannot influence a vault transfer before round finalization.

### Stage 6 — Port the frontend

1. Replace Express/Axios service calls with generated Candid clients.
2. Keep the session-oriented UX and session expiry behavior.
3. Add OAuth session entry points backed by `liminal`, without making OAuth or
   Internet Identity mandatory.
4. Replace the one-address profile with a payout-account manager and a clear
   default route selector.
5. Show round status, dispute deadline, frozen state, carried balance, ledger
   asset, amount, and transfer block index.
6. Serve the production frontend from the `frontend` asset canister.

**Exit criterion:** a browser integration test completes login, account
management, evaluation, dispute viewing, and payment reporting without Express.

### Stage 7 — Shadow migration and reconciliation

1. Export active legacy users, identities, eligibility, historical
distributions, and payouts through a reproducible read-only migration script.
2. Import active profile data and payout accounts using stable legacy-ID
mapping. Do not import raw KYC data, session tokens, OAuth tokens, or system
secrets.
3. Run current and ICP evaluation/allocation calculation in parallel against
the same snapshots.
4. Reconcile eligibility decisions, allocation totals, carried balances,
recipient route selection, and ledger results.
5. Fund a segregated, low-value staging treasury and perform live ICRC-1 test
payouts.
6. Require three consecutive reconciled shadow rounds before any production
treasury migration.

**Exit criterion:** no unexplained difference exists between the reconciled
data sets or ledger balances.

### Stage 8 — Security review and production launch

1. Independently review `vault`, `rounds`, subaccount derivation, transfer
idempotency, authorization, Motoko upgrade paths, and generated Candid.
2. Establish multi-party governance over upgrades before meaningful funds enter
the vault. Separate frontend, registry, assessment authority, rounds, and vault
permissions.
3. Publish canister IDs, interfaces, source revisions, supported ledgers,
subaccount derivation rules, round accounting rules, and incident procedures.
4. Deploy the initial production canisters, complete a low-value canary round,
and reconcile its ledger receipts.
5. Freeze the legacy write API, execute the data cutover, and retain the legacy
application/database as read-only historical evidence.

**Exit criterion:** the canary round is reconciled, governance controls are
verified, and production writes flow only through the ICP application.

### Stage 9 — Add non-ICRC payout networks one at a time

The registry supports all routes from Stage 2. A route becomes payable only
when its adapter has completed the following fixed checklist:

1. Deterministic address normalization and validation.
2. Wallet ownership proof.
3. Chain-key account/address derivation where applicable.
4. Fee estimation and exact integer amount conversion.
5. Deterministic transaction construction and idempotency handling.
6. Submission, confirmation, retry, and reconciliation tests.
7. An independent security review of that adapter.

Order of implementation: Bitcoin/ckBTC first, then Ethereum/EVM, then Solana,
Polkadot, Stellar, Cosmos, Bitcoin Cash, and later requested networks. No
network adapter changes the user, session, allocation, or round model.

## Non-negotiable verification rules

- Do not merge user accounts merely because a newly linked identity is already
  attached elsewhere.
- Do not pay an address merely because it appears in imported legacy data.
- Do not allow raw administrative transfer methods in the vault.
- Do not use a timer or retry as proof that a transfer was not already sent;
  ledger duplicate protection and block-index reconciliation are required.
- Do not release a Motoko upgrade without Candid and stable-state compatibility
  checks and a tested backup/readout procedure.
- Do not store secrets or raw personally identifying KYC data in replicated
  canister state.
- Do not delete the legacy system or data export during this project.

## Definition of done

The rewrite is complete when the ICP application is the sole write authority
for profiles, sessions, evaluations, allocation rounds, disputes, and treasury
payouts; production assets are held by the governed vault; each payment has a
verifiable ledger receipt; and the legacy Node/PostgreSQL system is read-only.
