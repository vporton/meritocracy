# Legacy-to-ICP feature parity checklist

Last updated: 2026-08-08. The repository's AGPL-3.0-only license and related package metadata changes are complete and recorded in `9122ff0`; no additional relicensing gate remains. M1 includes an aggregate-only PostgreSQL inventory command (`docs/icp/POSTGRES_INVENTORY.md`) that loads an ignored local configuration without printing it. Its 2026-08-07 read-only attempt produced only a redaction-safe generic failure category and no report, so it records no target-feature or production-inventory completion evidence. The post-G1 flat lint baseline now passes while preserving the legacy application. This remains the exhaustive legacy audit baseline.

**M1 handoff supersession:** `docs/icp/M1_OPERATOR_HANDOFF.md` records the settled owner decision that ZenDB is in-process behind a Motoko storage-authority canister and that this canister—not ZenDB—enforces RBAC. Any earlier row describing the remote-ZenDB grant topology is historical diagnostic evidence only. The same handoff records that `DATABASE_URL` is already in ignored `backend/.env`; do not request it again. Its remaining aggregate-only inventory failure is a DBA connectivity/TLS/query-permission remediation, not a missing configuration value.

**M1 storage-boundary correction (2026-08-07):** The earlier DFX local-replica claim in DM-004 is not valid evidence. DFX 0.32 identities are global; a local run selected an ambient home-directory identity despite the runner's claimed isolation. The runner is disabled, no production network/data/canister/asset was touched. Its passed replacement is an identity-free pinned PocketIC proof with synthetic principals. The storage authority's six-principal matrix is a private persistent field with a committed stable signature; its fixed per-collection/action probe surface survives the tested EOP-preserving upgrade. This is authorization-scaffold evidence only, not a ZenDB/data-mutation/recovery proof.

**M1 toolchain correction (2026-08-08):** The owner selected Motoko `1.4.1` repository-wide to match the exact ZenDB v2.0.1 pin, superseding the earlier `0.16.3` incompatibility decision. The project uses no dual compiler; the exact-source embedded probe compiles in both ZenDB and repository modes. The remaining compatibility configuration is two legacy `motoko-base` aliases pinned to upstream `moc-1.4.1` and a hashed management-canister IDL for explicit compiler resolution. This changes no Candid surface, storage method, target data, authority, deployment, or ZenDB eligibility proof.

**M1 embedded-integration blocker (2026-08-08):** The application lock now includes both `core@1.0.0` and `core@2.2.0`, but only explicit `mo:core@2.2` imports select the latter. ZenDB still imports unqualified `mo:core`, which resolves to identify's retained `core@1` and lacks `Nat.bytes`; the closures therefore compile only separately. No ZenDB target dependency or compatibility fork was added. The fixed PocketIC storage-boundary runner now uses the Mops-pinned Motoko `1.4.1` compiler and passes, but it remains an authorization-only scaffold proof. Integration requires an owner-approved exact identify update or audited fork with refreshed hashes and OAuth vectors.

**M1 Mops package conversion (2026-08-09):** `third_party/` was removed. The released `identify@0.0.2` and `zendb@2.0.1` packages are direct Mops dependencies and their full content closure is locked in `mops.lock`; retained ZenDB proof records now live in `docs/icp/evidence/zendb/`. That earlier remote-CanisterDB Git pin is a distinct historical artifact, not validation of the Mops package. The direct `mops check` fails because the released identify package contains a frontend E2E actor, which Motoko rejects in a library package path. No target canister imports ZenDB, no storage method or data was enabled, and this failure is an M1 integration blocker—not a reason to restore vendored sources or use a hidden fork.

## Status vocabulary

- `AUDITED`: the legacy implementation and callers were inspected.
- `DESIGNED`: a target behavior is proposed in the G1 documents but no target code exists.
- `BLOCKED_M1`, `BLOCKED_G2`, `BLOCKED_G3`, `BLOCKED_G4`: work is intentionally waiting at that milestone or approval gate.
- `IMPLEMENTED`: target code exists but full acceptance has not passed.
- `VERIFIED`: acceptance evidence is linked and reconciliation passed.
- `INTENTIONALLY_CHANGED`: unsafe/incorrect legacy semantics will not be reproduced; the approved replacement must still preserve legitimate state, money, and history.
- `RETIRED`: the approved architecture makes the feature unnecessary and its removal has acceptance evidence.

Unless a row says otherwise, source status is `AUDITED` and target design is `DESIGNED`. M1-blocked rows remain design-only until their individual implementation milestones start. No row is currently implemented or verified on ICP.

## Global parity rule

Parity means preserving intended user/business capability, authorization, history, and financial obligations. It does **not** mean reproducing insecure endpoint shapes, plaintext custody, floating-point accounting, non-idempotent sends, bearer/cron secrets, in-memory locks, ambiguous ownership, destructive cascades, or known routing/UI defects. Each intentional change requires tests and, where data/money is involved, a reconciliation record.

## Frontend and public experience

