# ZenDB schema versioning

## Common contract

Only `PublicProfileProjection`, `AssessmentRunProjection`, and `PaymentObligationProjection` are ZenDB documents. Canonical stable state remains the source of truth and uses independently tagged record decoders described in [upgrade-strategy.md](upgrade-strategy.md). Each ZenDB document has a required integer `schemaVersion`, immutable primary key, `projectionSourceVersion` (canonical record version), and `projectionGeneration`. Collection metadata declares the active version, supported reader versions, index generation and rebuild status.

Schema versions are positive integers. Version 1 below is the initial target-production schema, not a claim about legacy PostgreSQL shapes. A writer emits the active version only. Readers accept only the collection metadata’s supported versions, normalize through a pure versioned decoder, and reject malformed/unknown required variants. No decoder may invent private data, monetary values, IDs, status or consent.

Common rules: additive fields begin optional; a field becomes required only after an explicit backfill/derivable-default migration; every default is versioned and materialized on next write; field absence means the documented historical meaning, not JavaScript null/false/zero. `null` is used only where a field explicitly permits a known empty value—otherwise omit optional fields. Removed data is not silently repurposed. A rename is an expand/read-both/backfill/contract operation, with one canonical field written after cutover. Indexes are versions of a query contract: create and verify a new generation before switching reads, retain the old one for rollback, and rebuild from canonical state rather than trusting stale documents.

## `public_profiles` — current version 1

|Topic|Version-1 rule and evolution policy|
|---|---|
|Fields|Required: `schemaVersion`, `accountId`, `onboarded`, public eligibility flag, fixed-point `share`, `accountVersion`, `updatedAt`. Optional: bounded `displayName`, consented public identifiers/addresses, policy-approved normalized handle. `accountId` is immutable; `accountVersion` links the projection to canonical account state.|
|Compatibility|Readers of V1 ignore unknown allow-listed fields. New public fields are optional in N, omitted from old documents, and must pass consent/size/content validation before write. A field cannot be made required when historical profiles may legitimately lack it.|
|Optional/default policy|No consent is inferred from absence. Missing `displayName`/identifier means “not published.” Missing `share` is invalid, not zero. Defaults may only be deterministic policy values that do not expand visibility; for example, a newly introduced display-only flag defaults to false/hidden and is recorded in its schema migration.|
|Removed/renamed field policy|Withdrawn consent removes/tombstones the public field immediately in the active projection; historic audit records hold only redacted hashes. To rename, write both old and new fields, reader-prefer new, backfill/rebuild, then remove old after all supported readers are retired. Never rename to conceal different consent semantics.|
|Index evolution|V1: unique `accountId`; `(onboarded, share DESC, accountId ASC)`; `(share DESC, accountId ASC)`; optional approved handle. Any changed sort/normalization gets a new index generation and cursor version; existing cursors reject changed query/index versions rather than risk duplicate/omitted pages.|
|Historical interpretation|V1 profiles are a consented projection at `accountVersion`, not evidence that a field is currently consented. Missing optional public fields were not published. Deleted/withdrawn profiles are absent or explicitly tombstoned and must not be reconstructed from older snapshots.|

## `assessment_runs` — current version 1

|Topic|Version-1 rule and evolution policy|
|---|---|
|Fields|Required: `schemaVersion`, `runId`, `accountId`, `status`, request/result schema versions, policy version, bounded fixed-point summary, `evidenceCommitment`, worker/result ID, `requestedAt`. `completedAt`, opaque evidence URI, capped sources (`ordinal`, `urlHash`, optional `titleHash`) and allowed result-summary members are optional only where lifecycle/status permits.|
|Compatibility|`runId`, account/policy association, request/result schema provenance, source order and terminal result semantics are immutable. Readers must understand each stored result schema or return a redacted unsupported-history result; they must not reinterpret old scores under a new model/policy. New summary members are optional and ignored by older readers.|
|Optional/default policy|Absence of `completedAt` means not completed; absence of URI means evidence location not retained in core; absence of title hash means unavailable, not empty title. Defaults may not fabricate a score, source, result or completion. A required future summary field needs a new result schema and either an explicit bounded backfill or remains optional for V1 history.|
|Removed/renamed field policy|Raw evidence/prompt/result content is never introduced for compatibility. A retired display field may be omitted from new versions while V1 immutable records retain their original compact meaning. Rename via dual fields and decoder normalization; never mutate an accepted run merely to rename a field.|
|Index evolution|V1: unique `runId`; `(accountId, completedAt DESC, runId ASC)`; `(status, requestedAt, runId)`; `(resultSchemaVersion, completedAt, runId)`. New work/history indexes are built by generation from canonical stable run/work data. `completedAt` ordering specifies a documented null/lifecycle treatment before index activation.|
|Historical interpretation|A run is an immutable compact outcome under its stored request/result schema and policy, not the account’s current assessment. Missing optional data was unavailable/not applicable at recording time. Old schema results remain auditable but are never silently re-scored.|

## `payment_obligations` — current version 1

|Topic|Version-1 rule and evolution policy|
|---|---|
|Fields|Required: `schemaVersion`, `obligationId`, `accountId`, `periodId`, asset `{network, tokenId, decimals}`, integer `amount`, integer `backlogAmount`, destination commitment, policy version, memo/idempotency key, status, `createdAt`, `updatedAt`. `settledAt`, receipt reference, bounded ordered attempts and error code are lifecycle-optional; a `settled` document requires a receipt.|
|Compatibility|Obligation ID, allocation key, asset decimal meaning, integer smallest-unit amounts, memo, policy version, status history and receipt semantics are immutable. New monetary interpretation, status, network or settlement proof requires a new explicitly recognized variant and reconciliation; readers reject unknown payment states rather than treating them as failed/settled.|
|Optional/default policy|Missing `backlogAmount` is invalid for V1—not zero—unless a named migration proves/materializes zero. Missing receipt/settled time is valid only before settlement. Missing attempt history means it was not retained in this compact projection; canonical state/audit remains authoritative. No amount, destination, memo, receipt, or status receives an implicit default.|
|Removed/renamed field policy|Financial fields are never deleted or semantically renamed in place. A display/adapter reference may use dual fields with a migration, while the old value stays readable for audit. Redaction applies only to permitted sensitive presentation fields, never canonical accounting/receipt evidence.|
|Index evolution|V1: unique `obligationId`, allocation tuple, memo/idempotency, and non-null receipt; `(accountId, createdAt DESC, obligationId)` and `(status, network, updatedAt, obligationId)`. Build a new index generation, compare key/count digests to canonical indexes, then switch bounded queries. Never use a timestamp-only legacy uniqueness index.|
|Historical interpretation|Each document describes the obligation under its stored asset decimals and policy, not a rebased present-value amount. `reconcile_required` means external outcome is unresolved; no historical reader may imply a resend is safe. Legacy decimal/float records are absent unless an approved fixed-point transformation and ledger reconciliation produced this V1 form.|

## Stable record evolution

Stable records use the same rules but are not ZenDB documents. Every record family is a tagged versioned envelope; readers support only declared ranges and preserve unknown optional extension data only if a lossless codec is provided. New stable indexes are derived/rebuildable where possible. Canonical keys, receipts, audit events, policy versions, work leases and settled-payment facts have no implicit defaults. A decoder encountering an unknown state, impossible required field or incompatible fixed-point scale reports `Corruption`, preserves the bytes/snapshot for diagnosis, and blocks the affected mutating path.
