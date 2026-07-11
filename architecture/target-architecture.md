# Target ICP architecture

## Decision summary

The target is an ICP application with **two project-owned canisters**: `meritocracy_core` and `meritocracy_assets`. The core is written in Motoko and is the sole authority for public governance, eligibility, allocations, and payment-obligation state. The asset canister serves the React bundle. Existing ICRC/ledger canisters remain external dependencies, not project canisters. Private identity, KYC, AI execution, non-ICP signing, scheduling, search, analytics, and secret-bearing integrations remain off-chain.

Rust is not justified in the initial architecture. Introduce it only for a demonstrated Motoko/library limitation in deterministic cryptographic verification or resource-critical processing; it must not be introduced merely to mirror the existing Node services. TypeScript remains the React/browser language and Node.js/TypeScript remains appropriate for protected workers: identity/KYC/email, AI execution/evidence, external-chain execution, scheduling, operational telemetry, search, and analytics. ZenDB is used selectively as a bounded indexed read/history store within the core domain, never as a canister-per-table conversion and never as the sole authority for financial or voting invariants.

## System overview

Meritocracy registers a person by ICP principal, records the policy-approved evidence that makes that principal eligible, evaluates a contributor through a private asynchronous process, lets eligible contributors participate in governance, determines payment holds and allocation entitlements, and records payment obligations. It can pay supported ICP/ICRC assets through their ledger canisters. It may instruct a protected external executor for other networks, but that executor never decides entitlement.

`meritocracy_core` owns principal accounts, consented public-profile projection, eligibility attestations, evaluation-acceptance state, vote and decision state, holds, treasury policy, reserve accounting, obligations, and append-only audit facts. Its stable structures enforce uniqueness and state transitions. ZenDB collections are bounded derived/history documents: `public_profiles`, `assessment_runs`, and `payment_obligations`; `public_vote_view` is deferred until vote-publicity policy is approved. The core retains the canonical key, status, amount, and policy version even where ZenDB supplies pagination.

The browser authenticates directly to ICP using Internet Identity or another delegation-compatible identity. React remains the UI. The browser calls the core actor through an agent, reads public assets from the asset canister, and only uses external wallet providers for an explicit signed proof or user-initiated transfer. It does not send bearer sessions, private keys, or KYC data to a canister.

## Architectural principles

- Use the smallest reasonable number of canisters: two project-owned canisters now.
- Do not map one canister to each SQL table, Node service, worker, or external network.
- Put every authoritative fact in one clear location; ZenDB projections cannot create competing authority.
- Make every update bounded by argument size, page limit, and work-item count; use cursor pagination and continuation tokens.
- Model external and delayed work as explicit asynchronous state machines with idempotency keys.
- Separate policy approval from irreversible execution, especially payments.
- Keep an explicit stable-state schema, migrations, and rollback-compatible upgrade plan.
- Treat all canister state as potentially observable. Access checks restrict interfaces, not replication-level confidentiality.
- Use integer smallest units for money; never migrate `DOUBLE PRECISION` shares or decimal payment values without a defined fixed-point representation.

## Execution flows

### Authenticated user request

1. The React app obtains a delegation from Internet Identity (or an approved compatible identity) and creates a core actor.
2. A principal-authenticated update validates caller, account state, input bounds, proof/attestation reference, and idempotency key before one atomic mutation.
3. The core returns a stable command result or a typed domain error. The UI refreshes a query; it never treats a stale ordinary query as payment or governance proof.

### Public read request

The browser obtains static content from `meritocracy_assets`. It calls bounded public core queries for display-only data such as a leaderboard. Decision-relevant public outputs—accepted policy version, period outcome, reserve/obligation aggregate, and any public eligibility/assessment status—are exposed as certified HTTP/query outputs with certificate verification in the UI. Private or account-scoped reads require the caller principal and are not made public by a query method.

### State-changing request

The core validates all invariants before mutation: principal ownership, role, time period, duplicate key, finite state transition, size cap, and idempotency key. It writes the authoritative record and a redacted audit event atomically. If work must leave the canister, it creates a pending work/obligation record first, then returns. The later callback/proposal validates a unique work ID and expected state; it never replays a completed transition.

### Privileged administration request

There are no header-password, anonymous distribution, secret-generation, or system-wide cleanup APIs. Governance-controlled principals call narrowly scoped methods: change a versioned policy, approve an oracle value, pause execution, accept a worker result, or advance one bounded scheduled batch. A multisig/governance process must control those principals before money is migrated. Emergency pause authority may stop new execution, but must not rewrite financial history.

### External API interaction

Secret-bearing or long-running work goes to an off-chain worker: OAuth/KYC, email, OpenAI/source collection, market-data normalization, external-chain signing, and private logs. A worker receives an opaque job/instruction ID and submits a signed, authenticated, schema-versioned proposal to the core. The core accepts only an allow-listed worker identity and performs its own state checks. Direct HTTPS outcalls are permitted only for a public, bounded, non-secret, non-financially-authoritative source with a dedicated cycle budget and response validation.

### Scheduled or delayed operation

