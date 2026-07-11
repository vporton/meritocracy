# Asynchronous workflows

## Common protocol

All cross-boundary messages are at-least-once. A workflow record/work item has a
deterministic ID, finite state, lease/version, retry schedule, correlation ID, and a
redacted audit event for every core transition. The initiating update never awaits;
it commits an intent first. A callback must include the workflow ID, producer event
ID, expected state/version, schema version, and bounded payload. A duplicate terminal
callback returns the stored result; a wrong-state callback is rejected without change.

After upgrade, stable workflow records and leases are decoded/validated. Expired
leases become reclaimable only when their external effect is safe to repeat; otherwise
they become `reconcile_required`. Upgrade must not regenerate IDs or clear receipts.

## Identity verification and attestation

- Initiating command: private identity/KYC service verifies a credential, then submits `propose_attestation`.
- State machine: `off_chain_pending → verified_or_rejected → proposed → accepted | rejected | expired | revoked`.
- Retryable failures: provider outage, callback delivery failure, temporary core rejection due to lease/network.
- Permanent failures: invalid/expired/used credential, unauthorized worker, identity collision, schema/bounds failure.
- Timeout: provider-side expiry; an unsubmitted verification expires and must be restarted. Core proposal expiry is a separate bounded work transition.
- Duplicate calls: private service consumes credential/event exactly once; core deduplicates provider event ID. Same accepted event replays its stored result.
- Compensation: revoke a mistakenly accepted attestation and recompute eligibility in one core update; raw evidence stays off-chain.
- Operator intervention: quarantine conflicting claims or unknown provider schema; governance manages provider policy.
- Audit: credential/event commitment, provider/schema/policy, worker, before/after status—never credential or PII.
- Upgrade recovery: retain attestation/event receipt and expiry index; reject unknown state/schema as `Corruption`.

## Account deletion and private-data erasure

- Initiating command: owner/governance `tombstone_account`.
- State machine: `active → tombstoned + erasure_pending → erasure_claimed → erased | retryable | manual_review`.
- Terminal states: `erased`; core tombstone remains terminal even when private erasure is pending.
- Retryable failures: private service outage or delivery uncertainty.
- Permanent failures: legal hold/retention policy or irrecoverable identity mapping (**UNKNOWN** policy).
- Timeout: expired worker lease returns work to pending; do not reactivate the account.
- Duplicate calls: tombstone receipt replays; erasure service receives deterministic work ID.
- Compensation: none for replicated facts; remove public projection atomically at tombstone. Correctly authorized restoration is **UNKNOWN**.
- Operator intervention: resolve legal hold/manual-review; no blind deletion retry.
- Audit: deletion reason code, actor, account/version, erasure work ID; redact PII.
- Upgrade recovery: tombstone gate stays active; rebuild due-work index from stable work items.

## Evaluation request, execution, and acceptance

- Initiating command: owner/governance `request_assessment` / retry.
- State machine: `requested → work_pending → claimed → executing → proposed → accepted | rejected | expired | retryable | reconcile_required`.
- Terminal states: `accepted`, `rejected`, `expired`; retry creates a new immutable run, never overwrites accepted history.
- Retryable failures: worker/provider/source outage, expired lease before any accepted proposal.
- Permanent failures: eligibility/policy failure, malformed/oversize proposal, invalid signature, source uniqueness violation.
- Timeout: lease expiry reclaims work; proposal past deadline is rejected/expired. Whether a running provider job can be cancelled is **UNKNOWN**.
- Duplicate calls: request key returns same run; worker work ID/result ID deduplicate; out-of-order proposals must match `requested/executing` expected state.
- Compensation: reject proposal; accepted share correction/appeal process is **UNKNOWN**, so no automatic rollback is specified.
- Operator intervention: quarantine inconsistent worker results, policy/schema mismatch, or corrupted run/index.
- Audit: run/work/result commitments, worker, policy/version, transition and redacted rejection code.
- Upgrade recovery: preserve active run key, work lease and result receipts; validate capped source metadata before re-serving.

## Vote period, hold, and compensation decision

- Initiating command: `submit_vote`; governed/scheduled `finalize_period`.
- State machine: `scheduled → open → closing → finalized → appealed | settled`; account hold `none → held → released`; compensation `not_needed | obligation_created → settled | reconcile_required`.
- Terminal states: finalized decision plus settled/reconcile-required compensation.
- Retryable failures: notification/payment work delivery; no retry is needed for the no-await vote/finalization commit itself.
- Permanent failures: self vote, duplicate key, ineligible voter, invalid type, closed period, invalid policy state.
- Timeout: closing/finalization timing and appeals are **UNKNOWN**; a late finalizer must use expected period version.
- Duplicate calls: composite vote key and deterministic outcome/compensation allocation key return prior result; finalization is one state transition.
- Compensation: releasing a hold may atomically create one policy-pinned obligation; there is no rollback of a settled transfer.
- Operator intervention: disputed outcome, policy ambiguity, or reserve mismatch pauses payment and enters review.
- Audit: voter/target commitments, period/policy, aggregate/outcome, hold and compensation IDs; vote-message publicity is **UNKNOWN**.
- Upgrade recovery: completed periods remain immutable; rebuild aggregates only from canonical vote keys after validation.

