# PostgreSQL/Prisma to ICP schema mapping

Status: complete source inventory and G1-level proposed disposition; concrete Motoko/ZenDB collection schemas, mutation-recovery protocols, indexes, and measured limits require G2 approval.

## Completeness boundary

The source schema contains 21 Prisma models and 18 SQL migrations. Migration `20260711000000_compact_ai_results` also creates physical table `ai_result_migration_exceptions`, which is absent from Prisma. The migration therefore covers 22 physical tables. All are mapped below.

There are 17 explicit `prisma.$transaction` call sites. Every transaction is mapped in “Transaction mapping.” Non-transactional legacy sequences that affect money, task claims, AI result replacement, voting, KYC, and cleanup are listed as hazards rather than being treated as target semantics.

## Canonical type transformation

| PostgreSQL/Prisma source | Canonical export | Motoko target | Rule |
| --- | --- | --- | --- |
| `SERIAL` / `Int` ID or FK | tagged signed decimal string | `Nat64` | Reject negative; preserve exact source value as the public `legacyId`; new IDs start above imported max and never reuse |
| `String` | exact PostgreSQL UTF-8 code points, JSON-escaped canonically | bounded `Text` or parsed typed value | Preserve source text without Unicode normalization; apply a normalized derivative only to an explicit index key; never silently trim/lowercase source |
| nullable field | JSON `null` | `?T` | Unique indexes omit null, matching PostgreSQL multiple-null semantics |
| `Boolean` | JSON boolean | `Bool` | Exact |
| `TIMESTAMP(3)` without timezone | tagged RFC3339 UTC with exactly milliseconds plus source textual form | `Int64` Unix nanoseconds/milliseconds (index) plus preserved source value where timezone assumption is disputed | Export session sets UTC and records server/database timezone; ambiguous interpretation blocks G2 |
| `Decimal(65,30)` | tagged normalized sign/coefficient/scale decimal, never JS number | historical `DecimalValue { coefficient : Int; scale : Nat8 }`; token amounts additionally transform to integer base units `Nat` | Conversion to base units must be exact for `tokenDecimals`; excess precision is an exception, never rounded silently |
| `Float`/double precision | tagged 8-byte IEEE-754 big-endian hex plus diagnostic decimal | preserved `Float64Bits`; deterministic future calculations use an approved fixed-point/rational derivative | NaN/Infinity and conversion loss become explicit exceptions |
| `Json`/JSONB | recursively typed canonical JSON with sorted keys and tagged numeric scalars | typed application result if valid; original canonical bytes/hash in archive | No `JSON.stringify`/parse through JS `number` for arbitrary numeric data |
| CUID/token/hash | tagged source text/blob | `Text` or fixed `Blob` | Credential tokens are already digests after the security migration; active legacy credentials are not accepted on ICP |
| chain address | source text plus chain/network | typed `{ chain; network; canonical; display }` | Chain-specific parser. EVM bytes are canonical; Base58/case-sensitive formats are never lowercased |
| status/type string | exact source text | closed Motoko variant plus `#LegacyUnknown(Text)` during migration | Unknown values block activation but remain historically preserved |

Canonical encoding details are in `MIGRATION_RUNBOOK.md`.

## Target stores

- `core/ZenDB`: versioned identity/role/profile/KYC/hold collections with explicit unique/sorted indexes and Motoko-authenticated mutation/recovery sagas in `core_canister`.
- `workflow/ZenDB`: task/DAG/result/lease collections with Motoko claim/idempotency mutation sagas in `workflow_canister`.
- `treasury/ZenDB`: append-only accounting, payment obligations/operations/attempts, and replay/finality collections with Motoko operation/reconciliation protocol in the unified treasury.
- `evidence/ZenDB`: encrypted PII evidence plus Motoko access/hash indexes; no public document query.
- `archive/ZenDB`: versioned, replaceable document collections for large AI/audit/raw legacy payloads.
- `historical-only`: imported for audit/reconciliation but never accepted as a live credential or secret.

