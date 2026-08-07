# M1 storage schema and mutation-saga contract

Status: **IN PROGRESS authorization scaffold / unproven** as of 2026-08-07. This document and the companion Motoko modules define the only candidate schemas for M1 task 4. The local-only storage-authority scaffold adds fixed authorization probes and a governance audit, but does not deploy ZenDB, persist target data, grant a principal, ingest data, enable OAuth, or make any collection authoritative. The required local fault, benchmark, and RBAC proof remains a G2 blocker.

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

## Storage-authority authorization boundary

Per the 2026-08-07 M1 decision in `M1_OPERATOR_HANDOFF.md`, ZenDB is an
in-process library in a persistent storage-authority canister. The library has
no remote Candid ingress and is not an RBAC layer. For every catalogue entry,
the storage authority's fixed Motoko policy permits only its owning application
canister to perform the required read/write actions and only the approved
governance/SNS principal to perform administration. It derives the permitted
logical-ID scope from the authenticated caller and does not accept caller-
supplied collection, role, owner, document ID, or arbitrary query authority.

No browser/user principal, import operator, unrelated canister, bootstrap
deployer, or generic application role may call a sensitive storage operation.
There is no generic collection CRUD or ZenDB grant-management Candid method.
At deployment, governance renders and hashes the principal-bound caller/
collection/action matrix before target writes. A staging-only import action can
exist only for the approved migration window and is revoked/downgraded at
finalization. Tests must prove exact direct-ingress, cross-canister, bootstrap,
and post-upgrade negatives; controller privilege never substitutes for method
authorization.

### 2026-08-07 executable boundary scaffold

`canisters/storage_authority/main.mo` is the first local-only implementation
of this boundary. It is a shared persistent actor class configured once with
six distinct non-anonymous principals: `core`, `workflow`, `treasury`,
`archive`, `evidence`, and `governance`. The installer must itself be a
separate non-anonymous principal; it cannot bootstrap itself into any of those
six roles. Its policy is pure Motoko in
`StorageAuthorityPolicy.mo`, so it is independently testable without a
replica, ZenDB instance, target collection, document, or credential.

The Candid surface contains only fixed owner-specific read/write **probes**
and `policyAudit`. A caller cannot pass a collection, action, role, owner,
document ID, ZenDB filter, or grant request. Each probe derives the permitted
owner from its own method, rejects anonymous callers, rejects IDs that are
empty, control-containing, or longer than 512 characters before an eventual
storage call, and authorizes only the matching configured application
principal. `policyAudit` returns the fixed matrix only to governance and does
not grant governance a data read/write path. The fixed matrix is a private
persistent field rather than a captured actor-class parameter, so an upgrade
cannot replace the installed matrix through its new init argument. There is no
configuration update method, and a canister controller or initializer caller
is not a policy member because the shared initializer rejects it when it
appears in the fixed matrix.

`test/StorageAuthorityPolicy.test.mo` covers every catalogue owner and rejects
anonymous direct ingress, unrelated principals, bootstrap/deployer access,
governance data access, cross-owner calls, malformed logical IDs, anonymous
configuration, and duplicate configuration. The persistent actor's generated
stable signature includes that matrix, and `mops test`, `mops check`, `mops
build`, and `mops check-stable` pass with this scaffold. The former DFX local
replica runner remains intentionally disabled: DFX 0.32 identities are
global, so its claimed disposable identity isolation was not valid evidence.
`scripts/icp/test-storage-authority-boundary.sh` is its completed
identity-free replacement. It pins PocketIC 12.0.0 in `mops.toml`, compiles
the scaffold and disposable caller fixture into a fresh `/tmp` directory, and
uses only synthetic principals through Mops 2.19.2's lock-pinned
`pic-js-mops` 0.14.8 client. It never invokes DFX, chooses a wallet, or
contacts a network. The proof covers anonymous/bootstrapping/unrelated direct
ingress denial; every owner-specific inter-canister read/write allowance;
cross-owner, malformed-ID, unrelated-canister, and governance-as-data denial;
governance-only audit; and an EOP-preserving upgrade supplied with a distinct
valid init matrix that cannot replace the persisted one. Before G2, the actual
in-process ZenDB adapter still needs bounded writes, lookups, archive
behavior, low-cycle handling, lost-reply recovery, and repair/resume tests.

