# ZenDB collection design

ZenDB documents are bounded read/history documents in `meritocracy_core`. Canonical stable maps enforce authorization, uniqueness, balances, and transitions before a document is written. All page limits and document caps are versioned policy constants; numerical caps are **UNKNOWN** until workload/cycle budgeting is approved.

## `public_profiles`

|Field|Design|
|---|---|
|Collection name|`public_profiles`|
|Document type|Consented public contributor profile / leaderboard projection|
|Primary key|`accountId`: principal-derived opaque account ID; generated at account claim|
|Fields|`accountId`, bounded `displayName`, consented public identifiers/addresses, `onboarded`, public eligibility flag, fixed-point `share`, `accountVersion`, `updatedAt`|
|Embedded data|None; each optional public identifier is length-validated and count-capped|
|References|Account ID, accepted assessment version|
|Indexes|Unique `accountId`; `(onboarded, share DESC, accountId ASC)`; `(share DESC, accountId ASC)`; optional normalized public handle only if policy approves|
|Unique constraints|One document/account, application-enforced from Account stable key|
|Validation|Consent required for each public field; no PII/KYC/email; fixed-point range; bounded strings/address format; document cap|
|Pagination|Opaque cursor over `(onboarded, share, accountId)` or `(share, accountId)`|
|Ordering|Leaderboard: `share DESC, accountId ASC`; profile list: `accountId ASC`|
|Cardinality|At most one per account; expected moderate, exact count **UNKNOWN**|
|Growth|Unbounded population; bounded document size and page operations|
|Authorization|Public read only for consented projection; Account owner requests changes; core projection writer writes|
|Retention|Remove/tombstone on consent withdrawal/deletion; Account/audit remains minimized|
|Migration source|`users` public-safe fields only, after claimant proof and consent renewal|
|Risks|Public replication and leader-board ranking; tie-breaker is required to avoid duplicate/omitted pages; final public-field policy **UNKNOWN**|

## `assessment_runs`

|Field|Design|
|---|---|
|Collection name|`assessment_runs`|
|Document type|Compact immutable assessment request/result summary|
|Primary key|Opaque `runId`, deterministic from account + request idempotency key, collision-checked|
|Fields|`runId`, `accountId`, `status`, request/result schema versions, policy version, fixed-point result/share summary, `evidenceCommitment`, opaque evidence URI, worker/result ID, requested/completed timestamps|
|Embedded data|Capped ordered source summaries `{ordinal, urlHash, titleHash?}` and capped machine-readable result summary; no raw response/prompt|
|References|Account, worker attestation, policy version, off-chain evidence object|
|Indexes|Unique `runId`; `(accountId, completedAt DESC, runId ASC)`; `(status, requestedAt, runId)`; `(resultSchemaVersion, completedAt, runId)`|
|Unique constraints|One accepted run per account/policy scope is enforced in Account stable state; source ordinal unique within document|
|Validation|Finite status graph, source/document byte/count caps, hashes/URI grammar, fixed-point values, worker/schema allow-list, immutable terminal fields|
|Pagination|Opaque cursor over account/completed/run ID or status/requested/run ID|
|Ordering|Account history `completedAt DESC, runId ASC`; work queue `requestedAt ASC, runId ASC`|
|Cardinality|Several per account; aggregate count potentially large; workload **UNKNOWN**|
|Growth|Unbounded history; compact documents only; raw evidence off-chain|
|Authorization|Caller sees own redacted history; governance/authorized worker sees role scope; public only policy-approved fields|
|Retention|Immutable summary retained for entitlement/audit; private evidence follows off-chain retention; exact periods **UNKNOWN**|
|Migration source|`ai_results`, `ai_result_sources`, and accepted `users` assessment fields; transform only validated compact accepted/proposed summaries|
|Risks|Unbounded source/result JSON and non-repeatable AI outputs; do not accept an off-chain result merely because it exists in this collection|

## `payment_obligations`

|Field|Design|
|---|---|
|Collection name|`payment_obligations`|
|Document type|Payment obligation and bounded settlement history projection|
|Primary key|Immutable `obligationId`, deterministic from distribution period + account + asset + policy version/idempotency key|
|Fields|`obligationId`, `accountId`, `periodId`, asset `{network,tokenId,decimals}`, integer `amount`, integer `backlogAmount`, destination commitment, policy version, memo/idempotency key, status, created/updated/settled times, receipt reference, error code|
|Embedded data|Capped ordered settlement attempts `{attemptNo, time, state, receiptRef?, errorCode?}`; never raw transaction data or recipient address unless policy makes it public|
|References|Canonical obligation stable key/state, Account, Reserve, policy, ledger block/executor receipt|
|Indexes|Unique `obligationId`; unique `(periodId, accountId, assetKey)`; unique memo/idempotency; `(accountId, createdAt DESC, obligationId)`; `(status, network, updatedAt, obligationId)`; external receipt/hash unique when non-null|
|Unique constraints|Canonical stable state enforces one obligation per allocation key and unique receipt/memo; ZenDB mirrors it|
|Validation|Integer amount/backlog >= 0; asset/network allow-list; destination commitment grammar; bounded attempts; finite transition and expected state version; `settled` requires valid receipt reference|
|Pagination|Opaque cursors for `(accountId, createdAt DESC, obligationId)` and `(status, network, updatedAt, obligationId)`|
|Ordering|Account history newest-first; executor queue oldest eligible first; stable `obligationId` tie-breaker|
|Cardinality|Potentially one or more per account/period/asset; total unbounded|
|Growth|Unbounded history, bounded document/attempt data; archive/export only after financial policy permits|
|Authorization|Account reads its history; governance/reconciliation role reads scope; executor may submit receipt only for assigned instruction; public receives certified aggregates, not private details|
|Retention|Financial/audit record retained indefinitely unless a governed/legal retention policy says otherwise; no hard delete|
|Migration source|`gas_token_distributions` and `pending_transactions`, reconciled against chain/ledger first|
|Risks|Duplicate external send after await/retry, reorg/finality ambiguity, timestamp-based legacy duplicate guard; status is canonical stable state, not merely a document field|

## Deliberately not collections

|Data|Reason/location|
|---|---|
|Accounts, eligibility, policy, reserves, vote keys/aggregates, active obligation state|Direct stable state: these require atomic uniqueness, authorization and transitions.|
|Votes|Direct stable state with indexed key maps. A `public_vote_view` is **deferred** until anonymity/message-publication policy is approved.|
|Sessions, verification tokens, email/KYC, OAuth tokens, private keys, secrets|Protected off-chain services.|
|Tasks, batches, OpenAI logs/raw results, dependency DAGs|Off-chain worker database/object store; only compact core work descriptors and assessment summaries are retained.|
|Raw evidence, logs, exported analytics, full text search|Off-chain object/search/analytics stores; derived data has no write authority.|
|UI bundle, release artifacts|`meritocracy_assets` asset store.|