ZenDB is the proposed PostgreSQL/Prisma destination, including the collections above. M1 must prove each collection's mutation/recovery behavior under remote-call interruption, duplicate delivery, upgrades, and low cycles. Application code—not ZenDB constraints, indexes, or UI behavior—authenticates callers and enforces authorization, referential integrity, uniqueness, money, and replay rules. Independently, each ZenDB collection grants minimum read/write capability only to its owning application canister, grants administration only to approved governance/SNS, denies browsers/users/import operators/unrelated canisters, and has bootstrap/deployer roles revoked before authority. If the pinned API has only instance-wide roles, separate ZenDB deployments enforce distinct collection grant boundaries. A failed mutation or RBAC proof requires a G2-approved, collection-specific native-Motoko exception.

Each document carries a unique indexed application logical ID, version, and content hash. That key, not a ZenDB-generated internal document ID, is the stable source/migration/idempotency identity unless the exact G2-pinned API proves caller-supplied IDs. The canonical audit map records `source ID -> application logical ID` and may record an observed ZenDB document ID only as non-authoritative storage metadata. An unknown insert/update is looked up by logical ID: the desired version/hash means acknowledged success; an absent insert or unchanged expected prior version/hash permits retry of the identical insert/CAS; any other version/hash is a blocking conflict.

## Per-model field mapping

### `User` → `core.User`, `core.IdentityEvidence`, `core.PayoutDestination`, `core.KycAttestation`

| Source fields | Target disposition |
| --- | --- |
| `id` | `User.id : Nat64`, exact stable source ID |
| `email`, `emailVerified` | Legacy mirror retained in `User.legacyPrimaryEmail`; authoritative rows come from `UserEmail`. Conflicts are reported; future core has no duplicate mirror |
| `votingPleaUnsubscribed` | `User.notificationPreferences.votingPleaUnsubscribed` |
| `name`, `onboarded`, `createdAt`, `updatedAt` | Bounded profile fields and timestamps |
| `ethereumAddress` | Split into historical `IdentityEvidence(#Ethereum, legacy)` and `PayoutDestination`; neither is treated as verified after import without proof. EVM canonical uniqueness checked case-insensitively/by bytes |
| `solanaAddress`, `bitcoinAddress`, `bitcoinCashAddress`, `polkadotAddress`, `cosmosAddress`, `stellarAddress`, `icpAddress` | One versioned `PayoutDestination` per chain/network, source text preserved, chain parser result and proof state explicit. Duplicate destinations are reported, not silently merged |
| `orcidId`, `githubHandle`, `bitbucketHandle`, `gitlabHandle` | Historical identity-evidence records. Handles are display values; re-verification must add immutable provider subject ID before granting identity assurance |
| `bannedTill`, `evaluationBlockedTill`, `evaluationBlockReason`, `paymentHoldStartedAt`, `compensationDueAt` | Typed `Hold`/`CompensationEligibility` records with cause, epoch, timestamps, source ID, and immutable audit event |
| `lastPaymentAmount` | Preserve legacy decimal exactly as non-authoritative historical field; no asset identity exists, so it cannot seed a balance |
| `shareInGDP` | Preserve source IEEE bits and a separately validated deterministic fixed-point share used by the new calculation |
| `isDeleted`, `deletedAt` | Tombstone/redaction state. Historical financial/evaluation/ban references remain |
| `kycStatus`, `kycVerifiedAt`, `kycRejectedAt`, `kycRejectionReason`, `kycData` | Typed KYC state plus encrypted evidence blob/hash. Unknown string states preserved as legacy exceptions. AML/sanctions rejection has precedence in future transitions |
| `livelinessStatus`, `livelinessVerifiedAt`, `livelinessDueAt`, `livelinessRequestedAt` | Versioned liveliness attestation/state |
| `kycVotingStatus`, `kycVotingVerifiedAt`, `kycVotingRejectedAt`, `kycVotingRejectionReason`, `kycVotingData` | Separate Level-1/voting attestation and encrypted evidence |
| `issuingState`, `personalNumber`, `residenceCountry` | Encrypted identity attributes; uniqueness uses a keyed/canonical fingerprint only when both source fields are non-null; public queries never expose them |

