# Repository interfaces

## Contract conventions

These are language-independent ports. `Result<T, RepositoryError>` is one of `Ok(T)`, `NotFound`, `Conflict`, `ValidationError`, `Corruption`, or `InternalError`; `Conflict` includes a stable machine code. `Page<T>` contains bounded `items` and an opaque next cursor. All writes accept a `RepositoryTransaction` supplied by the service's unit of work; a repository never decides whether an actor is allowed to perform a business action.

Every cursor binds the declared filter, direction, index tuple and immutable ID tie-breaker. `limit` is validated against the active policy before repository entry. “Atomic” below means atomic with the stated canonical data and audit/receipt in the core update; a ZenDB write joins it only after its transaction guarantee is accepted, otherwise it is a durable rebuildable projection event.

## `public_profiles` repository

|Operation|Inputs → result / errors|Boundedness and index|Authorization and atomicity|
|---|---|---|---|
|`insert(profile, tx)`|validated `PublicProfileProjection` → `Created`; `Conflict(account_id)`, `ValidationError`, `InternalError`|one capped document; unique `accountId`|Caller has already authorized projection creation. Atomically creates document and declared indexes with the canonical account/projection receipt.
|`get_by_id(account_id)`|opaque account ID → projection; `NotFound`, `Corruption`, `InternalError`|O(1), primary/unique `accountId`|Read visibility is decided by query service (public only if published); no write.
|`find_leaderboard(filter, page)`|`onboarded?`, `minimum_share?`, cursor/limit → `Page<projection>`; cursor/validation errors|bounded page using `(onboarded, share DESC, accountId ASC)` or `(share DESC, accountId ASC)`|Public query service supplies only approved public filter; read-only.
|`update(profile, expected_account_version, tx)`|full replacement projection plus version → `Updated`; `NotFound`, `Conflict(stale_projection)`, validation/corruption|one document; maintain both leaderboard indexes|Service has validated consent and account version. Same atomic group as Account, receipt and audit; no patch-by-arbitrary-field API.
|`delete_or_archive(account_id, reason, tx)`|ID, governed removal reason → `RemovedOrTombstoned`; `NotFound` may be idempotent|one key and index entries|Service authorizes deletion/consent withdrawal. Atomic with canonical tombstone/consent change and audit.
|`paginate_by_account(page)`|cursor/limit → `Page<projection>`|bounded page, `accountId ASC` primary order|For governed diagnostics only unless a public policy explicitly enables it; no mutation.
|`check_unique(account_id)`|ID → `Unique | Occupied`; corruption/internal error|O(1), unique `accountId`|Internal consistency helper, not an authorization decision.
|`count(filter)`|approved filter → non-negative count|only declared indexed filter; never scan|Public use only where policy permits; aggregate is not certified by this call.
|`rebuild_projection(account, tx)`|canonical public projection input → `Rebuilt`; validation/conflict/internal|one document and indexes by primary key|Called by projection coordinator after canonical facts have been authorized. Idempotent replace; cannot change Account.
|`migration_import(document, receipt, tx)`|validated transformed document and migration receipt → `Imported | PreviouslyImported`; typed errors|one document; lookup `accountId` and stable receipt key|Migration service only. Atomic with receipt and cursor advancement; imported data cannot bypass consent proof.

## `assessment_runs` repository

