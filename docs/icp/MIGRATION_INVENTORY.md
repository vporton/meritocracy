# ICP migration inventory

Status: Stage 0 migration contract baseline. The legacy Node/PostgreSQL system remains the production source of truth until Stage 8 cutover. Nothing in this inventory authorizes deleting legacy data.

## Classification rules

- **OC** — replicated canister state, using exact integer/fixed-scale values.
- **EA** — external attestation or controlled off-chain service; canisters retain only status, expiry, issuer and signed/hash references.
- **LH** — immutable/read-only legacy history, available to migration and audit reporting but not authoritative for new actions.
- **RT** — retired at ICP cutover. Secrets, raw PII and provider payloads are also forbidden in canister state.

Relations and database indexes inherit the classification of their referenced data and are not migrated as independent domain fields.

## Prisma persistence inventory

The canonical legacy schema is `backend/prisma/schema.prisma`.

| Model | Fields and classification | ICP target / rule |
|---|---|---|
| `User` | **OC:** `id`, `name`, `onboarded`, `createdAt`, `updatedAt`, `bannedTill`, `evaluationBlockedTill`, `evaluationBlockReason`, `paymentHoldStartedAt`, `compensationDueAt`, `isDeleted`, `deletedAt`. **EA:** `email`, `emailVerified`, `orcidId`, `githubHandle`, `bitbucketHandle`, `gitlabHandle`, `kycStatus`, `kycVerifiedAt`, `kycRejectedAt`, `kycRejectionReason`, `livelinessStatus`, `livelinessVerifiedAt`, `livelinessDueAt`, `livelinessRequestedAt`, `kycVotingStatus`, `kycVotingVerifiedAt`, `kycVotingRejectedAt`, `kycVotingRejectionReason`, `issuingState`, `residenceCountry`. **LH then RT columns:** `ethereumAddress`, `solanaAddress`, `bitcoinAddress`, `bitcoinCashAddress`, `polkadotAddress`, `cosmosAddress`, `stellarAddress`, `icpAddress`, `lastPaymentAmount`, `shareInGDP`, `votingPleaUnsubscribed`. **RT/forbidden:** `kycData`, `kycVotingData`, `personalNumber`. Relations: `emailVerificationTokens`, `emails`, `kycTokens`, `gasTokenDistributions`, `pendingTransactions`, `openaiLogs`, `sessions`, `banVotesCast`, `banVotesReceived`. | `registry.User`; addresses become separate `PayoutAccount`s and imported values are inactive `LegacyImported`. Monetary/share values become exact atoms/rationals in rounds/assessment. Raw identity and KYC data stay off chain. |
| `UserEmail` | **EA:** `id`, `userId`, `email`, `verified`, `createdAt`, `updatedAt`; relation `user`. | Verified email may survive only as an issuer/subject hash and status attestation. Raw email remains off chain. Email is not a v1 session issuer. |
| `BanVote` | **LH:** `id`, `voterUserId`, `targetUserId`, `message`, `type`, `weekStartDate`, `createdAt`; relations `voter`, `target`. | Audit-only historical import, with message redaction/hash policy. New ban/unban voting is retired at cutover. It is not a payout dispute and grants no `rounds` or `vault` authority. |
| `Session` | **OC replacement:** `userId`, `expiresAt`, `createdAt`; legacy `id`, `updatedAt` are **LH**. **RT/forbidden:** `token`; relation `user`. | `registry.Session` is keyed by authenticated browser principal with issuer, issued/expiry/revocation times. Raw session secrets are never stored or sent in Candid. |
| `EthereumAuthChallenge` | **OC ephemeral:** `id`, `address`, `message`, `expiresAt`, `usedAt`, `createdAt`. | Short-lived registry issuer state; deterministic signed payload binds session key, nonce, expiry, domain and action. |
| `Batches` | **LH:** `id`, `createdAt`, `taskId`; relations `batchMappings`, `task`. | Legacy assessment orchestration evidence. New work uses idempotent/versioned assessment requests. |
| `BatchMapping` | **LH:** `id`, `customId`, `batchId`, `createdAt`; **RT raw provider data:** `response`; relation `batch`. | Canonical normalized result/hash in `assessment`; raw response stays external. |
| `NonBatches` | **LH:** `id`, `createdAt`, `taskId`; relations `nonbatchMappings`, `task`. | Same replacement as `Batches`. |
| `NonBatchMapping` | **LH:** `id`, `customId`, `nonBatchId`, `createdAt`; **RT raw provider data:** `response`; relation `batch`. | Same replacement as `BatchMapping`. |
| `Task` | **OC replacement:** `id`, `status`, `createdAt`, `updatedAt`, `completedAt`, `lockTime`, `isNeverDeleted`, `isDeleted`; **EA/RT implementation data:** `runnerClassName`, `runnerData`, `storeId`; relations `Batches`, `NonBatches`, `openaiLogs`, `aiResults`, `dependents`, `dependencies`. | `assessment` retains deterministic request identity/state, version, idempotency and error class; provider orchestration remains external. |
| `AiResult` | **OC:** `id`, `customId`, `taskId`, `resultKind`, `status`, validated `result` or its hash, normalized `errorMessage` class, `requestInitiated`, `responseReceived`, `createdAt`, `updatedAt`; relations `task`, `sources`. | Versioned `assessment` result. Never persist a raw provider response. |
| `AiResultSource` | **OC:** `id`, `aiResultId`, `ordinal`; **EA:** allowed `url` reference/hash; relation `aiResult`. | Explicitly allow-listed source reference; gathered content remains untrusted. |
| `TaskDependency` | **OC replacement:** `id`, `taskId`, `dependencyId`; relations `dependency`, `task`. | Deterministic assessment dependency/idempotency graph if still required. |
| `OpenAILog` | **LH:** `id`, `userId`, `taskId`, `customId`, `runnerClassName`, timing fields, normalized `errorMessage`, `createdAt`, `updatedAt`; **RT/forbidden:** `storeId`, `requestData`, `responseData`; relations `user`, `task`. | `audit` stores only model/prompt versions, input/result hashes, status and error class. |
| `Global` | **EA:** `worldGdp`, `salaryStatsUserCount`, `salaryStatsTotal`, `salaryStatsAverage`, `salaryStatsMedian`, `salaryStatsCalculatedAt`; **OC governed config:** `gasDistributionEnabled`; **LH:** `id`, `createdAt`, `updatedAt`. | Signed/source-versioned snapshots; floats are converted to explicit rationals/fixed-scale integers. Distribution flag becomes governed pause/config, never arbitrary transfer authority. |
| `GasTokenDistribution` | **LH:** every field: `id`, `userId`, `network`, `amount`, `backlogAmount`, `amountUsd`, `distributionDate`, `status`, `transactionHash`, `errorMessage`, `tokenType`, `tokenSymbol`, `tokenAddress`, `tokenDecimals`, `createdAt`, `updatedAt`; relation `user`. | New ICRC payouts split into `rounds.Allocation`, `vault.Transfer` and audit receipt using exact atoms. Non-ICRC history remains read-only until a Stage 9 adapter. |
| `GasTokenReserve` | **LH:** every field: `id`, `network`, `totalReserve`, `lastDistribution`, `tokenType`, `tokenSymbol`, `tokenAddress`, `tokenDecimals`, `createdAt`, `updatedAt`. | Replaced by vault subaccounts, exact-atom reservations and ledger reconciliation. |
| `EmailVerificationToken` | **RT/forbidden:** every field: `id`, `token`, `email`, `userId`, `expiresAt`, `used`, `createdAt`, `updatedAt`; relation `user`. | Email registration/session issuance is retired at ICP cutover. Any later email attestation must use an external token service and requires an approved plan/interface change. |
| `KycToken` | **EA ephemeral/forbidden in stable state:** every field: `id`, `token`, `userId`, `expiresAt`, `used`, `createdAt`, `updatedAt`; relation `user`. | Controlled external verifier only; registry receives signed/hash attestation. |
| `SystemSecret` | **RT/forbidden:** every field: `id`, `name`, `value`, `createdAt`, `updatedAt`. | Secure external configuration only. No plaintext secret equivalent may exist in a canister. |
| `PendingTransaction` | **OC replacement:** `userId`, `network`, normalized `recipientAddress`, exact `amount`/`backlogAmount`, `tokenType`, `tokenSymbol`, `tokenDecimals`, `status`, `executionAttempts`, `lastExecutionAttempt`, receipt `executedTransactionHash`, normalized `errorMessage`, `createdAt`, `updatedAt`; **LH:** legacy `id`, `transactionHash`; **RT raw payload:** `transactionData`; relation `user`. | `vault.Transfer` uses allocation identity, asset, atoms, deterministic memo/`created_at_time`, state and ledger block index. Stage 9 raw signed/provider payload stays external. |