### Identity/authentication models

| Source model | Fields and target | Live behavior |
| --- | --- | --- |
| `UserEmail` | `id`, `userId`, normalized-and-source `email`, `verified`, `createdAt`, `updatedAt` → `core.EmailEvidence` | Exact source ID; unique non-null normalized email; relation to existing user; future verification creates immutable event and invalidates sibling credentials |
| `Session` | `id`, `userId`, source-side one-way token evidence digest, expiry/timestamps → restricted historical auth-event collection | Historical only. The source bearer value is never exported or CDC-published; all sessions are rejected. Live authority is an Internet Identity or OAuth-recovered non-anonymous caller-principal binding, never a callback, code, or token |
| `EthereumAuthChallenge` | `id`, address, exact message, expiry, `usedAt`, creation → historical challenge record | Historical only/expired at cutover. New proof challenges are caller-bound, random, single-use, domain/chain/action scoped |
| `EmailVerificationToken` | approved non-secret fields plus source-side one-way token evidence digest; relation to user | Historical only and invalid on ICP. The raw verification value is never exported or CDC-published. New challenge state is a ZenDB document guarded by a Motoko hashed, expiring, acknowledged single-use compare-and-set/saga |
| `KycToken` | approved non-secret fields plus source-side one-way token evidence digest; relation to user | Historical only and invalid on ICP. The raw verification value is never exported or CDC-published. New invitation is a ZenDB document guarded by a Motoko scoped, expiring, acknowledged single-use compare-and-set/saga |

### Voting model

| Source model | Field mapping | Target correction |
| --- | --- | --- |
| `BanVote` | `id`, `voterUserId`, `targetUserId`, `message`, `type`, `weekStartDate`, `createdAt` → `core.BanVote` | `type` becomes `#Ban/#Unban/#LegacyUnknown`; deterministic UTC epoch is stored; self-vote and eligibility policy explicit. Imported unique key is preserved exactly |

### Workflow models

| Source model | Field mapping and storage | Target invariants |
| --- | --- | --- |
| `Batches` | `id`, `createdAt`, `taskId` → `workflow/ZenDB.ProviderBatch` | Existing task required; task index explicit |
| `BatchMapping` | `id`, `customId`, `batchId`, `response`, `createdAt` → ZenDB provider-item metadata; large/raw response canonical bytes/hash → `archive/ZenDB ai_artifact_v1` | `customId` unique; response state versioned; archive failure does not change task result |
| `NonBatches` | `id`, `createdAt`, `taskId` → `workflow/ZenDB.ProviderRequestGroup` | Existing task required |
| `NonBatchMapping` | `id`, `customId`, `response`, `nonBatchId`, `createdAt` → ZenDB provider-item metadata plus archive payload | Same invariants as batch mapping |
| `Task` | every field `id,status,runnerClassName,runnerData,createdAt,updatedAt,completedAt,storeId,lockTime,isNeverDeleted,isDeleted` → typed `workflow/ZenDB.Task` | `runnerClassName` maps to closed task-kind variant; `runnerData` is parsed into typed ownership/input plus preserved canonical legacy bytes/hash; lock becomes epoch/owner/lease; terminal history tombstoned, not hard-deleted |
| `AiResult` | every field → `workflow/ZenDB.AiResult`; original JSON canonical bytes/hash archived | Unique `customId`; closed kind/status; canonical validated result is authoritative after the workflow mutation-saga proof; task relation optional with explicit tombstone reason |
| `AiResultSource` | every field → ordered ZenDB source references | Both `(result,ordinal)` and `(result,url)` unique; URL scheme/size validation; cascade becomes tombstone retention |
| `TaskDependency` | every field → ZenDB DAG edge | Unique edge; both tasks must exist; reject self-edge and cycles for new data; legacy self/cycle becomes explicit exception and remains viewable |
| `OpenAILog` | `id,userId,taskId,customId,storeId,runnerClassName,requestInitiated,responseReceived,errorMessage,createdAt,updatedAt` → ZenDB log metadata; `requestData,responseData` → hash-addressed `archive/ZenDB ai_artifact_v1` | Exact owner index; no textual JSON owner search; redaction classification; missing/nulled historical responses represented explicitly |

