# M1 storage schema and mutation-saga contract

Status: **IMPLEMENTED design contract / unproven** as of 2026-08-01. This document and the companion Motoko modules define the only candidate schemas for M1 task 4. They do not deploy ZenDB, add a public Candid method, grant a principal, ingest data, enable OAuth, or make any collection authoritative. The required local fault, benchmark, and RBAC proof remains a G2 blocker.

## Contract boundary

`canisters/shared/StorageTypes.mo` is the versioned Motoko record contract and `canisters/shared/StorageCatalog.mo` is the proposed collection, index, limit, and role catalogue. The empty core scaffold imports them solely so Mops type-checks the contract; it has no state, public method, grant, or ZenDB call. The catalogue fixes names and field/index intent so later implementations cannot substitute a generated ZenDB document ID for an application logical ID.

Every remote document uses `Envelope`:

- `logicalId` is the immutable, unique indexed application identity. It is the source-ID/import/idempotency key; ZenDB's returned ID is audit metadata only.
- `schemaVersion`, `contentHash`, creation/update epochs, and `pending`/`active`/`tombstoned` state are mandatory. `pending` data is never public or authoritative.
- Hash fields are SHA-256 digests encoded as exactly 32 bytes. The future codec rejects any other length before hashing/serialization.
- Text, blobs, documents, batches, queries, cursors, and manifests are bounded before a remote call. A Candid caller never supplies an owner principal, role, collection, document ID, version, or hash as authority.

The supplied records cover identity/principal bindings, destinations, holds and roles; final evaluation results; exact-base-unit payment operations; and migration receipts. Sensitive identity evidence and large artifacts deliberately keep encrypted/canonical payload bytes out of ordinary indexes. `PaymentOperationV1.amountBaseUnits : Nat` is the monetary authority; no float/decimal presentation field can authorize a transfer.

## Collection and index catalogue

`StorageCatalog.collections()` is the normative machine-readable list. All collections include `logical_id_unique` and `state_updated`; these are not repeated below. A field listed in a unique index is omitted when its source value is null, preserving PostgreSQL's nullable-unique behavior. A `*_unique` name is an application constraint to be verified by Motoko and the M1 ZenDB proof; it is not a claim that an unproven remote call is atomic.

| Collection | Candidate owner | Additional indexes | Purpose / visibility |
| --- | --- | --- | --- |
| `core_user_v1` | core | `legacy_user_unique`, `created` | user identity / restricted |
| `core_principal_binding_v1` | core | `principal_unique`, `provider_subject_unique`, `user` | caller binding / restricted |
| `core_profile_v1` | core | `user_unique` | profile / public projection only |
| `core_email_evidence_v1` | core | `normalized_email_unique`, `user_verified` | email proof / restricted |
| `core_payout_destination_v1` | core | `address_unique`, `user_effective` | destination history / restricted |
| `core_hold_v1` | core | `user_kind`, `due` | eligibility / restricted |
| `core_role_assignment_v1` | core | `principal_role_unique`, `role_principal` | authorization audit / restricted |
| `core_ban_vote_v1` | core | `vote_epoch_unique`, `target_epoch` | voting / sanitized projection only |
| `workflow_result_v1` | workflow | `cycle_unique`, `user_completed` | complete canonical result / restricted or sanitized projection |
| `workflow_result_source_v1` | workflow | `result_ordinal_unique`, `result_url_unique` | result sources / projection policy applies |
| `workflow_schedule_v1` | workflow | `schedule_unique`, `due` | stable non-AI schedules only |
| `workflow_completion_receipt_v1` | workflow | `completion_unique` | final idempotent job receipt; never an AI task |
| `treasury_obligation_v1` | treasury | `obligation_unique`, `asset_status` | liability / no public reader |
| `treasury_payment_operation_v1` | treasury | `operation_unique`, `obligation`, `asset_status` | at-most-one value transfer / no public reader |
| `treasury_journal_v1` | treasury | `entry_unique`, `account_asset_sequence`, `operation` | append-only accounting / no public reader |
| `treasury_chain_receipt_v1` | treasury | `chain_tx_unique`, `operation_attempt_unique` | chain reconciliation / no public reader |
| `migration_receipt_v1` | archive | `chunk_unique`, `table_chunk` | bounded import resume / restricted |
| `migration_evidence_v1` | archive | `source_row_unique` | conflict/exception evidence / restricted |
| `ai_artifact_v1` | archive | `payload_hash_unique`, `retention` | hash-addressed payload archive / restricted |
| `evidence_kyc_v1` | evidence | `attestation_unique`, `erasure_due` | encrypted evidence / no public reader |

The existing detailed mapping in `SCHEMA_MAPPING.md` remains the source-to-collection field and relation disposition for all 22 physical PostgreSQL tables. It now resolves each target collection to this catalogue rather than creating ad-hoc collection names.

No `Task`, task dependency, lease, provider batch/item, or intermediate evaluation collection exists. Legacy equivalents are restricted archive records only. No collection stores a legacy bearer/session value, raw verification token, `SystemSecret.value`, private key, or OAuth code/verifier/token.