| ID | Legacy feature/evidence | ICP target and acceptance | Migration status |
| --- | --- | --- | --- |
| FE-001 | React/Vite SPA, `BrowserRouter`, root `Home` | Retained React/Vite/TypeScript bundle in a certified frontend canister, SPA fallback, generated Candid actors; deep-link/certification/CSP/reproducible pinned-Node build tests, with no Node runtime in the canister | DESIGNED / BLOCKED_M1 |
| FE-002 | `/connect` wallet/email/social connection form; `/login` redirects there | Internet Identity and `identify` OAuth sign-in through a non-anonymous Candid caller: caller-bound one-use state/nonce/PKCE start, allowlisted React callback, authenticated complete/recovery, and URL/history redaction; external proofs and payout destinations are separately linked | DESIGNED / BLOCKED_M1/G2 |
| FE-003 | `/verify-email` token flow | Caller-bound, expiring, single-use email proof without accepting imported credentials | DESIGNED / BLOCKED_G2 |
| FE-004 | `/logs` global/admin log viewer | Capability-protected, redacted, cursor-paginated audit view | DESIGNED / BLOCKED_G2 |
| FE-005 | `/logs/:userId` user audit log | Exact ZenDB owner index plus Motoko self/admin authorization; no JSON substring search | DESIGNED / BLOCKED_G2 |
| FE-006 | `/admin` controls/status | Governance proposals or named capabilities; safety role can pause only | INTENTIONALLY_CHANGED / BLOCKED_G2 |
| FE-007 | `/ban-voting` list/vote experience | Principal-authorized vote, deterministic epoch, Level-1 eligibility, ban/unban parity, and a default-deny public field allowlist. Raw social identifiers and wallet addresses are excluded unless the G2 product/privacy/consent decision permits each field/purpose | DESIGNED / BLOCKED_G2 |
| FE-008 | `/ban-voting/timing-plan` | Preserve explanatory schedule derived from the same deterministic epoch rules | DESIGNED / BLOCKED_G2 |
| FE-009 | `/treasury` reserve/distribution/funding interface | Certified public accounting projection plus wallet-driven deposits to a published asset/scope account; never expose signing secrets or treat a memo as donor authentication/entitlement | DESIGNED / BLOCKED_G3 |
| FE-010 | Navigation/auth state/responsive layout | Preserve accessible routes, pending/error states, mobile layout, and caller identity semantics | DESIGNED / BLOCKED_G2 |
| FE-011 | Social-share controls and external community links | Preserve as ordinary external links; no third-party executable JS in the certified app | DESIGNED / BLOCKED_M1 |
| FE-012 | Browser EVM native-token funding | User wallet sends to approved treasury address; network/amount/receipt validation | DESIGNED / BLOCKED_G3 |
| FE-013 | Browser ERC-20 approve + helper funding | Explicit allowance/amount/contract/network UI, receipt tracking, revoke guidance | DESIGNED / BLOCKED_G3 |
| FE-014 | Browser ckETH funding helper | Prefer direct ICRC/ck-token transfer where possible; exact ledger/decimals/dedup | DESIGNED / BLOCKED_G3 |
| FE-015 | BTC deposit to ckBTC minter and manual `update_balance` | Preserve supported ckBTC mint flow with account derivation, confirmations, retry-safe update, and clear fees | DESIGNED / BLOCKED_G3 |
| FE-016 | Public treasury address/details | Chain/network/asset scoped, certified config; never imply one global address serves derived scopes | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| FE-017 | Google analytics/configurable third-party browser services | Privacy/security review; omit or use consented non-executable endpoint if approved | DESIGNED / BLOCKED_M1 |
| FE-018 | Frontend API client contains posts calls but no backend/model | Confirm unused/dead contract; remove only after route/bundle tests prove no feature loss | DESIGNED / BLOCKED_G2 |
| FE-019 | UI calls country/region-account admin endpoints without admin header | Replace with authorized governance/admin UX or remove caller; do not preserve broken unauthenticated call | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| FE-020 | Backend supports UNBAN vote but UI does not expose it | Add approved UI or explicitly retire with product decision; API/UI parity test required | DESIGNED / BLOCKED_G2 |
| FE-021 | Frontend self-ping calls protected cron status without authorization | Retire self-ping; canister timers/monitoring expose sanitized health separately | INTENTIONALLY_CHANGED / BLOCKED_G2 |

## Authentication, identity, KYC, and authorization

| ID | Legacy feature/evidence | ICP target and acceptance | Migration status |
| --- | --- | --- | --- |
| AU-001 | `POST /api/auth/challenge/ethereum` random 5-minute challenge | Domain/chain/caller/action-bound single-use challenge with exact address parser and replay tests | DESIGNED / BLOCKED_G2 |
| AU-002 | `POST /api/auth/login/ethereum`, EOA and EIP-1271 verification | Preserve EOA/contract-wallet proof as identity evidence; principal remains session authority | DESIGNED / BLOCKED_G2 |
| AU-003 | Disabled direct `/login/{github,orcid,bitbucket,gitlab}` returns 410 | Preserve as retired endpoint/clear UI migration; OAuth start/callback is the only social path | RETIRED (proposed) / BLOCKED_G2 |
| AU-004 | `POST /api/auth/register/email` | Email evidence initiation with rate/cost limits and no account authority before proof | DESIGNED / BLOCKED_G2 |
| AU-005 | `POST /api/auth/verify/email` | Acknowledged single-use compare-and-set/saga bound to caller and intended identity; no cross-canister atomicity assumption | DESIGNED / BLOCKED_G2 |
| AU-006 | `POST /api/auth/resend-verification` | Bounded resend, same invalidation/rate rules, provider idempotency and audit | DESIGNED / BLOCKED_G2 |
| AU-007 | Opaque SHA-256 bearer sessions, seven-day expiry | Internet Identity or OAuth-recovered non-anonymous caller principal; imported sessions permanently invalid and no callback/code/token becomes method authority | INTENTIONALLY_CHANGED / BLOCKED_G2 |
| AU-008 | `POST /api/auth/logout` | Clear frontend delegation/session state and revoke app-side binding where applicable | DESIGNED / BLOCKED_G2 |
| AU-009 | `GET /api/auth/me` | Caller-derived private profile with certified/public fields separated | DESIGNED / BLOCKED_G2 |
| AU-010 | Admin session cleanup endpoint and expiry worker | Stable expiry index/bounded timer cleanup; imported sessions historical only | DESIGNED / BLOCKED_G2 |
| AU-011 | OAuth start/callback for GitHub, ORCID, Bitbucket, GitLab using state/nonce cookie | Exact pinned `identify` provider flow: non-anonymous caller-bound one-use state/nonce/purpose/redirect/PKCE challenge; allowlisted certified-frontend callback clears URL/history and calls authenticated completion; verify caller equality, expiry, PKCE, configured client/redirect, provider-specific response, and immutable subject, plus issuer/audience where present, before binding/recovery. Callback/code/token alone is never authority; unsupported flow is blocked or explicitly retired. M1 package/fixture evidence: `TOOLCHAIN_AND_OAUTH_EVIDENCE.md` | DESIGNED / BLOCKED_G2 |
| AU-012 | OAuth identities stored mainly as mutable handles | Re-verification adds immutable provider subject; handle is display-only | INTENTIONALLY_CHANGED / BLOCKED_G2 |
| AU-013 | `POST /api/auth/disconnect/:provider` | Prevent loss of last recovery/auth factor; disconnect evidence without silently deleting history | DESIGNED / BLOCKED_G2 |
| AU-013a | OAuth callback/recovery binding | Duplicate exact completion is idempotent; copied state/code/verifier, anonymous/different caller, configured-client/redirect or provider-response mismatch, issuer/audience mismatch where present, expired attempt, subject conflict, and token/history/log leakage all fail closed; successful new-principal recovery records immutable audit/notification and applies the approved step-up/hold policy | DESIGNED / BLOCKED_G2 |
| AU-014 | `GET /api/auth/kyc/status` | Caller-only typed attestation/status with evidence minimization | DESIGNED / BLOCKED_G2 |
| AU-015 | `POST /api/auth/kyc/initiate` and expiring KYC tokens | Caller-bound provider session, expiry, purpose, attempt, and idempotency | DESIGNED / BLOCKED_G2 |
| AU-016 | Didit signed `POST /api/auth/kyc/didit/callback` | HTTP gateway update endpoint; HMAC/provider signature, event ID dedup, monotonic transitions | DESIGNED / BLOCKED_G2 |
| AU-017 | KYC/AML callback ordering can allow later acceptance to obscure rejection | Sanctions/AML rejection precedence and explicit manual-review state | INTENTIONALLY_CHANGED / BLOCKED_G2 |
| AU-018 | `POST /api/auth/liveliness/initiate` and periodic due/request state | Caller-bound provider flow, durable schedule, monotonic attestation events | DESIGNED / BLOCKED_G2 |
| AU-019 | Level-1/voting KYC and separate fields | Preserve as purpose-scoped attestation; it cannot implicitly satisfy payout KYC | DESIGNED / BLOCKED_G2 |
| AU-020 | Static admin bearer secret | Named principal capability/governance quorum; no static all-powerful admin token | INTENTIONALLY_CHANGED / BLOCKED_G2 |
| AU-021 | Static cron bearer secret | Retire external cron authorization; stable timers plus restricted manual trigger capability | INTENTIONALLY_CHANGED / BLOCKED_G2 |
| AU-022 | Process-local rate limits and locks | Stable caller-principal/provider/action/cost-aware bounded quotas and durable leases where justified. A canister does not trust or receive an end-user IP; any IP-based abuse control is a separately configured/tested edge boundary and never authorization input | INTENTIONALLY_CHANGED / BLOCKED_G2 |
| AU-023 | Login identity and payout address are coupled; ordinary bearer may alter payout fields | Separate identity evidence and payout destination; chain ownership proof, step-up, delay, notification, hold | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| AU-024 | User IDs supplied in routes/body | Caller principal is authority; explicit admin capability required for another user | INTENTIONALLY_CHANGED / BLOCKED_G2 |
| AU-025 | User deletion cascades sessions/votes/financial rows | Tombstone/redact PII while retaining immutable financial/evaluation/voting history | INTENTIONALLY_CHANGED / BLOCKED_G2 |
| AU-026 | API/webhook/provider secrets in process/DB | Per-integration scoped, rotatable credentials with spend/rate caps and no logs/exports; malicious-controller risk acknowledged. Credential-bearing calls use the shared allowlisted HTTPS/deadline/response-bound/circuit/correlation policy; loopback HTTP is development-only by explicit configuration | DESIGNED / BLOCKED_G2 |