|Operation|Inputs → result / errors|Boundedness and index|Authorization and atomicity|
|---|---|---|---|
|`insert(run, tx)`|capped immutable run projection → `Created`; `Conflict(run_id)`, validation/internal|one document; unique `runId`|Service already validates request/worker state. Atomic with canonical run/active-run index/audit or outbox.
|`get_by_id(run_id)`|ID → projection; `NotFound`, corruption/internal|O(1), unique `runId`|Query service enforces owner/role redaction.
|`find_by_account(account_id, page)`|ID and cursor/limit → `Page<projection>`|`(accountId, completedAt DESC, runId ASC)`|Caller scope decided by service; bounded history only.
|`find_by_status(status, page)`|status and cursor/limit → `Page<projection>`|`(status, requestedAt ASC, runId ASC)`|Restricted worker/governance use; query service owns role check.
|`update_terminal(run, expected_version, tx)`|allowed projection replacement, version → `Updated`; `NotFound`, `Conflict`, `StateConflict`, validation|one document/index update|Repository mechanically checks optimistic version; service/domain transition table decides legality. Atomic with Account acceptance/rejection state, audit and receipt.
|`delete_or_archive(run_id, reason, tx)`|ID/reason → `Archived`; typed errors|one key; historical document normally immutable|Only governed legal redaction/archive path; never ordinary deletion of accepted facts.
|`paginate_by_schema(schema_version, page)`|schema and page → `Page<projection>`|`(resultSchemaVersion, completedAt, runId)`|Migration/governed diagnostic scope; bounded.
|`check_unique(run_id)`|ID → `Unique | Occupied`|O(1), `runId`|Consistency helper only; accepted-run uniqueness belongs to stable Account state.
|`count_by_status(status)`|finite status → count|indexed status; no scan|Operational metric; no authorization decision.
|`rebuild_projection(canonical_run, tx)`|canonical compact run → `Rebuilt`|one capped document, all indexes|Projection coordinator only; rejects raw evidence/unbounded sources and cannot alter canonical status.
|`migration_import(run, receipt, tx)`|transformed compact run/receipt → import outcome|one record plus stable receipt lookup|Migration service; atomic per row with receipt, not a bulk unbounded transaction.

## `payment_obligations` repository

|Operation|Inputs → result / errors|Boundedness and index|Authorization and atomicity|
|---|---|---|---|
|`insert(obligation, tx)`|validated compact projection → `Created`; allocation/memo/ID `Conflict`, validation/internal|one capped document; unique `obligationId`, allocation key and memo|Service has already reserved funds and established entitlement. Atomic with stable obligation/allocation/receipt indexes, reserve and audit.
|`get_by_id(obligation_id)`|ID → projection; `NotFound`, corruption/internal|O(1), unique `obligationId`|Query service enforces owner/governance/executor scope.
|`find_by_account(account_id, page)`|ID/cursor/limit → `Page<projection>`|`(accountId, createdAt DESC, obligationId ASC)`|Owner history or permitted role; bounded.
|`find_execution_queue(status, network, page)`|finite status/network/page → `Page<projection>`|`(status, network, updatedAt, obligationId)`|Executor/governance scope is checked by service; this is a read candidate list, not a claim.
|`update_state(obligation, expected_version, tx)`|full new bounded projection/version → `Updated`; `NotFound`, `Conflict(version)`, validation/corruption|one document and affected indexes|Service/domain decides transition. Atomic with canonical obligation, receipt uniqueness, reserve accounting, work state, audit and idempotency receipt.
|`delete_or_archive(obligation_id, reason, tx)`|ID/reason → `Archived`; typed errors|one key|Normal hard delete prohibited; only governed policy-approved archive/redaction preserving financial audit.
|`paginate_by_status(status, network?, page)`|filter/page → `Page<projection>`|declared status/network index|Restricted operational scope; bounded.
|`check_unique(allocation_key, memo?, receipt?)`|one normalized key → `Unique | Occupied`|O(1), canonical stable indexes are authoritative|Consistency preflight only; never a substitute for atomic insert.
|`count_by_status(status, network?)`|indexed finite filter → count|declared index only|Operational metric; no policy decision.
|`rebuild_projection(canonical_obligation, tx)`|canonical bounded obligation view → `Rebuilt`|one document/index set|Projection coordinator only; does not execute payments or calculate reserve.
|`migration_import(obligation, receipt, tx)`|reconciled transformed record/receipt → import outcome|one obligation; stable migration receipt lookup|Migration service only; imports ambiguous sends as `reconcile_required`, atomically per row.

## Canonical stable-state ports required by services

ZenDB ports above are projections. The following ports own the actual decision facts: `AccountStore`, `AttestationStore`, `VoteStore`, `PeriodStore`, `PolicyStore`, `ReserveStore`, `ObligationStore`, `WorkStore`, `IdempotencyReceiptStore`, `AuditLog`, and `MigrationReceiptStore`. Each has `get`, deterministic indexed lookup/page where declared, and transaction-scoped create/update operations with expected-version or unique-key conflict results. In particular, `VoteStore` owns `(period,target,voter)`, `AccountStore` owns active assessment and identity-commitment keys, `ReserveStore` owns integer reservation arithmetic, and `ObligationStore` owns allocation/memo/receipt keys and lifecycle state. No ZenDB repository may recreate these invariants.
