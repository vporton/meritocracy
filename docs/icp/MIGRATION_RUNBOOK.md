# PostgreSQL to ICP migration runbook

Status: G1 design draft. This document specifies the protocol; it does not authorize access to production, creation of a replication slot/trigger, a production import, DNS changes, or asset movement. Concrete types, limits, operator identities, and timing are finalized at G2. Production execution requires G4.

## Safety contract

- PostgreSQL remains authoritative until the recorded G4 cutover step. The legacy application stays runnable and is not retired by an export.
- Discovery and base export use a dedicated read-only database role. The session asserts `default_transaction_read_only = on`, opens `REPEATABLE READ, READ ONLY, DEFERRABLE`, and aborts if the database is not the expected instance.
- General migration data never contains `SystemSecret.value`, plaintext credentials, private keys, wallet mnemonics, WIF, ICP PEM material, OAuth secrets, SMTP credentials, or provider API keys. A separate redacted disposition report contains only secret name, fingerprint, owner, and rotate/retire/manual-transfer decision.
- An import method cannot call a ledger, sign a transaction, enqueue a payment, activate an imported pending payment, or change unified-treasury policy. Imported financial rows remain historical/quarantined until separately reconciled and activated under the approved wallet design.
- Dry runs use a local replica, PocketIC, or a disposable testnet canister and test data. Automated tests never use real funds.
- Every operator action writes an append-only machine-readable receipt. An unexplained count, hash, relation, uniqueness, or financial discrepancy stops the run.

## Roles and required approvals

| Role | Authority |
| --- | --- |
| Database operator | Produce read-only inventory/snapshot; create or remove a production replication mechanism only during an approved G4 step |
| Migration builder | Build deterministic artifacts; has no database write or wallet authority |
| Migration approver/governance | Approve one manifest root, importer principal, expiry, target module hashes, and import mode |
| Import operator | Submit only approved chunks; cannot alter the manifest or activate financial state |
| Independent verifier | Recompute exports, hashes, destination projections, relations, and financial reconciliation independently |
| Incident/safety role | Pause imports/cutover; cannot resume, upgrade, sign, or transfer assets alone |

The final identities and quorum are a G2/G3 decision.

## Artifact layout

An immutable migration directory is content addressed and contains:

```text
migration-<id>/
  manifest.json
  schema/
    prisma-schema.sha256
    migrations.json
    physical-schema.json
  inventory/
    inventory.json
    anomaly-report.json
  tables/<table>/
    table-manifest.json
    chunk-000000.jsonl.zst
    chunk-000001.jsonl.zst
  deltas/
    delta-manifest.json
    chunk-000000.jsonl.zst
  reconciliation/
    structural.json
    financial.json
    external-chain-evidence.json
  reports/
    migration-report.json
    migration-report.schema.json
    signatures.json
```

Compressed files are transported for efficiency, but every hash is over the uncompressed canonical bytes. The compressor, version, and parameters are recorded and have no effect on identity.

## Deterministic canonical representation

The codec is versioned as `meritocracy-migration-canonical-v1` and has golden vectors in the legacy exporter plus Motoko before G2; the target implementation introduces no Node.js/TypeScript dependency.

1. Each JSONL line is UTF-8 with LF only and no byte-order mark.
2. Object keys are lexicographically ordered by Unicode code point. Arrays retain source order only when the source type has an order; otherwise their schema specifies a deterministic sort key.
3. PostgreSQL text is preserved exactly as returned in UTF-8. It is never trimmed, case-folded, or Unicode-normalized. Normalized search/index values are separate derived fields and are never used as source evidence.
4. Ambiguous JSON numbers are forbidden. Scalars use tagged encodings:

```json
{"$int":"-42"}
{"$decimal":{"coefficient":"1200","scale":3}}
{"$f64":"3ff0000000000000"}
{"$timestamp":{"assumedZone":"UTC","precision":3,"value":"2026-07-31T12:34:56.789Z"}}
{"$bytes":"base64url-without-padding"}
```

5. `null` and booleans remain JSON primitives. JSON/JSONB is recursively canonicalized, but every numeric token is tagged without passing through a JavaScript `number`. Duplicate JSON object keys are impossible in JSONB; raw JSON inputs, if any, must be parsed by a loss-detecting parser.
6. `Decimal(65,30)` preserves coefficient and scale. Conversion to ledger base units is a separately hashed target projection and fails rather than rounds.
7. `Float` preserves the exact IEEE-754 64-bit pattern. Deterministic fixed-point/rational derivatives are separate values.
8. `TIMESTAMP(3)` has no source timezone. The export session fixes UTC and records server, database, and session timezone. Any evidence that source writers used another interpretation is an exception that blocks G2.
9. Every row is encoded as `{"pk":...,"row":...,"sourceRowHash":...,"table":...}`. The hash input excludes `sourceRowHash` itself.
10. SHA-256 is the baseline content hash. If a different algorithm is approved later, the algorithm identifier is part of every manifest and receipt; identities are never silently reinterpreted.