## Users, profiles, public statistics

| ID | Legacy feature/evidence | ICP target and acceptance | Migration status |
| --- | --- | --- | --- |
| US-001 | Public `GET /api/users` capped at 500 | Sanitized certified public projection with stable cursor pagination and size bounds | DESIGNED / BLOCKED_G2 |
| US-002 | Public `GET /api/users/leaderboard` | Deterministic ranking/tie-break/cursor and privacy filtering | DESIGNED / BLOCKED_G2 |
| US-003 | Public `GET /api/users/salary-stats` | Versioned deterministic stats snapshot with exact numeric derivation | DESIGNED / BLOCKED_G2 |
| US-004 | Public `GET /api/users/:id` | Sanitized stable-ID profile; tombstone behavior and authorization tested | DESIGNED / BLOCKED_G2 |
| US-005 | Self `GET /api/users/me/gdp-share`; route currently follows `/:id` and is shadowed by Express route order | Provide unambiguous typed canister method and caller-derived result | INTENTIONALLY_CHANGED / BLOCKED_G2 |
| US-006 | Disabled `POST /api/users` | Keep disabled; account is created through approved identity onboarding | RETIRED (proposed) / BLOCKED_G2 |
| US-007 | Self `PUT /api/users/:id` profile, identities, payout addresses, notification settings | Split methods by risk; ordinary profile vs proof/step-up/delayed payout change | INTENTIONALLY_CHANGED / BLOCKED_G2/G3 |
| US-008 | Self `DELETE /api/users/:id` | PII erasure/tombstone workflow that retains obligations/audit; recovery/appeal policy | INTENTIONALLY_CHANGED / BLOCKED_G2 |
| US-009 | Multi-email and primary-email behavior | Explicit verified email evidence, uniqueness, primary selection, notification eligibility | DESIGNED / BLOCKED_G2 |
| US-010 | Onboarding flag and connected-provider requirements | Typed onboarding state; identity assurance policy separated from display fields | DESIGNED / BLOCKED_G2 |
| US-011 | Country/personal-number/residence fields | Encrypted/restricted evidence; uniqueness fingerprint; never public/certified. G2 records purpose/data controller/legal basis, minimization, retention/cryptographic erasure, backup/restore, access audit, and permitted anti-evasion/accounting exceptions | DESIGNED / BLOCKED_G2 |
| US-012 | GDP share and last-payment public/profile values | Preserve source bits/history; new exact deterministic share and asset-qualified payment history | INTENTIONALLY_CHANGED / BLOCKED_G2/G3 |

## Evaluation, legacy task graph, AI results, and logs

