# Upgrade strategy

## Scope and principles

This is the production upgrade design for the target ICP deployment, not a migration implementation. `meritocracy_core` is the only application canister with authoritative business state. ZenDB holds only bounded, rebuildable projections; it must never decide authorization, uniqueness, eligibility, reserve arithmetic, or payment state. The asset canister is independently versioned and owns only immutable release assets. ICP/ICRC ledgers and off-chain services are external systems and are not upgraded by this procedure.

Every release is assigned an immutable release ID, core stable-schema version, ZenDB document-schema versions, Candid interface version, and policy compatibility range. The release manifest and its hashes are recorded in the core audit log before activation.

## Stable-state ownership and versions

|Owner|Stable state it owns|Version location|Upgrade rule|
|---|---|---|---|
|`meritocracy_core`|Accounts; attestations; assessment-active keys; vote keys/aggregates/periods; policy versions and active pointer; reserves; canonical payment obligation keys/statuses; work items/leases; idempotency and migration receipts; audit segments; canonical indexes; projection outbox|One root `StableStateHeader` in stable memory: `formatVersion`, `minReaderVersion`, release ID, initialization marker, and checksum. Each independently encoded record family has a tagged envelope with its own decoder version.|Decode old versions explicitly; preserve IDs, receipts, leases and indexes. No destructive in-place reinterpretation without a resumable migration.|
|`meritocracy_core` ZenDB projections|`public_profiles`, `assessment_runs`, `payment_obligations` documents and declared indexes|Document field `schemaVersion`; collection metadata document containing active/read-compatible versions, index generation, rebuild status and cursor.|They are derived from core state. A failed or incompatible projection is marked stale and rebuilt; canonical writes continue through an outbox where synchronous ZenDB atomicity is unavailable.|
|Asset canister|Versioned frontend bundle, immutable files, release manifest|Asset release manifest/version in the asset canister; browser-visible build ID.|Assets do not contain domain state. Retain a previous verified bundle for UI rollback and cache it by content hash.|
|External ledger/off-chain identity, worker, executor, evidence and notification systems|Their own state only; core stores bounded references/receipts/work items|Their own deployment metadata; core records adapter protocol/schema version in commands and callbacks.|Never assume external rollback. Preserve core correlation IDs and reconcile instead of replaying uncertain effects.|

The header is written on fresh install before any user record. A canister that sees a future `formatVersion`, an invalid header checksum, an unknown required variant, or a `minReaderVersion` above its reader version must refuse normal mutations and expose only controller diagnostics. It must not guess a default.

## Compatibility policy

- Releases use an expand, migrate, contract sequence. A reader accepts the current and explicitly supported earlier encodings; writers emit only the current encoding after the compatibility gate is enabled.
- Additive optional fields and new indexes may be rolled out before data backfill. Required-field, semantic, identifier, amount-unit, state-machine, or index-order changes require a named migration and a supported source-version range.
- Candid/API changes are additive during a compatibility window. Existing methods, variant tags, record fields, cursor semantics, idempotency behavior, authorization and pagination ordering remain stable for every supported client version. Breaking removal requires a published deprecation release and a policy-approved end-of-support date.
- The core must accept callbacks carrying the previous supported workflow and result schema while work created by that version may still complete. Unknown callback schema/state is rejected and quarantined, never coerced.
- No release may change fixed-point scale, principal-derived IDs, deterministic work/obligation/run IDs, memo/idempotency semantics, or settled-payment interpretation in place. Such a change requires a new field/record and governed reconciliation.

Supported-version policy is deliberately operational: production declares a finite set in the release manifest. At minimum, N and N-1 stable formats and client/workflow schemas are supported during rolling deployment; a migration may narrow this only after completion verification and the rollback window closes.

## Pre-upgrade gate

1. A governance-authorized controller approves the signed release manifest, exact wasm hashes, schema compatibility matrix, migration definitions, and rollback decision point. The controller set and threshold are a policy prerequisite still to be selected; until then production upgrades must require all configured controllers, not a single shared secret.
2. Run the release’s fresh-install, supported-upgrade, invariant, migration-resume, and rollback rehearsal tests against the exact artifacts. Verify Candid compatibility and deterministic serialization.
3. Put the core in `upgrade_preparing`: reject new governed configuration changes and new external-send claims; accept only safe reads and idempotent terminal callback replays. Drain or record the exact set of active leases. Do not wait for external calls inside `pre_upgrade`.
4. Create and verify a labeled stable-state snapshot and ZenDB metadata/count/index-generation manifest. Record audit-head/hash, active policy version, reserve totals, work-state counts, projection-outbox count, and all `executing` payment obligation IDs/memos. Back up the preceding asset bundle. See the rollback procedure for retention/access rules.
5. Confirm migration capacity: bounded batch size/cycle budget, source and target range, stop condition, quarantine policy, operator roster, alerting, and read-only diagnostic method. A release that needs a full scan in an upgrade hook is rejected.
6. Confirm external protocol compatibility with identity workers, assessment workers, executors, ledger adapter and scheduler. Pause payment executor dispatch before upgrade; it may continue ledger observation only.