## Source inventory and snapshot

### Preflight

The operator records and independently verifies:

- environment identifier, database host fingerprint, database name, PostgreSQL version, encoding, collation, timezone settings, transaction ID/LSN, schema search path, and Prisma migration table;
- SHA-256 of `schema.prisma`, all 18 checked-in migrations, the application commit, and exporter binary/container;
- row count, total/table/index/TOAST sizes, sequence state, primary-key min/max, maximum row/field sizes, nulls, status/type histograms, and exact decimal ranges for all 22 physical tables;
- duplicate candidates under source unique semantics, orphan relations, invalid addresses/statuses/JSON, DAG cycles, timestamp anomalies, and all `ai_result_migration_exceptions`;
- a statement that no secret values were selected or logged.

The inventory is read-only. Live counts and collection sizes are currently unknown; design envelopes in `ARCHITECTURE.md` are not substitutes for this step.

### Base snapshot

1. Confirm G2 has approved schema mapping, canonical vectors, target indexes, exception policy, and a delta mechanism.
2. Start one `REPEATABLE READ, READ ONLY, DEFERRABLE` transaction and capture its snapshot identifier and start LSN. Parallel workers may import the same exported snapshot; none may open an unrelated snapshot.
3. Select every physical column explicitly; never use `SELECT *`. Order by the complete primary key using explicit deterministic collation for textual keys. Tables without a declared primary key require an approved synthetic stable ordering over all columns and duplicate ordinal; none may be silently skipped.
4. Export all 21 Prisma tables plus `ai_result_migration_exceptions`. Record the Prisma migration history and sequence states as metadata.
5. Re-run count and aggregate checks inside the snapshot. Commit/close the read-only transaction only after manifests are durable.
6. A second implementation independently verifies canonical hashes from the same immutable export or snapshot.

The base snapshot alone is insufficient for a live cutover. Writes after its start are captured as ordered deltas until the final freeze.

## Chunking and hash tree

- Default chunk bounds are at most 500 rows and strictly less than 1 MiB of uncompressed canonical bytes, including the header. G2 benchmarks may lower either limit; they may not make canister messages unbounded.
- A single row larger than the bound is divided into content-addressed fragments of at most 512 KiB. A row becomes visible only after every fragment is present, the assembled row hash matches, and the row transaction commits.
- Chunks never span tables and follow primary-key order. A chunk header contains format version, migration ID, table/schema version, zero-based ordinal, first/last key, row/fragment count, previous chunk hash, source payload hash, expected target-projection hash, and manifest root.
- `chunkHash = SHA256(canonical(header without chunkHash) || LF || canonical row bytes)`.
- Each table manifest contains counts, byte count, first/last key, ordered chunk hashes, a Merkle root, source-table hash, expected target-projection hash, and exception counts.
- The top-level manifest commits to ordered table roots, delta roots, schema/tool hashes, transform version, target Candid/module hashes, and report schema. `migrationId` is derived from this manifest without signatures.

Changing any byte, row order, schema rule, target projection, or exception changes the root and requires a new migration ID and approval.

## Explicit transformation and dependency order

Transformation follows `SCHEMA_MAPPING.md` and emits two hashes per source row:

- `sourceRowHash`: exact canonical source evidence;
- `targetProjectionHash`: exact canonical semantic record(s) expected after transformation, including tombstones and exception references.

Stable source IDs are stored as target `legacyId` and are never renumbered. Newly allocated IDs start beyond the imported maximum in a disjoint namespace. Foreign keys refer to stable target IDs, not import order.

The default dependency order is:

1. schema/config metadata and redacted secret disposition;
2. `User`, then `UserEmail` and historical credential/auth records;
3. `Global` and typed policy/config state;
4. tasks, provider groups, mappings, task dependencies, results, sources, and logs;
5. votes, holds, KYC/liveliness evidence, and notification state;
6. financial history (`GasTokenDistribution`, `GasTokenReserve`, `PendingTransaction`) into a quarantined historical namespace;
7. unmanaged AI migration exceptions and restricted archive payloads;
8. derived indexes, certified public projections, and reconciliation summaries.

Missing relations, unique collisions, unknown variants, parse errors, excess monetary precision, DAG cycles, disputed timestamps, oversized values, and discarded AI source evidence are explicit exception records. The policy for each exception is `block`, `preserve historical only`, or an approved deterministic repair with both before/after hashes. No row is dropped merely because it cannot become active state.

## Authenticated, idempotent, resumable import

### Import authorization

Import mode is disabled by default. Governance enables exactly one import session containing:

- migration/manifest root;
- permitted importer principal(s) and quorum;
- target canister/module/Candid hashes;
- allowed table/schema versions and chunk bounds;
- not-before/expiry and maximum total rows/bytes;
- `dryRun` versus `stageOnly` mode;
- explicit denial of ledger, signing, asset activation, and normal user-write capabilities.

Canister caller authentication and governance approval bind the session. A copied chunk submitted by another principal or to another module/migration is rejected. The unified treasury exposes no migration import method.

### State machine

Each table moves monotonically through:

```text
PENDING -> IMPORTING -> SEALED -> VALIDATED -> FINALIZED
              |           |
              +-> ABORTED <-+
```

- `PENDING/IMPORTING`: accept the next valid ordinal or a byte-identical previously accepted chunk.
- Identical duplicate: return the original receipt and make no writes.
- Same ordinal/key range with another hash: reject and pause the table.
- Out-of-order chunk: reject unless its dependency-safe parallel lane was declared in the manifest.
- A bounded message validates, writes staging records/indexes, updates the receipt journal, and commits atomically without an inter-canister `await`.
- Every authoritative or archive ZenDB write uses a durable outbox/saga receipt; application code never claims an object is present until the content hash is acknowledged. Retries use the same object ID and reconciliation resolves interrupted remote writes.
- `SEALED`: expected last chunk/count/roots match; no more chunks accepted.
- `VALIDATED`: uniqueness, references, type rules, source/target hashes, derived indexes, and exception counts pass.
- `FINALIZED`: historical import is immutable and import methods are disabled. Controller governance can technically upgrade mutable application canisters, which is why module/controller verification remains part of G4.

Every receipt includes caller, time, migration/table/chunk IDs, previous/new state, row/byte counts, hashes, and module hash. `status(migrationId, table)` and paginated receipt queries allow safe resume without trusting the operator's local state.

### Partial batches and duplicates

- Staged row fragments and indexes are invisible to application reads until the whole record commits.
- A trap leaves neither the row nor receipt committed; the sender queries status and retries the exact bytes.
- A source primary-key duplicate is preserved with a duplicate exception if the table lacks enforceable uniqueness. A target unique-key collision never chooses a winner implicitly.
- Referential indexes are built/checked deterministically. A table cannot reach `VALIDATED` while an unresolved blocking orphan remains.
- Derived/rebuildable indexes carry their own count/hash and can be dropped and rebuilt without changing authoritative records.

## Delta capture and final freeze

The preferred production delta mechanism is PostgreSQL logical decoding from the base snapshot start LSN. Creating a publication/slot changes database operational state and occurs only under the approved G4 runbook with WAL-retention monitoring and a tested cleanup. If infrastructure cannot safely support it, a transactionally written outbox trigger is the fallback, but its schema/write overhead must be approved at G2 and its production installation still waits for G4.

Each committed change is canonicalized with commit LSN, transaction ID, relation, complete key, operation, transaction-local ordinal, before/after hashes, and row projection. All changes in one database transaction are applied as one target logical transaction or idempotent saga. Tables lacking `updatedAt` are covered because deltas are database-level, not timestamp scans.

Cutover sequence after G4:

1. Verify base and continuous shadow reconciliation while PostgreSQL remains authoritative.
2. Announce maintenance; stop legacy write/API workers and every cron/payment sender. Preserve read-only service where safe.
3. Record process identities and prove no legacy writer/payment worker is running.
4. Capture final LSN, drain deltas through it, and lock the migration epoch.
5. Re-run structural and financial reconciliation and obtain independent signatures.
6. Enable ICP application writes, but keep asset execution paused until the distinct financial/custody checklist is satisfied.
7. Switch certified frontend/DNS/API routing in reversible stages; monitor.
8. Real-asset/key disposition is a separate manual G4 action. Data cutover does not imply asset transfer.

If the freeze exceeds its approved window or any check fails, follow `ROLLBACK_PLAN.md`; do not improvise a second writer.

## Financial reconciliation

Financial reconciliation is independent of table count/hash success. It never uses JavaScript floating point.

### Classification

For each source distribution, reserve row, and pending attempt, construct a typed identity:

`(legacyUserId, chain, network, assetStandard, contractOrLedger, tokenDecimals, scope, cycle, operationId)`.

Then classify it as:

- settled with externally verified transaction and finality evidence;
- pending but definitely not broadcast;
- broadcast with known hash and final/pending/reverted state;
- ambiguous (send may have occurred but durable proof is insufficient);
- failed/cancelled with retained liability;
- invalid/duplicate/conflicting historical evidence.

Legacy status alone is never proof. Pending hashes are not assumed deterministic, and legacy chain-address lowercasing is not repeated.

### Independent evidence