| ID | Legacy feature/evidence | ICP target and acceptance | Migration status |
| --- | --- | --- | --- |
| EV-001 | `POST /api/evaluation/start`, authenticated with additional-connection requirement | Caller-authorized start, typed eligibility/hold state, idempotent cycle key | DESIGNED / BLOCKED_G2 |
| EV-002 | First evaluation graph (14 tasks) | Versioned Motoko function executes 14 bounded `llm` operations directly, with typed local dependency values and golden differential tests; no live task/DAG persistence | INTENTIONALLY_CHANGED / BLOCKED_G2 |
| EV-003 | Subsequent/re-worth graph (6 tasks) | Versioned Motoko function executes 6 bounded operations directly with exact previous-result inputs and a deterministic cycle key; no live task/DAG persistence | INTENTIONALLY_CHANGED / BLOCKED_G2 |
| EV-004 | Quarterly graph (5 tasks) | Upgrade-safe scheduler invokes the 5-operation function directly per user/cycle and records only schedule cursor/completion plus canonical results, not task graphs | INTENTIONALLY_CHANGED / BLOCKED_G2 |
| EV-005 | Immediate OpenAI request flow | Direct `llm` invocation with bounded/redacted request/result, hard operation/cycle/spend limits, and deterministic final-result publication | INTENTIONALLY_CHANGED / BLOCKED_G2 |
| EV-006 | OpenAI batch and non-batch provider mappings | Retain imported mappings as read-only history; target uses only direct `llm` calls and creates no provider batch, item, polling, or resumable request state | INTENTIONALLY_CHANGED / BLOCKED_G2 |
| EV-007 | Web-search/result source records | Ordered unique source references with URL validation and evidence hash | DESIGNED / BLOCKED_G2 |
| EV-008 | Prompt-injection screening and evaluation blocks | Versioned policy/result, false-positive review, adversarial tests, immutable reason history | DESIGNED / BLOCKED_G2 |
| EV-009 | Task dependencies and terminal cleanup | Preserve imported task/dependency rows and tombstones as restricted read-only history; new dependencies are code-local typed values and no live DAG is stored | INTENTIONALLY_CHANGED / BLOCKED_G2 |
| EV-010 | Task claim uses non-atomic read/update and process lock | Retire AI task claims/locks entirely; duplicate triggers run the bounded direct evaluator and deterministic cycle/result keys permit at most one final publication | INTENTIONALLY_CHANGED / BLOCKED_G2 |
| EV-011 | Task graph creation can leave partial graph | Create no target graph: direct code either publishes one complete canonical result/source set or publishes no result; interruption restarts the whole bounded sequence | INTENTIONALLY_CHANGED / BLOCKED_G2 |
| EV-012 | AI result/source replacement can be partial | Staged canonical result and complete source set, activated by an acknowledged manifest pointer; archive outbox cannot authorize result | INTENTIONALLY_CHANGED / BLOCKED_G2 |
| EV-013 | `OpenAILog` request/response/error audit | ZenDB redacted metadata and hash-addressed payload collections; Motoko access control; stable user/evaluation-operation/custom indexes, with legacy task references historical only | DESIGNED / BLOCKED_G2 |
| EV-014 | Admin `GET /api/logs` filtering/pagination | Capability-protected cursor query with bounded indexed filters | DESIGNED / BLOCKED_G2 |
| EV-015 | Self `GET /api/logs/my` | Exact caller owner index, sanitized content | DESIGNED / BLOCKED_G2 |
| EV-016 | `GET /api/logs/user/:userId` allows self/admin | Caller equality or explicit capability; exact owner index | DESIGNED / BLOCKED_G2 |
| EV-017 | Admin `GET /api/logs/stats` | Bounded pre-aggregated/streamed statistics with no sensitive payload leakage | DESIGNED / BLOCKED_G2 |
| EV-018 | Public `GET /api/logs/types` | Certified allowlist of safe evaluation-operation/log types | DESIGNED / BLOCKED_G2 |
| EV-019 | Ownership inferred from serialized JSON substring; user 1 can match user 10 | Parse during migration and store typed exact owner; unresolved rows restricted | INTENTIONALLY_CHANGED / BLOCKED_G2 |
| EV-020 | 2026-07 AI compaction chose one response and nulled successful legacy payloads | Import canonical results and unmanaged exception table; report lost/conflicting evidence, never invent it | INTENTIONALLY_CHANGED / BLOCKED_G2 |
| EV-021 | OpenAI request/delete/retry/error paths | Direct bounded call errors publish no partial result; an authorized trigger reruns the whole sequence, with no persisted request/task delete, retry, or provider-reconciliation state | INTENTIONALLY_CHANGED / BLOCKED_G2 |

## Ban voting, holds, and compensation eligibility

| ID | Legacy feature/evidence | ICP target and acceptance | Migration status |
| --- | --- | --- | --- |
| BV-001 | Public `GET /api/ban-voting` | Cursor-paginated sanitized current epoch/eligibility/aggregate; no raw social/wallet correlation absent the G2 public-disclosure/consent decision | DESIGNED / BLOCKED_G2 |
| BV-002 | Authenticated `POST /api/ban-voting/vote` for BAN/UNBAN | Principal/caller vote, deterministic UTC week, unique voter/target/type/epoch, self-vote policy | DESIGNED / BLOCKED_G2 |
| BV-003 | Public `GET /api/ban-voting/:userId/assessments` | Sanitized historical assessments with exact stable target ID | DESIGNED / BLOCKED_G2 |
| BV-004 | Threshold application creates bans/evaluation/payment holds | Deterministic audited state transition; no broad update or destructive history | DESIGNED / BLOCKED_G2 |
| BV-005 | Voting plea/unsubscribe email behavior | Durable notification outbox, opt-out, provider idempotency, no authorization via email | DESIGNED / BLOCKED_G2 |
| BV-006 | Compensation scheduling and `compensationDueAt` | Per-obligation state; date clears only after success or an explicit retained-hold outcome | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| BV-007 | Current job clears due dates even on skip/failure | Never clear a legitimate claim without a journaled disposition | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| BV-008 | Compensation update matches broad user/network/status, not asset | Operation/obligation ID and typed asset key are mandatory | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| BV-009 | Deferred/failed payments can be processed despite current KYC failure; zero failure can erase claim | Keep liability held pending approved policy; KYC failure cannot silently destroy money/history | INTENTIONALLY_CHANGED / BLOCKED_G3 |

## Global data, schedules, cleanup, and operations jobs

| ID | Legacy feature/evidence | ICP target and acceptance | Migration status |
| --- | --- | --- | --- |
| JO-001 | Public `GET /api/global/gdp` and startup GDP initialization | Versioned GDP snapshot with source/time/hash and certified public projection | DESIGNED / BLOCKED_G2 |
| JO-002 | Admin `POST /api/global/refresh-gdp` | Capability/governance trigger to idempotent durable job | DESIGNED / BLOCKED_G2 |
| JO-003 | Public `GET /api/global/token-prices` | Versioned price snapshots with freshness/provider/error state; not accounting truth | DESIGNED / BLOCKED_G2 |
| JO-004 | Quarterly evaluation cron endpoint | Stable schedule/cursor and idempotent cycle; restricted manual replay | INTENTIONALLY_CHANGED / BLOCKED_G2 |
| JO-005 | Bi-monthly endpoint aliases quarterly evaluation | Preserve compatibility only if callers exist; otherwise explicitly retire after inventory | DESIGNED / BLOCKED_G2 |
| JO-006 | Weekly gas-distribution cron endpoint | Stable treasury scheduler creates obligations; execution independently gated | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| JO-007 | Hourly compensation-payout cron | Stable bounded compensation eligibility/payment job | DESIGNED / BLOCKED_G3 |
| JO-008 | Daily liveliness-check cron | Stable bounded cursor over due attestations, upgrade recovery | DESIGNED / BLOCKED_G2 |
| JO-009 | Monthly cleanup cron | Bounded tombstone/retention job; never deletes immutable finance/history | INTENTIONALLY_CHANGED / BLOCKED_G2 |
| JO-010 | Monthly/world GDP refresh cron | Stable scheduled HTTPS outcall with source/freshness/hash | DESIGNED / BLOCKED_G2 |
| JO-011 | Admin cron status | Sanitized schedule/cursor/last-success/last-error health view | DESIGNED / BLOCKED_G2 |
| JO-012 | External cron endpoint responds 202 before completion | Return a schedule/cycle correlation key and truthful terminal completion/failure status; direct AI evaluation creates no per-run job/task record | INTENTIONALLY_CHANGED / BLOCKED_G2 |
| JO-013 | Process-local cron locks | Stable due cursor plus deterministic completion key; upgrades/timer duplicates tested; direct AI evaluations use no task lease/epoch | INTENTIONALLY_CHANGED / BLOCKED_G2 |
| JO-014 | Admin cleanup stats/dry-run/execute | Capability-protected retention plan, hash/count dry run, bounded execution receipts | DESIGNED / BLOCKED_G2 |
| JO-015 | Cleanup covers tasks, auth tokens/sessions/challenges, logs | Retention applies to imported legacy-task history, credentials, and logs; no live AI task collection exists; finance/audit preservation remains mandatory | INTENTIONALLY_CHANGED / BLOCKED_G2 |
| JO-016 | Admin status/toggle distribution | Certified status; pause fails closed; resume/policy change requires governance | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| JO-017 | Admin trigger distribution | Creates an idempotent reviewed cycle/obligations; does not bypass unified-treasury controls | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| JO-018 | Admin trigger re-worth assessment | Capability/governance-authorized direct evaluation with deterministic cycle key and final result receipt; no durable task record | INTENTIONALLY_CHANGED / BLOCKED_G2 |