### Global and financial models

| Source model | Field mapping and storage | Target invariants |
| --- | --- | --- |
| `Global` | all fields → `core.GlobalConfig` and versioned `SalaryStatsSnapshot` | Import requires exactly one selected row and reports extras; singleton enforced. Floats preserved as bits plus deterministic fixed-point derivatives. Distribution pause fails closed |
| `GasTokenDistribution` | all fields → immutable `treasury.LegacyDistributionEvent`, plus separately derived `Obligation` only after reconciliation | Token identity is `(chain,network,asset standard,address/ledger,decimals)`, amounts exact base units, status closed variant, tx hash typed, distribution cycle ID deterministic. No user deletion cascade |
| `GasTokenReserve` | all fields → immutable legacy reserve snapshot, not an opening balance by itself | Target reserve derives from journal entries; source unique token key is preserved and cross-checked against address matching behavior |
| `PendingTransaction` | all fields → immutable `treasury.LegacyPaymentAttempt`; a reviewed subset may link to target operations but is never automatically re-sent | Preserve source hash even though it was nondeterministic; parse `transactionData` without floating conversion; reconcile external hash/chain state/status/distribution before classification |
| `SystemSecret` | `id,name,createdAt,updatedAt` and a one-way fingerprint recorded in a sealed migration-secret disposition report | `value` is never placed in canonical general export or canister data. Each secret is rotate/retire/transfer-manually dispositioned; missing-key auto-generation is forbidden |

### Unmanaged physical table

`ai_result_migration_exceptions(customId, sourceTable, sourceRowId, resultKind, responseData, reason, createdAt)` is exported explicitly and imported into a ZenDB migration-evidence collection plus encrypted/restricted payload collection as appropriate. Primary key `(customId,sourceTable)` is preserved. It participates in count/hash reports even though Prisma cannot query it.

The 2026-07-11 migration selected `DISTINCT ON(customId)` without a complete deterministic tie-break between equal-priority batch/non-batch candidates and later nulled successful legacy responses. The exporter produces a conflict/missing-evidence report; it does not invent the discarded content.

## Relation mapping

| Source relation | Source delete behavior | ICP representation |
| --- | --- | --- |
| User 1—N UserEmail | cascade | ZenDB FK/index guarded by Motoko relation checks; user tombstone retains/redacts evidence according to policy |
| User 1—N Session | cascade | Historical auth events retained; no live session relation |
| User 1—N EmailVerificationToken/KycToken | cascade | Historical credential metadata retained/inactivated |
| User 1—N BanVote as voter/target | cascade | Both FKs required; votes retained after user tombstone with redacted public identity |
| User 1—N GasTokenDistribution/PendingTransaction | cascade | Forbidden cascade; immutable financial references retain stable user ID |
| User 1—N OpenAILog | database `SET NULL` | Preserve optional source user ID plus deletion/redaction state; no loss of historical link in restricted audit |
| Task 1—N Batches/NonBatches | cascade | Required ZenDB FK guarded by Motoko relation checks; task tombstone retains provider history |
| Batch/NonBatch 1—N mapping | cascade | Required ZenDB FK/index guarded by Motoko relation checks; tombstone retention |
| Task 1—N AiResult | `SET NULL` | Optional typed task reference; source null preserved |
| Task 1—N OpenAILog | database `SET NULL` | Optional exact task reference; restricted historical source ID retained |
| Task N—N Task through TaskDependency | cascade both sides | ZenDB DAG adjacency indexes in both directions, guarded by Motoko cycle/orphan checks |
| AiResult 1—N AiResultSource | cascade | ZenDB ordered set guarded by Motoko mutation protocol; result tombstone retains sources |

