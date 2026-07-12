# Vertical slices

## Rules used for every slice

`Security sensitivity` and `Financial sensitivity` use **low**, **medium**, or **high**.  A slice is not a wholesale table migration: it moves one observable capability and its minimum authoritative state.  PostgreSQL remains available for all capabilities not explicitly cut over.  Source IDs are migration metadata only; principal claims are never inferred from numeric user IDs.

The supplied inputs refer to `migration/runbook.md`, but that file is absent in this checkout.  The operational runbook must be supplied and rehearsed before any state-changing or financial cutover; the criteria below are therefore minimum gates, not a substitute for it.

## S1 — versioned public assets and public-profile read projection

|Field|Description|
|---|---|
|Slice|Versioned assets, public profiles, leaderboard, and redacted public status|
|Existing endpoints|`GET /`; `GET /api/users/leaderboard`; `GET /api/users/{id}`; `GET /api/users/salary-stats`|
|Existing tables|`users`, `global`|
|Target methods|Asset HTTP `/`; `list_leaderboard`; `get_public_profile`; `get_certified_public_status`; `get_certified_reserve_aggregate`|
|Target collections|`public_profiles` ZenDB; core Account/projection version; no migration of PII|
|Dependencies|Asset canister release process; approved public-field and fixed-point conversion policy|
|Risk|Medium|
|Security sensitivity|Medium — eliminate current public PII/KYC exposure|
|Financial sensitivity|Low — displayed aggregates are non-authoritative|
|Data migration|Snapshot only consented/bounded fields; transform `shareInGDP` only after approved fixed-point rules; rebuild stale salary statistics|
|Behavioral tests|Banner and leaderboard cap in `current-api.characterization.test.ts`|
|New tests|Certificate verification; cursor order/tie-breaker; omitted PII; snapshot row/count/hash reconciliation; legacy adapter contract|
|Shadow mode|Yes: serve canister result internally/at a canary route and compare normalized pages with PostgreSQL|
|Cutover condition|100% snapshot reconciliation; zero sensitive-field leaks; deterministic page comparisons pass for a full release window; certificate verification works in supported browsers|
|Rollback method|Route reads back to Express/PostgreSQL; retain immutable snapshot and projection version; do not write target from this slice|

## S2 — principal account claim and consented profile CRUD

|Field|Description|
|---|---|
|Slice|Claimed account, self profile update, consent withdrawal, and tombstone|
|Existing endpoints|`PUT/DELETE /api/users/{id}`; `GET /api/users/me/gdp-share`; `GET /api/auth/me`|
|Existing tables|`users`, `user_emails`, `sessions`, verification-token tables|
|Target methods|`claim_account`; `update_my_profile`; `get_my_account`; `tombstone_my_account`|
|Target collections|Core Account and `public_profiles`; off-chain identity/erasure records|
|Dependencies|S1; S3 verified principal/identity service; deletion and retention policy|
|Risk|High|
|Security sensitivity|High — ownership, PII exclusion, deletion semantics|
|Financial sensitivity|Medium — account state carries eligibility/share, but this slice must not alter allocations|
|Data migration|Import only a claimant-verified principal binding, consented profile fields, and a legacy-ID hash; never import sessions, tokens, emails, or KYC payloads|
|Behavioral tests|Unauthenticated GDP rejection; cross-owner update rejection|
|New tests|Principal-only ownership; idempotency/expected version; consent withdrawal; tombstone/erasure outbox; replayed claim; profile projection atomicity|
|Shadow mode|Partial: compare account/profile projections after a read-only claim; no dual-write of deletion or ownership changes|
|Cutover condition|Claim conflict rate resolved; authorization/replay suite passes; erasure workflow tested; no account update requires a bearer session|
|Rollback method|Disable new updates and re-enable legacy profile updates only for accounts with no target-only mutation. For any target mutation, export an auditable reconciliation record and apply a controlled one-way repair; do not silently dual-write.|

## S3 — private identity, OAuth/KYC, email, and notifications

|Field|Description|
|---|---|
|Slice|Protected enrollment, OAuth/KYC verification, attestations, notifications, and session retirement|
|Existing endpoints|`POST /api/users`; `/api/auth/login/*`; email/KYC register/verify/callback/initiate/resend/disconnect routes; `POST /api/auth/logout`|
|Existing tables|`users`, `user_emails`, `sessions`, `email_verification_tokens`, `kyc_tokens`|
|Target methods|Off-chain identity/KYC APIs; core `propose_attestation`; browser delegation logout|
|Target collections|Core Verification attestation/Account; private identity/KYC store; no ZenDB PII|
|Dependencies|Worker identity allow-list, provider validation/PKCE/webhook replay controls, retention policy|
|Risk|High|
|Security sensitivity|High|
|Financial sensitivity|Medium — attestations may gate eligibility later|
|Data migration|Migrate only policy-approved verification attestations; invalidate all sessions and secret tokens; rotate provider credentials|
|Behavioral tests|Unauthenticated protected endpoint characterization|
|New tests|OAuth state/PKCE/issuer validation; webhook signature/replay; token expiry/single use; worker allow-list; attestation expiry/revocation; no PII in core|
|Shadow mode|Yes for verification decisions: compare worker decisions without issuing core eligibility. No shadow use of real tokens after retirement.|
|Cutover condition|Provider fixtures pass; zero PII/secret scan findings in core state/interfaces; attestation reconciliation complete; user reauthentication communication sent|
|Rollback method|Keep legacy login only during a pre-announced overlap; stop attestation acceptance and use protected-service status. Never restore expired/invalidated bearer tokens.|