## Express endpoint inventory

Mounts are defined in `backend/src/index.ts`. Paths below include every route declaration under `backend/src/routes`.

| Legacy endpoint(s) | Classification | Target / retirement reason |
|---|---|---|
| `GET /api/users`, `GET /api/users/:id`, `GET /api/users/leaderboard` | OC query | `registry` public profile queries plus `audit` reporting index; redact private attestations. |
| `GET /api/users/salary-stats`, `GET /api/users/me/gdp-share` | EA/OC query | Attested statistics and `assessment`/`audit` projections using fixed-scale/rational values. |
| `POST /api/users`, `PUT /api/users/:id`, `DELETE /api/users/:id` | OC mutation | Authenticated `registry` self-service; create occurs through an approved session issuer and delete is a tombstone. Unauthenticated legacy create is retired. |
| `POST /api/auth/challenge/ethereum`, `POST /api/auth/login/ethereum` | OC issuer | `registry` Ethereum issuer with replay-safe challenge bound to browser session principal. |
| `POST /api/auth/oauth/:provider/start`, `GET /api/auth/:provider/callback` | EA issuer | `liminal` OAuth/OIDC PKCE issuer; access/refresh tokens never enter stable state. |
| `POST /api/auth/register/email`, `POST /api/auth/verify/email`, `POST /api/auth/resend-verification` | RT | Email-based account/session creation is not one of the locked v1 issuers and is retired at ICP cutover. Verified email may remain an external attestation only. |
| `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/disconnect/:provider`, `DELETE /api/auth/sessions/cleanup` | OC | `registry` session read/revoke/unlink and expiry housekeeping; no bearer token cleanup endpoint or identity-based account merge. |
| `GET /api/auth/kyc/status`, `POST /api/auth/kyc/initiate`, `POST /api/auth/kyc/didit/callback`, `POST /api/auth/liveliness/initiate` | EA | External verifier workflow; registry persists only signed/hash attestation metadata. |
| `POST /api/evaluation/start` | OC | Idempotent, rate-limited `assessment.submit_evaluation`; caller is authorized through registry. |
| `GET /api/ban-voting`, `GET /api/ban-voting/:userId/assessments` | LH query | Historical `audit`/assessment reporting only. |
| `POST /api/ban-voting/vote` | RT | Legacy ban voting is retired. It is not mapped to payout disputes; only `rounds.file_dispute` may freeze an allocation under the new rules. |
| `GET /api/global/gdp`, `GET /api/global/token-prices`, `POST /api/global/refresh-gdp` | EA | Versioned external oracle/attestation and reporting. Refresh requires governed ingestion; display prices never authorize accounting. |
| `GET /api/logs`, `/my`, `/user/:userId`, `/stats`, `/types` | OC/LH query | Filtered `audit` queries and compact indexes; provider payloads, secrets and raw PII excluded. |
| `POST /api/cron/quarterly-evaluation`, `/bi-monthly-evaluation` | OC scheduler | Governed/idempotent assessment timers. |
| `POST /api/cron/weekly-gas-distribution`, `/compensation-payout` | OC scheduler | Governed/idempotent rounds lifecycle. A timer is never evidence that a payment was not sent. |
| `POST /api/cron/liveliness-check` | EA scheduler | Registry attestation expiry/update workflow. |
| `POST /api/cron/monthly-cleanup` | LH then RT | Legacy database maintenance only; no public cutover endpoint. |
| `POST /api/cron/world-gdp-refresh` | EA scheduler | Governed attestation ingestion. |
| `GET /api/cron/status` | OC query | Canister timer/reporting status without a shared cron secret. |
| `GET /api/multi-network-gas/list`, `/status`, `/reserve-status`, `/network/:networkName/status` | OC query | Registry route catalog and vault/rounds balance, reservation and reconciliation reporting. |
| `GET /api/multi-network-gas/distribution-history`, `/network/:networkName/distribution-history`, `/user/:userId/distribution-history` | LH/OC query | `audit` history and ledger receipts with authorization/redaction. |
| `POST /api/multi-network-gas/run-distribution` | OC scheduler | `rounds.execute_due`; never direct vault authority. |
| `POST /api/multi-network-gas/ensure-country-account`, `/ensure-region-account` | RT endpoint | Replaced by deterministic vault fund/subaccount derivation. Non-ICRC operations wait for Stage 9 adapters. |
| `GET /api/cleanup/stats`, `POST /api/cleanup/dry-run`, `/execute` | LH then RT | Preserve as read-only migration/legacy maintenance tooling; remove from the ICP write surface after cutover. |
| `GET /api/admin/status` | OC query | Governance/reporting status. |
| `POST /api/admin/toggle-distribution` | OC governance | Narrow governed vault emergency pause; it creates no withdrawal right. |
| `POST /api/admin/trigger-distribution` | OC governance | Requests a rounds lifecycle action only. Only `rounds` may call `vault.execute_batch`. |
| `POST /api/admin/trigger-re-worth-assessment` | OC governance | Governed assessment scheduling. |