## Treasury, payments, reserves, and wallet/network parity

| ID | Legacy feature/evidence | ICP target and acceptance | Migration status |
| --- | --- | --- | --- |
| FI-001 | Public `GET /api/multi-network-gas/list` | Certified supported asset/network/policy catalog | DESIGNED / BLOCKED_G3 |
| FI-002 | Public aggregate `/status` | Certified sanitized liabilities/reserves/job status from exact journal | DESIGNED / BLOCKED_G3 |
| FI-003 | Public `/reserve-status` | Controlled on-chain balances and journal-derived reserve; freshness/finality explicit | DESIGNED / BLOCKED_G3 |
| FI-004 | Admin global and per-network distribution history | Capability-protected exact event query with stable cursor | DESIGNED / BLOCKED_G3 |
| FI-005 | Public per-network status | Typed chain/network/asset status, not string-address matching | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| FI-006 | Self/admin user distribution history | Caller/capability authorization; immutable user reference survives deletion | DESIGNED / BLOCKED_G3 |
| FI-007 | Manual admin run-distribution endpoint | Approved cycle creates exact obligations; no alternate direct-send path | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| FI-008 | Admin ensure-country-account | Only create a scope derivation the adapter actually signs; ownership/provisioning receipt | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| FI-009 | Admin ensure-region-account | Same exact authority/derivation requirement as country scope | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| FI-010 | GDP-share/token-price allocation | Exact rational/fixed-point calculation, deterministic rounding, conservation/remainder policy | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| FI-011 | `GasTokenDistribution` lifecycle/history | Immutable legacy event plus target obligation/settlement IDs and journal entries | DESIGNED / BLOCKED_G2/G3 |
| FI-012 | `GasTokenReserve` mutable snapshots | Historical import only; authoritative reserve is derived from double-entry journal/external balances | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| FI-013 | `PendingTransaction` create/execute/recover/retry | Deterministic operation, attempt and chain state machines; imported rows quarantined | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| FI-014 | Legacy hash injects current time, omits stored timestamp, and lowercases case-sensitive addresses | Canonical binary/type-aware operation IDs; stable intent data stored and hashed | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| FI-015 | Pending row can be created outside accounting transaction | Obligation/journal/operation set is staged and logical-ID/hash-acknowledged before any external-chain await/send; unknown database results reconcile before signing | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| FI-016 | External send occurs before durable DB completion | Durable intent before send, immutable signed bytes/hash, result reconciliation after await | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| FI-017 | `EXECUTING` resets after 15 minutes without chain check | Never retry on elapsed time alone; chain/ledger-specific reconciliation required | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| FI-018 | Failed pending/distribution state divergence permits repeat payout | One obligation settles once through compare-and-set operation ID; failures retain liability | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| FI-019 | ICRC transfers omit memo and `created_at_time` | Stable memo/operation ID and `created_at_time`; Duplicate is success; TooOld requires ledger scan | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| FI-020 | Financial amounts calculated with JS `number`/Prisma decimal conversions | Exact integer base units and rational allocation; no float/number in money path | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| FI-021 | Reserve update can double-count and lacks compare-and-set | Append-only balanced journal, unique posting key, derived projection | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| FI-022 | Financial history cascades on hard user deletion | Immutable stable user reference and redacted/tombstoned profile | INTENTIONALLY_CHANGED / BLOCKED_G2 |
| FI-023 | Distribution pause can fail open when DB read fails | Fail closed; independently visible pause epoch; unified-treasury policy caps remain effective | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| FI-024 | Some bypass/direct distribution paths do not share all checks | One unified-treasury authorization path; its methods reject calls lacking an approved operation receipt | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| FI-025 | EVM networks/tokens and server-held private keys | Chain Fusion threshold ECDSA for approved direct EVM assets; ck tokens only where their ledger/minter path is selected | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| FI-026 | Solana transfers from process-held key | Threshold Schnorr ed25519/RPC design only after test-key prototype, nonce/finality tests | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| FI-027 | Bitcoin transfers from process-held seed/WIF | Direct BTC uses ICP Bitcoin integration/threshold signing and UTXO leases/finality; ckBTC remains an approved alternative asset path | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| FI-028 | Bitcoin Cash adapter | Direct Chain Fusion feasibility, address/sighash/RPC/finality prototype required or asset held/retired by explicit policy | DESIGNED / BLOCKED_G3 |
| FI-029 | Cosmos transfers from process-held mnemonic | Threshold signing only after chain-specific sequence/fee/broadcast/finality prototype | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| FI-030 | Polkadot transfers from process-held mnemonic | Threshold signing only after nonce/era/runtime-version/finality prototype | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| FI-031 | Stellar transfers from process-held key | Threshold signing only after sequence/time-bound/memo/finality prototype | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| FI-032 | ICP transfers from local PEM/Ed25519 identity | Canister-controlled ICRC account/subaccounts with exact ledger dedup and archive reconciliation | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| FI-033 | ckBTC, ckETH, ckUSDT, ckUSDC, ckEURC support | Canister-controlled ICRC accounts; verify ledger/minter IDs, fees, standards, withdrawal semantics per network | DESIGNED / BLOCKED_G3 |
| FI-034 | Global/country/region distribution scopes | Derivation domain `(environment, chain, network, asset, scope kind/id, purpose)` and an actual signer for every displayed account | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| FI-035 | Non-EVM adapters display scoped derived address but sign with global identity | Never allocate/fund an address the canister cannot control; reconcile any historical mismatch | INTENTIONALLY_CHANGED / BLOCKED_G3 |
| FI-036 | KYC/liveliness/payment-hold eligibility | Snapshot policy decision into obligation; holds retain liability and cannot erase it | DESIGNED / BLOCKED_G3 |
| FI-037 | External fees and gas | Explicit estimated/actual fee journal postings, max-fee policy, fee-bump/replacement limits | DESIGNED / BLOCKED_G3 |
| FI-038 | Transaction finality/reorg handling | Chain-specific confirmation/finality state; reorg returns to reconciled state without second settlement | DESIGNED / BLOCKED_G3 |
| FI-039 | User payout-address changes | Chain ownership proof, step-up, notification, delay/hold, operation binds destination version | DESIGNED / BLOCKED_G3 |
| FI-040 | Legacy private keys/mnemonics/WIF/PEM/SystemSecret wallet entries | Values excluded from import; fingerprint, rotate/retire/manual asset-transfer inventory and destruction evidence | INTENTIONALLY_CHANGED / BLOCKED_G3/G4 |
| FI-041 | Third-party custodial wallet option | No current custodian; reject as default, retain as explicit contingency with contractual/API/withdrawal/insolvency review | DESIGNED / BLOCKED_G3 |
| FI-042 | Canister-controlled ICP/ICRC accounts and direct donations | Unified treasury owns and executes approved ICP/ICRC operations with ledger dedup/reconciliation; donations credit once by ledger/block identity and the published receiving account fixes scope, while a memo is untrusted metadata unless a separate caller-bound ownership proof is recorded | DESIGNED / BLOCKED_G3 |
| FI-043 | Direct external-chain addresses via Chain Fusion | Approved target for native-chain custody after complete chain-specific state/finality prototype passes | DESIGNED / BLOCKED_G3 |
| FI-044 | Upgrade/controller control over custody | One SNS-controlled treasury; no blackhole; governance delay, caps, pause-only role, reproducible upgrades, controller verification, and recovery drill | DESIGNED / BLOCKED_G3 |
| FI-045 | Controller compromise response | Pause, SNS governance delay/recovery, caps, module verification, credential rotation, chain reconciliation; no blanket trust claim | DESIGNED / BLOCKED_G3 |