All imported relations are validated after table load and before migration finalization. A dangling source FK is preserved in an exception record and blocks activation; it is never silently dropped.

## Constraint and index mapping

Every source index is preserved as an access requirement, corrected when the source did not enforce its comment/intent.

| Model | Source unique/primary constraints | Source non-unique indexes | Proposed target index/constraint |
| --- | --- | --- | --- |
| User | PK `id`; nullable unique email, Ethereum, ORCID, GitHub, Bitbucket, GitLab; unique `(issuingState,personalNumber)` | onboarded; `(onboarded,share desc)`; share; evaluation block; payment hold; compensation due; KYC status; liveliness due; Cosmos address; ICP address | Primary by ID; separate unique identity/evidence indexes omitting null; encrypted KYC fingerprint; typed payout index; leaderboard `(eligible,share,id)`; each due/hold/status cursor. Legacy uniqueness collisions under canonical normalization block activation |
| UserEmail | PK; unique email | user; `(user,verified)` | Same, using normalized email plus source-text preservation and null semantics |
| BanVote | PK; unique `(voter,target,week)` | `(target,week)` | Same imported key plus reverse `(voter,epoch,id)`; vote type does not permit second vote in same epoch unless policy explicitly versions key |
| Session | PK; unique token | user; expiry | Historical primary/token fingerprint/user/expiry indexes; no live authentication |
| EthereumAuthChallenge | PK | address; expiry | Historical; future primary/caller/action/expiry and single-use receipt |
| Batches | PK | none | primary; task index added |
| BatchMapping | PK; unique customId | none | primary; custom ID; batch index added |
| NonBatches | PK | none | primary; task index added |
| NonBatchMapping | PK; unique customId | none | primary; custom ID; group index added |
| Task | PK | status; runner; completed; lock; deleted | primary; `(status,nextAttempt,id)` queue; exact owner; kind; lease expiry; completion; deletion; store ID as required by observed queries |
| AiResult | PK; unique customId | task; kind | primary/custom/task/kind/status; exact source indexes |
| AiResultSource | PK; unique `(result,ordinal)` and `(result,url)` | none | Same two unique indexes |
| TaskDependency | PK; unique `(task,dependency)` | none | Same plus reverse dependency index; DAG validation |
| OpenAILog | PK; unique customId | user; task; runner; created; store | ZenDB metadata indexes match all; global pagination `(created,id)`; composite payload indexes only for bounded document queries |
| Global | PK only | none | One fixed config key; versioned snapshot sequence; reject extra active singleton |
| GasTokenDistribution | PK; unique `(user,network,symbol,exact timestamp)` | user; network; status; date; `(network,symbol)` | Preserve legacy unique key in history; target obligation unique `(cycle,user,scope,asset)` and indexes by user/asset/status/cycle. Do not claim per-day uniqueness from timestamp |
| GasTokenReserve | PK; unique `(network,symbol,type)` | none | Preserve source key; target balance/reserve by canonical asset ID and journal sequence |
| EmailVerificationToken | PK; unique token | user; expiry; used | Historical; future unique digest/user/expiry/state |
| KycToken | PK; unique token | user; expiry; used | Historical; future unique digest/user/expiry/state |
| SystemSecret | PK; unique name | none | Disposition metadata by source ID/name/fingerprint only; secret absent |
| PendingTransaction | PK; unique transactionHash | status; network; user; created; `(status,network)` | Preserve legacy indexes; target unique stable operation ID and attempt ID, chain nonce/UTXO indexes, status/next action, user/asset, external tx hash |
| AI migration exceptions | PK `(customId,sourceTable)` | none | Same unique evidence key plus source row/reason index |

