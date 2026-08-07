# ICP migration execution plan

Last updated: 2026-08-07

Status: `M1_EMPIRICAL_SCHEMA_AND_STORAGE_DESIGN` — IN_PROGRESS. G1 is approved and the AGPL-3.0-only license/metadata change is complete. No target migration application code has been changed; the M1 lint tooling change preserves legacy behavior.

## Status vocabulary

- `NOT_STARTED`: no implementation exists.
- `IN_PROGRESS`: active work is within an approved milestone.
- `IMPLEMENTED`: code exists but has not passed every acceptance/reconciliation check.
- `VERIFIED`: acceptance criteria passed and evidence is recorded.
- `BLOCKED`: a listed dependency or one of the four approval gates is unmet.
- `INTENTIONALLY_CHANGED`: legacy behavior was unsafe/incorrect and the approved target behavior differs.

## Global execution protocol

For every milestone:

1. Restate its invariants and acceptance criteria.
2. Implement the smallest coherent change in a reviewable commit.
3. Add or update tests, including negative/failure-path tests.
4. Run formatting, type checking, builds, upgrade checks, and relevant tests.
5. Review the diff for regressions, authorization gaps, replay/reentrancy, unbounded work, data loss, and secret/fund exposure.
6. Update this file and `docs/icp/PARITY_CHECKLIST.md` with evidence.
7. Continue to the next unblocked milestone, stopping only at the four gates below.

No production mutation, production logical replication, DNS cutover, mainnet canister deployment, legacy-key transfer, or real-asset transfer is allowed before its stated milestone and gate.

### Legacy safety bridge during migration

The legacy Node/PostgreSQL service remains recoverable until M10, but this plan does not approve continued real-asset custody or automatic payment retry through its known unsafe paths. Until a separately approved, narrowly scoped legacy-hardening change proves otherwise, production payment senders stay paused, no missing wallet key is generated, and an unknown legacy send is held for manual chain reconciliation rather than reset or retried. Any exception must name the asset/scope, accountable operator, compensating controls, expiry, and rollback action; it does not waive the target G3/G4 requirements.

The legacy browser bearer-token path is rollback-only. If it remains Internet-facing before M10, it needs an explicitly approved compatibility hardening plan for bearer storage and CSP; it must not be treated as equivalent to the target Candid-principal authentication model.

## Implementation task-card requirements

Every implementation prompt derived from a milestone must stand alone. It must state its objective; the applicable milestone, gate, invariants, and security constraints; the files/subsystems to inspect; exact required and prohibited changes; tests/validation and evidence commands; acceptance/completion criteria; and its rollback boundary. It must explicitly preserve the legacy application, production data, production signing authority, and unrelated user changes unless the approved milestone says otherwise. A task card that depends on a prior design decision must name that decision and stop as `BLOCKED` when its gate or evidence is absent.

## Approval gates

These are the only planned approval stops.

| Gate | Status | Decision being approved | Evidence required to request approval |
| --- | --- | --- | --- |
| G1 — Target architecture | **APPROVED 2026-08-01** | Canister boundaries, ZenDB-authority feasibility policy, external-dependency boundary, retained React frontend in a certified canister, completed AGPL-3.0-only licensing change, and SNS-governed unified treasury direction | Approval evidence: the exact AGPL-3.0-only text is in `LICENSE.txt`, with corresponding package metadata changes recorded in `9122ff0`. |
| G2 — Database schema and migration design | BLOCKED by G1 | Concrete Motoko/ZenDB types/indexes, exact legacy transformations, canonical export format, importer protocol, OAuth-to-caller binding protocol, reconciliation queries, cutover delta mechanism, public-identifier disclosure boundary, and PII lifecycle policy | Read-only production inventory; exact ZenDB source/dependency/Candid/Wasm pins and Motoko `identify` package version/source/package/API hashes; authoritative-mutation, logical-ID, RBAC, OAuth state/PKCE/caller-binding, upgrade, recovery, outbound-call, and quota proofs; recorded data-controller/legal-basis, retention, cryptographic-erasure, backup, access-audit, anti-evasion/accounting exception, and public-identifier/consent decisions; PostgreSQL logical-decoding/exported-snapshot, replica-identity, commit-order, WAL-retention, and sensitive-column redaction proofs; schema/property tests; golden export/import dry run; revised `SCHEMA_MAPPING.md` and runbook |
| G3 — Wallet custody and authorization | BLOCKED by G2 | Asset custody per network, unified Chain Fusion treasury and SNS controller model, payout authorization, finality/reorg policy, legacy-key retirement, incident response | Threat model; test-key prototypes; replay/ambiguous-send/finality tests; local/PocketIC SNS-controller and governance-recovery drills; recorded human decision naming the production SNS launch/ownership model, applicable `sns_init`/tokenomics or existing-SNS configuration, and root-handoff/recovery policy; independent wallet review; revised `WALLET_SECURITY.md` |
| G4 — Testnet-to-production migration | BLOCKED by G3 | A non-custodial mainnet SNS testflight with an approved cycle budget, then mainnet production deployment, production data cutover, DNS/frontend cutover, and separately authorized real-asset movement | Full dress rehearsal from sanitized snapshot; source/destination and financial reconciliation; rollback rehearsal; controller/module plus exact ZenDB pin/RBAC/intent checks; testnet parity; reviewed G4 testflight/recovery runbook with isolated canister IDs, bounded approved cycles, test-only derivation/environment, no custodial assets, and an abort proof; independent security sign-off |

Approval of G4 authorizes only the reviewed runbook steps. Each real-asset transfer remains a deliberate manual runbook action with recorded transaction details; automated tests never move real assets.

## Milestone plan

### M0 — Repository discovery and planning baseline

Status: **VERIFIED** (documentation-only)

Dependencies: none.

Invariants:

- The legacy source remains unchanged and runnable.
- No database, external account, canister, or asset is mutated.
- Unknown live-data facts remain explicitly unknown rather than guessed.

Scope/evidence:

- Audited 193 tracked files, 21 Prisma models, 18 SQL migrations, 22 physical tables (including unmanaged `ai_result_migration_exceptions`), all Prisma call sites, 17 explicit Prisma transactions, REST routes, auth/authorization, task graph, timers/cron, wallet adapters, frontend calls, tests, Docker/Fly/GitHub Actions, scripts, and checked-in operational documentation.
- Current live row counts are unavailable because no `DATABASE_URL` is set. Numeric capacity figures in design documents are target envelopes, not claims about production data.
- Identified legacy financial and authorization defects that must be reconciled, not copied; see the risk register below and `PARITY_CHECKLIST.md`.
- Baseline verification under Node.js v26.5.0/npm 12.0.1 (`nvm use stable`): root backend+frontend production build passed; backend security suite passed (1/1). Frontend lint did not reach source analysis because ESLint 10 requires `eslint.config.js` while the repository still uses the legacy configuration. This pre-existing tooling gap is recorded below and must be corrected in a small post-G1 tooling commit.

Acceptance:

- Required planning files exist and cross-reference each other.
- Every Prisma model/physical table and explicit transaction has a proposed disposition.
- No application-code diff exists.

Rollback: revert only the planning-document commit.

Suggested commits:

1. `docs: record ICP migration architecture and engineering rules`
2. `docs: map schema, custody, migration, rollback, and parity`

### G1 — Target architecture approval

Status: **APPROVED 2026-08-01**.

Approved without amendments: the six architecture choices summarized at the end of `docs/icp/ARCHITECTURE.md`, including the completed AGPL-3.0-only licensing change. The approval does not authorize work beyond M1, production mutation, a wallet policy, an SNS launch, or any asset transfer.

### M1 — Empirical schema and storage design

Status: IN_PROGRESS.

Dependencies: recorded G1 approval; read-only access to a production snapshot or a DBA-produced inventory report.

Invariants:

- Inventory queries are read-only and redact secret values.
- No production table, slot, trigger, row, or index is changed during sizing.
- The read-only inventory records PostgreSQL version and logical-decoding prerequisites, every table's replica identity and update/delete key, active prepared-transaction policy, publication/slot capacity, WAL-retention limits, and the approved source-side redaction projection for every credential/secret column. No general base or delta artifact may contain `SystemSecret.value`, session bearer values, raw email/KYC verification values, private keys, or credentials.
- The completed AGPL-3.0-only license and metadata change remains part of the repository baseline; no additional relicensing work is in scope for M1.
- ZenDB is the proposed persistent store for imported PostgreSQL/Prisma records and target document collections, including identity, balances, payment operations, replay journals, and migration receipts where M1 proves the required atomicity, boundedness, recovery, and upgrade behavior. Motoko application code remains the enforcement point for authorization, canonical encodings, and financial constraints; ZenDB constraints/indexes are defense in depth, not a substitute.
- M1 is blocked until an authoritative-ZenDB design is proven with a mutation/recovery protocol for every multi-record and cross-canister invariant. A remote ZenDB call may introduce an `await`; the resulting durable saga must journal before the call, be idempotent on redelivery, and leave no partially activated authority. If that proof fails for a collection, G2 must record a narrowly scoped native-Motoko exception and its rationale rather than silently falling back for all authority.
- Application and ZenDB authorization are separate enforcement layers. The pinned remote ZenDB must grant each application canister only collection-scoped read/write capabilities, reserve administration for the approved governance/SNS principal, deny browser/user/direct-importer ingress, and revoke bootstrap/deployer grants before authoritative use. “Collection-scoped” must be implemented by a pinned, tested native grant or by a separate ZenDB deployment for that grant boundary; the plan does not assume unsupported per-collection RBAC. M1 must inventory and justify any library-required self-grant and prove exact grants survive upgrades without privilege expansion.
- An application logical ID/idempotency key is distinct from ZenDB's internal document ID. G2 is blocked until the pinned API proves either deterministic caller-supplied document IDs or a unique indexed application logical-ID field with conflict lookup and content-hash reconciliation. For an unknown remote result, the desired hash means success; an absent insert or an unchanged expected prior version/hash permits the identical insert/CAS retry; any other hash/version is a conflict. No retry invents a new key or blindly inserts a second document.

Small changes/commits:

1. **IMPLEMENTED 2026-08-01:** Added pinned ICP/Motoko/Mops toolchain manifests, empty interfaces, and the credential-free `oauth_fixture`; `docs/icp/TOOLCHAIN_AND_OAUTH_EVIDENCE.md` records the exact `identify` package/source/API hashes, provider-capability matrix, package limitations, and validation commands. This is design/fixture evidence only: no provider, OAuth client, credential, login, target authorization, or legacy behavior has been enabled or altered.
2. **IMPLEMENTED 2026-08-01:** Added `npm run inventory:postgres --workspace backend -- --output /secure/operator-only/m1-inventory.json`, documented in `docs/icp/POSTGRES_INVENTORY.md`. It starts a `SERIALIZABLE, READ ONLY, DEFERRABLE` transaction with a read-only startup default; produces only aggregate/capability/redaction metadata for all 22 physical tables; fails on a source-table mismatch; and contains no publication, slot, trigger, outbox, DDL, or row-write SQL. The command loads an ignored `backend/.env` when present without overriding an operator-supplied environment value; its failure output is limited to a safe authentication, permission, reachability, validation, or generic-query category. Unit tests prove the source-table boundary, prohibited-value exclusion, and redaction-safe failure classification. A 2026-08-07 attempt confirmed the local `DATABASE_URL` was loaded but returned only `INVENTORY_QUERY_FAILED`, with no report produced and no URL, endpoint, credentials, SQL, or row values emitted. M1 acceptance remains incomplete until a DBA resolves the read-only connection/query condition and the aggregate report is collected.
3. **IN_PROGRESS 2026-08-02:** Pinned the released ZenDB `v2.0.1` source commit, complete Mops dependency lock, reproducible generated Candid/Wasm hashes, and a local-only reproducer in `third_party/zendb/v2.0.1.pin.json`, `scripts/icp/verify-zendb-pin.sh`, and `docs/icp/ZENDB_PIN_AND_BASELINE.md`. The evidence also records the non-byte-reproducible generated stable signature and its G2 compatibility gate. `scripts/icp/test-zendb-rbac.sh` validates the exact source/lock then runs the candidate's synthetic PocketIC remote-canister RBAC baseline, proving ungranted and collection-scoped writer negatives plus collection isolation; its exact coverage and exclusions are pinned in `third_party/zendb/v2.0.1.rbac-proof.json`. `scripts/icp/test-zendb-authoritative.sh` passed its corrected local-only runner against the remote candidate: a fresh ephemeral project-local loopback replica was health-checked before creation; every DFX operation named `--network local`; creation used `--no-wallet`; DFX used its built-in anonymous identity; Mops `install` was avoided; ingress/lifecycle operations were bounded to 180 seconds plus a 10-second kill grace, and exact O3 artifact builds to 360 seconds plus the same grace; and cleanup stopped the replica. The executed fixture proves unique logical-ID rejection, bounded logical-ID/hash recovery, and opaque one-document cursor advancement; its exact scope and exclusions are recorded in `third_party/zendb/v2.0.1.authoritative-proof.json`. `scripts/icp/test-zendb-benchmark.sh` passes the bounded synthetic expected/2× fixture on that boundary, measuring candidate-provided query/replace/delete instructions and document/index byte figures; its exact results, rejection-limit assertions, warning, and explicit gaps are recorded in `third_party/zendb/v2.0.1.benchmark-proof.json`. The previous Mops 2.19.2/pic-js-mops single-ingress path remains unsuitable for its 3,281,858-byte linked actor and is not claimed as execution evidence. The candidate is not yet authoritative: close the insert/reindex/archive/low-cycle measurement gaps, and add the remaining application durable-intent tests across actual lost reply/duplicate delivery, bootstrap and post-upgrade self-grant/grant audit, archive failure, crash/upgrade recovery, low-cycle, and repair/resume cases. An unmerged or future pull request is not evidence.
   The authoritative runner forces DFX's built-in anonymous identity for every canister operation, while replica lifecycle uses an isolated, disposable DFX config that is removed at exit; it therefore cannot select a developer PEM/keyring or wallet/signing authority. **FAILED 2026-08-07:** `M1UpgradeOwner.mo` gave a synthetic owner sole controller authority over an empty local `CanisterDB`, accepted only the SHA-256/length-bound exact pinned artifact, created a bounded synthetic collection, revoked its bootstrap admin grant, and upgraded the same artifact. The post-upgrade audit trapped because ZenDB `v2.0.1` restored that revoked bootstrap admin grant. This fails the M1 post-upgrade RBAC invariant: the candidate is not authoritative for any collection. Do not repair the proof with state replacement or a broader installer. G2 must either record a named, collection-specific native-Motoko exception or approve a later exact ZenDB pin only after it passes this proof. A read-only upstream tag check on 2026-08-07 found no released successor to `v2.0.1`; unmerged/future commits remain ineligible. Remaining eligible-candidate gaps are insert/reindex/archive/low-cycle measurements and complete crash/upgrade mutation recovery.