## External integrations

| ID | Legacy feature/evidence | ICP target and acceptance | Migration status |
| --- | --- | --- | --- |
| EX-001 | OpenAI API immediate/batch/web-search | `llm` direct calls (including supported web-search use), scoped key/spend limits, hard payload/operation bounds, redacted audit, deterministic result validation; provider batch mode is retired | INTENTIONALLY_CHANGED / BLOCKED_G2 |
| EX-002 | Didit KYC/liveliness | Pinned `join-proxy`/`join-proxy-client.mo` evaluation with configurable allowlisted HTTPS endpoint, reusable-proof consent/freshness/subject binding/cost accounting, signed callback/event dedup/ordering, G2 evidence lifecycle, shared outbound-call bounds, and tested direct-provider fallback | DESIGNED / BLOCKED_G2 |
| EX-003 | GitHub OAuth | Immutable provider subject, caller-bound state, token minimization/rotation | DESIGNED / BLOCKED_G2 |
| EX-004 | ORCID OAuth | Same identity-evidence contract with provider-specific protocol tests | DESIGNED / BLOCKED_G2 |
| EX-005 | Bitbucket OAuth | Same identity-evidence contract with immutable account UUID | DESIGNED / BLOCKED_G2 |
| EX-006 | GitLab OAuth | Same identity-evidence contract with immutable provider subject | DESIGNED / BLOCKED_G2 |
| EX-007 | SMTP/nodemailer verification/plea email | HTTPS email provider or reviewed relay, durable outbox, provider idempotency, no private SMTP keys in frontend | DESIGNED / BLOCKED_G2 |
| EX-008 | World Bank GDP API; a legacy path uses plaintext HTTP | HTTPS-only outcall, schema/freshness/source hash, cached versioned snapshot | INTENTIONALLY_CHANGED / BLOCKED_G2 |
| EX-009 | CoinGecko token prices | HTTPS outcall, allowlisted response/size, timestamp/freshness, non-authoritative pricing policy | DESIGNED / BLOCKED_G2 |
| EX-010 | Reown/wallet connectors | Browser-only user funding/ownership proof; dependency/CSP/supply-chain review | DESIGNED / BLOCKED_G3 |
| EX-011 | EVM RPC providers | EVM RPC canister/approved providers, quorum/disagreement/finality/cost policy | DESIGNED / BLOCKED_G3 |
| EX-012 | Solana/Cosmos/Polkadot/Stellar/BCH RPCs | Chain-specific allowlists, deterministic transform/quorum/finality, cycle/rate budgets | DESIGNED / BLOCKED_G3 |
| EX-013 | ICP/ICRC ledgers and chain-key minters | Pinned canister IDs/standards/fees, archive queries, dedup/reconciliation tests | DESIGNED / BLOCKED_G3 |
| EX-014 | Provider outages/rate errors | Shared allowlisted outbound-call policy with deadline, request/response bytes/schema, redirect, HTTPS credential transport, correlation ID, durable retry/backoff/budget/circuit breaker; no repeated financial effect | DESIGNED / BLOCKED_G2/G3 |

## Data, constraints, and migration parity

