# Concurrency test plan

## Harness and oracle

Run deterministic concurrent update tests against a replica/simulator capable of
injecting an await, reject, timeout, duplicate delivery, and upgrade at every workflow
boundary. Assert canonical stable maps, uniqueness indexes, projections (when ZenDB
transactionality is accepted), work leases, command receipts, and audit events after
each case. Test in both message orderings; use distinct principals/worker identities.

Unless a test says otherwise, every successful mutation must produce exactly one
command receipt and one corresponding redacted business audit event; duplicate replay
must produce no second entity/aggregate/reservation/send.

|ID|Scenario and injection|Expected assertions|Evidence/unknowns|
|---|---|---|---|
|CT-01|Duplicate profile/identity submission: submit same key concurrently and then retry after uncertain response.|One Account/identity binding/projection; same stored response; mismatched payload under key conflicts; no PII in receipt.|Identity uniqueness and INV-002/024 confirmed. Provider-proof semantics **UNKNOWN**.|
|CT-02|Simultaneous profile updates with same expected version but different consent/display values.|One succeeds; one gets `Conflict(version_mismatch)`; account/projection/index/audit agree and no duplicate public profile exists.|INV-003/008/023 confirmed; ZenDB atomic guarantee **UNKNOWN**.|
|CT-03|Stale version for policy activation, account tombstone, reserve adjustment, and assessment acceptance.|Each stale command rejects without partial state/index/audit; retry with reread version follows state rules.|INV-008/021/024 confirmed.|
|CT-04|Repeated verified-attestation callback, including callback after account tombstone and a provider-event ID reused with different payload.|One attestation/result; deleted account accepts none; mismatched replay conflicts; eligibility never resurrects.|INV-009/010/011/024 confirmed; provider event format **UNKNOWN**.|
|CT-05|Two simultaneous `request_assessment` calls with different keys, then worker duplicate/out-of-order proposals and expired lease.|At most one active run/work; only matching claimed/requested state can advance; accepted share changes once; late callback is replay/reject, not overwrite.|INV-012/016 confirmed; cancellation/timeout SLA **UNKNOWN**.|
|CT-06|Assessment worker/canister rejection after durable work claim; retry before and after lease expiry.|Core preserves requested/executing durable intent; safe retry occurs only through lease/state; no second accepted run; audit exposes recovery.|Cross-boundary at-least-once rule confirmed; retry budget **UNKNOWN**.|
|CT-07|Double vote: two messages for same `(period,target,voter)`, distinct keys; repeat an accepted vote; vote concurrent with period finalization.|Exactly one Vote/key and aggregate increment; replay returns original; close/finalize ordering yields either valid vote-before-close or clean rejection, never aggregate drift.|Ban uniqueness/INV-013 confirmed; close timing and replacement policy **UNKNOWN**.|
|CT-08|Two finalizers for one period, plus policy activation racing with finalization and hold release/compensation creation.|Exactly one finalized outcome pinned to recorded policy; one hold decision; at most one compensation allocation/reservation/obligation.|INV-014/017/018/021 confirmed; outcome thresholds/appeal semantics **UNKNOWN**.|
|CT-09|Double allocation: two schedulers allocate same account/period/asset; also allocate two accounts concurrently against insufficient shared reserve.|One allocation per canonical key; reserve never negative; only available reservations commit; obligation/history/work/audit all agree.|INV-017/018 confirmed.|
|CT-10|Double payment execution: two executors claim one obligation; inject reject before send, timeout after send, DB/core failure after ledger reply, and duplicate receipt callback.|One lease holder sends. Proven-unsent failure may retry; post-send uncertainty becomes `reconcile_required`, no automatic resend. One receipt/settled transition and conserved reserve accounting.|INV-019/023/024 confirmed; ledger finality/reorg policy **UNKNOWN**.|
|CT-11|Out-of-order payment observations: `settled` receipt arrives before timeout failure, duplicate receipt, stale failure after settlement, and reorg observation.|Valid expected-state transition wins; stale/repeated observations do not regress settled state; receipt uniqueness holds; ambiguous/reorg path is auditable/manual reconciliation as policy requires.|Lifecycle confirmed; reorg transition/finality thresholds **UNKNOWN**.|
|CT-12|Inter-canister ledger rejection and external executor rejection for a committed authorized/executing obligation.|No false settlement or duplicate debit; status/error/work transition is atomic; retry only if non-submission is proved; original entitlement persists for reconciliation.|Canister-map persist-before-await rule and INV-019 confirmed.|
|CT-13|Upgrade during each workflow state: requested/claimed evaluation, tombstone-erasure pending, vote closing, authorized/executing/reconcile-required payment, and in-progress migration.|State, receipt, indexes, audit, leases and deterministic IDs survive pre/post-upgrade; expired lease recovery obeys no-resend rule; unknown decoder state halts as `Corruption`.|Stable structures required; concrete upgrade encoding and ZenDB guarantees **UNKNOWN**.|
|CT-14|Retry after uncertain client result for every public mutation; vary response loss before and after core commit.|Same key reaches exactly-once business effect and stable stored response; fresh key follows normal uniqueness/version rules.|INV-024 confirmed; retention window **UNKNOWN**.|
|CT-15|Repeated migration batches: same batch, overlapping reordered batches, crash before/after row commit, transform-version change, and conflicting legacy source row.|Each source-row receipt is immutable; cursor advances only with committed row outcomes; duplicates replay; transform change does not silently overwrite; conflicts quarantine.|INV-001/004/023/024 confirmed.|
|CT-16|Bounded maintenance/notification/cleanup: two schedulers, repeated email callback, target tombstoned during work, and retry after private-service rejection.|One active lease per work item; underlying decision/tombstone remains correct; notifications/erasure are at-least-once and never roll back core state; no unbounded scan.|Work-item lifecycle confirmed; cleanup/notification retention and provider dedup **UNKNOWN**.|
|CT-17|Oracle refresh races: newer and older observations arrive out of order; same observation replayed; policy activation races with proposal.|Older observation cannot overwrite accepted newer version; provenance/version/audit remain consistent; unauthorized/invalid proposal changes nothing.|Atomic adoption principle confirmed; freshness and monetary use **UNKNOWN**.|
|CT-18|Property/fuzz: generate interleavings of vote, finalization, allocation, payment callbacks, deletion, assessment callbacks, retries, and upgrades.|All invariant checks INV-001–026 hold; no duplicate keys, active run, vote, allocation, receipt, or audit entity; money non-negative/conserved; terminal states do not regress.|Invariant mapping is the oracle; inferred accounting/hold rules must be parameterized and marked **UNKNOWN** until policy is adopted.|

## Await crash matrix

For every intentional pre-await mutation—erasure Work item, assessment/work claim,
notification Work item, payment authorization/`executing` claim, and reconciliation
claim—inject: (1) trap/reject before outbound call, (2) outbound rejection, (3) remote
success with lost reply, (4) remote success with duplicate reply, (5) reply after lease
expiry, and (6) upgrade before result commit. Assert durable recovery/reconciliation,
never rollback or blind resend.

## Exit criteria

All confirmed-invariant cases pass under randomized schedules and explicit boundary
injections. Cases labelled **UNKNOWN** remain specification blockers: they must be
resolved by policy/adapter/ZenDB decisions before financial or decision-driving
production cutover.