`pre_upgrade` is limited to persisting the header, release intent, migration/workflow checkpoint and bounded serialization needed by the stable-state runtime. It performs no ZenDB rebuild, external I/O, global scan, or semantic migration.

## Post-upgrade gate

1. Validate and decode the header and every lazily opened record family. Check the expected release ID and report the active/required schema versions; retain a read-only emergency mode on any corruption.
2. Rebuild derived due indexes and ZenDB indexes/projections only through bounded, resumable jobs. Compare rebuilt count/key digests with canonical state before marking a generation active. A stale projection never makes a canonical entity disappear from an authorized query.
3. Revalidate active work items and callbacks against their stored schema/version. Preserve deterministic IDs and receipts. Expired leases are reclaimed only when the relevant workflow says replay is safe.
4. Before executor dispatch resumes, reconcile every expired or in-flight `executing` payment by memo/instruction ID with the ledger/executor. Ambiguous observations become `reconcile_required`; no automatic resend follows an upgrade.
5. Run release-defined invariant checks in bounded batches: uniqueness/index consistency, non-negative integer money, policy singleton, record/version validity, terminal-state immutability, projection provenance, and audit continuity. Publish the redacted completion report and require governance sign-off before `upgrade_complete`.

## Ordering, partial upgrades, and active workflows

Deploy core first when it expands or changes core callback acceptance; deploy the asset bundle only after core health/readiness and client-compatibility checks. For a UI-only compatible release, the asset canister may be deployed first, but it must feature-detect core capabilities and retain its prior API path. Never deploy a UI that requires a core schema/API not yet activated. Ledger and off-chain services are versioned as protocol peers: deploy their backward-compatible readers before core starts emitting new messages; retain their old callback format until outstanding old work drains.

A partially upgraded system is an expected state, not success:

|Condition|Required behavior|
|---|---|
|Core upgraded, asset old|Core preserves N-1 Candid/API behavior; old UI continues or displays maintenance for unavailable new features.|
|Asset upgraded, core old|Asset selects the old compatible feature set; it must not send unsupported commands.|
|Core upgraded, ZenDB migration/rebuild pending|Use canonical reads where required; mark projection freshness; process outbox/rebuild batches. Do not make ZenDB authoritative or expose stale public consent fields.|
|Core format migration paused/failed|Keep the source reader active if safe; block writes requiring the target format; expose migration status and quarantine. Resume/repair in bounded batches or roll back only under the defined limits.|
|Worker/executor old|Core accepts only declared compatible callback schemas. New work may be held until the peer is upgraded; duplicate old callbacks replay stored outcomes.|

During active workflows, upgrade preserves workflow ID, producer event ID, expected state/version, lease, retry schedule, payload reference and receipt. It never clears active keys or regenerates work. Evaluation/identity/notification jobs resume according to their durable state. Payment execution is special: pausing is preferred; anything with an uncertain external send is reconciled, not retried blindly. Governance finalization uses its expected period version, so an in-progress old finalizer cannot overwrite a post-upgrade transition.

## Snapshot and rollback limits

Snapshots are mandatory before a state-format or semantic migration and recommended before every core release. They are encrypted, access-controlled, integrity-verified artifacts containing stable state and a manifest, not a mechanism to erase public replication or reverse external effects. ZenDB may be snapshotted for speed, but its authoritative recovery method is rebuild from core.

Code rollback is normally possible before the new release writes an unsupported stable format. State rollback is possible only while the snapshot is complete, verified, protected from later incompatible writes, and all post-snapshot external effects are known/reconcilable. A settled ledger transfer, released asset bundle already cached by users, off-chain email, accepted external credential, or external worker action cannot be undone by reinstalling old wasm. In those cases freeze unsafe actions, restore only compatible code/state when safe, then reconcile with governed corrective records. Detailed controls are in [rollback-procedure.md](../operations/rollback-procedure.md).