4. **IMPLEMENTED 2026-08-01 (design/scaffolding only):** Defined versioned Motoko records and the proposed ZenDB collection/index/limit/grant catalogue in `canisters/shared/StorageTypes.mo`, `canisters/shared/StorageCatalog.mo`, and `docs/icp/M1_STORAGE_SCHEMA_AND_SAGAS.md`. The contract fixes logical-ID/hash envelopes, native mutation intents, pending-data visibility manifests, exact collection-vN migration steps, and the lost-reply reconciliation rule. It adds no actor behavior, live principal grant, deployment, or production access. Its required local benchmark, RBAC-negative, interruption, upgrade, low-cycle, and repair/resume proof remains incomplete; no collection is yet authoritative.
5. **IMPLEMENTED 2026-08-01 (design/schema/vector evidence only):** Defined `meritocracy-migration-canonical-v1` in `docs/icp/canonical-v1.schema.json`, its source-ID-to-application-logical-ID mapping and base/delta/import contract in `docs/icp/CANONICAL_EXPORT_IMPORT_CONTRACT.md`, and byte/hash golden vectors in `test/canonical-v1-vectors.json`, exercised by `npm run test:canonical --workspace backend`. The local codec is data-only and cannot read PostgreSQL, create a slot/publication, grant access, or import data. The G2/M4 proof still requires an independently matching Motoko codec, explicit approved redacted source projections, a logical slot/publication created before the base export, all base workers using that slot's exported snapshot and consistent point, complete source-transaction commit order through the barrier LSN, and disposable PostgreSQL/ZenDB fault rehearsal.
6. **IMPLEMENTED 2026-08-01 (inventory only; shipment remains blocked):** `docs/icp/DEPENDENCY_INVENTORY.md` and its machine-checked lock record identify the root workspace `package-lock.json` as the rollback and retained-frontend-toolchain closure; all direct manifest versions are exact pins and `Dockerfile` now uses `npm ci`. The production scan found 13 high, zero critical findings, grouped with actual reachability, owner, containment, and a required upgrade/removal decision. No adapter was removed. `npm run inventory:dependencies` verifies the reviewed closure offline. No affected bundle is approved for shipment until the scan is clean or a compatibility-tested, explicitly accepted disposition is recorded.
7. **IMPLEMENTED 2026-08-07 (tooling only):** Added `frontend/eslint.config.js`, pinning the TypeScript-aware parser through `typescript-eslint@8.65.0`; ESLint is now the compatible `9.39.1` root development dependency because the retained React plugin cannot run on ESLint 10. The baseline parses every TypeScript/TSX frontend source, rejects stale disable directives, preserves React hook-placement enforcement, and rejects unsafe `target="_blank"` links; the two existing external links now include `rel="noopener noreferrer"`. `npm run lint --workspace frontend` and the frontend production build pass. The lock inventory and production-only audit were refreshed: 855 production dependencies, 13 high, zero critical. All high findings remain shipment-blocking; no production dependency, adapter, route, credential, database, canister, or wallet behavior changed.

Acceptance:

- Counts, sizes, max field lengths, status histograms, null/unique collisions, orphan checks, exact decimal ranges, sequence values, and unmanaged-table contents are recorded for all 22 physical tables.
- Benchmarks cover expected, 2×, and failure-limit sizes; every production query has an index/cursor plan below the instruction budget.
- The authoritative-ZenDB proof demonstrates that identity/role updates, financial journals/operations, replay receipts, and migration receipts preserve their stated invariant across duplicate requests, traps, upgrades, and remote-call interruption. It proves pending data cannot become authoritative before acknowledgement, unknown inserts and CAS updates reconcile by logical ID/version/hash without overwriting a concurrent result, and any required multi-document ZenDB-side atomic operation exists in the pinned API and is tested; any native exception is approved, collection-specific, and documented in `SCHEMA_MAPPING.md`.
- ZenDB direct-ingress and inter-canister negative tests prove that browsers, users, import operators, unrelated canisters, and revoked bootstrap/deployer principals cannot read sensitive collections or mutate any collection. Post-deploy and post-upgrade audits match the approved collection-scoped application grants and governance-only administration exactly.
- A disposable-PostgreSQL rehearsal proves that the logical slot/publication is created before every base snapshot; every base worker imports that exported snapshot; decoded transactions are contiguous from the slot consistent point through a final barrier LSN; update/delete replica identities and prepared-transaction behavior are handled; and a consumer crash never acknowledges an unverified delta. It also proves that source-side redaction excludes secret/bearer/raw-token values from base exports, publications, outbox rows, reports, and logs. A generic trigger outbox is not an automatic production fallback unless G2 proves an equivalent durable commit-order feed.
- The existing AGPL-3.0-only license and metadata baseline remains intact. ZenDB's exact source/dependency/Candid/Wasm hashes and logical-ID/hash reconciliation strategy are pinned and proven; upgrade and schema-version migration tests pass; all authoritative and archive data remains canonically exportable independent of ZenDB.
- Candid and stable signature baselines are committed; application types represent money exactly. The exact `identify` package/API hash and provider-capability matrix are recorded, and the caller-bound OAuth-attempt vectors reject an anonymous caller, state/caller swap, expiry, and unsupported provider before G2; this is design evidence, not a live provider deployment.
- The dependency inventory identifies every legacy rollback and target frontend/toolchain production dependency, records the advisory result, actual reachability, owner, containment, and upgrade/removal decision, and rejects an unaccepted high/critical advisory in a bundle proposed for deployment.
- Migration dry-run vectors produce byte-identical canonical chunks and hashes across repeated runs.

Rollback: remove un-deployed scaffolding/benchmarks; no legacy behavior or data has changed. A completed public AGPL-3.0 grant is not treated as revoked by rolling back later code; any license correction follows a documented, approved legal/notice disposition.

### G2 — Database schema and migration design approval

Status: BLOCKED by M1.

### M2 — Core Motoko domain and authorization

Status: BLOCKED by G2.

Dependencies: G2.

Invariants:

- A non-anonymous Candid caller principal is the authority root for every public method. Internet Identity and a verified OAuth subject are peer authentication factors for adding/recovering that caller binding; no bearer session, callback, request user ID, or caller-supplied principal grants authority by itself.
- Login identities, public handles, KYC evidence, and payout destinations are separate records.
- Canister quotas are bound to authenticated caller principal, provider, action, and bounded cost/bytes. A canister does not receive a trustworthy end-user IP address and never accepts one from a caller. If IP-based abuse controls remain necessary, a separately approved edge boundary enforces them and is not an authorization input.
- Raw KYC/identity evidence has a G2-approved purpose, data-controller/legal basis, retention/erasure schedule, backup treatment, access-audit role, and accounting/anti-evasion exception before it can be collected or imported. User-profile and ban-voting projections default to excluding raw social identifiers and user payout wallet addresses unless the G2 public-disclosure/consent decision explicitly permits a field and purpose; published treasury receiving addresses remain separately governed asset/scope configuration.
- Multi-record core changes use either one bounded ZenDB-side method proven atomic against the G2 pin or a durable idempotent intent/write/acknowledgement saga; no application-to-ZenDB call is treated as a single atomic message.
- User deletion cannot delete financial/evaluation/audit history.

Small changes/commits:

1. Core types, repositories, uniqueness/FK enforcement, cursor pagination, and upgrade tests.
2. Internet Identity integration and principal binding/recovery.
3. Use the exact M1-pinned Motoko `identify` OAuth package and implement the caller-bound OAuth factor protocol: a non-anonymous Candid caller begins a short-lived one-use attempt with provider, purpose, caller binding, state/nonce, redirect allowlist, and PKCE challenge; the certified React callback returns the authorization code/state/verifier only to `completeOAuth` from that same caller. The canister verifies the attempt, expiry, state, PKCE, configured client/redirect, provider-specific authorization-code/token/profile response, and immutable subject before it creates or recovers a principal binding; issuer/audience claims are verified where the provider supplies them. The callback or code never authenticates a method by itself, and tokens/codes/verifiers never enter browser history after handling, logs, or public/archive data. The M1 provider capability record selects a proven PKCE/public-client or confidential-client flow; any client secret is a scoped, encrypted, rotatable canister credential, never a browser value. Provider tokens are discarded after subject verification unless an approved feature needs one, in which case they are encrypted, scope-minimized, access-audited, and rotatable. Legacy identities require re-verification where source data lacks immutable IDs; unsupported provider flows are blocked or explicitly G2-approved as retired, never downgraded to a bearer or mutable-handle login.
4. KYC/liveliness integration, including a required `join-proxy` design/prototype. Inspect the pinned `https://github.com/vporton/join-proxy` service and `https://github.com/vporton/join-proxy-client.mo` client; use the client only against an allowlisted, configurable HTTPS proxy URL. Define the reusable-attestation/session protocol, consent and data-minimization boundary, proof freshness and subject binding, provider terms/eligibility, failure/expiry behavior, cost-accounting, and a direct-provider fallback that cannot double-charge or weaken AML/KYC controls. The endpoint still requires signature verification, event deduplication, monotonic state, AML precedence, and encrypted evidence policy.
5. Named role capabilities, pause-only incident role, immutable audit events, principal/provider/action/cost quotas, and governance-call interfaces. If approved, integrate an external edge quota configuration without trusting forwarded/caller-supplied IP data.
6. Ban voting/holds/compensation eligibility and deterministic UTC epochs.
7. Certified/sanitized public views.

Acceptance:

- Authorization matrix, horizontal-access, identity-confusion, replay, deleted-user, OAuth caller-binding/state/PKCE/configured-client+redirect/provider-response/issuer-where-present/subject-conflict/expired-attempt tests, KYC ordering, callback, quota, public-projection, and upgrade tests pass in PocketIC/local replica. Tests prove a callback, copied code, copied state, bearer token, anonymous caller, different caller, or caller-supplied IP cannot add/recover a binding or bypass a quota; an exact duplicate completion is idempotent; and an OAuth-authenticated recovery preserves the no-cross-account-merge and step-up/notification rules.
- `join-proxy` is not optional implementation debt: before M2 can complete, a pinned compatible client/service contract, configurable endpoint, privacy/security review, reuse-versus-direct-provider decision, and tests for reused, expired, mismatched, duplicate, unavailable, and direct-fallback KYC flows are recorded. Reuse must never convert an unverified proxy response into verified KYC or cause two provider charges for one logical verification.
- Before M2 can complete, record and test the G2-approved PII lifecycle: purpose/legal basis, field minimization, encryption/key access, retention/cryptographic erasure, backup and restore behavior, access-audit review, anti-evasion/accounting holds, and the public social/user-wallet disclosure policy. The default implementation exposes no raw user identifier in certified public or ban-voting views.
- Exact indexed ownership replaces serialized-JSON substring matching.
- The legacy app remains buildable and unchanged except explicitly approved compatibility hooks.