The root/static/health behavior in `backend/src/index.ts` moves to the certified frontend asset canister and canister query health/version methods. Express error/fallback middleware has no persisted target.

## Frontend API declarations not backed by Express routes

`frontend/src/services/api.ts` declares `/api/posts` CRUD, but the backend mounts no posts router and the frontend has no call sites. All post endpoints/types are **RT** as dead scaffolding. Declared but currently unused wrappers (some user/log/admin cleanup calls) follow the endpoint mapping above rather than creating extra ICP methods automatically.

## Frontend call-site inventory

The frontend currently uses the following API groups; each is covered by the
endpoint mapping above: authentication (`me`, login/logout, Ethereum challenge,
OAuth start, disconnect, email verification, KYC and liveliness), users
(`getById`, update, GDP share, leaderboard and salary statistics), evaluation
start, ban-voting reads/vote, personal log/type reads, all four admin actions,
GDP/token-price reads, and gas network/status/account-scope calls. Call sites are
in `AuthContext.tsx`, `ConnectForm.tsx`, `MultiNetworkGasBalances.tsx`,
`Leaderboard.tsx`, `useWorldGdp.ts`, and the Home, Logs, Admin, BanVoting,
DefensePanel and UserAuditLog pages.

The following exported wrappers have no current call site: user list/create/delete,
all post CRUD, session cleanup, the standalone KYC-status wrapper, and log
all/user/stats queries. Unused status/reporting wrappers may be reintroduced only
when a Stage 6 screen requires them; dead post and email-session scaffolding stays
retired. The browser migration replaces Axios bearer headers and `authToken` in
local storage with generated actors using the browser session principal, while
preserving seven-day expiry, cross-tab logout, OAuth popup completion, and
fail-closed logout when the session is invalid.

## Authority invariants

1. `registry` authenticates browser session principals; raw session secrets never cross Candid.
2. `assessment` may propose allocation data but cannot finalize rounds or transfer funds.
3. Only `rounds` can call the vault reservation/execution/reconciliation methods.
4. The vault exposes no arbitrary transfer, administrative withdrawal or sweep method.
5. Audit history is append-only; legacy imports cannot become proof of payout-account ownership.
6. No raw KYC data, email/OAuth token, provider credential, personal number or legacy `SystemSecret` is imported into replicated canister state.
