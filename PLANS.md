# ICP migration execution plan

Last updated: 2026-08-01

Status: `G1_TARGET_ARCHITECTURE` — awaiting approval. Planning documents only; no application code has been changed.

## Status vocabulary

- `NOT_STARTED`: no implementation exists.
- `IN_PROGRESS`: active work is within an approved milestone.
- `IMPLEMENTED`: code exists but has not passed every acceptance/reconciliation check.
- `VERIFIED`: acceptance criteria passed and evidence is recorded.
- `BLOCKED`: a listed dependency or one of the four approval gates is unmet.
- `INTENTIONALLY_CHANGED`: legacy behavior was unsafe/incorrect and the approved target behavior differs.

## Global execution protocol

For every milestone:

1. Restate its invariants and acceptance criteria.
2. Implement the smallest coherent change in a reviewable commit.
3. Add or update tests, including negative/failure-path tests.
4. Run formatting, type checking, builds, upgrade checks, and relevant tests.
5. Review the diff for regressions, authorization gaps, replay/reentrancy, unbounded work, data loss, and secret/fund exposure.
6. Update this file and `docs/icp/PARITY_CHECKLIST.md` with evidence.
7. Continue to the next unblocked milestone, stopping only at the four gates below.

No production mutation, production logical replication, DNS cutover, mainnet canister deployment, legacy-key transfer, or real-asset transfer is allowed before its stated milestone and gate.

## Implementation task-card requirements

Every implementation prompt derived from a milestone must stand alone. It must state its objective; the applicable milestone, gate, invariants, and security constraints; the files/subsystems to inspect; exact required and prohibited changes; tests/validation and evidence commands; acceptance/completion criteria; and its rollback boundary. It must explicitly preserve the legacy application, production data, production signing authority, and unrelated user changes unless the approved milestone says otherwise. A task card that depends on a prior design decision must name that decision and stop as `BLOCKED` when its gate or evidence is absent.

## Approval gates

These are the only planned approval stops.

| Gate | Status | Decision being approved | Evidence required to request approval |
| --- | --- | --- | --- |
| G1 — Target architecture | **WAITING NOW** | Canister boundaries, ZenDB-authority feasibility policy, external-dependency boundary, frontend replacement, AGPL-3.0 relicensing plan, and SNS-governed unified treasury direction | This plan plus all `docs/icp/*` drafts; repository audit and cited primary-source due diligence; completed AGPL-3.0 relicensing inventory covering contributor/licensor authority, license and notice files, package metadata, distributed artifacts, and third-party notices. Any missing authority is a G1 blocker. |
| G2 — Database schema and migration design | BLOCKED by G1 | Concrete Motoko/ZenDB types/indexes, exact legacy transformations, canonical export format, sizing results, importer protocol, reconciliation queries, and cutover delta mechanism | Read-only production inventory; authoritative-ZenDB atomicity/recovery benchmarks; schema/property tests; golden export/import dry run; revised `SCHEMA_MAPPING.md` and runbook |
| G3 — Wallet custody and authorization | BLOCKED by G2 | Asset custody per network, unified Chain Fusion treasury and SNS controller model, payout authorization, finality/reorg policy, legacy-key retirement, incident response | Threat model; test-key prototypes; replay/ambiguous-send/finality tests; SNS-controller and governance-recovery drills; independent wallet review; revised `WALLET_SECURITY.md` |
| G4 — Testnet-to-production migration | BLOCKED by G3 | Mainnet deployment, production data cutover, DNS/frontend cutover, and separately authorized real-asset movement | Full dress rehearsal from sanitized snapshot; source/destination and financial reconciliation; rollback rehearsal; controller/module hash checks; testnet parity; independent security sign-off |

Approval of G4 authorizes only the reviewed runbook steps. Each real-asset transfer remains a deliberate manual runbook action with recorded transaction details; automated tests never move real assets.

## Milestone plan

### M0 — Repository discovery and planning baseline

Status: **VERIFIED** (documentation-only)

Dependencies: none.

Invariants:

- The legacy source remains unchanged and runnable.
- No database, external account, canister, or asset is mutated.
- Unknown live-data facts remain explicitly unknown rather than guessed.

Scope/evidence:

- Audited 193 tracked files, 21 Prisma models, 18 SQL migrations, 22 physical tables (including unmanaged `ai_result_migration_exceptions`), all Prisma call sites, 17 explicit Prisma transactions, REST routes, auth/authorization, task graph, timers/cron, wallet adapters, frontend calls, tests, Docker/Fly/GitHub Actions, scripts, and checked-in operational documentation.
- Current live row counts are unavailable because no `DATABASE_URL` is set. Numeric capacity figures in design documents are target envelopes, not claims about production data.
- Identified legacy financial and authorization defects that must be reconciled, not copied; see the risk register below and `PARITY_CHECKLIST.md`.
- Baseline verification under Node.js v26.5.0/npm 12.0.1 (`nvm use stable`): root backend+frontend production build passed; backend security suite passed (1/1). Frontend lint did not reach source analysis because ESLint 10 requires `eslint.config.js` while the repository still uses the legacy configuration. This pre-existing tooling gap is recorded below and must be corrected in a small post-G1 tooling commit.

Acceptance:

- Required planning files exist and cross-reference each other.
- Every Prisma model/physical table and explicit transaction has a proposed disposition.
- No application-code diff exists.

Rollback: revert only the planning-document commit.

Suggested commits:

1. `docs: record ICP migration architecture and engineering rules`
2. `docs: map schema, custody, migration, rollback, and parity`

### G1 — Target architecture approval

Status: **WAITING**.

Requested decision is summarized at the end of `docs/icp/ARCHITECTURE.md`. The recorded G1 evidence must include the completed AGPL-3.0 relicensing inventory and resolve every contributor/licensor-authority exception. No M1 work starts until G1 is recorded here with date and approved amendments.

### M1 — Empirical schema and storage design

Status: BLOCKED by G1.

Dependencies: recorded G1 approval, including completed AGPL-3.0 relicensing authority/inventory evidence; read-only access to a production snapshot or a DBA-produced inventory report.

Invariants:

- Inventory queries are read-only and redact secret values.
- No production table, slot, trigger, row, or index is changed during sizing.
- The G1-approved AGPL-3.0 relicensing is the first M1 implementation change. No application/toolchain/scaffolding change may precede it; the relicensing task preserves third-party notices and stops as `BLOCKED` if the recorded G1 authority evidence is absent or incomplete.
- ZenDB is the proposed persistent store for imported PostgreSQL/Prisma records and target document collections, including identity, balances, payment operations, replay journals, and migration receipts where M1 proves the required atomicity, boundedness, recovery, and upgrade behavior. Motoko application code remains the enforcement point for authorization, canonical encodings, and financial constraints; ZenDB constraints/indexes are defense in depth, not a substitute.
- M1 is blocked until an authoritative-ZenDB design is proven with a mutation/recovery protocol for every multi-record and cross-canister invariant. A remote ZenDB call may introduce an `await`; the resulting durable saga must journal before the call, be idempotent on redelivery, and leave no partially activated authority. If that proof fails for a collection, G2 must record a narrowly scoped native-Motoko exception and its rationale rather than silently falling back for all authority.

Small changes/commits:

1. Execute the G1-approved AGPL-3.0 relicensing as one reviewable commit: update the applicable repository license, notices, package metadata, and distributed-source/artifact obligations together; retain all required third-party notices. Validate the completed inventory against tracked license/notice files and package/distribution metadata, record every changed artifact, and stop as `BLOCKED` if G1 authority evidence is missing.
2. Add pinned ICP/Motoko/Mops toolchain manifests and empty canister interfaces.
3. Add a read-only PostgreSQL inventory command with a hard read-only transaction and safe output.
4. Add ZenDB authoritative-collection and remote/archive benchmarks using generated data distributions, including documented indexes, unique-key conflicts, bounded cursor queries, crashes between journal and remote writes, duplicate delivery, upgrade, low-cycle, and repair/resume cases.
5. Define versioned Motoko records and ZenDB collection schemas, explicit secondary indexes, collection/shard limits, authoritative mutation-saga journals, and upgrade/collection-vN migrations.
6. Define canonical export/import schemas and golden vectors, including a canonical source-ID-to-ZenDB-document-ID mapping and immutable receipt keys.