Rollback: undeploy local/testnet canisters or reinstall test-only state; production remains on Node/PostgreSQL.

### M3 — Direct evaluations, durable timers, and external integrations

Status: BLOCKED by M2.

Dependencies: M2.

Invariants:

- Jobs are at-least-once and idempotent; no in-memory lock is authoritative.
- Timers are recoverable from stable schedules after upgrades or cycle outages.
- Evaluation workflows do not create or persist live task, dependency, claim/lease, provider-batch, provider-item, or intermediate-operation records. A versioned Motoko function executes each fixed, bounded sequence of `llm` calls directly and keeps intermediate values local to that invocation.
- A direct evaluation reads the already-authoritative user/cycle/eligibility inputs and writes no execution state before its first `llm` call. Its only new durable business output is the canonical final result/source set; stable recurring schedules may retain aggregate due cursors and final completion receipts, but never per-evaluation task or intermediate state.
- Every direct evaluation has hard bounds on operation count, request/response size, cycles, and provider spend. Interruption or failure publishes no partial canonical result; an authorized caller or due scheduler may restart the whole bounded sequence, and deterministic cycle/result keys prevent duplicate final publication.
- ZenDB stores canonical results, sources, redacted audit metadata, and approved archive payloads according to the M1 authoritative-collection proof; it does not store new AI tasks. Legacy task/batch/dependency rows remain read-only migration history.

Small changes/commits:

1. Timer scheduler with stable deadlines/cursors, bounded user batches, completion receipts, and upgrade recovery; it invokes evaluations directly and creates no evaluation-task records.
2. Versioned first, repeat, and quarterly Motoko evaluators that execute the intended 14/6/5 bounded operations directly with the `llm` Motoko package, passing dependency outputs through local typed values rather than a stored DAG.
3. One shared HTTPS integration adapter with allowlisted hosts and redirects, HTTPS-only credential transport except documented loopback development, bounded request/response parsing, deadline, retry/backoff/circuit, provider/action cost budget, correlation/operation ID, and redacted audit. Deterministic transforms are used where replicated consensus requires them.
4. Canonical result/source publication with deterministic cycle/result keys. Do not implement OpenAI batch submission, polling, provider-item mappings, a task queue, or resumable intermediate task state; retain those legacy rows only in historical migration collections.
5. World GDP, token-price, email HTTPS-provider, the M2 caller-bound OAuth factor protocol, and Didit integration parity.
6. ZenDB result/audit/archive collection routing with cursor pagination, canonical export, reindex, collection-vN migration, and fault-injected authoritative mutation recovery.

Acceptance:

- Crash/restart/timeout/duplicate-trigger and timer-upgrade tests pass. An interrupted direct evaluation exposes no partial canonical result; rerunning it can publish at most one final result set for the deterministic cycle key.
- First, repeat, and quarterly code paths reproduce the intended 14/6/5-operation workflows and verified outcomes without writing live task, dependency, lease, batch, provider-item, or intermediate-operation records to stable memory or ZenDB.
- Tests enforce the configured operation/request/response/cycle/spend bounds and prove that later operations receive exactly the required earlier outputs through local typed values.
- External API keys are scoped/rotatable/spend-capped and excluded from logs/snapshots; compromise response is rehearsed. OAuth, KYC, email, GDP/price, and chain adapters all pass timeout, oversized/malformed response, redirect/host, circuit-open, correlation, and credential-transport negative tests.
- A ZenDB outage or partial final-result mutation cannot authorize or duplicate a canonical result/payment; the result publication saga makes the final record either unpublished or exactly recoverable without persisting execution tasks.

Rollback: route test traffic back to legacy services; discard test canisters. No production cutover.

### M4 — Deterministic migration tooling and shadow reconciliation

Status: BLOCKED by M3.

Dependencies: M3 and the G2-approved design, including the tested exact ZenDB pin, logical-ID strategy, RBAC grant matrix, remote-mutation saga, collection-vN upgrade protocol, and PostgreSQL delta-capture/redaction contract. If a required capability exists only in an unmerged or unpinned pull request, M4 remains blocked until an exact accepted commit is pinned and its behavior is proven, or G2 approves a documented design alternative.

Invariants:

- Export is read-only, snapshot-consistent, canonical, ordered, and deterministic.
- Import is authenticated, bounded, idempotent, resumable, and never calls wallet/ledger methods.
- Stable legacy IDs are preserved; all exceptions are explicit.
- Financial reconciliation is independent from general row/hash reconciliation.

Small changes/commits:

1. Read-only exporter, canonical codec, manifest/signature, chunker, and report schema.
2. Dry-run transformer and referential/unique/status validators.
3. Motoko/ZenDB staging-import protocol in which only the application importer is callable by the approved import principal. It records a durable local intent before every remote write; derives each staged record's application logical ID from the manifest/source key; uses unique `(migration,table,chunk)` plus payload hash for the authoritative ZenDB receipt; reconciles an unknown result by key/hash; and exposes a confirmed receipt only after the staged data and receipt hashes are acknowledged. If staging plus receipt must commit atomically inside ZenDB, use one bounded ZenDB-side method proven against the G2 pin rather than claiming cross-canister atomicity.
4. Full snapshot shadow import and repeated resume/fault injection.
5. Disposable-PostgreSQL delta-capture prototype: create the approved publication and logical slot before the base export, keep the replication connection open while base workers adopt its exported snapshot, and stream complete transactions from the slot consistent point through a final barrier LSN. Do not acknowledge/advance a slot until the corresponding canonical delta transaction is durable and target-acknowledged. Prove update/delete replica identities, prepared-transaction policy, crash/resume, slot-WAL exhaustion, and source schema freeze. Direct publication excludes sensitive tables; an audited source-side redacted projection/outbox may carry only non-secret metadata inside the same logical stream. A polling or generic trigger outbox without a proven total commit order is not a fallback.
6. Independent financial/history reconciler and ambiguous-payment exception workflow.