| ID | Legacy feature/evidence | ICP target and acceptance | Migration status |
| --- | --- | --- | --- |
| DM-001 | 21 Prisma models | Every model/field maps in `SCHEMA_MAPPING.md`; count/hash/type golden tests | DESIGNED / BLOCKED_G2 |
| DM-002 | Unmanaged `ai_result_migration_exceptions` physical table | Explicit 22nd table export/import/count/hash and restricted payload handling | DESIGNED / BLOCKED_G2 |
| DM-003 | 18 SQL migrations and Prisma migration history | Hash/record migration SQL, physical schema, sequence state, data-rewrite exceptions | DESIGNED / BLOCKED_G2 |
| DM-004 | All PKs, uniques, indexes, relations, delete rules | Versioned Motoko records and the explicit ZenDB collection/index/grant/limit catalogue are in `M1_STORAGE_SCHEMA_AND_SAGAS.md`. The local-only `storage_authority` scaffold has a fixed six-principal Motoko RBAC matrix, one fixed read/write probe for every declared collection, governance-only audit, no caller-selected collection/action, and no generic ZenDB/grant API. Its identity-free `test-storage-authority-boundary.sh` replacement pins PocketIC 12.0.0 and uses only synthetic principals through Mops 2.19.2's lock-pinned Pic client and Mops-pinned Motoko 1.4.1: anonymous/bootstrap/unrelated direct ingress, malformed IDs, cross-owner collection access, unrelated-canister, and governance-as-data access are denied; every declared collection's matching owner can use only its fixed actual inter-canister probes; only governance audits; and an EOP-preserving upgrade supplied a different valid matrix cannot replace the persisted one. It never invokes DFX, persists no target data, and remains neither a ZenDB nor future-state mutation/recovery proof. The exact source/lock probe compiles a private in-process `VersionedStableStore` in ZenDB and repository compiler modes. Both `core@1.0.0` and `core@2.2.0` are locked, but ZenDB's unqualified import cannot select the latter, so no target dependency was added. The pinned candidate's synthetic PocketIC remote-RBAC baseline proves ungranted and collection-scoped-writer negatives plus collection isolation (`test-zendb-rbac.sh`/`v2.0.1.rbac-proof.json`). The target-data runner retains local proof for logical-ID recovery, owner lost-reply/duplicate reconciliation, archive non-activation, and bounded v1→v2 repair. Its owner-controlled exact-artifact upgrade proof failed on 2026-08-07: ZenDB `v2.0.1` restored the revoked bootstrap admin grant after upgrade (`test-zendb-authoritative.sh`/`v2.0.1.authoritative-proof.json`). It is therefore ineligible as authoritative storage; G2 needs a named collection-specific native-Motoko exception or a later pin must pass the proof. | IN_PROGRESS / BLOCKED_M1/G2 |
| DM-005 | 17 explicit Prisma transaction call sites | M1 now specifies the native intent/version/hash/manifest recovery state machine. The pure `MutationRecovery.mo` vectors prove exact desired-version/hash acknowledgement, identical-only retry from an absent or unchanged complete CAS target, fail-closed partial/malformed/concurrent cases, and bounded pending-only manifest activation. It persists no target data and is not a storage-authority mutation/recovery proof; Motoko authorization and fault injection at every phase remain required | IN_PROGRESS / BLOCKED_M1/G2 |
| DM-006 | Non-transactional financial/task/KYC/AI sequences | Correct target semantics, preserve resulting legacy history/exceptions | INTENTIONALLY_CHANGED / BLOCKED_G2/G3 |
| DM-007 | PostgreSQL `SERIAL` IDs | Exact stable `legacyId` maps to a unique application logical ID with no reuse and disjoint new allocation; the versioned mapping and golden vector are committed in `CANONICAL_EXPORT_IMPORT_CONTRACT.md`/`canonical-v1-vectors.json`; generated ZenDB document ID is non-authoritative metadata unless caller-supplied IDs are proven against the pin | IN_PROGRESS / BLOCKED_M1/G2 |
| DM-008 | `TIMESTAMP(3)` without timezone | Recorded timezone assumption/source form; ambiguity report blocks activation | DESIGNED / BLOCKED_G2 |
| DM-009 | `Decimal(65,30)` and double precision | Tagged exact source; base-unit/fixed-point target projection, no silent rounding | DESIGNED / BLOCKED_G2 |
| DM-010 | Nullable unique semantics permit multiple nulls | Target unique index omits null and property tests match PostgreSQL | DESIGNED / BLOCKED_G2 |
| DM-011 | JSON/JSONB and serialized ownership | Lossless canonical numeric/string encoding; typed parsed target plus original hash | DESIGNED / BLOCKED_G2 |
| DM-012 | Deterministic source export | One approved logical-slot exported snapshot, explicit approved/redacted projections and ordering, canonical JSONL, repeatable roots; the v1 byte/tag/hash format and invented golden vectors are committed, while no exporter or capture has been implemented | IN_PROGRESS / BLOCKED_M1/G2 |
| DM-013 | Bounded chunks | ≤ approved row/byte limit, large-row fragments, hash chain/Merkle roots; the v1 schema fixes the proposed limits and header shape, while benchmarked export/import handling remains unimplemented | IN_PROGRESS / BLOCKED_M1/G2 |
| DM-014 | Authenticated/idempotent/resumable import | Manifest/principal/module-bound application session; durable local intent plus logical-key/hash-confirmed ZenDB receipt; no direct importer DB role; duplicate no-op/conflict rejection. The authorization/receipt shape is defined only; no import API or grant exists | IN_PROGRESS / BLOCKED_M1/G2 |
| DM-015 | Partial batch/duplicate detection | Invisible pending fragments, exact logical-key/hash reconciliation after unknown results, acknowledged manifest activation, no blind duplicate or implicit winner | DESIGNED / BLOCKED_G2 |
| DM-016 | Live writes after base snapshot | G2-proven logical slot/publication created before the exported base snapshot; complete replica-identified source transactions from its consistent point through final barrier LSN, durable target acknowledgement before source watermark advance; direct CDC excludes sensitive tables and any redacted outbox flows inside that same stream. No generic/polling trigger fallback without equivalent commit-order proof | DESIGNED / BLOCKED_G2/G4 |
| DM-017 | Source/destination verification | Source and target-projection row/table/Merkle hashes, counts, relations, indexes | DESIGNED / BLOCKED_G2 |
| DM-018 | Separate financial history reconciliation | Chain evidence, exact asset equations, ambiguous hold, signed exceptions | DESIGNED / BLOCKED_G3/G4 |
| DM-019 | Dry run and fault injection | Local/testnet only; repeat slot-exported snapshot; interruption at capture/snapshot/transaction/target-ack boundaries; replica-identity, WAL-pressure, redaction-leak, duplicate/upgrade/low-cycle tests; zero assets | DESIGNED / BLOCKED_G2 |
| DM-020 | Machine-readable report | Canonical JSON Schema report with counts/hashes/exceptions/approvals/zero unexplained difference | DESIGNED / BLOCKED_G2 |
| DM-021 | Secret/private-key migration | Base/delta/direct-CDC/redacted-outbox/report/log scans exclude `SystemSecret.value`, bearer, and raw verification values; source-side one-way metadata projection plus separate fingerprinted disposition only | DESIGNED / BLOCKED_G2/G3 |
| DM-022 | PostgreSQL deletion/retention history | Source backup/export retained; no production mutation until G4; no history lost in tombstone conversion | DESIGNED / BLOCKED_G4 |

## Deployment, testing, monitoring, and governance

