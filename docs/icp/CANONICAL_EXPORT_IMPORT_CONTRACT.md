# Canonical export/import contract (M1)

Status: **IMPLEMENTED design and test vectors / unproven** as of 2026-08-01. This is a data-format contract and local test scaffold. It does not read PostgreSQL, create a logical slot or publication, write a target canister, grant ZenDB access, or authorize an import. The executable exporter, decoder, importer, and disposable PostgreSQL rehearsal remain later M4/G2 work.

## Scope and invariants

- `meritocracy-migration-canonical-v1` is the sole currently proposed base/delta encoding. Its bytes are UTF-8 JSONL with LF separators, no BOM, canonical object-key order by Unicode code point, and no insignificant whitespace.
- JavaScript numeric values are invalid. Integers, decimals, floating-point bits, timestamps, and byte strings use the tagged forms specified in `MIGRATION_RUNBOOK.md`. This avoids IEEE-754 loss before export. `sourceRowHash` is SHA-256 over canonical `{pk,row,table}`; it is never included in its own hash input.
- The application logical ID is `meritocracy-legacy-logical-id-v1:<table>:sha256:<digest>`, where the digest is over canonical `{format,pk,table}`. It is independent of row content, stable for every source primary key, and distinct from a ZenDB document ID. Observed ZenDB document IDs are optional audit metadata only.
- The committed vectors contain invented, non-sensitive values only. Raw source secrets, bearer values, email/KYC verification values, private keys, credentials, and unrestricted PII are prohibited from base artifacts, deltas, vectors, reports, and logs. Sensitive-table artifacts contain only the separately G2-approved redacted projection plus an approved source-side evidence digest.
- A chunk is bounded to 500 rows and strictly less than 1 MiB uncompressed; a fragment is at most 512 KiB. These are contract maxima, not permission to use unbounded importer messages.

`backend/scripts/icp-canonical-codec.ts` has no I/O capability and exists only to keep these committed vectors executable. The target Motoko codec must independently reproduce the exact vectors before G2; it must not depend on a Node.js runtime.

## Schemas

The canonical schemas are in `docs/icp/canonical-v1.schema.json`. They define the tag grammar and the required fields for source records, chunk headers, table/top-level manifests, delta transactions, import authorization, and receipts. Counts, byte sizes, ordinals, and transaction IDs are decimal strings; PostgreSQL LSNs are uppercase hexadecimal `X/Y` strings; every digest is `sha256:` plus 64 lowercase hex characters. A schema validates shape, never authorizes data or replaces semantic validation.

The importer contract is deliberately fixed now:

1. A base record carries `table`, canonical `pk`, redacted-or-non-sensitive `row`, and `sourceRowHash`; its separately recorded target transformation uses `targetProjectionHash`.
2. A chunk commits to a table/schema version, ordinal, key range, rows/fragments, previous chunk hash, source payload hash, target-projection hash, and the top-level manifest root. Hashes use uncompressed canonical bytes.
3. A delta transaction carries the capture identity, commit LSN, transaction ID, complete begin/commit boundary, relation, replica key, operation, ordinal, before/after hashes, and approved projection. It becomes visible only after its complete source transaction is staged and target-acknowledged.
4. An import receipt has a unique logical key `(migrationId, table, chunkOrdinal)`, exact payload hash, caller/module/Candid binding, bounded counts, operation/attempt ID, and optional non-authoritative ZenDB document IDs. The duplicate rule is exact key plus hash: same hash is a no-op; a different hash is a blocking conflict.

## Capture boundary

The production delta contract remains an approval-gated design: create the approved publication and `EXPORT_SNAPSHOT` logical slot *before* the base export; all base workers adopt that slot's exported snapshot; decode complete transactions from its consistent point through the final barrier LSN; only advance the durable source watermark after target acknowledgement. A generic trigger/polling outbox is not a fallback. No production slot, publication, trigger, replica-identity change, or delta artifact is authorized by this document; G4 is the only production-creation gate.

## Validation

```sh
nvm use stable
npm run test:canonical --workspace backend
```

The test covers stable code-point key ordering, every scalar tag, byte/hash vectors, source-row self-hash exclusion, stable logical-ID derivation, and rejection of JavaScript numbers/malformed or unknown tags. It is not evidence that PostgreSQL logical decoding, source redaction, ZenDB recovery/RBAC, or a production migration is safe; those remain explicit M1/G2 blockers.