Acceptance:

- Repeated exports from one snapshot are byte-identical.
- Interrupted imports resume by reconciling local intents with ZenDB receipts by logical key and hash; duplicate identical chunks are no-ops; changed hashes are rejected; no blind duplicate insert is possible; partial record fragments and unacknowledged batches cannot become visible, including after interruption before, during, or after a remote ZenDB mutation.
- The importer has no direct ZenDB role. The application import capability expires after signed finalization; any separate staging-only application writer grant is revoked or downgraded, while a normal owning-application grant remains only where the approved live collection matrix requires it. Post-finalization negative tests and a grant audit prove import cannot resume or exceed that matrix.
- A base root and delta root prove contiguous source coverage from the logical slot's consistent point through the final barrier LSN. Each source transaction is staged and activated as one ordered target logical transaction/saga; no partial source transaction is visible and no later commit becomes authoritative before an earlier unresolved commit. Slot/publication/outbox identity, redaction-projection hashes, and no-secret scans are in the signed report.
- Counts/hashes/relations/uniques/source IDs match for all 22 physical tables.
- Secret values never appear in canonical data or reports.
- No method reachable in migration mode can transfer assets.

Rollback: discard shadow canisters and replication artifacts according to the runbook; PostgreSQL remains authoritative.

### M5 — Frontend canister and differential parity

Status: BLOCKED by M2–M4.

Dependencies: core/workflow/test migration.

Invariants:

- The frontend is a certified static ICP asset application with strict CSP and no third-party executable JavaScript.
- Calls use generated Candid actors. Internet Identity and OAuth are peer authentication factors, but every state-changing method authorizes only its non-anonymous Candid caller after the M2 caller-bound OAuth exchange has added or recovered that principal binding; no bearer token, OAuth callback, or caller-supplied user ID is authority.
- Legacy frontend/backend stays deployable through the rollback window; the target uses the retained React frontend only after the approved canister route is enabled.
- The target never stores an application bearer session in browser storage. A legacy REST rollback route may not be presented as an authenticated target path; if it remains Internet-facing, its separately approved compatibility hardening includes strict CSP without `unsafe-inline` and an XSS/session-theft test.

Small changes/commits:

1. Retain the React/Vite/TypeScript client and build it with a pinned Node.js toolchain into a certified frontend-canister asset bundle. Replace its legacy REST bearer-token path with generated Candid actors alongside the legacy REST client behind an environment flag. Node.js is a reproducible build dependency only and never runs in the frontend canister; the legacy frontend/backend remains runnable until M10.
2. Internet Identity and the M2 caller-bound OAuth (`identify`) UI flows: create a browser-held non-anonymous Candid identity before OAuth start; preserve state/nonce/PKCE verifier only for the bounded attempt; deliver the provider redirect to an allowlisted certified React route; immediately remove code/state from browser history; and complete only through the authenticated Candid actor. Include social/KYC evidence-link flows and the M2 `join-proxy` decision. Do not restore REST sessions, URL tokens, or a frontend-only OAuth identity binding.
3. User, evaluation, logs, voting, admin/governance, and treasury read parity.
4. Certified asset canister, SPA aliasing, alternative-origin plan, strict no-`unsafe-inline` CSP, browser-storage-free target authentication, and reproducible build.
5. Differential fixture/E2E suite against legacy and ICP behavior.

Acceptance:

- Every UI route and user-visible state in `PARITY_CHECKLIST.md` passes browser E2E tests; the retained React assets rebuild byte-for-byte from the pinned Node.js lockfile/toolchain, are served as certified frontend-canister assets, use no browser-stored application bearer, and do not restore the legacy REST bearer-token path. OAuth E2E covers start/callback/complete, refresh/new-browser recovery, state/code/caller swaps, expiry/replay, provider-subject conflict, redirect tampering, browser-history/log redaction, and CSP/XSS attempts.
- Stale `/api/posts` helpers and documented-but-absent endpoints receive an explicit `NOT_APPLICABLE` or implementation decision; no silent omission.
- Asset certification, module hash, controller, CSP, network-switch, and custom-domain tests pass.

Rollback: switch the environment flag/DNS back to legacy frontend; no authority has moved.

### M6 — Wallet design spike and threat model

Status: BLOCKED by G2 and M2.

Dependencies: approved schemas/roles; test keys only.

Invariants:

- No real funds or legacy production keys.
- A test controller compromise is contained by the reviewed test-governance/SNS harness's proposal delay, pause role, policy caps, reconciliation procedures, and tested recovery; no canister is blackholed. This proves the controller contract, not that a production SNS already controls a canister.
- Every chain has an explicit operation-ID, nonce/sequence/UTXO, finality, reorg, and ambiguous-result design.

Small changes/commits:

1. ICRC/ICP and ck-token unified-treasury test-ledger prototype.
2. BTC testnet/regtest Chain Fusion prototype.
3. EVM Sepolia EVM-RPC/t-ECDSA prototype.
4. SOL devnet and other network feasibility spikes; classify unsupported/maturity risks rather than faking parity.
5. Use pinned local SNS testing or PocketIC SNS/NNS subnets to prototype the SNS-root controller contract, unified treasury, pause/recovery, and adversarial threat model. Verify that the test canister accepts governance action only through that configured root, that the production handoff artifacts are complete, and that no test canister has an empty controller list. Do not claim that a production canister is SNS-controlled or deploy a mainnet canister at M6.

Acceptance:

- Duplicate, reentrant, timed-out, upgrade-interrupted, `TooOld`, nonce conflict, UTXO conflict, provider inconsistency, finality, and reorg tests pass.
- Exact cycle/fee/storage budgets and funding alarms are measured.
- An independent reviewer signs off on the design evidence, including the recorded human SNS launch/ownership decision and an executable G4-only mainnet-testflight/recovery runbook.

Rollback: delete only valueless test accounts/canisters; retain reports.

### G3 — Wallet custody and authorization approval

Status: BLOCKED by M6.

### M7 — Wallet implementation on test networks

Status: BLOCKED by G3.

Dependencies: G3.

Invariants:

- The unified treasury journal enforces operation idempotency before every ledger or Chain Fusion action.
- ICRC accounts/subaccounts and direct Chain Fusion addresses are selected per reviewed asset/network adapter; ck assets remain distinct from native external assets.
- Payout pause, policy caps, and operation idempotency cannot be bypassed by application shortcuts; their modification requires the approved governance controller and delay. The test controller must exercise the same authorization interface as the selected SNS root, but cannot stand in for a production SNS handoff.