`fixtures/zendb/M1EmbeddedStorageProbe.mo` and
`scripts/icp/test-zendb-embedded-storage.sh` add a narrower compiler proof for
that remaining adapter work. The runner takes an existing ZenDB checkout only,
archives the exact pin into a fresh `/tmp` directory, copies and validates each
lock-recorded dependency source hash, and compiles a private persistent
`VersionedStableStore` with the candidate's Motoko 1.4.1 compiler. It has no
Candid method, collection, document, index, remote ZenDB actor, DFX, PocketIC,
network, identity, or wallet path. The 2026-08-07 local execution passed. This
is compatibility evidence for the embedded library only; it neither proves a
storage operation nor authorizes replacing this repository's currently pinned
Motoko 0.16.3 toolchain with the candidate's 1.4.1 toolchain.

## Cross-canister mutation and recovery state machine

Each owning domain actor records `MutationIntentV1` before every call to the
storage-authority canister, including the collection, immutable logical ID,
desired hash, expected prior version/hash, operation and attempt IDs, and
phase. ZenDB writes execute in-process inside that storage authority; the
cross-canister reply, not a direct ZenDB call, is the interruption boundary.
The state machine is:

```text
prepared -> remoteWriteStarted -> acknowledged
                         |              |
                         v              v
                    reconciling ------> (visible only after manifest acknowledgement)
                         |
                         +-> conflict | blocked
```

Before retrying a lost reply or trap, the actor asks the storage authority for
a bounded, caller-authorized logical-ID lookup:

- desired version and hash: acknowledge it;
- absent insert, or CAS target still has the expected prior version/hash: retry the identical bytes and logical ID;
- anything else: mark `conflict`, fail closed, and require reconciliation. It never generates a second key or blind overwrite.

A multi-document operation first writes all member documents as pending and journals a `VisibilityManifestV1` whose member-ID root is known before any cross-canister call. Only after every member and then the manifest itself are hash-acknowledged does the application expose the version as active. One bounded in-process ZenDB operation may replace this sequence only after the exact pin proves its atomic behavior; no cross-canister `await` is treated as atomic. Intent/receipt evidence is append-only; compaction may preserve a checkpoint but not erase audit history.

`MutationIntentV1` has no payload field: canonical bytes remain in the bounded operation-specific state, while the intent records their desired hash. An implementation must retain/reconstruct the identical bytes for a permitted retry, or move to `blocked`; it may not recreate a mutable request from caller input.

## Collection-vN migration and upgrade

No in-place ZenDB schema change is assumed. An owning actor records `CollectionMigrationV1`, creates a new `collection_vN`, copies a bounded logical-ID/hash page as pending, verifies count/hash/index roots, drains old intents, audits the new grant matrix, and only then makes a separately acknowledged router/visibility switch. The old collection becomes read-only and remains available through the rollback window. A failed copy or incompatible signature leaves the router on the old collection and the migration `rollbackOnly`.

Every canister upgrade must retain a semantic stable-type baseline, Candid subtype check, and a bounded old-to-new-to-rollback rehearsal. Timers are re-registered from durable schedules. Before a router switch or upgrade, nonterminal intents are reconciled; they are not discarded, replayed under a new operation ID, or assumed failed because an `await` did not return.

## Required proof before G2

This contract does not satisfy M1 acceptance by itself. The target-data fixture implements the owning-canister lost-reply/duplicate-delivery saga, an archive-failure/acknowledged-activation saga, bootstrap/self-grant audit, and a bounded collection-v1-to-v2 page replay that reconciles a duplicate only by matching logical ID/hash while retaining v1. On 2026-08-07, its separate owner-controlled remote-actor upgrade path failed because the pinned candidate restored a bootstrap admin grant after upgrade. That rejects the remote-RBAC topology and remains diagnostic only. The approved M1 direction is instead the storage-authority Candid boundary described above and in `M1_OPERATOR_HANDOFF.md`. The remaining suite must prove that boundary with direct-ingress/caller/upgrade negatives, bounded cursor/index plans; interruption before/during/after cross-canister calls and manifest activation; low cycles; archive failure; and executed collection-vN repair/resume.

Rollback: remove this un-deployed design/scaffolding only. Legacy Node/PostgreSQL behavior, production data, signing authority, and real assets remain unchanged.
