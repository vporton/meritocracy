# Current invariants

Facts are **confirmed** only where source code or committed migration states them. Text statuses are not PostgreSQL enums or CHECK constraints.

|Invariant|Statement / enforcement|Source|If violated|Confidence|
|---|---|---|---|---|
|Identity uniqueness|`users.email`, Ethereum address, ORCID and three SCM handles are individually unique; issuing-state/personal-number is unique as a pair. `user_emails.email` is globally unique.|`schema.prisma:User,UserEmail`; migrations|Identity can be linked to two people or legitimate records rejected.|confirmed|
|Session validity|Bearer token must match `sessions.token`, be unexpired, and user must not be soft deleted. JWT signature is not verified on reads; the DB token is the operative credential.|`middleware/auth.ts:getCurrentUserFromToken`|Expired/deleted identities could act if bypassed; DB compromise exposes credentials.|confirmed|
|Email verification|A verified email is a `user_emails` record (or legacy verified primary email). Verification tokens are unique and have `used`/expiry state; actual consume semantics are in EmailService.|`auth.ts:register/email,verify/email`; schema|Evaluation eligibility can be wrongly granted/denied.|confirmed (state), uncertain (atomic consume)|
|Self-service ownership|Update/delete user and user-log lookup require authenticated ID equal to path ID.|`users.ts` PUT/DELETE; `logs.ts` GET `/user/:userId`|Cross-account profile/log changes/read.|confirmed|
|Evaluation eligibility|Onboarding requires auth, Ethereum address, verified email, and production social identity; must not be onboarded or within retry block.|`evaluation.ts:/start`; `auth.ts:requireAdditionalConnections`|Repeated or insufficiently identified evaluation.|confirmed|
|Ban vote uniqueness|At most one vote per voter/target/week (DB unique). API prohibits self vote and accepts only BAN/UNBAN when supplied.|`ban_votes` migration; `banVoting.ts:/vote`|Duplicate weekly vote/counter distortion.|confirmed|
|Ban/payment state|Ban assessment applies/revokes payment holds and sets compensation due on unban; exact thresholds and state transitions are service-only strings.|`BanVotingService.ts`; `CronService.ts:runCompensationPayouts`|Payments during review or omitted compensation.|inferred for business rule; confirmed for fields|
|Task dependency|A task/dependency pair is unique; task execution selects completed dependencies before runnable work. No DB acyclicity constraint exists.|`TaskManager.ts`; `task_dependencies` schema|Cycles or invalid status strings can stall work.|confirmed|
|Pending transfer idempotency|Deterministic `transactionHash` is unique; conditional `updateMany` transitions PENDING/FAILED→EXECUTING, preventing two workers from claiming a row.|`PendingTransactionService.ts:createPendingTransaction,markAsExecuting`|Duplicate on-chain transfer or stuck transfer.|confirmed|
|Transfer lifecycle|Pending transfers use PENDING, EXECUTING, COMPLETED, FAILED; stale EXECUTING can be reset. Distribution records use PENDING/SENT/DEFERRED/FAILED/PROCESSED in code, without DB check.|`PendingTransactionService.ts`; `MultiNetworkGasTokenDistributionService.ts`|Invalid state accepted by PostgreSQL; reconciliation ambiguity.|confirmed|
|Distribution duplicate guard|Unique tuple includes exact timestamp, not calendar date; code comment says “per day,” so DB does not enforce per-day uniqueness.|`schema.prisma:GasTokenDistribution`|Multiple same-day distribution rows possible.|confirmed contradiction|
|Cleanup preservation|Cleanup intentionally does not delete banned or KYC accounts; self deletion is soft deletion preserving logs and removes sessions/emails.|`DisconnectedAccountCleanupService.ts`; `userDeletionUtils.ts:softDeleteUser`|Ban evasion or loss of legal/audit logs.|confirmed|
|Global singleton|Code calls `findFirst` for global data; schema permits zero or many global rows.|`GlobalDataService.ts`; `schema.sql`|Nondeterministic GDP/config selection.|confirmed inconsistency|
|Atomic groups|Email attachment/primary sync and self-deletion use Prisma interactive transactions. Many external transfer/AI operations cannot be atomic with DB writes.|`users.ts`; `auth.ts`; services|Partial state after external failure.|confirmed|
|Ordering|Leaderboard sorts GDP share descending; assessments default page=1/pageSize=3 (service ordering must be consulted); history applies JS `slice` after service ordering.|`users.ts`; `banVoting.ts`; `multi-network-gas.ts`|Unstable pagination where service has no deterministic order.|confirmed/uncertain|

## Dependencies and unresolved behavior

- PostgreSQL serial sequences, unique-index conflict semantics, `TIMESTAMP(3)` clock semantics, and Prisma transaction isolation are relied on. Isolation level is not configured: **UNKNOWN**.
- External provider identity verification is **UNKNOWN** for POST social login endpoints: those handlers accept an identifier and unused `accessToken` field; provider callback flow is separate (`auth.ts`).
- No schema-level non-negative monetary checks, status enums, ownership RLS, or balance conservation constraints exist.
