# Data model decisions

## Decisions

|Decision|Why / consistency implication|Duplication risk and update/rebuild strategy|
|---|---|---|
|Keep Account, policy, vote uniqueness/aggregates, reserves, active obligation state and audit keys in direct stable state.|They participate in authorization, atomic state transitions, uniqueness and financial/governance invariants. ZenDB must not become competing authority.|ZenDB documents hold only a versioned mirror where needed. The stable mutation validates and changes canonical state first/in the same message, then writes the projection and audit. A failed message rolls back together.|
|Embed source summaries in `assessment_runs`, not a source collection.|Sources are only read with their run and ordinal order; an extra collection creates joins and permits unbounded result expansion.|Embed at most S sanitized/hash-based summaries. Full source evidence is off-chain. A changed evidence policy creates a new run/document schema, never mutates immutable historical result.|
|Do not embed payments or votes in Account.|Both histories are unbounded and have independent filters, authorization, retention, and audit needs.|Use referenced IDs and indexed histories. Account contains at most current active IDs and bounded counters/aggregate pointers.|
|Use `public_profiles` as a projection, not as Account.|Leaderboard/list workloads need indexed sort and only a subset of fields may be public.|Profile fields duplicate consented Account-derived data. Update inside the same account mutation; projection records `accountVersion`. On mismatch, rebuild by primary-key cursor from Account stable state.|
|Use `assessment_runs` and `payment_obligations` ZenDB documents while keeping canonical keys/state stable.|They are independently paginated history/read models with bounded payloads. Their documented fields are useful but cannot decide eligibility or payment transition by themselves.|Run/obligation document carries canonical ID/version. Projection drift is detected by version/reconciliation audit and repaired in bounded cursor batches. Payment canonical state wins on disagreement.|
|Do not create `public_vote_view` yet.|Vote anonymity, message visibility, and publication timing are **UNKNOWN**. Premature replication can be irreversible disclosure.|Canonical stable votes remain restricted. If approved later, create a deliberately redacted versioned projection from finalized data only and rebuild cursor-wise.|
|Move private identity/KYC/tokens/secrets/raw logs/evidence off-chain.|Replicated canister state is not confidential; these records need provider secrets, legal erasure and large/searchable storage.|Core stores only bounded commitments, statuses, expiry and worker/policy references. Off-chain erasure does not rewrite core audit facts; it changes references to redacted/tombstoned state.|
|Treat `global` as a versioned singleton, and salary statistics as rebuildable projection.|Current `findFirst` permits multiple globals. Policy/treasury configuration needs governance versioning; statistics do not deserve authority.|One active configuration key is enforced directly. Recompute statistics off-chain or in bounded batches and publish only certified aggregate if useful. Do not import stale legacy projection as truth.|
|Replace timestamp-based distribution uniqueness with allocation identity.|Legacy uniqueness includes an exact timestamp despite a “daily” intent, allowing duplicates. Payments need an explicit period/account/asset idempotency scope.|Obligation ID/memo is deterministic and canonical. A backfill transforms/reconciles each legacy distribution/transaction; conflicts and ambiguous sends are `reconcile_required`.|
|Use fixed-point integers, never legacy floats/decimals directly.|Financial/share comparisons need deterministic semantics across upgrades and languages.|A migration version specifies scale, rounding, overflow bounds and reconciliation report. The appropriate scale/allocation formula is **UNKNOWN**; financial cutover is blocked until approved.|
|Append redacted audit facts rather than SQL-style raw logs.|Core decisions need durable accountability, but raw request/response/error logs can contain secrets/PII and grow without bound.|Audit has entity/correlation IDs and hashes, not payload duplication. Segment/archival rebuild/export is cursor-driven; private detailed logs remain off-chain.|

## Migration and projection protocol

1. Freeze a PostgreSQL source snapshot and assign `snapshotId`; do not treat a current serial ID as a new account ID.
2. Import only a bounded source-key batch through an authorized migration principal. Validate schema version, payload limits, a row idempotency key, and target uniqueness before each write.
3. Create Account only after the claimant proves the target principal or an approved verified-link process succeeds. Exclude emails, government numbers, KYC fields, session/token material, secrets, private keys and raw AI/log payloads.
4. Import compact assessment summaries only where a policy-approved transformation and evidence commitment exist. Import votes only at a defined new-period boundary after identity claims; otherwise retain legacy history off-chain.
5. Convert reserves/obligations with an explicit fixed-point transformation and external ledger/chain reconciliation. Any unmatched or uncertain send becomes `reconcile_required`; no automatic replay.
6. For each successful row, write a Migration receipt and audit event. Advance the cursor only after the whole bounded batch commits. Repeated rows return the original receipt/outcome.
7. Build each ZenDB projection from canonical stable state using a versioned, primary-key cursor. Serve the old projection until the new version is complete, validate counts/checksums, then atomically select it. Never run an unbounded rebuild call.

## Uncertain workload and policy assumptions

- **UNKNOWN:** expected account count, concurrent users, evaluation-run rate, payment volume, retention periods, stable-memory/cycle budgets, and therefore numerical page/document/source/attempt/link caps.
- **UNKNOWN:** whether public profile fields include any wallet/social identifier, how many principals one person may link, and which identity providers remain required.
- **UNKNOWN:** vote anonymity, message publication, replacement/appeal/quorum/threshold policy and finalization cadence.
- **UNKNOWN:** allocation formula, fixed-point scale/rounding, GDP/price authority/freshness, supported networks/assets, finality/reorg rule and treasury custody.
- **UNKNOWN:** legal retention, deletion and erasure obligations for KYC, contact data, evidence, logs, audit and financial records.

These decisions must be resolved before choosing numerical validators or a financial/KYC production cutover. They are intentionally not guessed in the data model.
