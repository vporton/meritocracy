# Current use cases

This is a characterization, not intended behavior. “UNKNOWN” means a delegated service/provider was not fully determinable from the endpoint handler.

## Identity and profile

### Create or link an identity

- Actor: visitor or existing session holder. Preconditions: identifier/email not claimed by another identity under the relevant unique rule. Input: email/name, Ethereum signature triplet, or provider handle.
- Flow: find/create/link user; create a seven-day session. Email flow creates/attaches `user_emails`, sends a verification token; Ethereum verifies signature. Direct ORCID/GitHub/Bitbucket/GitLab endpoint requires only the named handle.
- Reads/writes: users, user_emails, sessions, email_verification_tokens; transactions for email synchronization. External calls: email delivery; OAuth callback exchanges call providers (details UNKNOWN).
- Failure: 400 missing/malformed email or claimed identity; 401 invalid Ethereum signature; provider/mail/DB 500. Postcondition: session credential may exist even before email verification.
- Sources/endpoints: `routes/auth.ts:findOrCreateUser,createSession,login/*,register/email`; `/api/auth/login/*`, `/api/auth/register/email`.

### Verify, maintain, or disconnect account data

- Actor: token holder (verify is token bearer, no session required). Input: verification token, profile patch, provider name.
- Flow: mark email verified; owner patch validates chain addresses and atomically adds unverified email/synchronizes legacy primary; disconnect removes a connection/KYC state and may soft-delete a disconnected account.
- Reads/writes: user, user_emails, email tokens, sessions. Transaction: profile update/disconnect groups use Prisma transaction. External calls: resend email.
- Failure: expired/missing session/token, duplicate email/address, invalid addresses, unsupported/unverified connection. Postcondition: only owner can profile-update/delete; self delete retains user/log row but removes email/session links.
- Sources/endpoints: `routes/users.ts`; `routes/auth.ts:verify/email,resend-verification,disconnect`; `services/userDeletionUtils.ts`; `/api/users/{id}`, `/api/auth/*`.

## Evaluation, voting, and payments

### Onboard and re-assess a contributor

- Actor: authenticated prospective contributor; administrator/cron for re-assessment. Preconditions: address + verified email + social provider (social waived in development), not onboarded, not retry-blocked.
- Flow: build task dependency graph, synchronously run pending tasks; runners query AI sources and persist task/log/result records. Re-assessment is triggered by cron/admin.
- Reads/writes: users, tasks, dependencies, batch/non-batch mappings, OpenAI logs, AI results/sources. Transaction boundary: graph creation/task writes have service-defined boundaries; external AI cannot be atomic.
- Failure: eligibility 403, already-onboarded 400, external AI/task failure 500. Postcondition: onboarding/evaluation statuses and GDP share may change via runners.
- Sources/endpoints: `routes/evaluation.ts`; `services/UserEvaluationFlow.ts`, `TaskManager.ts`, `runners/OpenAIRunners.ts`; `/api/evaluation/start`, admin/cron evaluation routes.

### Community ban/unban vote and payment hold

- Actor: authenticated user. Preconditions: non-self target; service-specific voter eligibility; one voter-target-week tuple. Input: target ID, message, optional BAN/UNBAN.
- Flow: create vote, calculate weekly assessment outcomes; service applies/revokes payment hold, potentially schedules compensation after unban.
- Reads/writes: ban_votes and target users. DB transaction boundary: **UNKNOWN** from route; uniqueness protects races. External: voting-plea email likely via EmailService (exact conditions UNKNOWN).
- Failure: 400 invalid/self, 403 service says not authorized, 409 duplicate. Postcondition: vote exists and potential ban/payment fields change.
- Sources/endpoints: `routes/banVoting.ts`; `services/BanVotingService.ts`; `/api/ban-voting`.

### Distribute gas tokens and recover pending transfers

- Actor: cron/admin; currently also anonymous caller. Preconditions: enabled network/secrets/recipient/eligible users and funds. Input: optional token/country/region override.
- Flow: determine network contexts and allocation, write distribution and deterministic pending transaction rows, claim transactions conditionally, call chain adapter, record SENT/FAILED and process backlog. Startup also attempts recovery.
- Reads/writes: global, users, gas reserves/distributions, pending_transactions, system_secrets. Transactions: DB state transitions are atomic individual operations; chain send is non-atomic. External calls: RPC/blockchain adapters, price service.
- Failure: provider/estimate/send failure results in deferred/failed records; HTTP caller gets 500. Postcondition: on-chain transfer may occur even if later DB update fails (reconciliation risk).
- Sources/endpoints: `MultiNetworkGasTokenDistributionService.ts`, `PendingTransactionService.ts`, adapters; `/api/multi-network-gas/run-distribution`, admin/cron routes.

## Operations and data

### Refresh public market/global data

- Actor: anonymous or scheduled service. Flow: fetch world GDP or CoinGecko quotes; upsert/update global data. Reads/writes global table; external HTTP calls. Failure: 404 absent data/500 fetch. Sources: `GlobalDataService.ts`, `TokenPriceService.ts`; `/api/global/*`.

### Inspect logs and clean disconnected accounts

- Actor: anyone for global logs; any session for cleanup. Flow: dynamically compose log filters, or compute/remove stale disconnected accounts while preserving banned/KYC accounts. Reads/writes all affected users/related rows. Cleanup execute is destructive and requires only `{confirmDeletion:true}` plus authentication.
- Sources/endpoints: `DBLogsService.ts`, `DisconnectedAccountCleanupService.ts`; `/api/logs/*`, `/api/cleanup/*`.

## Missing coverage

No route-level HTTP test harness exists. Existing tests exercise gas-service behavior only (`backend/tests/*.test.ts`); OAuth, KYC webhook signature, account cleanup authorization, public log disclosure, API serialization, and task/AI rollback are uncovered.
