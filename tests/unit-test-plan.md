# Unit test plan

## Test approach

Unit tests use deterministic clocks, ID generators, policy fixtures, authorization fixtures, in-memory transaction-capable repository fakes, and fake external adapters. They do not require a live canister, ZenDB, ledger, worker, or private identity system. Every test asserts the typed result, canonical state, indexes/projection intent, idempotency receipt, and redacted audit event as applicable. Contract tests separately ensure Candid/serialization compatibility.

|Area|Core cases|Key assertions|
|---|---|---|
|Validators|all IDs, principals/account IDs, fixed-point shares, integer amounts, strings/addresses, commitments/URIs, page limits/cursors, document/source/attempt caps, private-data rejection|invalid input returns `ValidationError` before any write; boundary values accepted/rejected exactly; no float or raw PII/secret reaches a projection.
|Authorization rules|anonymous vs public profile; owner vs another account; eligibility/non-self voting; governance role; allow-listed identity/evaluation/executor/oracle workers; tombstoned/restricted accounts|correct `AuthenticationError`/`AuthorizationError`; services pass only mechanical scopes to repositories; repositories do not decide role/ownership.
|State transitions|account, attestation, assessment, work, vote period, hold and obligation graphs|each legal edge succeeds; every illegal edge returns `StateConflict`; terminal records are immutable except documented governed redaction; stale expected version conflicts.
|Calculations|share and fixed-point rounding; vote totals/threshold inputs; reserve available/reserved arithmetic; allocation uniqueness and non-negative amounts; policy-pinned finalization|integer deterministic results; no overflow/negative reserve; same inputs yield same output; policy changes after period opening do not alter pinned outcome.
|Stable repositories|atomic create/update/index/receipt/audit behavior; corruption detection; canonical unique keys for account identity, vote, active run, allocation, memo/receipt|a failed write leaves no partial record/index/audit; duplicate key conflicts; index lookup agrees with primary record; repository never calls authorization policy.
|ZenDB repositories|three collection schemas; declared insert/get/find/update/archive/paginate/count/rebuild/import operations; index maintenance|one capped document per operation; exact declared index/order used; primary and unique conflicts typed; repository accepts a pre-authorized transaction and contains no business role logic.
|Serialization|domain ↔ projection mappings; Candid request/response mapping; error mapping; cursor encode/decode/version/filter binding; audit redaction; certificate model serialization|round trip preserves values/statuses; unknown enum/schema rejected; optional fields do not leak private values; changed filter/cursor version is rejected.
|Idempotency|profile update, request/retry assessment, attestation webhook, vote, policy activation, allocation, work claim/callback, settlement observation, migration row|same key and same normalized command replays stored typed result with `duplicate`; same key/different payload conflicts; only one canonical mutation/audit; response survives retry.
|Pagination|leaderboard, assessment history, obligation history, vote periods and restricted queues|limit max/min validation; deterministic sort/tie-breaker; concatenated pages contain each fixture record once with no gap; bad/tampered/mismatched cursor rejected; query performs no full scan in fake instrumentation.
|Workflow transitions|assessment request→claim→proposal; tombstone→erasure intent; finalization→hold/allocation; obligation authorize→claim→settlement/reconcile; expiry/retry work|intent/lease commits before fake await; no settled/accepted state before result validation; duplicate/reordered/late callback is safe; ambiguous payment becomes `reconcile_required`, never a resend; event payload is bounded and correlation-linked.

## Minimum service test matrix

|Service|Success path|Failure/replay path|
|---|---|---|
|AccountService|consented profile replaces projection and emits audit/receipt|stale version, unconsented field, deletion then further mutation, replay key mismatch|
|AttestationService|allow-listed worker creates/revokes bounded attestation and recalculates eligibility|untrusted worker, duplicate event/subject, account-version conflict|
|AssessmentService|eligible request creates one immutable run/work item; accepted proposal updates share once|second active request, expired lease, oversized sources, reordered duplicate proposal|
|GovernanceService|eligible vote and period finalization; allocation reserves funds|self/ineligible/duplicate vote, stale finalization, insufficient reserve, duplicate allocation key|
|PaymentService|executor claim then proven settlement atomically records receipt|wrong executor/lease, duplicate receipt, timeout/ambiguous observation, stale/reordered observation|
|QueryService|public and owner pages redact correctly and preserve order|unauthorized scope, invalid cursor, missing projection requests rebuild rather than changing canonical result|
|MigrationService|bounded row import stores transform receipt and advances cursor|replayed row, malformed/PII row, unknown legacy status, ambiguous payment quarantines without cursor loss|
|WorkService|claim/completion with valid lease and event|two workers, expired lease, invalid kind/state transition|

## Property and mutation tests

Add property-based tests for pagination order/no-duplication, state-transition closure, fixed-point/reserve arithmetic, idempotency replay, and bounded document transforms. Add mutation tests targeted at removed expected-version checks, omitted audit writes, changed index tie-breakers, skipped uniqueness checks, and a changed `ambiguous → settled` payment mapping; each mutation must be detected by a unit test.

## Non-unit follow-on

Integration tests later verify accepted ZenDB transaction semantics, stable-state upgrade persistence, real Candid interoperability, certification verification, and external ledger reconciliation. Those are deliberately outside this unit plan and must not be used to compensate for missing pure/service tests.