Acceptance:

- Counts, sizes, max field lengths, status histograms, null/unique collisions, orphan checks, exact decimal ranges, sequence values, and unmanaged-table contents are recorded for all 22 physical tables.
- Benchmarks cover expected, 2×, and failure-limit sizes; every production query has an index/cursor plan below the instruction budget.
- The authoritative-ZenDB proof demonstrates that identity/role updates, financial journals/operations, replay receipts, and migration receipts preserve their stated invariant across duplicate requests, traps, upgrades, and remote-call interruption; any native exception is approved, collection-specific, and documented in `SCHEMA_MAPPING.md`.
- The G1-approved repository AGPL-3.0 relicensing is completed before every other M1 implementation change; its inventory, authority evidence, updated license/notice/package/distribution artifacts, and preserved third-party notices are reviewed and recorded. ZenDB's exact version/commit and AGPL-3.0 disposition are pinned; upgrade and schema-version migration tests pass; all authoritative and archive data remains canonically exportable independent of ZenDB.
- Candid and stable signature baselines are committed; application types represent money exactly.
- Migration dry-run vectors produce byte-identical canonical chunks and hashes across repeated runs.

Rollback: remove un-deployed scaffolding/benchmarks; no legacy behavior or data has changed. A completed public AGPL-3.0 grant is not treated as revoked by rolling back later code; any license correction follows a documented, approved legal/notice disposition.

### G2 — Database schema and migration design approval

Status: BLOCKED by M1.

### M2 — Core Motoko domain and authorization

Status: BLOCKED by G2.

Dependencies: G2.

Invariants:

- Caller principal is the authentication root; no bearer session or request user ID grants authority.
- Login identities, public handles, KYC evidence, and payout destinations are separate records.
- Multi-record core changes are single-message atomic or durable idempotent sagas.
- User deletion cannot delete financial/evaluation/audit history.

Small changes/commits:

1. Core types, repositories, uniqueness/FK enforcement, cursor pagination, and upgrade tests.
2. Internet Identity integration and principal binding/recovery.
3. Email/social proof linking keyed by immutable provider subject; legacy identities require re-verification where source data lacks immutable IDs.
4. KYC/liveliness integration, including a required `join-proxy` design/prototype. Inspect the pinned `https://github.com/vporton/join-proxy` service and `https://github.com/vporton/join-proxy-client.mo` client; use the client only against an allowlisted, configurable HTTPS proxy URL. Define the reusable-attestation/session protocol, consent and data-minimization boundary, proof freshness and subject binding, provider terms/eligibility, failure/expiry behavior, cost-accounting, and a direct-provider fallback that cannot double-charge or weaken AML/KYC controls. The endpoint still requires signature verification, event deduplication, monotonic state, AML precedence, and encrypted evidence policy.
5. Named role capabilities, pause-only incident role, audit events, and governance-call interfaces.
6. Ban voting/holds/compensation eligibility and deterministic UTC epochs.
7. Certified/sanitized public views.

Acceptance:

- Authorization matrix, horizontal-access, identity-confusion, replay, deleted-user, KYC ordering, callback, and upgrade tests pass in PocketIC/local replica.
- `join-proxy` is not optional implementation debt: before M2 can complete, a pinned compatible client/service contract, configurable endpoint, privacy/security review, reuse-versus-direct-provider decision, and tests for reused, expired, mismatched, duplicate, unavailable, and direct-fallback KYC flows are recorded. Reuse must never convert an unverified proxy response into verified KYC or cause two provider charges for one logical verification.
- Exact indexed ownership replaces serialized-JSON substring matching.
- The legacy app remains buildable and unchanged except explicitly approved compatibility hooks.

Rollback: undeploy local/testnet canisters or reinstall test-only state; production remains on Node/PostgreSQL.

### M3 — Durable workflow, timers, and external integrations

Status: BLOCKED by M2.

Dependencies: M2.

Invariants:

- Jobs are at-least-once and idempotent; no in-memory lock is authoritative.
- Every task claim has an atomic lease/epoch/attempt and every external effect has an idempotency key.
- Timers are recoverable from stable schedules after upgrades or cycle outages.
- ZenDB stores task/result documents and large provider payloads according to the M1 authoritative-collection proof; task authorization, leases, and idempotency remain enforced by Motoko code and durable mutation journals.