Small changes/commits:

1. Append-only accounting/liability/payment-operation journal.
2. One test-governed Chain Fusion treasury canister that owns the journal, payment operations, ICRC accounts/subaccounts, and direct-chain derivation/signing state. It is not blackholed and has no separate vault canister. Pin and test the production SNS-root authorization interface locally/PocketIC; reserve the mainnet SNS-testflight root handoff, then the separately reviewed production SNS handoff, for G4.
3. ICRC/ICP and ck-token adapters.
4. Direct BTC/EVM adapters, followed by independently reviewed network adapters.
5. Payout destination proof/change-delay, direct-to-treasury donation/deposit, scoped treasury, confirmation/reconciliation, SNS recovery, and incident tooling.

Acceptance:

- Supply conservation and double-entry/property tests pass across all states.
- Legacy known duplicate/ambiguous cases are fixtures and cannot trigger automated sends. Before any test-network treasury implementation starts, an interim legacy-sender inventory proves all real-value automatic senders are paused or covered by a separately approved, expiring safety exception; no missing legacy wallet key is generated.
- Test networks demonstrate direct donation to a published treasury address/account, funding, mint/update-balance, payout, retry, confirmation, reorg recovery, pause, governance-controller upgrade/recovery, cycle top-up, and controller-compromise response with valueless assets. They include duplicate scanner delivery, two unrelated donations with the same memo, and a forged/unbound memo; each source observation credits exactly once and no memo grants identity, entitlement, or a different scope.

Rollback: pause the test treasury, reconcile, and discard test state. Production remains legacy.

### M8 — Full testnet dress rehearsal and cutover package

Status: BLOCKED by M4, M5, and M7.

Dependencies: every parity item whose implementation is pre-G4 is implemented; each G4-only parity item has an executable signed testflight, deployment, or cutover package.

Invariants:

- PostgreSQL remains authoritative during rehearsal.
- No production/private secret is used in testnet.
- Rehearsal follows the exact production scripts with only environment/IDs changed.
- The rehearsal exercises only local/PocketIC SNS or the reviewed pre-production governance controller. It does not assert a mainnet SNS handoff or an NNS-controlled Chain Fusion integration, which remain G4-runbook steps.

Acceptance:

- Full snapshot plus delta import, read-only shadow, final freeze/drain, reconciliation, frontend switch, rollback, and forward-recovery are rehearsed and timed.
- The rehearsal reproduces the exact ZenDB source/dependency/Candid/Wasm pin, exercises lost-result logical-ID/version/hash reconciliation, drains every native intent, and proves bootstrap/importer/staging grants are absent and live collection grants exactly match the approved matrix before target writes are enabled.
- The rehearsal creates its capture publication/slot before the exported base snapshot, proves the continuous slot-consistent-point-to-barrier-LSN chain under decoder restart and WAL pressure, and proves direct CDC, redacted outbox, artifacts, and logs contain no secret/bearer/raw-token value.
- All parity entries reachable before G4 are verified or explicitly approved as changed/not-applicable. Each G4-only entry has a complete, independently reviewed runbook and is not reported as verified before its authorized testflight/deployment evidence exists.
- Independent security and migration review is clean. The review includes a production dependency/advisory inventory: unused wallet/browser adapters are removed, every remaining high/critical advisory has a documented exploitability decision and containment, and no unaccepted high/critical finding affects a shipped legacy rollback bundle or certified frontend asset.
- Module hashes, controller transitions, cycles/freezing thresholds, monitoring, backup/export, and incident contacts are in the machine-readable report.
- The report includes the selected SNS launch/ownership decision, validated local/PocketIC SNS evidence, and the isolated G4 mainnet-testflight manifest/recovery procedure; it does not treat either as a completed mainnet handoff.

Rollback: execute `docs/icp/ROLLBACK_PLAN.md` against testnet and prove legacy recovery.

### G4 — Testnet-to-production migration approval

Status: BLOCKED by M8.

### M9 — Production deployment, migration, and observation

Status: BLOCKED by G4.

Dependencies: G4 approval and named operators present.

Invariants:

- Follow the signed runbook; no ad-hoc correction or transfer.
- Legacy PostgreSQL stays intact/read-only through the rollback window.
- Asset movement is separately reconciled and manually authorized.
- Before any production canister, data, DNS, or custody action, execute the G4-approved non-custodial mainnet SNS testflight on isolated canister IDs with a test-only derivation/environment and only its approved cycle budget. Verify SNS-root-only control, proposal delay, pause/recovery, upgrade, monitoring, and the documented recovery/abort path. A testflight failure aborts before production deployment; its canisters never receive production data or custodial assets.

Acceptance:

- Source/destination counts/hashes, constraints, histories, and exact finances reconcile.
- Deployed modules/controllers/config/cycles and exact ZenDB source/dependency/Candid/Wasm/RBAC hashes match approved values; all intents are acknowledged or explicitly blocked before writes are enabled.
- The production base snapshot is the approved slot-exported snapshot; its capture chain, replica identities, redaction hashes, transaction roots, and final barrier LSN match the signed report before ICP writes are enabled.
- Production smoke, auth, certified frontend, timers, external integrations, and read-only financial tests pass.
- The mainnet SNS testflight report proves its isolation, cycle accounting, controller/recovery result, and absence of production data, production derivation paths, custodial assets, and payment authority before the production deployment proceeds.
- Observation window closes with no unresolved severity-1/2 issue; final export/backup and cutover report are archived.

Rollback: execute the phase-specific branch in `ROLLBACK_PLAN.md`. After any ICP-side financial write, rollback means pause plus reconcile/forward-repair or a verified reverse delta; it never means blindly enabling the old sender.

### M10 — Legacy retirement

Status: BLOCKED by M9 observation window.

Dependencies: production acceptance and rollback-window closure.

Acceptance:

- The legacy Node.js backend, REST bearer-token path, and their deploy dependencies are retired only after the rollback window closes. The retained React/Vite/TypeScript frontend remains a pinned, reproducibly built frontend-canister asset bundle; no Node.js runtime runs in the canister. Legacy wallet keys are revoked/retired and their dispositions audited.
- PostgreSQL/Fly data is retained or destroyed under the approved retention policy, with a verified immutable export.
- Old DNS, legacy OAuth callback registrations, cron jobs, deploy tokens, API secrets, and funded addresses are disabled. The approved certified-frontend OAuth redirect registrations remain only while their pinned provider capability, caller-binding, and credential-rotation evidence is current.
- ICP TODO is removed only now, and final parity/completion evidence is recorded.

