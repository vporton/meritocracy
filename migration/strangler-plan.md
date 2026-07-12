# Strangler migration plan

## Strategy and ordering

The migration is feature-by-feature, with Express/PostgreSQL strangled only after each capability has an authoritative target and a reconciliation record.  The normal ordering is public reads → isolated CRUD → identity → ownership → workflows → integrations → governance → finance → database retirement.  Source evidence modifies it in two ways:

1. S1 public read projection can go first, but S2 profile ownership must wait for S3’s verified principal claim; a numeric legacy ID cannot become a canister owner.
2. Governance (S5) is before policy/reserves and payments (S6–S8), because vote/hold policy and the unresolved controller, formula, custody, and finality decisions gate all financial cutover.

Do not dual-write mutable domain state.  The only allowed duplication is a derived, versioned read projection (S1) or a read-only shadow calculation.  State-changing target cutovers fence the legacy writer first, use an idempotent migration/cutover command, and reconcile by correlation ID.

## Cross-cutting controls before Phase 1

- Build a legacy-to-Candid adapter only for intentionally supported responses; it must redact fields removed by `api-mapping.md`.
- Record source snapshot IDs, transformation versions, row/batch receipts, target IDs, and reconciliation outcomes.  Import in bounded batches.
- Instrument request route/method, target/legacy version, correlation ID, principal hash, read divergence, migration lag, obligation delta, and reconciliation age. Never emit PII, tokens, prompts, addresses, or secrets.
- Establish a freeze switch per slice, alert ownership, support templates, a read-only PostgreSQL archive, and the missing operational runbook before state-changing cutover.

## Phase 1 — public assets and read projection (S1)

|Responsibility|Plan|
|---|---|
|Old-system responsibility|React/Express serves assets, profile/leaderboard/salary reads from PostgreSQL.|
|New-system responsibility|Asset canister serves versioned UI; core serves bounded consented profile projection and certified public status.|
|Authoritative writer|PostgreSQL; core projection importer is a derived writer only.|
|Authoritative reader|PostgreSQL initially; core becomes reader after comparison window.|
|Dual-read behavior|Normalize pagination/order/intentional field removals and compare canary requests; log hash/count/value deltas.|
|Dual-write behavior|None. Snapshot import and one-way projection refresh are versioned/replayable, not a second domain write.|
|Synchronization strategy|Immutable snapshot plus cursor-based, source-versioned projection refresh; a visible projection version prevents silent stale reads.|
|Divergence detection|Per-page row IDs/order, count/hash, fixed-point conversion, certificate and sensitive-field scanner.|
|Cutover criteria|S1 criteria in `vertical-slices.md`; old route remains fallback until metrics are clean.|
|Rollback criteria|Any leak, certificate failure, conversion mismatch, or material divergence routes reads to old and invalidates the projection release.|

## Phase 2 — identity foundation and owned profiles (S3 then S2)

|Responsibility|Plan|
|---|---|
|Old-system responsibility|Bearer sessions, OAuth/email/KYC, numeric user ownership, profile mutation/deletion.|
|New-system responsibility|Private verifier owns secrets/PII; core owns verified principal account, consented profile, tombstone, and attestation status.|
|Authoritative writer|Identity service for private evidence; core for account/attestation state after S2 cutover.|
|Authoritative reader|Private service for PII/KYC; core for principal account/profile.|
|Dual-read behavior|Shadow verification and claim/projection comparison only; account/profile reads may be canaried after claim.|
|Dual-write behavior|None for sessions, claims, profile updates, tombstones, or attestations.  The cutover fences the old owner writer.|
|Synchronization strategy|Claimant proves principal; worker proposes an idempotent attestation; target-only changes carry correlation IDs for controlled repair.|
|Divergence detection|Claim conflicts, attestation/provider event IDs, account versions, profile projection versions, erasure-outbox status.|
|Cutover criteria|S2/S3 security, provider-fixture, reauthentication, and erasure criteria pass.|
|Rollback criteria|Provider/security incident, claim conflict, or authorization failure pauses target writes. Restore only pre-cutover legacy access; reconcile target-only actions rather than copying them blindly.|

## Phase 3 — assessment workflow (S4)

|Responsibility|Plan|
|---|---|
|Old-system responsibility|Synchronous HTTP initiation and PostgreSQL task/AI result/log workflow.|
|New-system responsibility|Core owns request/accepted result; private worker owns execution/evidence/logs.|
|Authoritative writer|Worker for raw private job data; core only for request and accepted bounded result.|
|Authoritative reader|Core for current accepted status; worker/private portal for evidence/logs.|
|Dual-read behavior|Compare shadow job outputs to legacy normalized outcomes; do not display or adopt shadow decisions.|
|Dual-write behavior|None. New assessment requests use one workflow owner; legacy remains for accounts not cut over.|
|Synchronization strategy|Durable work/run ID, expected state/version, signed worker proposal, idempotent acceptance.|
|Divergence detection|Run/job state, schema/policy version, result commitment, source cap, accepted share delta, retry age.|
|Cutover criteria|S4 shadow corpus, policy/appeal, failure recovery, and privacy criteria pass.|
|Rollback criteria|Pause acceptance/new requests and retain result audit; unresolved accounts use legacy only if no target result has been accepted.|