Small changes/commits:

1. Task DAG and atomic claim/lease state machine.
2. Timer scheduler with stable deadlines/cursors, bounded batches, and upgrade recovery.
3. HTTPS integration adapter with bounded deterministic transforms, rate/cost budgets, circuit breakers, and redacted audit.
4. OpenAI immediate/batch parity and canonical result/source replacement.
4a. Use `llm` Motoko package.
5. World GDP, token-price, email HTTPS-provider, OAuth evidence, and Didit integration parity.
6. ZenDB workflow/archive collection routing with cursor pagination, canonical export, reindex, collection-vN migration, and fault-injected authoritative mutation recovery.

Acceptance:

- Crash/restart/timeout/duplicate/out-of-order/concurrent-claim and timer-upgrade tests pass.
- First, repeat, and quarterly evaluation DAGs reproduce the intended 14/6/5-task workflows and verified outcomes.
- External API keys are scoped/rotatable/spend-capped and excluded from logs/snapshots; compromise response is rehearsed.
- A ZenDB outage or partial remote mutation cannot authorize or duplicate a core result/payment; the durable saga/reconciliation protocol makes the record either safely held or exactly recoverable.

Rollback: route test traffic back to legacy services; discard test canisters. No production cutover.

### M4 — Deterministic migration tooling and shadow reconciliation

Status: BLOCKED by M3.

Dependencies: M3 and G2 design.

Note: Use a future version of ZenDB with this pull request counted
as accepted: https://github.com/NatLabs/ZenDB/pull/53

Invariants:

- Export is read-only, snapshot-consistent, canonical, ordered, and deterministic.
- Import is authenticated, bounded, idempotent, resumable, and never calls wallet/ledger methods.
- Stable legacy IDs are preserved; all exceptions are explicit.
- Financial reconciliation is independent from general row/hash reconciliation.

Small changes/commits:

1. Read-only exporter, canonical codec, manifest/signature, chunker, and report schema.
2. Dry-run transformer and referential/unique/status validators.
3. Motoko/ZenDB staging-import protocol with authoritative ZenDB chunk-receipt collection, durable saga state for every remote write, and destination hash queries.
4. Full snapshot shadow import and repeated resume/fault injection.
5. Read-only delta capture prototype (logical decoding preferred; trigger outbox only if approved as the documented fallback).
6. Independent financial/history reconciler and ambiguous-payment exception workflow.

Acceptance:

- Repeated exports from one snapshot are byte-identical.
- Interrupted imports resume from ZenDB receipts; duplicate identical chunks are no-ops; changed hashes are rejected; partial record fragments cannot become visible, including after interruption between an application journal write and a remote ZenDB mutation.
- Counts/hashes/relations/uniques/source IDs match for all 22 physical tables.
- Secret values never appear in canonical data or reports.
- No method reachable in migration mode can transfer assets.

Rollback: discard shadow canisters and replication artifacts according to the runbook; PostgreSQL remains authoritative.

### M5 — Frontend canister and differential parity

Status: BLOCKED by M2–M4.

Dependencies: core/workflow/test migration.

Invariants:

- The frontend is a certified static ICP asset application with strict CSP and no third-party executable JavaScript.
- Calls use generated Candid actors and peer Internet Identity/OAuth authentication; canisters authorize the authenticated caller rather than a bearer token or caller-supplied user ID.
- Legacy frontend/backend stays deployable until production cutover.

Small changes/commits:

1. Standards-based certified asset client using generated Candid actors alongside the legacy REST client behind an environment flag. The target contains no Node.js runtime or TypeScript source/toolchain dependency; the legacy Node.js/TypeScript application remains runnable only until M10.
2. Peer Internet Identity and OAuth (`indentify`) UI flows plus social/KYC evidence-link flows, including the M2 `join-proxy` decision.
3. User, evaluation, logs, voting, admin/governance, and treasury read parity.
4. Certified asset canister, SPA aliasing, alternative-origin plan, CSP, and reproducible build.
5. Differential fixture/E2E suite against legacy and ICP behavior.

Acceptance:

- Every UI route and user-visible state in `PARITY_CHECKLIST.md` passes browser E2E tests; the new certified assets build without Node.js/TypeScript and do not restore the legacy REST bearer-token path.
- Stale `/api/posts` helpers and documented-but-absent endpoints receive an explicit `NOT_APPLICABLE` or implementation decision; no silent omission.
- Asset certification, module hash, controller, CSP, network-switch, and custom-domain tests pass.

Rollback: switch the environment flag/DNS back to legacy frontend; no authority has moved.

### M6 — Wallet design spike and threat model

Status: BLOCKED by G2 and M2.

Dependencies: approved schemas/roles; test keys only.

Invariants:

- No real funds or legacy production keys.
- A test controller compromise is contained by the SNS-governed unified treasury's reviewed proposal delay, pause role, policy caps, reconciliation procedures, and tested recovery; no canister is blackholed.
- Every chain has an explicit operation-ID, nonce/sequence/UTXO, finality, reorg, and ambiguous-result design.

Small changes/commits:

1. ICRC/ICP and ck-token unified-treasury test-ledger prototype.
2. BTC testnet/regtest Chain Fusion prototype.
3. EVM Sepolia EVM-RPC/t-ECDSA prototype.
4. SOL devnet and other network feasibility spikes; classify unsupported/maturity risks rather than faking parity.
5. SNS/controller, unified-treasury, pause/recovery, and adversarial threat-model prototype; verify that every production canister remains upgradeable only through the approved SNS path and none has an empty controller list.

Acceptance:

- Duplicate, reentrant, timed-out, upgrade-interrupted, `TooOld`, nonce conflict, UTXO conflict, provider inconsistency, finality, and reorg tests pass.
- Exact cycle/fee/storage budgets and funding alarms are measured.
- An independent reviewer signs off on the design evidence.

Rollback: delete only valueless test accounts/canisters; retain reports.

### G3 — Wallet custody and authorization approval

Status: BLOCKED by M6.

### M7 — Production wallet implementation on testnets

Status: BLOCKED by G3.

Dependencies: G3.

Invariants:

- The unified treasury journal enforces operation idempotency before every ledger or Chain Fusion action.
- ICRC accounts/subaccounts and direct Chain Fusion addresses are selected per reviewed asset/network adapter; ck assets remain distinct from native external assets.
- Payout pause, policy caps, and operation idempotency cannot be bypassed by application shortcuts; their modification requires the approved SNS governance path and delay.

Small changes/commits:

1. Append-only accounting/liability/payment-operation journal.
2. One SNS-controlled Chain Fusion treasury canister that owns the journal, payment operations, ICRC accounts/subaccounts, and direct-chain derivation/signing state. It is not blackholed and has no separate vault canister.
3. ICRC/ICP and ck-token adapters.
4. Direct BTC/EVM adapters, followed by independently reviewed network adapters.
5. Payout destination proof/change-delay, direct-to-treasury donation/deposit, scoped treasury, confirmation/reconciliation, SNS recovery, and incident tooling.

Acceptance:

- Supply conservation and double-entry/property tests pass across all states.
- Legacy known duplicate/ambiguous cases are fixtures and cannot trigger automated sends.
- Testnets demonstrate direct donation to a published treasury address/account, funding, mint/update-balance, payout, retry, confirmation, reorg recovery, pause, SNS governance upgrade/recovery, cycle top-up, and controller-compromise response with valueless assets.

Rollback: pause the test treasury, reconcile, and discard test state. Production remains legacy.

### M8 — Full testnet dress rehearsal and cutover package

Status: BLOCKED by M4, M5, and M7.

Dependencies: all parity items implemented.

Invariants:

- PostgreSQL remains authoritative during rehearsal.
- No production/private secret is used in testnet.
- Rehearsal follows the exact production scripts with only environment/IDs changed.

Acceptance:

- Full snapshot plus delta import, read-only shadow, final freeze/drain, reconciliation, frontend switch, rollback, and forward-recovery are rehearsed and timed.
- All parity entries are verified or explicitly approved as changed/not-applicable.
- Independent security and migration review is clean.
- Module hashes, controller transitions, cycles/freezing thresholds, monitoring, backup/export, and incident contacts are in the machine-readable report.

