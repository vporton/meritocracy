# Rollback procedure

## Decision boundary

Rollback means either reverting code, restoring compatible canister state, or both; these are different operations. The incident commander must first freeze unsafe mutation paths and determine which is safe.

|Condition|Permitted response|
|---|---|
|New code is faulty but has not written a format the prior release cannot read|Code rollback is normally possible; retain current stable state and verify old reader compatibility.|
|New state is written but remains explicitly compatible with prior reader and snapshot is verified|A controlled state restore may be possible after accounting for post-snapshot writes/effects.|
|New state requires an incompatible decoder, or snapshot is missing/corrupt|Do not restore old code/state. Keep safe/read-only mode, deploy a forward repair, or execute a corrective migration.|
|Any post-snapshot external payment, external credential action, notification, evidence deletion, or user-visible asset release occurred|It cannot be rolled back merely by restoring the canister. Freeze/reconcile and use corrective records/communications.|

No rollback substitutes for ledger reconciliation. In particular, a payment marked `executing`, a broadcast transfer, or uncertain executor result is `reconcile_required` until observed by deterministic memo/instruction ID.

## Authorization and immediate containment

Only the policy-defined controller threshold may authorize rollback, snapshot restoration, controller changes, or release activation. The final controller threshold is an unresolved governance decision; until it is defined and tested, require unanimous configured controllers and a recorded emergency decision, never a shared password or a single worker key. Separate roles may diagnose, pause the scheduler/executor and collect evidence, but may not restore state.

1. Declare incident/release ID and open an immutable redacted audit record.
2. Put core in emergency safe mode: stop new migrations, policy activation, external-send claims and destructive projection changes. Preserve reads appropriate to data safety; show maintenance/degraded status where required.
3. Pause off-chain scheduler/executor dispatch. Instruct workers to retain callbacks and stop new claims; do not discard messages, leases, receipts or evidence references.
4. Record current core/asset wasm hashes, stable header, schema/index generations, migration cursor/status, audit head, policy/reserve totals, work-state counts and every active/executing payment memo. Preserve logs and snapshot artifacts with restricted access.

## Snapshot creation and validation

Before a risky upgrade—and immediately before a controlled restore if possible—create a labeled snapshot containing core stable state, release manifest, header/version/checksum, audit head, migration receipts/cursors, policy/reserve summaries and a ZenDB metadata/count/index-generation manifest. Encrypt it, restrict access to authorized controllers/operators, store it in independent durable storage, and record content hashes and creation time in the audit log. A ZenDB data copy is optional acceleration only; its recovery authority is the core snapshot plus rebuild.

Validate a snapshot by restoring it into an isolated rehearsal canister with the intended reader, checking hashes/header, opening representative record families, verifying invariant/count digests and confirming it is not from the wrong network/environment. Do not label a snapshot rollback-ready until this rehearsal succeeds.

## Controlled rollback

1. Classify the problem: code-only, compatible-state, incompatible-state, ZenDB-projection-only, or external-side-effect incident. Identify all writes after the chosen snapshot from audit/migration receipts.
2. Obtain controller-threshold approval naming exact artifact hashes, snapshot ID, reason, user impact, planned state handling and reconciliation owner. Announce maintenance where public behavior or balances may appear stale.
3. If code-only, install the prior verified wasm only after confirming the stable header’s `minReaderVersion` permits it. Run read-only decoder/invariant smoke checks before re-enabling traffic.
4. If restoring state is approved, retain a copy of current state first, restore the verified snapshot into the controlled target, install the compatible artifact, and run the post-restore invariant checks. Do not overwrite the forensic/current snapshot.
5. Restore/redeploy the prior asset bundle only if its API compatibility is confirmed. Browser caches and copied public assets may remain; serve a compatibility/maintenance notice rather than claiming global reversal.
6. Treat ZenDB as derived: set stale generations inactive, rebuild projections/indexes from restored canonical state in bounded batches, compare count/key digests, then activate verified generation. Do not restore a ZenDB copy over newer canonical truth.
7. Reconcile post-snapshot facts before resuming mutations. Merge no data silently: use idempotency receipts, audit correlation IDs and governed corrective/reconciliation records. Resume scheduler and payment execution only after the payment-specific gate below.

## Data written after the snapshot

Restoring a snapshot removes those canister writes from the live state, so they must first be enumerated and classified. Benign requests can be replayed only through their original idempotency keys after compatibility is verified. New accounts, consent withdrawals, votes, governance decisions, assessments, policy changes and migration receipts need an explicit replay, correction, or user-support decision; their audit evidence remains preserved outside the restored live snapshot.

Never blindly replay post-snapshot payment-related writes. Match allocation key, obligation ID, memo/instruction ID and receipt against the ledger/executor. Keep a sent transfer settled (or create a governed corrective obligation); a proven-unsent instruction may be safely recreated; ambiguous cases remain `reconcile_required`. Recalculate reserve/accounting from reconciled canonical obligations and ledger evidence before any new allocation.

## Irreversible effects and user impact

The procedure cannot undo ledger transfers, chain finality/reorg consequences, external signer broadcasts, consumed/revoked identity credentials, off-chain evidence/erasure actions, sent notifications/email, third-party worker actions, public data already replicated, or cached/downloaded asset files. Restoring a prior canister can also temporarily hide a valid newer account action, vote, assessment or payment history until reconciliation completes.

Tell users plainly when service is paused, reads are from a prior snapshot, a profile/consent change may need confirmation, payment status is under reconciliation, or an asset/UI cache may be stale. Do not disclose PII, raw evidence, secrets, wallet details or security-sensitive investigation data. Publish only policy-approved redacted status and estimated next update; do not promise reversal of external effects.

## Reconciliation and closure

Create a governed reconciliation work record for every post-snapshot external or financially relevant action. Process it in bounded idempotent batches using immutable receipts. Reconcile: payment memos/receipts/finality and reserve balances; active workflow IDs/leases/callbacks; identity-attestation events; consent/deletion projection state; policy/vote/period versions; and ZenDB projection/index provenance. Unknown or conflicting evidence is quarantined/manual review, never auto-resubmitted.

Before leaving safe mode, run the full post-upgrade invariant verifier, verify audit continuity across the incident (with explicit restore/reconciliation linkage), confirm no unreviewed `executing` payments remain, compare projection/index digests to canonical state, and obtain controller-threshold closure approval. Record the timeline, artifact/snapshot hashes, affected scope, user communication, reconciliations, residual risks and follow-up corrective migration in the audit/incident record.
