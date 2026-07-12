# Upgrade and migration gate checklist

Complete against exact old/new release artifacts—not source-level transforms alone. Attach build/Wasm hashes, schema versions, fixture/snapshot hashes, transform version, batch limits, and test report hash to the gate report.

## Compatibility and install

- [ ] Fresh installation initializes valid header/schema/collection metadata, one active policy singleton, empty indexes/cursors/audit genesis, and the expected asset manifest.
- [ ] Every supported prior version upgrades using its integrity-hashed fixture; unsupported versions fail explicitly rather than decoding by accident.
- [ ] Supported N-1 clients and worker callbacks preserve Candid/semantic compatibility or fail with an explicit version/capability result, never mispage or reinterpret data.
- [ ] Stable records, receipts, IDs, leases, expected versions, policy references, audit order, and public visibility decode/retain their meaning.

## Migration integrity and recovery

- [ ] Export is deterministic for the frozen source snapshot: repeated exports have identical ordered count/hash manifests.
- [ ] Transform is deterministic and versioned: repeated input + transform version yields byte-identical normalized rows/outcomes.
- [ ] Import is idempotent by snapshot/source-row hash/transform-version receipt; repeated and concurrent calls produce one durable result.
- [ ] Row outcomes, counts, and checksums/digests match source-to-target mapping; invalid/ambiguous rows are quarantined with a redacted reason, never silently repaired or dropped.
- [ ] Cursor/lease/resume is tested after interruption before and after row/cursor commit, upgrade checkpoint, and storage outage; cursor never advances beyond durable outcomes.
- [ ] Mapped invariants pass after import and after bounded index/projection rebuild; canonical keys remain authoritative.

## Workflow and rollback

- [ ] Pending, expired, duplicate, and out-of-order workflows survive upgrade; safe jobs reclaim only after lease expiry.
- [ ] Executing payment/external work is reconciled by deterministic memo/instruction/receipt: sent settles once, proven-unsent may retry, ambiguity is `reconcile_required`.
- [ ] A verified snapshot and manifest support the declared code/state rollback boundary; restored reader compatibility and derived-store rebuild are rehearsed.
- [ ] Post-snapshot external effects are not erased by rollback and have a tested reconciliation path; maintenance/status behavior is visible and accurate.

## Automated enforcement

CI executes the supported-version matrix and `M/U/X` tests from `tests/invariant-test-plan.md`, compares generated manifests using a stable digest algorithm, and fails on any count/hash/invariant mismatch, unsupported decoder acceptance, missing snapshot artifact, or failed rollback rehearsal. Human review is still required for an impossible rollback boundary and any invalid-data repair.
