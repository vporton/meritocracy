# ICP migration rollback and recovery plan

Status: G1 design draft. Recovery objectives, named owners, canister IDs, module hashes, and commands are finalized at G2–G4. This plan does not authorize a production change or asset movement.

## Non-negotiable rules

- PostgreSQL and the legacy application remain recoverable and runnable until parity, data reconciliation, financial reconciliation, and the post-cutover observation window have passed.
- There is exactly one application writer and one payment authority per epoch. Never make both the legacy service and ICP authoritative to shorten an outage.
- An external send that may have happened is reconciled on-chain before retry. Restarting the legacy payment worker is prohibited while any ICP or ambiguous legacy operation can still execute.
- Rollback never means reinstalling a production canister and losing stable memory. Use a stable-compatible prior Wasm or a forward repair after verifying snapshots and Candid/stable signatures.
- Financial custody may not be reversible merely by switching DNS or databases. Once assets or signing authority move, application traffic can roll back while the SNS-controlled unified treasury remains the only custody component.
- Source exports, delta logs, reports, module hashes, controller records, and incident evidence are immutable. Do not delete replication artifacts until their approved retention point.

## Recovery targets

Provisional objectives, to be measured in dress rehearsal and approved at G4:

| Failure domain | Target response | Data-loss objective |
| --- | --- | --- |
| Planning/local/testnet | Discard disposable state and repair | None; PostgreSQL unaffected |
| Shadow import | Pause/recreate shadow canister | None; replay immutable base/deltas |
| Pre-authority cutover | Restore legacy writers inside maintenance window | None after final-LSN verification |
| ICP application after authority | Pause ICP, export reverse delta/forward repair | Zero acknowledged writes; otherwise explicitly reconciled |
| Unified treasury | Immediate pause, chain reconciliation, SNS governance response | No duplicate send; uncertain operations held |
| Controller/API-key compromise | Pause constrained capabilities, rotate/redeploy per governance | Bounded by immutable caps and already exposed authority |

These are design targets, not measured guarantees. G4 evidence must replace them with observed rehearsal times and explicit acceptable RTO/RPO.

## Required recovery artifacts

Before any production freeze, independently verify:

- encrypted PostgreSQL base backup plus point-in-time/WAL recovery and a successful restore test;
- immutable canonical base export, delta stream through the declared LSN, source/destination roots, and signed migration report;
- exact legacy application image/commit, configuration schema, dependency lock, and infrastructure definition with secrets available from the approved secret store;
- every canister ID, subnet, controller/governance principal, module hash, Candid interface, stable signature, certified-asset root, and sufficient cycle balance;
- current and previous stable-compatible Wasm artifacts and tested upgrade/downgrade/forward-repair procedures;
- DNS/CDN/custom-domain configuration, TTLs, asset routing, monitoring, and reversible traffic-switch commands;
- chain/ledger evidence for every payment operation active near cutover and a hard proof that legacy cron/payment workers are stopped;
- named incident commander, database operator, ICP governance approvers, wallet/custody approvers, independent verifier, and communications owner.

Backups and artifacts must be readable by the recovery team without relying on the failed canister or a single compromised controller.

## Rollback points by phase

### R0 — Planning, scaffolding, and local tests

Authority: legacy application/PostgreSQL.

Trigger: failed design/test, toolchain regression, security finding, or unapproved dependency/license.

Action: revert the reviewable documentation/scaffolding commit or remove disposable local canisters. No source data, production service, or custody changed. The disposable ZenDB deployment can be replaced because no production authority exists at R0.

Exit: legacy build/tests pass; `PLANS.md` and parity status record the failure and revised design.

### R1 — Testnet and shadow import

Authority: legacy application/PostgreSQL; target is read-only shadow.

Trigger: importer fault, hash/count mismatch, relation/index error, upgrade failure, archive cost/limit problem, or inability to resume.

Action:

1. Disable the approved import session and preserve receipt/module/controller evidence.
2. Stop delta consumption without deleting the source slot/outbox.
3. Reconcile the last acknowledged chunk/LSN; do not trust an operator cursor.
4. Repair forward in a new schema/canister version or discard only the disposable shadow canister.
5. Replay immutable base/deltas and repeat all verification.

No user traffic, production data, or assets are affected. Removal of a production replication slot/trigger is a separately reviewed DBA action after its retention/WAL consequences are checked.

### R2 — Production freeze, before ICP writes are enabled

Authority: PostgreSQL, temporarily frozen. ICP has no acknowledged production writes and asset execution is paused.

Trigger: freeze timeout, final-delta mismatch, target hash/module/controller/cycle mismatch, failed health check, or operator abort.

Action:

1. Keep all payment senders paused and reconcile any operation active before the freeze.
2. Prove ICP application writes never became enabled and record its final receipt root.
3. Verify PostgreSQL final LSN and no target-only acknowledged writes.
4. Restart the legacy application writers using the exact prior image/config.
5. Restart non-financial jobs first. Restart financial jobs only after custody approvers prove the legacy signer is still sole authority and no ICP send can execute.
6. Retain shadow/delta artifacts for analysis; restore normal routing and announce recovery.

This is the cleanest rollback point and must be rehearsed before G4.

### R3 — ICP writes enabled, before financial authority or real assets move

Authority: ICP for application writes; PostgreSQL is read-only. Custody remains legacy and all financial execution remains paused.

Trigger: application/auth/workflow defect, material parity failure, unacceptable latency/cost, or target unavailability.

Action:

1. Pause target writes and capture a certified/deterministic target delta from the cutover epoch.
2. Keep legacy writes disabled while independently reconciling target-only writes.
3. Apply the reviewed inverse transformation into a restored/staging PostgreSQL database; validate exact counts, relations, and semantic hashes. Never edit the old production database ad hoc.
4. Promote the reconciled database, then restore legacy routing/writes.
5. Restore financial jobs only after the single-authority check; target unified treasury stays unable to execute.

If the inverse transformer is unavailable or loses target-only semantics, do not discard acknowledged writes. Repair the target forward or remain in read-only incident mode until an approved data-preserving path exists.

### R4 — Financial authority enabled or signing material/assets moved

Authority: target unified treasury for affected assets. Application/frontend routing is independently reversible; custody is not automatically reversible.

Trigger: payment/accounting defect, duplicate/replay evidence, incorrect destination/allocation, chain reorg/provider disagreement, custody authorization failure, or controller compromise.

Action:

1. Invoke the limited pause capability. Stop new obligation activation and transaction construction while leaving read/reconciliation available.
2. Do not restart any legacy wallet/payment process and do not restore legacy keys from backup as a workaround.
3. Freeze each operation at its exact state; query approved independent chain/ledger sources using transaction bytes/hash, nonce/sequence, UTXOs, memo/created-at time, and finality evidence.
4. Classify operations as definitely unsent, broadcast/pending, final, reverted, replaced, or ambiguous. Retry only definitely unsent idempotent operations through the approved state machine.
5. Reconcile the double-entry journal, liabilities, controlled balances, and external fees. Place mismatches/ambiguous operations on hold.
6. Application traffic may return to a read-only legacy UI/API against a reconciled projection, but the target treasury remains custody authority. A later transfer to a replacement treasury is a new SNS-governed transaction plan with limits and independent review.

No production canister is blackholed. The unified treasury's recovery surface is the SNS-governed upgrade/recovery process, immediate pause behavior, per-operation receipts, policy caps, and chain reconciliation. A flaw can require a forward repair or deliberate, separately governed asset migration; it never authorizes an ad-hoc code rollback, a new payment operation, or re-enabling the legacy sender.

### R5 — Post-observation and legacy retirement

Authority: target. Legacy is retained as an audit/read-only recovery artifact until M10 criteria pass.

Trigger: late historical discrepancy or target incident.