- Query ledgers/chains through at least the approved independent providers and archival ranges; store block/transaction identifiers, confirmations/finality, recipient, asset, exact base units, memo/nonce/UTXO inputs, status, query time, and provider hashes.
- Reconcile known treasury addresses/accounts against chain history and balances. A balance match alone cannot prove per-user settlement.
- Identify the legacy defects listed in `WALLET_SECURITY.md`: sends before database commit, stale `EXECUTING` reset, failed distribution/pending divergence, missing ICRC dedup fields, scope/address mismatches, reserve double counting, and broad updates.
- Ambiguous operations are held for manual adjudication or chain-specific proof. They are never automatically resent.

### Exact equations

Per typed asset/network/scope and in aggregate, report exact integer base units:

```text
opening externally controlled assets
+ confirmed inbound transfers
- confirmed outbound transfers
- external fees
= closing externally controlled assets

recognized obligations
- confirmed settlements applied once
- approved cancellations/forfeitures
= outstanding liabilities
```

Every difference has a signed exception ID and evidence. `GasTokenReserve` and `lastPaymentAmount` are historical assertions, not authoritative balances. Opening target journal entries are created only from the approved reconciliation output and remain non-executable until G3/G4 activation.

## Dry-run protocol

A dry run:

1. uses a sanitized immutable snapshot or generated fixture;
2. rebuilds export twice and requires byte-identical roots;
3. imports into a fresh local/testnet canister with wallet/signing methods absent or hard-disabled;
4. injects interruption before/after each chunk commit, duplicate chunks, conflicting hashes, missing fragments, reordered deltas, upgrades, low cycles, and archive unavailability;
5. compares source counts/hashes with destination target-projection counts/hashes and every relation/index;
6. produces the same report schema as production with `environment = dry-run` and `assetTransfers = 0`;
7. destroys only disposable state after evidence is retained.

At least one full sanitized dress rehearsal and rollback rehearsal are required for G4.

## Machine-readable migration report

`migration-report.json` is canonical JSON validated against a committed JSON Schema. It includes:

```json
{
  "format": "meritocracy-migration-report-v1",
  "migrationId": "sha256:...",
  "environment": "dry-run|testnet|production",
  "source": {
    "schemaHash": "sha256:...",
    "snapshotId": "redacted-id",
    "startLsn": "...",
    "finalLsn": "...",
    "readOnly": true
  },
  "target": {
    "network": "local|testnet|mainnet",
    "canisters": [{"id": "...", "moduleHash": "sha256:..."}]
  },
  "tables": [{
    "name": "User",
    "sourceCount": "0",
    "destinationCount": "0",
    "sourceRoot": "sha256:...",
    "expectedTargetRoot": "sha256:...",
    "actualTargetRoot": "sha256:...",
    "duplicateChunks": "0",
    "exceptions": {"blocking": "0", "historical": "0"},
    "status": "matched"
  }],
  "relations": [{"name": "...", "orphans": "0", "status": "matched"}],
  "financial": {
    "reportHash": "sha256:...",
    "unexplainedDifferenceBaseUnits": "0",
    "ambiguousOperations": "0",
    "assetTransfers": "0",
    "status": "matched|blocked"
  },
  "approvals": [],
  "startedAt": "...",
  "completedAt": "...",
  "result": "pass|fail|aborted"
}
```

Counts and base-unit amounts are decimal strings. Reports contain hashes/redacted references, not secrets or unrestricted PII. Approvals sign the canonical report root, migration ID, environment, and decision.

## Abort conditions

Immediately pause and preserve evidence if any of the following occurs:

- source identity/schema/tool/module/manifest hash differs;
- a supposedly read-only export attempts a write;
- unexpected writer, cron, or payment sender is active during freeze;
- count, row/table/Merkle hash, relation, unique key, sequence, index, or financial equation differs;
- chunk conflict, unknown caller, expired authorization, target upgrade, canister/controller change, low-cycle threshold, or unbounded instruction failure;
- secret/private-key material appears in an artifact/log;
- archive, provider, ledger, or chain evidence is unavailable where required;
- any ambiguous payment would be made executable;
- final freeze exceeds the approved window.

An abort never deletes source data, marks an uncertain payment settled, retries an uncertain external send, or enables both legacy and ICP writers.

## Completion evidence

Migration is complete only when:

- all 22 tables, sequences, approved deltas, relations, constraints, indexes, exceptions, and stable IDs reconcile;
- destination projection roots independently match;
- financial equations have zero unexplained difference and every ambiguous operation remains held/resolved with evidence;
- importer, application, unified treasury, assets, and governance canister IDs/module hashes/controllers match the approved record;
- import mode and legacy writers/payment workers are disabled as planned;
- the signed machine report and rollback decision are archived;
- parity and observation criteria in `PARITY_CHECKLIST.md` and `ROLLBACK_PLAN.md` pass.
