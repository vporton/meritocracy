# Canister map

## Recommendation

The minimum justified project-owned count is **two**: one core canister and one asset canister. Existing ICP/ICRC ledger canisters are external system canisters, not new Meritocracy deployments. Do not split accounts, voting, evaluation acceptance, policy, reserves, and obligations: their invariants require atomic transitions. Do not create canisters for SQL tables, Node services, a scheduler, AI, KYC, search, analytics, or each external chain.

|Field|`meritocracy_core`|`meritocracy_assets`|
|---|---|---|
|Name|`meritocracy_core`|`meritocracy_assets`|
|Responsibility|Authoritative governance, eligibility, accepted assessments, holds, treasury policy, obligations, and bounded public/account views.|Serve versioned React/Vite bundle and immutable public assets.|
|Authoritative data|Principal accounts without PII; policy/config singleton; eligibility attestations; vote uniqueness/aggregates; accepted result references; payment-obligation state; audit facts; stable indexes. ZenDB has bounded read/history documents but does not replace canonical keys/state.|Asset bytes, content hashes, release metadata, cache headers.|
|Public update methods|Principal account lifecycle and consented profile update; submit vote; request/retry work; governed acceptance/policy/pause/batch/migration methods. All bounded and idempotent.|Asset upload/commit only to release controller; no end-user business updates.|
|Public query methods|Bounded profile/leaderboard, public policy/status, account-scoped reads, cursor-paginated history. Certified endpoints for decision-relevant public facts; ordinary queries for display-only data.|HTTP asset serving and asset metadata.|
|Certified outputs|Policy/version, period outcome and public aggregate, accepted public assessment/status when policy requires it, reserve/obligation aggregate, and public profile projection if it affects governance trust.|Asset manifest/content hashes and HTTP certification supplied by the asset mechanism.|
|Inter-canister dependencies|Calls approved ICP/ICRC ledger canisters for transfers; optionally reads certified state only through narrow interfaces. Does not call asset canister for business work.|None required for serving. Browser independently calls core.|
|External dependencies|No secret-bearing dependency. Optional bounded public HTTPS outcall only under approved non-financial policy. Workers call into it, rather than it calling workers.|Build/release pipeline only.|
|Controllers|Governance-controlled multisig/DAO plus narrowly defined emergency recovery process; final membership unresolved before treasury cutover.|Governed release automation with human/multisig protection; same organization as core.|
|Upgrade isolation reason|Financial/governance stable state needs reviewed, schema-safe upgrades independent of UI release cadence.|Bundle cache, storage, and rapid rollback differ from core logic.|
|Scaling reason|Not a scale split initially: tightly coupled policy state must remain atomic. Bound document/index growth and paginate before considering separation.|Static asset storage and HTTP traffic must not consume core execution/storage budget.|
|Security boundary|Separates authoritative state from untrusted browser and limited workers; no PII/secrets/private keys in replicated state.|A separate asset boundary limits UI storage/release effects, but release compromise remains a user-phishing risk.|
|Alternative|A future `treasury_executor` only if independent custody/controller, material execution load, or policy-approved signer isolation is demonstrated. Otherwise retain core ownership.|Could be served by core only for a very small prototype; reject that for production because deployments and caching are independent.|
|Recommendation confidence|**Confirmed** for domain coupling and minimum core; **inferred** for exact controller mechanism and ZenDB guarantees.|**Confirmed** from existing React/Vite static frontend and classification.|

## External and off-chain map

|Component|Location|Communication pattern|Authority / boundary|Why it is not a project canister|
|---|---|---|---|---|
|ICP and ICRC-1 ledgers|Existing ledger canisters|Core persists obligation → update call with memo → records/reconciles result.|Ledger owns balances/transfer final result; core owns entitlement and obligation lifecycle.|Independent standardized ledgers already exist; duplicating them is unjustified.|
|Identity, OAuth, email, KYC|Protected off-chain service|User-authorized browser flow/webhook → worker validates → authenticated, idempotent attestation proposal.|Worker proves policy-defined verification only; core decides eligibility. PII and secrets remain protected.|Needs credentials, redirects, tokens, retention/erasure controls.|
|AI evaluation and evidence|Protected worker + private DB/object store|Core job/reference → worker runs asynchronously → bounded signed proposal → core accepts/rejects.|Core is authoritative for accepted result/share; raw evidence remains private.|Long-running graphs, provider secrets, raw logs, and unbounded data are unsuitable for core.|
|Non-ICP payment executor|HSM/KMS-backed service|Core creates instruction → executor submits transaction → receipt/finality observation → core reconciliation.|Executor cannot create/alter an obligation; it only performs approved execution.|Private keys/RPC credentials and per-chain operational complexity cannot be confidential in a canister.|
|Scheduler, monitoring, private logs|Off-chain operations|Scheduler invokes bounded governed batch; monitoring consumes redacted events/status.|Core remains source of governance/financial facts.|Exact scheduling, alerts, credentials, and searchable private logs need conventional operations.|
|Search and analytics|Off-chain derived store|Redacted export/event stream; never a write authority.|No entitlement, vote, or payment decision can depend solely on this store.|Full-text/analytics retention and large scans would create avoidable stable-memory/cycle load.|

## Communication rules

- Browser-to-core: generated Candid bindings through the ICP agent; delegation identity for updates; certificate verification for certified reads.
- Core-to-ledger: narrow typed adapter; persist-before-await; memo/idempotency and reconciliation required.
- Worker-to-core: worker-identity authenticated update with job/instruction ID, schema version, bounded payload, and expected-state/version.
- Core-to-worker: workers poll only approved bounded work descriptors or receive an event relay; no secret callback URL is an authorization mechanism.
- Cross-boundary messages are at-least-once. Each destination deduplicates and each workflow has an observable terminal or reconciliation state.

## Rejected separations

`accounts`, `votes`, `assessment`, `treasury`, `ZenDB`, `scheduler`, and `each network adapter` are rejected as separate application canisters now. Splitting them would add asynchronous failure modes around presently atomic domain transitions without evidence of a controller, security, upgrade, or resource boundary. A separate treasury executor is explicitly deferred pending a custody decision.
