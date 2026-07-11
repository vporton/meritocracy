# Resumable migration framework

## Design

The future `MigrationService` and `migrations/` module process stable-state format upgrades, ZenDB schema backfills/index rebuilds, and governed legacy imports using the same durable protocol. This document specifies the framework; it does not implement migrations.

Each migration has immutable definition metadata:

|Field|Meaning|
|---|---|
|`migrationId`|Globally unique, semantic ID, for example `core-payment-obligation-v1-to-v2`; never reused if transform logic changes.|
|`sourceVersion` / `targetVersion`|Exact record/document/collection versions and compatible source range. The target must be forward-valid before work begins.|
|`scope` and `source`|Named record family/collection/index generation plus a snapshot ID or canonical source selector. Snapshot input is immutable and content-hashed.|
|`transformVersion`|Hash/version of deterministic transform and validation rules; changing it creates a new migration ID or explicit successor.|
|`cursor`|Opaque, schema-versioned, deterministic position after the last atomically committed source key. It includes the source ordering/index generation and snapshot binding.|
|`processedCount`, `failedCount`, `quarantinedCount`, `skippedCount`|Monotonic counters updated in the same commit as row receipts and cursor. `failed` counts retryable batch failures separately from immutable row rejection/quarantine.|
|`status`|`planned`, `running`, `paused`, `retryable`, `manual_review`, `verifying`, `completed`, `cancelled`. `cancelled` stops new work; it does not erase committed output.|
|`batchSize`|Policy-bounded requested/actual maximum rows and byte/cycle budget. It is capped server-side and may be reduced after resource pressure; never set to “all.”|
|`lease`/`attempt`/timestamps|Claim owner, expiry, optimistic version, retry count, last redacted error and next retry time.|
|`verification`|Expected and observed count/key digest, invariant-check version, completion evidence and approver identity.|

Migration metadata, cursor, row receipts and audit events are canonical stable state. ZenDB rebuild cursors and metadata are also mirrored in the collection metadata but cannot be the only checkpoint.

## Bounded batch algorithm

`start_migration` is governance-only and writes `planned` metadata after validating source/target compatibility, transform allow-list, snapshot and batch policy. `run_migration_batch(migrationId, expectedVersion, limit)` is governance or a delegated migration operator command:

1. Authorize, validate migration state, expected version, lease and bounded limit. Claim the migration with a short durable lease; duplicate claim returns its existing result/status.
2. Read at most `limit` source entries after the durable cursor, constrained by bytes/cycles as well as item count. The source order is a declared stable key order; it is never an unbounded collection scan.
3. For each entry, validate source version and bounds, calculate a deterministic source-row hash and target key, then consult `(migrationId, sourceRowHash, transformVersion)` receipt. Existing terminal receipt is replayed/skipped; this is the primary idempotency guard.
4. Transform and validate one entry. Write the canonical target mutation (or derived ZenDB document/index generation), its immutable row receipt, redacted audit event, and affected indexes in one no-`await` atomic update. Invalid/ambiguous data receives an immutable rejected/quarantined receipt with a redacted code; it is not silently coerced.
5. Atomically persist the final committed cursor, counts, lease/result and batch audit summary only after every processed row outcome is durable. A trap, upgrade, or lost reply before that commit leaves the prior cursor; retries replay row receipts safely.
6. Release/renew the lease and emit a bounded progress event/status containing migration ID, source/target versions, cursor token digest, counts, percent only when source cardinality is known, last outcome range, and next action. No raw source or PII appears in progress.

A batch may stop early on the byte/cycle budget and return `more=true`; that is normal. A retryable source read/ZenDB outage retains the old cursor, increments retry metadata and schedules exponential bounded backoff. A malformed source record is per-row rejection/quarantine unless the definition marks it migration-blocking. A corruption/invariant failure pauses the migration in `manual_review` and blocks the affected write path when required for safety.

## Idempotency, interruption, and upgrades

The transform is pure over `(source snapshot/key/value, transformVersion, policy version where pinned)`. Target identifiers are deterministic or collision-checked. Row receipts make repeated calls, duplicate scheduler delivery, cursor replay and post-trap re-execution return the original result rather than duplicate a record, payment, audit event or index key.

Migration status is stable state and is included in the core upgrade header/checkpoint. `pre_upgrade` persists only a bounded migration checkpoint; `post_upgrade` restores leases as expired/reclaimable and resumes only by an explicit bounded batch call. The framework never performs a full migration inside upgrade hooks. A migration that touches payment state may only create/reconcile canonical records; it cannot send an external transfer. Unknown source state, changed transform version, or a source snapshot hash mismatch is a hard pause, not a retry.

## Retry, controls, and observability

Retryable failures use exponential backoff with a policy maximum and alert threshold. Retrying does not increase `processedCount` for receipt-replayed rows; attempts and transient failure count are reported separately. Permanent row failures are quarantined with source commitment, target-key candidate, transform version and reason code. Operators cannot edit a receipt or cursor by hand. A correction is a new governed migration/reconciliation record referencing the old one.

Controller/governance operators can: inspect redacted status and quarantine pages; start a approved definition; claim/run one bounded batch; pause/resume; lower batch size; retry after dependency recovery; request verification; and cancel future batches. Only the controller threshold may approve a new definition, change supported source range, override a blocking quarantine by creating a corrective record, or mark a migration complete. No operator control bypasses source validation, receipt idempotency, audit append, or payment reconciliation.

Alerts fire for stalled lease, repeated retry, quarantine/nonzero failure, checksum mismatch, lagging projection generation, excessive batch resource use, and verification mismatch. Status queries are bounded/paginated and include release/snapshot/transform provenance.

## Invariants and completion verification

Each definition declares preconditions, per-row checks and completion checks tied to [invariant-mapping.md](invariant-mapping.md): record decode/schema validity; immutable IDs; uniqueness indexes; non-negative fixed-point/integer money; finite state variants; account/profile consent; exactly-one active policy; work/receipt continuity; payment memo/receipt/reserve conservation; cursor ordering; audit continuity; and no private/oversized content in ZenDB.

When the cursor reaches the immutable source end, status becomes `verifying`, not `completed`. Verification runs as bounded resumable passes and compares source/target counts, deterministic key/count digests, index keys/counts, row receipt totals, quarantine disposition, and domain invariant reports. ZenDB migrations additionally rebuild/compare the target index generation from canonical state and spot-check projection provenance. Completion requires zero unresolved blocking failures, no active lease, all expected receipts terminal, signed verification evidence, and controller approval. The old reader/index/schema is retained through the declared rollback window; only then may a separate contract migration remove it.