## S4 — asynchronous assessment workflow and accepted result

|Field|Description|
|---|---|
|Slice|Assessment request, private AI execution, accepted result/share, and result history|
|Existing endpoints|`POST /api/evaluation/start`; admin re-worth trigger|
|Existing tables|`users`, `tasks`, `task_dependencies`, `batches`, `*_mappings`, `ai_results`, `ai_result_sources`, `openai_logs`|
|Target methods|`request_assessment`; `retry_assessment`; worker proposal; governed `accept_assessment_result`|
|Target collections|`assessment_runs` ZenDB; core Account accepted assessment; private worker DB/object store|
|Dependencies|S2/S3; assessment policy/version, worker signing, evidence size/retention policy|
|Risk|High|
|Security sensitivity|High — prompts/evidence can be private|
|Financial sensitivity|High — accepted share may determine entitlement|
|Data migration|Only bounded accepted/proposed summaries and evidence commitments; no tasks, raw prompts, logs, or unbounded sources|
|Behavioral tests|No successful evaluation characterization; existing suite intentionally avoids mutations|
|New tests|State machine/idempotency; worker replay; capped documents; rejection/appeal; accepted-result atomic projection; provider failure/retry|
|Shadow mode|Yes: execute candidate worker jobs and compare normalized results; governance does not accept shadow outcomes|
|Cutover condition|Policy/appeal approved; representative shadow corpus accepted; no raw evidence reaches core; retry/recovery drill passes|
|Rollback method|Stop accepting new results and continue legacy evaluation for unresolved accounts; accepted target results remain audit facts and require an explicit governed superseding result, not deletion.|

## S5 — governance voting, outcomes, holds, and maintenance

|Field|Description|
|---|---|
|Slice|Ban/unban vote, period finalization, payment hold transition, bounded cleanup/scheduling|
|Existing endpoints|`GET/POST /api/ban-voting*`; cleanup/admin/cron operations|
|Existing tables|`ban_votes`, `users`, `global`|
|Target methods|`submit_vote`; `list_vote_periods`; `get_certified_vote_period`; `finalize_vote_period`; `run_maintenance_batch`|
|Target collections|Core Vote, Governance period/outcome, Account hold, Work item, Audit event; public vote view deferred|
|Dependencies|S2/S3 eligibility; policy for anonymity, quorum, thresholds, appeals, canonical clock; S4 if assessment state gates voting|
|Risk|High|
|Security sensitivity|High — eligibility and vote privacy|
|Financial sensitivity|High — outcomes affect payment holds/compensation|
|Data migration|At a closed-period boundary only, map claimed principals and import validated historical aggregates/votes if policy permits; otherwise preserve legacy history read-only|
|Behavioral tests|Unauthenticated vote route and malformed-request middleware ordering|
|New tests|Duplicate/self/ineligible vote; period boundary; concurrent expected-version race; finalization/appeal; certified aggregate; bounded maintenance cursor|
|Shadow mode|Yes for period calculation and hold proposals; no dual finalization or hold write|
|Cutover condition|Policy is approved; shadow outcomes match for at least one complete period; all eligible active voters have claim path; governance emergency procedure rehearsed|
|Rollback method|Before finalization, route submissions to legacy and invalidate target period. After finalization, keep target outcome/hold immutable, pause downstream payments, and reconcile via governed appeal/override—not a blind rollback.|

## S6 — governed oracle/policy and reserve accounting

|Field|Description|
|---|---|
|Slice|Versioned treasury policy, GDP/oracle observation, reserve accounting, and public status|
|Existing endpoints|`GET/POST /api/global/*`; admin distribution toggle/status; salary stats|
|Existing tables|`global`, `gas_token_reserves`|
|Target methods|`propose_oracle_observation`; `activate_policy`; reserve reconciliation; certified status/aggregate methods|
|Target collections|Core Treasury policy/config, Reserve, Audit event; no collection required|
|Dependencies|Governance controller/multisig; fixed-point and conservation formula; oracle freshness policy; S5 governance|
|Risk|High|
|Security sensitivity|High|
|Financial sensitivity|High|
|Data migration|Select/reconcile the legacy singleton; convert values to integer units only with approved semantics; external balance reconciliation is mandatory|
|Behavioral tests|Invalid global log filter only indirectly related; no oracle success coverage|
|New tests|Singleton/version authorization; stale/conflicting oracle rejection; conversion boundaries; reserve reconciliation; certified output|
|Shadow mode|Yes: observations and accounting are compared without policy activation|
|Cutover condition|Open financial decisions closed; reserve totals reconcile by asset/network; signed policy activation and emergency pause drill pass|
|Rollback method|Deactivate/pause the new policy and retain audit/config history; legacy data may be read for comparison, but no payment execution resumes without re-reconciliation.|