## Payment authorization, execution, and reconciliation

- Initiating command: governed allocation/distribution or compensation release.
- State machine: `allocation_pending → created → authorized → executing → settled`; side paths `failed/retryable`, `reconcile_required`, and policy-approved `cancelled` before send.
- Terminal states: `settled`, `cancelled`, or `reconcile_required` pending human/reconciler conclusion.
- Retryable failures: executor/ledger rejection before a send, transport failure with proven non-submission, unavailable observation service.
- Permanent failures: invalid asset/destination under policy, insufficient reserve, receipt collision, invalid transition.
- Timeout: an `executing` lease expiring after an await is **ambiguous**; do not resend. Query ledger/executor by deterministic memo/instruction ID and transition to settled, retryable (only proven unsent), or reconcile-required.
- Duplicate calls: allocation key, obligation ID, ledger memo, executor instruction ID, receipt index, and lease/version ensure one entitlement/send. Repeated result callbacks replay a stored settlement outcome.
- Compensation: reserve release is only a controlled pre-send cancellation/failure transition. A chain transfer is irreversible; over/underpayment is a separate governed corrective obligation after reconciliation.
- Operator intervention: pause asset/executor, inspect memo/receipt/finality/reorg evidence, then submit an attested reconciliation outcome. Finality depth is **UNKNOWN**.
- Audit: obligation/allocation/memo commitments, reserve before/after, attempts, receipt reference, error code, operator action; never private key or raw transaction payload.
- Upgrade recovery: preserve executing records and memo/receipt indexes; on restart reconcile all expired executing leases before any resend.

## Oracle refresh

- Initiating command: authorized oracle worker proposes GDP/token value.
- State machine: `fetch_pending → observed → proposed → accepted | rejected | stale`; a later accepted version supersedes, never overwrites history.
- Terminal states: accepted/rejected/stale.
- Retryable failures: public source/network/rate-limit failure, callback delivery.
- Permanent failures: unauthorized oracle, invalid bounds/provenance/schema.
- Timeout: observation expires according to policy freshness, which is **UNKNOWN**.
- Duplicate calls: observation ID returns stored decision; version prevents an older observation overwriting newer accepted data.
- Compensation/operator/audit/upgrade: no compensation; governance resolves source disagreement; audit source commitment/time/version; retain version history across upgrade. Whether this data affects allocation is **UNKNOWN**.

## Migration and reconciliation batches

- Initiating command: governed `import_batch` or `reconcile_batch(snapshot,cursor,limit)`.
- State machine: `received → validating → imported | rejected | quarantined → reconciled`; batch `pending → claimed → committed → completed | retryable | manual_review`.
- Terminal states: immutable per-row imported/rejected/reconciled receipt; completed batch.
- Retryable failures: trap/upgrade/network before commit, bounded source read failure.
- Permanent failures: invalid transform/schema, duplicate incompatible target, dangling relation, ambiguous payment/identity data.
- Timeout: lease expiry permits re-validation; cursor advances only in the atomic commit that writes every row outcome.
- Duplicate calls: snapshot + source-row hash + transformation version receipt replays prior outcome; a changed transform is a new explicit migration version.
- Compensation: no destructive rollback; quarantine and create a governed corrective/reconciliation record.
- Operator intervention: resolve collision/ambiguous external transfer, approve one legacy singleton, or stop a corrupt batch.
- Audit: snapshot, cursor range, transform version, counts and redacted row outcome commitments.
- Upgrade recovery: stable cursor/row receipts resume exactly; decoder rejects unknown migration state.

## Notifications

- Initiating command: a committed core decision creates a notification Work item.
- State machine: `pending → claimed → submitted → delivered | retryable | failed | expired`.
- Terminal states: delivered/failed/expired; delivery never changes the underlying governance, identity, or payment decision.
- Retryable failures: SMTP/provider outage and uncertain delivery; permanent failures: invalid destination/consent policy.
- Timeout/duplicates: lease expiry reclaims; deterministic notification ID gives at-least-once delivery with provider-side deduplication where available (**UNKNOWN** provider support).
- Compensation/operator/audit/upgrade: no decision rollback; operator handles repeated failure; audit redacted event/template/version; retain work receipts through upgrade.