An off-chain scheduler calls a governed `run_batch(kind, cursor, limit)`-style method. Canister timers may request or resume work but are not relied on for an exact deadline. Each period/action stores a run key and cursor so a retry can safely resume. Expiry, compensation, cleanup, and distribution processing are bounded batches; no method scans every account or waits for a network operation.

### Ledger or payment interaction

The core atomically creates an immutable obligation containing account, token, amount, destination commitment, policy version, and idempotency/memo. For ICP/ICRC-1 it calls the ledger after persisting the obligation, records the returned block/index or error, and reconciles after every await boundary. For other networks it issues the same uniquely keyed instruction to an HSM/KMS-backed executor and records verified receipts/finality observations. An ambiguous send is `UNKNOWN/RECONCILE`, never automatically resent. Ledger balances remain authoritative in the ledger canister; the core is authoritative only for meritocracy obligations.

### Data migration operation

Migration is versioned, resumable, and one-way per domain. An authorized migration principal imports a bounded, validated batch with source snapshot ID and row-level idempotency key, writes a reconciliation result, and advances a cursor only after success. PII, bearer tokens, KYC payloads, secret material, raw AI logs, and private keys are excluded. Principal claims are verified by the claimant, not assumed from a legacy numeric user ID. Voting changes at a new period boundary; payments use shadow accounting and reconciliation before cutover.

## Trust, governance, and upgrade boundaries

|Boundary|Trust and control|
|---|---|
|Browser ↔ core|Caller principal is authoritative for user identity. Browser input, wallet addresses, and displayed query data are untrusted until validated/certified as applicable.|
|Core ↔ asset canister|Assets are public and independently deployable; assets have no authority to mutate core state.|
|Core ↔ ledger canister|Ledger standards and ledger results govern token movement. Core does not assume an inter-canister call is atomic with its state.|
|Core ↔ worker|Workers are trusted only to propose bounded facts in their assigned role; they cannot alter policy, eligibility, or obligations outside an explicit transition. Worker credentials and PII stay off-chain.|
|Core ↔ governance|Governance controls policy/configuration and upgrades. A separately governed executor is required only if custody requires independent control.|

The core’s controller set should be a governance-controlled multisig/DAO (exact mechanism is unresolved) plus a tightly limited emergency recovery controller with a published procedure. The asset canister may be controlled by release automation governed by the same organization, because an asset compromise can phish users; it must not be an unrestricted CI key. Workers have no controller rights. Existing ledger controllers remain theirs.

Core upgrades are isolated from asset releases because policy/financial state needs slower review, migration rehearsal, and rollback. The asset canister is independently versioned and cache-busted. Before every core upgrade, persist an explicit schema version, run pre-upgrade checks, migrate in bounded post-upgrade steps where necessary, retain compatibility decoders for the previous version, and maintain a tested restore/reconciliation runbook. Do not call external services from upgrade hooks.

## Privacy, cycles, and storage

Canister state must not contain emails, government identifiers, KYC evidence/reasons, OAuth tokens, email/KYC tokens, sessions, private keys, SMTP/API/admin secrets, raw prompts/responses, or raw logs. Wallet/social identifiers are public only with recorded consent; otherwise use a commitment or protected off-chain mapping. Votes, payment history, and assessment evidence default to caller-restricted/redacted views. “Delete” means tombstoning/minimizing on-chain facts plus an asynchronous off-chain erasure workflow; replicated history cannot promise physical erasure.

Stable state is budgeted per collection and method: capped profile and assessment summaries, capped source metadata, fixed page sizes, no unbounded arrays in an account, and off-chain object storage for evidence/logs. Cycle budgets are separately configured for core execution, ledger calls, HTTPS outcalls, and storage growth; low-cycle mode pauses nonessential work and rejects payable execution before an unsafe state. Monitoring alerts on cycle runway, stable-memory growth, failed/retry backlog, and reconciliation age.

## Failure model

|Failure|Required behavior|
|---|---|
|Canister trap|The message rolls back its in-message state; callers receive an error. Validate before mutation and test stable-state recovery.|
|Rejected call|Return a typed rejection to the UI/worker; do not infer whether a remote side executed. Retry only idempotent commands.|
|Inter-canister failure|Persist intent first, then mark pending/unknown after failure. Reconcile ledger state using memo/transaction identity before another attempt.|
|External-service failure|Keep job/obligation pending with bounded retry/backoff and operator visibility. It never reverses an already accepted governance state.|
|Partial workflow completion|Represent every stage explicitly (`proposed`, `accepted`, `executing`, `settled`, `reconcile_required`, etc.); resume from durable state.|
|Retries and duplicate messages|Require a caller/work-item idempotency key and state-version check. Repeated requests return the original outcome where safe.|
|Cycle exhaustion|Reject or pause nonessential/outcall work before starting it; preserve authoritative state and surface a governed refill/pause action.|
|Upgrade interruption|Upgrade only at a safe schema boundary; preserve cursor/state, resume post-upgrade migration idempotently, and reconcile outstanding external work.|

## Open decisions that gate financial cutover

The artifacts do not establish vote anonymity/publication, quorum/appeal rules, allocation formula, GDP/price source and freshness tolerance, legal retention/erasure requirements, supported external networks, finality policy, treasury custody model, or the governance/controller mechanism. These are policy decisions, not implementation defaults; financial and KYC migration must wait for them.