Rollback: none after approved destruction; therefore destruction is the final, explicitly enumerated G4-runbook phase.

## Current risk register

| Risk | Severity | Required disposition |
| --- | --- | --- |
| External send may succeed before DB commit; stale execution resets can resend | Critical | Treat all ambiguous legacy payments as exceptions; never auto-retry during migration; target journal/reconcile-before-retry |
| Pending transaction hash includes an unstored current timestamp and lowercases case-sensitive addresses | Critical | New canonical operation IDs; preserve old hash only as historical input |
| Failed transaction and failed distribution can both remain payable | Critical | Independent obligation/attempt model and pre-cutover duplicate analysis |
| Non-EVM scoped addresses do not select the scoped signer | Critical | Per-scope Chain Fusion derivation/subaccount proof; reconcile displayed address to authority |
| KYC failure code intentionally consumes backlog claims | Critical policy conflict | Preserve claims as held liabilities until explicit policy at G2/G3; no silent forfeiture |
| Plaintext DB/process wallet secrets | Critical | Fingerprint only, rotate/retire, never import value; controlled legacy-to-unified-treasury transfer only after G4. Until a separately approved interim hardening proves otherwise, pause real-value legacy senders and prohibit automatic key generation. |
| SNS handoff/testflight is treated as a generic testnet controller or occurs before the permitted mainnet boundary | High governance/ordering | G3 records the human SNS launch/ownership decision and proves the interface locally/PocketIC; G4 alone authorizes an isolated non-custodial mainnet testflight with a bounded approved cycle budget and recovery/abort procedure before production deployment |
| Direct treasury donation memo is mistaken for authenticated donor, entitlement, or scope authority | High accounting/authorization | Scope comes only from the published account/address and an observation credits once by ledger/chain identity; memos are bounded untrusted metadata unless a separate authenticated proof is accepted |
| OAuth callback/code is treated as a Candid login or bearer authority | High authentication | M2 pins `identify` and binds each one-use OAuth state/PKCE/provider-subject exchange to a non-anonymous Candid caller; only the resulting caller-principal binding authorizes methods, with replay/swap/redirect/provider-response/issuer-where-present/subject-conflict tests and no token/code logging |
| Serialized legacy task user IDs leak/cross-match users | High | Parse imported history into a typed exact owner index, restrict unresolved rows, and never use legacy task data for live execution |
| Mutable OAuth handles are account keys | High | Reverify and bind immutable provider subject IDs |
| KYC callbacks lack durable event order/idempotency | High | Provider event journal, exact session/freshness, monotonic AML-first state |
| Raw KYC/identity evidence lacks a recorded legal basis, lifecycle, backup, access-audit, or public-disclosure policy | High privacy/compliance | G2 records purpose/data controller/legal basis, minimization, encryption/key access, retention/cryptographic erasure, backup/restore, access audit, accounting/anti-evasion exceptions, and per-field public disclosure/consent. Default user-profile/ban-voting views exclude raw user identifiers; treasury receiving configuration is separate. |
| Browser bearer storage or unsafe inline CSP remains reachable during the rollback window | High frontend/authentication | Target uses no browser-stored bearer and strict CSP. Any Internet-facing legacy rollback route requires a separately approved compatibility hardening and XSS/session-theft test; otherwise it is unavailable to public traffic. |
| Static admin/cron credentials and process-local limits obscure accountable authority or aggregate abuse control | High authorization/availability | Target uses named principal capabilities, append-only audit, stable principal/provider/action/cost quotas, and timers. IP controls, if needed, are enforced by an approved edge and never trusted from Candid callers. Rotate and constrain legacy shared secrets. |
| Unbounded or insecure external OAuth/KYC/RPC calls | High integration/security | Shared allowlisted HTTPS adapter with deadline, byte/schema bounds, redirect/credential transport policy, circuit/backoff, provider/action budget, and correlation ID; loopback HTTP only by explicit development configuration. |
| Production dependency advisories in wallet/browser stacks | High supply chain | Inventory actual use, remove unused adapters, upgrade only with compatibility tests, document containment for every remaining high/critical advisory, and block shipment of an unaccepted affected bundle. |
| Ban-voting/public projections correlate social identities with wallet addresses | Human privacy/product decision | G2 records whether each field is necessary, lawful/consented, and public; absent that decision, target projections expose connection/eligibility evidence rather than raw identifiers. |
| Task/cron locks are process-local and jobs are not durable | High | Replace cron locks with stable due cursors and idempotent completion receipts; direct bounded AI evaluations create no persisted task/lease queue and restart whole on interruption |
| AI compact migration tie-breaking was nondeterministic and successful raw data was nulled | High history risk | Export unmanaged exception table; build conflict report; preserve available source evidence and explicit missing markers |
| Tests can hard-delete configured DB financial rows | High operational | Add test-DB hard guard before database suites |
| Frontend lint is inoperative after ESLint 10 because no flat config exists | Medium operational | Resolved 2026-08-07 with the compatible ESLint 9 flat-config baseline; `npm run lint --workspace frontend` passes. Future lint-policy tightening must be a separately scoped legacy-frontend change. |
| ZenDB AGPL-3.0, young project, independent RBAC, generated document IDs in the currently reviewed API, and no in-place schema migration | High dependency | Treat the completed AGPL-3.0-only repository change as baseline; pin exact source/dependency/Candid/Wasm hashes; prove a logical-ID/hash reconciliation strategy and least-privilege collection grants; revoke bootstrap roles; use collection-vN migrations and durable mutation recovery; and retain independent canonical export. No future or unmerged PR is treated as available. |
| Base snapshot/delta gap, unordered trigger outbox, replica-identity loss, slot-WAL exhaustion, or sensitive logical-decoding output | Critical migration/security | At G2 prove the slot-exported-snapshot/consistent-point protocol, complete commit-order transaction application, replica identity, WAL capacity/abort thresholds, crash resume, and source-side redaction. Create production artifacts only at G4 before base export; a generic outbox is not an unproven fallback. Preserve the slot/artifacts through rollback and stop on any coverage, redaction, or retention failure. |
| Live cardinalities and row sizes unknown | High sizing | Read-only inventory before G2; no storage approval without evidence |