## Limits and query protocol

The initial hard envelope, pending M1 inventory/benchmark replacement, is:

| Limit | Value | Required behavior |
| --- | ---: | --- |
| Document | 256 KiB | reject before codec/remote call |
| Write/import batch | 1 MiB | split before call |
| Ordinary import records | 500 | split with stable chunk key |
| Page size | 500 | reject larger request |
| Collection shard | 25,000,000 documents or 50 GiB | create `*_vN`/new shard before either threshold |
| Financial journal | 100,000,000 entries | create a read-only archive/index collection, retain authority/receipts |

Every list uses a versioned opaque cursor carrying the exact indexed sort key, logical ID, and query/filter hash. Offset pagination and an unindexed filter are rejected. The future implementation must record measured instruction/bytes/index multiplier and set a lower request-specific limit if the current envelope is unsafe.

## Grant matrix and deployment requirements

For every catalogue entry, the desired grant shape is exactly: its owning application canister has collection-scoped reader and writer; the approved governance/SNS principal has admin; the ZenDB internal self-grant is retained only if the pin requires it. No browser/user principal, import operator, unrelated canister, bootstrap deployer, or generic application role has a grant. There is no global application admin.

The symbol-only matrix intentionally contains no concrete principal. At deployment, governance must render a principal-bound matrix, hash it, and compare it before target writes. If the pin cannot express a listed scope, a separate ZenDB deployment is required for that boundary. Bootstrap/deployer grants are revoked before an authoritative collection is enabled. A staging-only writer can exist only for the approved migration window and is revoked/downgraded at finalization. The pinned ZenDB self-grant is not a waiver: M1 tests must prove it creates no ingress path and does not expand after upgrade.

## Remote mutation and recovery state machine

Each owning persistent actor records `MutationIntentV1` before every ZenDB write, including the collection, immutable logical ID, desired hash, expected prior version/hash, operation and attempt IDs, and phase. The state machine is:

```text
prepared -> remoteWriteStarted -> acknowledged
                         |              |
                         v              v
                    reconciling ------> (visible only after manifest acknowledgement)
                         |
                         +-> conflict | blocked
```

Before retrying a lost reply or trap, the actor performs a bounded logical-ID lookup:

- desired version and hash: acknowledge it;
- absent insert, or CAS target still has the expected prior version/hash: retry the identical bytes and logical ID;
- anything else: mark `conflict`, fail closed, and require reconciliation. It never generates a second key or blind overwrite.

A multi-document operation first writes all member documents as pending and journals a `VisibilityManifestV1` whose member-ID root is known before any remote call. Only after every member and then the manifest itself are hash-acknowledged does the application expose the version as active. One bounded ZenDB-side atomic method may replace this sequence only after the exact pin proves its atomic behavior; no application-to-ZenDB `await` is treated as atomic. Intent/receipt evidence is append-only; compaction may preserve a checkpoint but not erase audit history.

`MutationIntentV1` has no payload field: canonical bytes remain in the bounded operation-specific state, while the intent records their desired hash. An implementation must retain/reconstruct the identical bytes for a permitted retry, or move to `blocked`; it may not recreate a mutable request from caller input.

## Collection-vN migration and upgrade

No in-place ZenDB schema change is assumed. An owning actor records `CollectionMigrationV1`, creates a new `collection_vN`, copies a bounded logical-ID/hash page as pending, verifies count/hash/index roots, drains old intents, audits the new grant matrix, and only then makes a separately acknowledged router/visibility switch. The old collection becomes read-only and remains available through the rollback window. A failed copy or incompatible signature leaves the router on the old collection and the migration `rollbackOnly`.

Every canister upgrade must retain a semantic stable-type baseline, Candid subtype check, and a bounded old-to-new-to-rollback rehearsal. Timers are re-registered from durable schedules. Before a router switch or upgrade, nonterminal intents are reconciled; they are not discarded, replayed under a new operation ID, or assumed failed because an `await` did not return.

## Required proof before G2

This contract does not satisfy M1 acceptance by itself. The target-data fixture now implements the owning-canister lost-reply/duplicate-delivery saga, an archive-failure/acknowledged-activation saga, bootstrap/self-grant plus post-upgrade revocation audit, and a bounded collection-v1-to-v2 page replay that reconciles a duplicate only by matching logical ID/hash while retaining v1. Its extended runner has no execution evidence: the latest fresh no-login local-loopback attempt reached the explicit-anonymous DFX build but produced no Wasm, deployment, or test call. The remaining suite must prove these exact records/catalogue against the pinned ZenDB API: collection-scope RBAC/direct-ingress negatives, unique logical-ID conflict handling; bounded cursor/index plans; interruption before/during/after remote writes and manifest activation; upgrades; low cycles; archive failure; and executed collection-vN repair/resume. A collection that fails its proof needs a G2-approved, named native-Motoko exception in `SCHEMA_MAPPING.md`; it cannot silently share a general fallback.

Rollback: remove this un-deployed design/scaffolding only. Legacy Node/PostgreSQL behavior, production data, signing authority, and real assets remain unchanged.