Action: prefer forward correction with an auditable compensating entry/migration. Restoring the legacy payment architecture is not a valid routine rollback after keys are retired and source delta capture is gone. Database restore remains useful for evidence, not automatic authority.

Legacy secrets/keys, PostgreSQL, replication artifacts, and deployments are retired only after retention, legal/audit, parity, financial reconciliation, and recovery criteria are approved. Destruction requires its own explicit inventory and evidence.

## Canister upgrade recovery

Before each upgrade:

1. record current/proposed module hashes, Candid interface, stable signature, migration function/version, controllers, cycles, and certified roots;
2. test upgrade from a production-shaped snapshot at expected and 2× capacity, including interruption and timer restoration;
3. export authoritative state/hash checkpoints and verify backups/rebuildable indexes;
4. pause high-risk writes and payment construction if the canister participates in finance;
5. upgrade one shadow/test canister, then staged production canisters where topology permits;
6. verify state/count/hash/index/certification/timers before resuming.

If a stable-compatible previous Wasm can read the evolved state, governance may downgrade after rehearsal. Otherwise deploy a forward repair. Never use reinstall on an authoritative production canister. ZenDB schema changes use a new `collection_vN`, copy/verify, atomically switch the router, and retain the old collection through the rollback window.

## Controller or credential compromise

Assume a malicious controller of a mutable canister can install arbitrary code and read/use secrets available to that canister.

- Safety responders pause through a capability that cannot upgrade, resume, change destinations, or raise caps.
- Governance removes compromised mutable controllers/keys, verifies module hashes, rotates API/OAuth/webhook/email credentials, invalidates importer sessions, and deploys clean canisters from reproducible artifacts.
- The unified treasury has no exportable signing secret. An SNS-controlled upgrade can request signatures, so proposal delay, safety pause, caps, reproducible artifacts, controller/module verification, and reconciliation bound and detect damage; the controller cannot be treated as a multisig merely because several principals are listed.
- Chain-key master material is not exportable as a legacy backup. Recovery relies on the approved canister/subnet/governance architecture and any predesigned successor mechanism.
- Internet Identity or user-principal compromise is handled as an account recovery/hold event; it does not authorize governance or arbitrary payout changes.
- Treat provider/API keys stored in a mutable canister as compromised after malicious upgrade, rotate them, and inspect provider spend/logs.

## Decision matrix

| Condition | Restore legacy writes? | Restore legacy payments? | Preferred action |
| --- | --- | --- | --- |
| Shadow mismatch, no cutover | Already active | Already active | Repair/replay shadow |
| Frozen, no target writes | Yes after LSN proof | Only after sole-custody proof | R2 rollback |
| Target-only app writes exist | Only after inverse reconciliation | No until authority proof | R3 reverse delta or forward repair |
| Target may have sent assets | Read-only UI possible | **No** | R4 pause and chain reconciliation |
| Assets/keys moved to target | App data may be projected back | **No** | Keep target unified treasury; repair/replace deliberately through SNS |
| Controller compromised | Not as an automatic response | **No** | Pause, rotate, verify/redeploy, reconcile |

## Rollback checklist and report

Every rollback produces a signed machine-readable incident record containing:

- trigger, phase/epoch, timestamps, decision makers, environment, and affected capabilities/assets;
- source/final LSN, last imported delta, source/target/module/controller/certified-root hashes;
- last acknowledged application write and every active/ambiguous payment operation;
- commands/actions and before/after evidence;
- database, canister, frontend, job, custody, and provider status;
- count/hash/financial reconciliation result;
- user impact, RTO/RPO actually achieved, outstanding holds, and follow-up owners;
- confirmation that no source rows/evidence were deleted and no uncertain payment was retried.

Rollback is complete only when one authority is proven, state is reconciled, money is reconciled or explicitly held, monitoring is green, and `PLANS.md`/`PARITY_CHECKLIST.md` cite the evidence.