| ID | Legacy feature/evidence | ICP target and acceptance | Migration status |
| --- | --- | --- | --- |
| OP-001 | Backend/frontend Node builds and root workspace dependencies | Keep root install/build/test commands green throughout migration; no subfolder installs. The retained frontend has a TypeScript-aware ESLint 9 flat config and `npm run lint --workspace frontend` passes; ESLint is development-only and its React-plugin compatibility pin is recorded in `DEPENDENCY_INVENTORY.md`. | AUDITED / ongoing invariant |
| OP-002 | Express serves Vite assets and API; BrowserRouter fallback | Certified asset canister plus direct canister actors/HTTP callback where required | DESIGNED / BLOCKED_M1 |
| OP-003 | Docker/Fly staging/production deployment | Preserve legacy rollback deployment; add reproducible `dfx`/Wasm/module-hash pipeline | DESIGNED / BLOCKED_G2 |
| OP-004 | Stable-branch workflow can deploy production automatically | Require reviewed immutable artifacts, environment protection, governance approval, module/controller verification | INTENTIONALLY_CHANGED / BLOCKED_G2 |
| OP-005 | Mutable npm install/base image behavior | Locked dependencies and reproducible/SBOM/scanned builds for legacy and Motoko toolchains | DESIGNED / BLOCKED_G2 |
| OP-006 | Staging configuration enables some real mainnets | Testnet/local chain endpoints and test keys only; automated environment guard rejects mainnet/real funds | INTENTIONALLY_CHANGED / BLOCKED_G2/G3 |
| OP-007 | CI build/test steps partly commented/limited | Format, lint, typecheck, build, unit/property/integration/PocketIC/upgrade/security/parity jobs required | DESIGNED / BLOCKED_G2 |
| OP-008 | Unit/integration suites | Preserve safe legacy tests; add target and differential tests; destructive DB suites require disposable-DB proof | DESIGNED / BLOCKED_G2 |
| OP-009 | DB financial tests delete all distribution/pending rows and accept inherited `DATABASE_URL` | Add hard non-production database guard before ever running; never point at shared/production DB | INTENTIONALLY_CHANGED / BLOCKED_G2 |
| OP-010 | No complete backup/restore/reconciliation runbook | Tested PG restore, slot-exported snapshot/contiguous-delta capture with WAL/slot recovery, canister upgrade/forward-repair, canonical replay, financial and rollback rehearsal | DESIGNED / BLOCKED_G2/G4 |
| OP-011 | Process logs/provider logs | Structured redacted append-only audit, correlation/operation IDs, bounded retention/export | DESIGNED / BLOCKED_G2 |
| OP-012 | Service/cron health endpoints | Canister cycle/memory/timer/schedule/index/archive/provider/ledger health and alerts; no AI-task queue metric | INTENTIONALLY_CHANGED / BLOCKED_G2 |
| OP-013 | Cycle and stable-memory capacity | Measured expected/2×/failure limits, per-operation budgets, shard/upgrade/low-cycle alerts | DESIGNED / BLOCKED_G2 |
| OP-014 | Controllers and deploy credentials | Recorded human SNS launch/ownership decision; local/PocketIC SNS controller proof; least controllers, emergency pause-only role, module transparency; G4-only isolated non-custodial mainnet testflight with a bounded approved cycle budget and recovery/abort evidence before the separately reviewed production handoff | DESIGNED / BLOCKED_M1/G3/G4 |
| OP-015 | Canister upgrades | Stable/Candid signature gates, production-shaped snapshot tests, ZenDB RBAC preservation/audit and drained-intent collection-vN switch, no authoritative reinstall | DESIGNED / BLOCKED_G2 |
| OP-016 | ZenDB dependency | ZenDB `v2.0.1` source/dependency/Candid/Wasm baseline remains pinned, but it is not an authoritative or archive-store candidate: the 2026-08-07 owner-controlled exact-artifact upgrade proof showed that it restores a revoked bootstrap admin grant. The Motoko 1.4.1 repository compiler accepts the isolated exact-source probe, but Mops cannot resolve ZenDB's unqualified `core@2.2` closure alongside source-identical identify's unqualified `core@1` closure. No dual compiler, target dependency, or compatibility fork is approved. The bounded benchmark and other local evidence remain diagnostic only. A G2-approved named native-Motoko exception is required per affected collection, or a later exact pin must pass the complete proof suite; do not assume an unmerged/future PR. | IN_PROGRESS / BLOCKED_M1/G2 |
| OP-016a | Repository licensing | The AGPL-3.0-only license and corresponding package metadata changes are already complete and recorded in `9122ff0`; no additional relicensing work or M1 gate remains | VERIFIED |
| OP-016b | Retained React frontend build chain and legacy Node retirement | React/Vite/TypeScript is retained as a pinned reproducible build that deploys only certified static frontend-canister assets; no Node runtime is in a canister. The legacy Node backend/REST deployment remains runnable through the rollback window, then is retired at M10 without removing the target frontend build chain | DESIGNED / BLOCKED_M1/M10 |
| OP-016c | Production dependency advisories | Root-workspace rollback/frontend closure, exact pins, `npm ci`, scan evidence, and high-finding containment are recorded in `DEPENDENCY_INVENTORY.md`; the 2026-08-07 production-only scan found 855 dependencies and 13 high/0 critical findings, which block shipment. Remove adapters only in an approved compatibility change; upgrade only through compatibility tests; document acceptance for every remaining high/critical advisory | IMPLEMENTED / BLOCKED_M1/G2 |
| OP-016d | PII lifecycle and public identifier disclosure | Before sensitive collection/import or public projection, record purpose/data controller/legal basis, minimization, encryption/key access, retention/cryptographic erasure, backup/restore, access audit, accounting/anti-evasion exceptions, and per-field public disclosure/consent; default deny raw social/wallet correlation | DESIGNED / BLOCKED_G2 |
| OP-017 | Custom domain/TLS/assets | ICP boundary/custom-domain setup, certificate/certification/deep-link/cache/CSP verification | DESIGNED / BLOCKED_G4 |
| OP-018 | Mainnet production migration | Full sanitized rehearsal, signed reconciliation, rollback rehearsal, G4 approval, separate manual asset actions | BLOCKED_G4 |
| OP-019 | Legacy retirement | Only after observation, parity, data/money reconciliation, key disposition, audit/retention approval | BLOCKED_G4/M10 |

## Required evidence for status changes

For a row to become `VERIFIED`, its acceptance behavior must have:

1. a linked implementation commit and interface/schema version;
2. positive, negative, authorization, replay/idempotency, bounded-work, and upgrade tests proportional to risk;
3. formatting, typecheck, build, test, and diff/security review evidence in `PLANS.md`;
4. source-to-target differential evidence where legacy intended behavior exists;
5. count/hash/relation evidence for migrated state and separate financial evidence for money rows;
6. rollback point and observed recovery result;
7. explicit approval at G2/G3/G4 where the row crosses that gate.

Any newly discovered legacy endpoint, scheduled task, provider call, data table, wallet asset/network, admin capability, frontend route, or operational script is added here before implementation continues.
