# Current-system analysis summary

## Modules discovered

- Express API/bootstrap/security headers/CORS: `backend/src/index.ts`.
- Session, email, wallet, social OAuth, KYC: `routes/auth.ts`, `middleware/auth.ts`, `EmailService.ts`.
- Contributor profiles, evaluation task graph and AI results: users/evaluation routes, `UserEvaluationFlow`, `TaskManager`, runners.
- Community ban voting, payment holds and compensation: `BanVotingService`, `CronService`.
- Multi-chain token distribution and recovery: distribution service, pending transactions, EVM/Solana/Bitcoin/Cosmos/Stellar/Polkadot/ICP adapters.
- Global GDP/token pricing, audit logs, scheduled jobs, account cleanup and admin controls.

## Undocumented behavior and contradictions

- Social direct-login handlers apparently authenticate a submitted provider handle without using `accessToken`; provider callback path differs. This requires immediate security verification.
- `GET /api/users` returns unfiltered User records; `/api/logs` reads logs publicly. Both can expose personal/KYC/AI/session-derived data.
- Gas execution and secret-account creation are public despite a route comment saying distribution should be protected.
- Cleanup execute requires any authenticated session, not administrator authorization.
- Distribution unique index includes exact timestamp but comment calls it a daily guard; global table is treated as singleton without a singleton constraint.

## Critical invariants / PostgreSQL assumptions

See `database/invariants.md` and `database/schema.sql`. PostgreSQL provides uniqueness, FK cascade/set-null, serial sequencing, and conditional Prisma updates; it does not enforce status values, non-negative money, one global row, task acyclicity, or external-transfer atomicity. Prisma owns `updatedAt` and CUID generation.

## Migration risks for ICP and ZenDB

- Preserve quoted PostgreSQL names/types and timestamp precision only where compatibility matters; model SERIAL/CUID identity, unique keys, cascades, nullable legacy fields, and JSONB AI outcomes explicitly.
- Do not assume SQL transactions cover chain calls, email, OAuth, GDP, or AI. Use durable idempotency/reconciliation around `pending_transactions` and distribution records.
- Explicitly design state machines and authorization roles that PostgreSQL currently leaves as text/application convention. Decide how to represent sensitive `system_secrets`, KYC data, tokens, and raw historical logs; they are high-risk to put on-chain.
- Reconcile the legacy primary-email field with the one-to-many `user_emails` model, and decide global singleton cardinality before data migration.

## Unresolved questions

1. What exact OAuth callback/state and Didit webhook signature checks run in the omitted/delegated sections?
2. Which BanVotingService eligibility/thresholds are policy, and are they race-safe?
3. What production data exists that violates assumed status/amount invariants?
4. What retention/legal basis applies to KYC, tokens, and OpenAI request logs?
5. Is public operational access intentional or a temporary deployment configuration?

## Recommended later migration order

1. Freeze/repair authorization and expose a tested API contract.
2. Export and validate relational data with uniqueness/FK/legacy-email audits.
3. Define explicit domain state machines and idempotent command records.
4. Migrate non-secret read models and profile data.
5. Migrate task/evaluation history and AI compact results.
6. Migrate payment/distribution workflow with reconciliation before enabling value transfer.
7. Migrate KYC/secrets only to an appropriate off-chain protected store; then cut over scheduled jobs.
