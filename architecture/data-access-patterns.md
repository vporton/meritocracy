# Data access patterns and bounds

All update paths execute in `meritocracy_core` and emit a redacted audit event atomically. “Index” includes a direct stable-map key where no ZenDB index is used. `L` is the configured page/batch limit, `S` the bounded embedded-source/attempt cap, and `K` the bounded current-identity-link cap. Exact values are **UNKNOWN** and must be set before cutover.

|Use case|Collections/state read|Collections/state written|Index and maximum processed|Ordering/pagination|Complexity and boundedness|Projection / scan flag|
|---|---|---|---|---|---|---|
|Create or claim principal account|Account key; external identity commitment uniqueness; private identity service|Account, verification attestation/ref, audit; optionally `public_profiles`|Direct keys; at most K link commitments|None|O(K), bounded by input/link cap|No projection beyond optional profile; no scan|
|Link/verify email, KYC, or social identity|Private identity/KYC service; Account/attestation key|Attestation, Account state/version, audit|Direct account/attestation/event ID; one proposal|None|O(1), bounded payload|No ZenDB scan; off-chain provider lookup must be indexed|
|Maintain profile/withdraw consent/delete account|Account; `public_profiles` by account ID|Account tombstone/consent, profile upsert/remove, audit, off-chain erasure work item|Direct account/profile key; at most K public fields|None|O(K), bounded|`public_profiles` maintained synchronously; no scan|
|Get public profile|`public_profiles`|None|Primary key|None|O(1), bounded|No scan; ordinary or certified when policy makes it decision-relevant|
|Leaderboard|`public_profiles`|None|`(onboarded, share DESC, accountId)`|Descending share, opaque cursor, ≤L|O(log N + L), bounded|Uses existing projection; **flag** if an ad-hoc filter lacks an index—do not scan collection|
|Request/retry evaluation|Account, active assessment key, policy, work idempotency|Account assessment state, Work item, `assessment_runs` request summary, audit|Account + idempotency direct keys; one run|None|O(1), bounded|No scan; run projection required for history|
|Worker proposes/authority accepts assessment|Work/run ID, Account expected version, policy/worker allow-list|Assessment run, Account accepted result/share, audit|Direct IDs; source/result ≤S|None|O(S), bounded|`assessment_runs` updated; raw evidence remains off-chain|
|Read assessment history|`assessment_runs`|None|`(accountId, completedAt DESC, runId)`|Newest first, opaque cursor, ≤L|O(log N + L), bounded|No scan|
|Submit BAN/UNBAN vote|Account voter/target, period, Vote uniqueness key, eligibility, policy|Vote key/aggregate, audit; possibly governance outcome work|`(period,target,voter)` and target aggregate direct maps; one vote|None|O(1), bounded|No ZenDB projection; no scan|
|Read own/target/period vote history|Vote indexes/aggregate|None|`(period,voter)` or `(period,target)`|Policy-defined order + cursor ≤L|O(log N + L), bounded|**UNKNOWN** whether detailed history can be public; no global scan|
|Finalize governance period/apply hold|Period/outcome, bounded aggregate and target Account|Outcome, Account hold/compensation state, Payment work/obligation if approved, audit|Direct period/target; process one decision or ≤L continuation targets|Canonical target ID order, cursor for multi-target scope|O(1) or O(L), bounded|No materialized vote scan; aggregate must be maintained at submission|
|Set policy/config or oracle value|Treasury singleton/version, authorization|Policy version/singleton, audit|Singleton/version key; one change|None|O(1), bounded|Certified public policy summary is projection/output, not ZenDB|
|Refresh global/market input|Policy-approved oracle slot / worker attestation|Versioned oracle value, audit|Direct key; one normalized input|None|O(1), bounded|No collection scan; raw external response off-chain|
|Create allocation/payment obligation|Account entitlement, active policy, Reserve, allocation idempotency, obligation key|Canonical obligation, `payment_obligations`, reserve/accounting, audit, executor work|Direct `(period,account,asset)` and reserve keys; one obligation|None|O(1), bounded|Payment history projection written synchronously|
|Read payment history|`payment_obligations`; canonical status if needed|None|`(accountId, createdAt DESC, obligationId)`|Newest first cursor ≤L|O(log N + L), bounded|No scan|
|Claim/execute/reconcile payments|Canonical obligation status/network queue, Reserve; receipt lookup|Canonical status/attempt, `payment_obligations`, audit|`(status,network,updatedAt,obligationId)`; ≤L work items; receipt unique key|Oldest eligible first, resume cursor|O(L × bounded transition), bounded; external calls are one-at-a-time with persisted intent|No scan; **flag** any “recover all pending” implementation without cursor/limit|
|Run expiry/compensation/cleanup batch|Due Work index or state-specific due index|Affected Account/Work/Obligation/audit|`(dueAt,id)` or work queue; ≤L|Due time then ID, opaque continuation|O(L), bounded|No full Account scan; legacy disconnected-account cleanup is replaced|
|Inspect operational/private logs|Off-chain private log store|Off-chain only|Worker/job/time index, ≤L|Time-desc cursor|O(log N + L), bounded|**Unbounded scan prohibited**; no core raw log collection|
|Import legacy data|Migration receipt `(snapshot, source table, row key)`, target uniqueness keys|Target stable/doc state, receipt, audit, migration cursor|≤L source rows; each row idempotent|Source-key cursor, deterministic order|O(L × bounded row transform), bounded|No source table scans in core; importer supplies cursor batches|
|Rebuild derived projections|Canonical Account/assessment/obligation state in partitioned/cursor scope|Specified ZenDB collection|Partition/cursor and ≤L keys|Stable primary-key order|O(L), bounded per invocation|**Flag:** full rebuild is globally unbounded; only resumable governed batches allowed|

## Explicitly prohibited unbounded operations

- Scanning every account to find stale sessions, disconnected users, eligibility, holds, compensation, or payments.
- Scanning all votes to calculate an outcome; maintain per-period/target aggregates at write time.
- Scanning all tasks, raw AI logs/results, source URLs, or transaction records in the core.
- Rebuilding a collection in one call. Rebuild by stable key-range cursor and retain the prior projection until the new version is complete.
- General “filter any field” log/profile APIs. Each supported filter must have a declared index and fixed page size.