Rollback: execute `docs/icp/ROLLBACK_PLAN.md` against testnet and prove legacy recovery.

### G4 — Testnet-to-production migration approval

Status: BLOCKED by M8.

### M9 — Production deployment, migration, and observation

Status: BLOCKED by G4.

Dependencies: G4 approval and named operators present.

Invariants:

- Follow the signed runbook; no ad-hoc correction or transfer.
- Legacy PostgreSQL stays intact/read-only through the rollback window.
- Asset movement is separately reconciled and manually authorized.

Acceptance:

- Source/destination counts/hashes, constraints, histories, and exact finances reconcile.
- Deployed modules/controllers/config/cycles match approved hashes and values.
- Production smoke, auth, certified frontend, timers, external integrations, and read-only financial tests pass.
- Observation window closes with no unresolved severity-1/2 issue; final export/backup and cutover report are archived.

Rollback: execute the phase-specific branch in `ROLLBACK_PLAN.md`. After any ICP-side financial write, rollback means pause plus reconcile/forward-repair or a verified reverse delta; it never means blindly enabling the old sender.

### M10 — Legacy retirement

Status: BLOCKED by M9 observation window.

Dependencies: production acceptance and rollback-window closure.

Acceptance:

- Legacy Node.js/TypeScript application and its build/deploy dependencies are retired only after the rollback window closes; the certified target remains buildable without Node.js/TypeScript. Legacy wallet keys are revoked/retired and their dispositions audited.
- PostgreSQL/Fly data is retained or destroyed under the approved retention policy, with a verified immutable export.
- Old DNS, OAuth callbacks, cron jobs, deploy tokens, API secrets, and funded addresses are disabled.
- ICP TODO is removed only now, and final parity/completion evidence is recorded.

Rollback: none after approved destruction; therefore destruction is the final, explicitly enumerated G4-runbook phase.

## Current risk register

| Risk | Severity | Required disposition |
| --- | --- | --- |
| External send may succeed before DB commit; stale execution resets can resend | Critical | Treat all ambiguous legacy payments as exceptions; never auto-retry during migration; target journal/reconcile-before-retry |
| Pending transaction hash includes an unstored current timestamp and lowercases case-sensitive addresses | Critical | New canonical operation IDs; preserve old hash only as historical input |
| Failed transaction and failed distribution can both remain payable | Critical | Independent obligation/attempt model and pre-cutover duplicate analysis |
| Non-EVM scoped addresses do not select the scoped signer | Critical | Per-scope Chain Fusion derivation/subaccount proof; reconcile displayed address to authority |
| KYC failure code intentionally consumes backlog claims | Critical policy conflict | Preserve claims as held liabilities until explicit policy at G2/G3; no silent forfeiture |
| Plaintext DB/process wallet secrets | Critical | Fingerprint only, rotate/retire, never import value; controlled legacy-to-unified-treasury transfer only after G4 |
| Serialized task user IDs leak/cross-match users | High | Typed exact owner index and authorization tests |
| Mutable OAuth handles are account keys | High | Reverify and bind immutable provider subject IDs |
| KYC callbacks lack durable event order/idempotency | High | Provider event journal, exact session/freshness, monotonic AML-first state |
| Task/cron locks are process-local and jobs are not durable | High | Stable leases/epochs, at-least-once timers, idempotent completion |
| AI compact migration tie-breaking was nondeterministic and successful raw data was nulled | High history risk | Export unmanaged exception table; build conflict report; preserve available source evidence and explicit missing markers |
| Tests can hard-delete configured DB financial rows | High operational | Add test-DB hard guard before database suites |
| Frontend lint is inoperative after ESLint 10 because no flat config exists | Medium operational | Add/verify `eslint.config.*` in the first approved tooling milestone; lint must pass before target implementation is accepted |
| ZenDB AGPL-3.0, young project, no in-place schema migration | High dependency | Complete and record the AGPL-3.0 relicensing inventory as G1 evidence; perform the approved relicensing as M1's first change; pin/audit the authoritative and archive deployment, use collection-vN migrations and durable mutation recovery, and retain independent canonical export |
| Live cardinalities and row sizes unknown | High sizing | Read-only inventory before G2; no storage approval without evidence |