## Phase 4 — governance and holds (S5)

|Responsibility|Plan|
|---|---|
|Old-system responsibility|Session/numeric-user voting, vote counts, holds, cron actions.|
|New-system responsibility|Core owns principal eligibility, vote uniqueness, period/outcome, hold transitions, and bounded maintenance.|
|Authoritative writer|Legacy until a fresh target period boundary; core thereafter.|
|Authoritative reader|Legacy before boundary; core certified aggregates thereafter.|
|Dual-read behavior|Shadow calculate outcomes and holds using a frozen eligibility snapshot for complete legacy periods.|
|Dual-write behavior|None. There is one period writer/finalizer.|
|Synchronization strategy|Close/freeze legacy period, reconcile counts and claimed-principal mapping, create target period with canonical clock and policy version.|
|Divergence detection|Vote uniqueness keys, eligible denominator, totals/outcome, hold state, period timestamps, audit event count.|
|Cutover criteria|At least one matching complete shadow period and approved quorum/anonymity/appeal policy.|
|Rollback criteria|Before finalization discard target period; after finalization freeze payment effects and use a governed appeal/compensating transition.|

## Phase 5 — policy, reserve accounting, and ICP/ICRC payments (S6 then S7)

|Responsibility|Plan|
|---|---|
|Old-system responsibility|Mutable global configuration, reserves, distribution records, pending transactions, direct execution.|
|New-system responsibility|Core owns policy/reserve/obligation state; existing ledger owns balances/transfers.|
|Authoritative writer|Core after approved policy activation; ledger remains authoritative for transfer outcome.|
|Authoritative reader|Core for obligations and certified aggregates; ledger adapter/ledger for settlement reconciliation.|
|Dual-read behavior|Shadow oracle, reserve, and allocation calculations only.|
|Dual-write behavior|None. An entitlement has one immutable obligation key and one execution path.|
|Synchronization strategy|Reconcile source records and external balances; migrate only non-ambiguous history; persist obligation before ledger await; reconcile memo/block index afterward.|
|Divergence detection|Reserve/ledger delta, obligation amount/status, memo uniqueness, settlement age, unknown/reconcile queue, integer conversion.|
|Cutover criteria|All S6/S7 open decisions resolved, dry-run cycles reconcile, emergency pause/low-cycle drill passes, and capped transfer batch is independently approved.|
|Rollback criteria|Pause new obligations/executor. Never resend an ambiguous transfer; settled transfers are reconciled and corrected only through approved accounting/compensation.|

## Phase 6 — external-chain execution (S8)

|Responsibility|Plan|
|---|---|
|Old-system responsibility|Private keys/secrets, RPC signing/broadcast, external pending transactions.|
|New-system responsibility|Core authorizes unique instructions; KMS/HSM executor performs them; core reconciles verified receipts.|
|Authoritative writer|Core for obligations; executor only for signed receipt/attempt proposal.|
|Authoritative reader|Core obligation view plus independently verified chain finality.|
|Dual-read behavior|Shadow instruction/fee/finality calculations per chain.|
|Dual-write behavior|None; never dual-broadcast.|
|Synchronization strategy|Rotate legacy secrets; executor deduplicates instruction ID; core verifies receipt and finality according to chain policy.|
|Divergence detection|Instruction IDs, executor signature/log, independent RPC result, reserve/recipient deltas, finality/reorg status.|
|Cutover criteria|Per-chain security review, rehearsal, reconciled backlog, and capped canary transfer satisfy S8 criteria.|
|Rollback criteria|Revoke executor authorization/pause per chain; reconcile broadcasts and communicate payout status.|

## Phase 7 — PostgreSQL retirement (S9)

|Responsibility|Plan|
|---|---|
|Old-system responsibility|Read-only archive and legally retained private operational data only.|
|New-system responsibility|Core/assets and protected private services serve all active functions.|
|Authoritative writer|Target services only.|
|Authoritative reader|Target services only; archive is investigation/export only.|
|Dual-read behavior|None after the retirement observation window.|
|Dual-write behavior|None.|
|Synchronization strategy|Final bounded reconciliation, archive checksum/export, secret rotation, endpoint/job disablement.|
|Divergence detection|No legacy writes/traffic, empty or accepted reconciliation queue, archive restore checksums.|
|Cutover criteria|S9 criteria pass, including two full business cycles and a tested runbook.|
|Rollback criteria|Expose a read-only archive for investigation; forward-reconcile target. PostgreSQL never returns as a business writer.|