## S7 — ICP/ICRC-1 obligation and ledger settlement

|Field|Description|
|---|---|
|Slice|Allocation, obligation lifecycle, ICP/ICRC-1 transfer, settlement, and account history|
|Existing endpoints|Multi-network distribution/history and cron/admin distribution triggers|
|Existing tables|`gas_token_distributions`, `pending_transactions`, `gas_token_reserves`, `global`|
|Target methods|`create_payment_obligation`; governed executor claim; ledger adapter; `list_my_obligations`; settlement/reconcile methods|
|Target collections|`payment_obligations` ZenDB plus canonical core obligation/status map and Audit events|
|Dependencies|S5/S6; approved custody, ledger/token list, memo/idempotency, finality and reconciliation policy|
|Risk|High|
|Security sensitivity|High|
|Financial sensitivity|High|
|Data migration|Import only reconciled, non-ambiguous history keyed by period/account/asset; mark unresolved legacy transactions `reconcile_required`; never duplicate an executed entitlement|
|Behavioral tests|README cites `backend/tests/payment-cycle.test.ts` and `crypto-distribution.test.ts`; black-box suite excludes payment mutation|
|New tests|Persist-before-await; ledger rejection/timeout; duplicate memo; ambiguous transfer; finality/reorg policy; reserve conservation; manual reconciliation|
|Shadow mode|Yes for allocation and obligation calculation only. Real transfers are single-writer and cannot be shadowed.|
|Cutover condition|Two or more dry-run reconciliation cycles; zero unexplained balance/obligation delta; low-cycle and emergency-pause drills; independent approval of first capped transfer batch|
|Rollback method|Stop creation/execution immediately. Unsettled obligations may return to `authorized`/`reconcile_required`; settled ledger transfers cannot be reverted and require accounting reconciliation/user notice.|

## S8 — non-ICP external-chain execution

|Field|Description|
|---|---|
|Slice|HSM/KMS-backed instruction execution and external-chain receipt/finality reconciliation|
|Existing endpoints|Multi-network gas run/status/history and country/region account creation endpoints|
|Existing tables|`system_secrets`, `pending_transactions`, distribution/reserve tables|
|Target methods|Core obligation/instruction and receipt reconciliation methods; protected executor API (no canister private-key method)|
|Target collections|Canonical core obligations; `payment_obligations`; off-chain executor/KMS receipt store|
|Dependencies|S7; per-chain custody, recipient-consent, finality/reorg and independent receipt-verification decisions|
|Risk|High|
|Security sensitivity|High — keys and recipient mapping|
|Financial sensitivity|High|
|Data migration|Do not migrate private keys or secrets: rotate them. Import reconciled history/receipts only; leave ambiguous sends for manual reconciliation|
|Behavioral tests|Existing adapter/payment tests named in behavioral README; no isolated external failure fixture in black-box suite|
|New tests|Signed instruction authenticity; executor duplicate handling; HSM access; RPC disagreement/reorg; receipt verification; per-chain emergency pause|
|Shadow mode|Calculation/instruction generation only; never broadcast two real transfers|
|Cutover condition|Chain-specific rehearsal and independent security review pass; rotated keys verified; all legacy pending sends reconciled; capped canary payment settles|
|Rollback method|Disable executor authorization and pause new obligations. Broadcast transfers cannot be reversed; reconcile receipts/balances and communicate affected payment status.|

## S9 — PostgreSQL retirement and retained private operations

|Field|Description|
|---|---|
|Slice|Remove legacy business reads/writes, archive PostgreSQL, and retain only protected private worker/identity stores|
|Existing endpoints|All remaining Express business endpoints, cron/admin/cleanup endpoints, raw logs|
|Existing tables|All legacy relations; private operational data is retained off-chain under its own policy|
|Target methods|Core/asset interfaces and off-chain identity, worker, executor, audit portal APIs only|
|Target collections|Core stable state; `public_profiles`, `assessment_runs`, `payment_obligations`; protected off-chain stores|
|Dependencies|S1–S8 completed; retention/legal approval; export/restore and incident runbook (missing input) approved|
|Risk|High|
|Security sensitivity|High|
|Financial sensitivity|High|
|Data migration|Archive/reconcile remaining eligible records; purge or retain PII/logs only under approved off-chain retention policy; remove secrets and rotate credentials|
|Behavioral tests|Current HTTP characterization suite provides a legacy baseline only|
|New tests|End-to-end Candid/UI replacement suite; restore from archive; no legacy endpoint traffic; retention/erasure evidence; disaster recovery|
|Shadow mode|No — this is only after all per-slice shadows and cutovers are complete|
|Cutover condition|No legacy writer for at least two full business cycles (including a payment cycle); reconciliation queues empty or formally accepted; archive restore drill and approvals complete|
|Rollback method|Restore the read-only archived legacy service only for investigation; do not revive it as a writer. Forward-fix from authoritative target state with controlled reconciliation.|