ZenDB indexes are never relied on to enforce a cross-collection FK or financial uniqueness. Motoko application checks and durable mutation/reconciliation sagas enforce primary/unique rules around the ZenDB write.

## Transaction mapping

| # | Legacy transaction | Target execution boundary |
| --- | --- | --- |
| 1 | Profile email/address update, UserEmail create, User update, primary sync | Caller-authorized core saga stages the versioned identity/destination records and activates one manifest/version only after all logical-ID/hash acknowledgements |
| 2 | User soft delete, email/session removal, anonymization | Core saga stages a tombstone/redaction event and activates it after acknowledgement; historical references remain |
| 3 | Add email to authenticated user, update name, primary sync | Caller-authorized core saga validates uniqueness, stages both records, and acknowledges one active version |
| 4 | Create email user/UserEmail and primary sync | II principal starts an idempotent core creation saga; the user becomes active only after the user/email records are hash-confirmed, and email proof remains a later idempotent event |
| 5 | Disconnect KYC/email/provider and possibly delete account | Core policy-transition saga activates only after its tombstones/versioned records are acknowledged; anti-evasion/financial retention invariant cannot be erased by disconnect |
| 6 | Consume email token, verify email, sync mirror | Core saga uses a version/epoch compare-and-set, stages consumption plus verification, and activates only after acknowledgement; all related active challenges are invalidated idempotently |
| 7 | Direct payment: blocked outcome replaces backlog/history | No direct-send path. Treasury stages an immutable held-obligation transition and exposes it only after logical-ID/hash acknowledgement |
| 8 | Direct payment: missing KYC processes backlog and creates failure | `INTENTIONALLY_CHANGED`: obligation remains held, never silently forfeited; policy decision recorded |
| 9 | Direct payment: estimation defer replaces backlog/history | Immutable obligation plus defer event; no destructive replacement |
| 10 | Direct payment: send success accounting | Removed. Unified treasury prepares journal/receipt first, signs or submits, reconciles, then appends confirmation; history never overwritten |
| 11 | Direct payment: send failure accounting | Append attempt failure/ambiguity; obligation remains exact |
| 12 | Two-stage blocked outcome | Same held-obligation transition as #7 |
| 13 | Two-stage missing KYC | Same changed behavior as #8 |
| 14 | Two-stage estimation defer | Same as #9 |
| 15 | Two-stage prepared pending + distribution row | One unified-treasury mutation saga stages the obligation snapshot, operation, and prepared journal entry, then activates the set after all acknowledgements; no signing call occurs yet |
| 16 | Two-stage preparation failure | Append failure, no executable orphan operation |
| 17 | Compensation marks failed/deferred processed and creates pending | One per-user/per-asset compensation operation. Due flag clears only after confirmed/reconciled terminal result; unrelated assets cannot match |

Every ZenDB-backed row above uses the same boundary: the application first persists a durable intent with collection, logical ID, desired hash, expected prior version/hash for CAS, operation/attempt ID, and phase; the remote write uses that immutable key; the callback reloads state and confirms the key/version/hash before activation. Unknown results are reconciled before retry without overwriting a concurrent result. Multi-record transitions use pending versions plus a manifest/visibility pointer, or one bounded ZenDB-side atomic method proven against the exact G2 pin. Cross-canister stages use durable outbox/inbox IDs and never assume atomicity across `await`; duplicate callbacks are idempotent and conflicting hashes fail closed.

## Non-transactional legacy sequences requiring explicit correction

- Payment creation, external send, pending completion, and distribution completion can disagree; ambiguous attempts must be chain-reconciled before classification.
- Reserve read/modify/write is not CAS and runtime display can double-count it; source reserve rows do not seed target balances without financial reconciliation.
- Evaluation graph creation can leave a partial DAG; target creates a graph manifest and bounded idempotent nodes/edges before activation.
- TaskManager can claim the same task concurrently; target uses one acknowledged, pinned ZenDB-side compare-and-set for lease epoch/owner.
- AI result upsert, source replacement, and legacy raw cleanup can be partial; target stages a result version, confirms every logical-ID/hash write, then switches one manifest/visibility pointer active through a separately acknowledged write.
- Ban vote, hold, tally, user ban/unban, task cancellation, and notification are separate; target activates the vote/hold only after its logical-ID/hash acknowledgement and drives idempotent derived actions.
- KYC token consumption can precede provider session creation; target reserves a credential, creates provider session, and finalizes/returns safely via a saga.
- KYC webhooks lack durable event IDs/order; target stores provider event receipt before state application.
- Bulk disconnected cleanup can delete emails before user update; target stages bounded user tombstones and activates their manifest only after acknowledgement.

## Query and pagination mapping

| Legacy query class | Target |
| --- | --- |
| Public users, leaderboard, salary stats | Certified/sanitized materialized indexes; stable cursor; no fixed first-500 truncation |
| Exact self profile/GDP share/history/logs | Principal→user lookup then exact typed owner index; caller-supplied IDs do not authorize |
| Ban candidates/votes/assessments | Explicit evaluated-user and task-owner indexes; deterministic epoch; no substring search or first-200 cap |
| Task queue/dependencies/dependents | Queue and two-way adjacency indexes; bounded cursor/lease |
| Logs merged from models | New append-only audit sequence gives one global `(time,sequence)` cursor; source-specific legacy views preserved |
| Eligible user/payment scans | Persistent eligibility index and bounded cursor checkpoint per cycle/scope/asset |
| Due compensation/liveliness/cleanup | `(dueTime,id)` indexes and idempotent bounded jobs |
| Token/network/reserve status | Canonical asset registry plus certified snapshots; chain balances carry observed height/finality/time |
| ZenDB AI/audit search | Fully covered composite/text index selected in schema; cursor pagination; reject unsupported/unbounded query |

## Cardinality and limits

Current counts are unknown. Repository-derived growth is unbounded for credentials, votes (`O(users² × weeks)` worst case), task/AI history, distributions, and pending rows. Initial task construction produces 14 tasks for first onboarding, 6 for subsequent onboarding, and 5 for quarterly reevaluation. The tested envelopes/shard thresholds are in `ARCHITECTURE.md` and must be replaced/validated using the read-only inventory before G2.

Required inventory per physical table: row and index bytes/counts; min/max IDs/timestamps; max/percentile text/JSON sizes; null/distinct counts; normalized identity/address duplicates; FK orphans; status histograms; sequence state; exact decimal scale/range/sums; extra Global rows; AI-source conflicts; financial cross-table reconciliation; primary/replica identity and update/delete key; direct-CDC versus redacted-projection membership; and publication/output-plugin compatibility. Secret, bearer, and raw-token values are reported only by approved source identifier/fingerprint/digest.

## Migration acceptance for the schema

- Source and destination count/hash match for all 22 tables.
- Every imported ID/field has a canonical representation or explicit signed exception.
- Every FK, unique key, normalized unique key, closed status, DAG, and index-consistency scan passes.
- PostgreSQL null-unique semantics and timestamp interpretation are tested with golden vectors.
- Token decimal conversion is exact; source decimals and float bits remain available for historical proof.
- Historical cascades are not reproduced as deletion; tombstones preserve required links.
- No session/token becomes active, no system-secret value is imported, and no legacy pending row can trigger a transfer.
- The base export uses the logical slot's exported snapshot; deltas are complete, contiguous source transactions from that slot's consistent point through the final barrier LSN. A direct CDC stream or redacted outbox never contains a secret, bearer, or raw verification value.
