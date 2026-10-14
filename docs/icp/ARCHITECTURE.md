# Target ICP architecture

Status: G1 approval candidate, 2026-08-01. This is a design document; no application code has been changed.

## Decision summary

The proposed target is a set of Motoko application canisters, the retained React/Vite/TypeScript frontend built into certified ICP frontend-canister assets, ZenDB as the proposed persistent store for PostgreSQL/Prisma data and target collections, and one explicitly journaled Chain Fusion treasury canister controlled by an SNS. The legacy Node/PostgreSQL application remains the production authority until parity and migration reconciliation pass.

AI evaluation is deliberately not a durable workflow queue: because the Motoko `llm` package has no OpenAI batch facility, versioned Motoko code issues each fixed, bounded sequence of calls directly, retains dependencies only in local values, and persists only completed canonical results/sources plus redacted audit evidence. Legacy task, dependency, and provider-batch records are migrated as restricted read-only history, never as executable target state.

ZenDB is capable of storing Candid-encoded identity, balance, payment-operation, replay-journal, and migration-receipt documents. Whether each such collection can be authoritative is an M1 proof obligation, not an assumption: authorization and financial constraints stay in Motoko application code, and remote ZenDB calls require durable idempotent sagas around every `await`. A collection that cannot meet that proof must have a G2-approved, narrowly scoped native-Motoko exception.

The architecture intentionally does **not** reproduce unsafe legacy behavior. Existing ambiguous payments, mutable-handle identities, exact-timestamp “daily” uniqueness, destructive KYC backlog handling, process-local locks, persisted AI task graphs, OpenAI batch bookkeeping, and textual user-ID searches become migration exceptions or explicitly corrected behavior.

## Repository facts driving the design

- The physical database has 21 Prisma models plus unmanaged `ai_result_migration_exceptions`; there are 17 explicit Prisma transaction sites.
- Legacy mutations span identity/email/KYC, ban holds, task graphs, AI results, and multi-stage financial history. Cross-canister calls cannot replace SQL transactions transparently.
- Current wallet authority is server-custodial: private keys/mnemonics/PEM are process or plaintext database secrets. ICP transfers use a local Ed25519 identity, not a canister account.
- Current payment retries are not safely idempotent, and external sends have a send-before-commit ambiguity window.
- The migration does not authorize continued real-value legacy sends through those paths. Until separately approved interim hardening exists, automatic legacy payment senders are paused, missing keys are not generated, and unknown sends are manually reconciled rather than reset/retried.
- Current jobs rely on a process-local lock and external cron triggers. The target retains stable timer schedules/cursors where recurrence requires them, but evaluates AI workflows through direct bounded code rather than replacing the legacy lock with a persistent AI task queue.
- The application depends on OpenAI, Didit, GitHub/ORCID/Bitbucket/GitLab OAuth, email delivery, World Bank GDP, CoinGecko, blockchain RPCs, and Reown browser wallets. “Fully on-chain” means application state machines, authorization, scheduling, custody policy, audit, and frontend hosting live on ICP; it does not make those external providers decentralized.
- Live row counts and sizes are unknown. A read-only production inventory is mandatory before G2.

## Target topology

```text
                        Internet Identity / passkeys
                                   |
                                   v
  certified React frontend assets ---> authenticated Candid calls
          |                        |
          |                 +------v-------+
          |                 | core_canister |
          |                 | users, roles, |
          |                 | KYC, voting,  |
          |                 | GDP/shares    |
          |                 +--+---------+--+
          |                    |         |
          |          operation IDs       | payment obligations
          |                    v         v
          |            +-------+---+  +--+----------------+
          |            | workflow  |  | treasury_canister |
          |            | direct AI |  | accounting, jobs, |
          |            | + timers  |  | reconciliation    |
          |            +---+---+---+  +---------+----------+
          |                |   |                |
          |        HTTPS outcalls |        journaled operation
          |                |   v                v
          |                | archive_router  treasury_canister
          |                |   |                 +--> ICP/ICRC ledgers
          |                | ZenDB collections +--> ckBTC/ckETH/ckERC20
          |                +--> OpenAI/Didit/    +--> BTC API / EVM RPC /
          |                     OAuth/email/          SOL RPC / HTTPS RPC
          |                     GDP/prices
          |
          +--> browser-owned wallets for donations/funding

       SNS controls every production canister, including treasury_canister. Before SNS handoff,
       one reviewed governance canister is the sole controller; an `icp-cli` account is never a production controller.
       A pause-only incident role cannot send funds, resume, or upgrade.
```

## Canister responsibilities

### `frontend_assets`

- Hosts the retained React/Vite/TypeScript static build as certified assets with SPA aliasing, strict CSP, immutable hashed assets, and raw access disabled. Node.js is pinned and used only to reproducibly build the bundle in CI; no Node.js runtime or server-side React execution runs in this canister.
- Contains no admin password or bearer token. It uses generated Candid actors and supports Internet Identity and OAuth as peer authentication methods.
- Loads no third-party executable JavaScript. Browser-wallet support must be bundled and pinned.
- Never stores an application bearer in browser storage. The legacy REST bearer client is rollback-only, not part of target authentication. If retained Internet-facing before M10, it needs a separately approved compatibility hardening with a strict no-`unsafe-inline` CSP and XSS/session-theft test.
- The ICP asset canister provides certified HTTP responses and configurable security policy/SPA aliasing; see the [official asset-canister guide](https://docs.internetcomputer.org/guides/frontends/asset-canister/).

### `core_canister` — Motoko enforcement with ZenDB collections

Authoritative state:

- stable legacy user IDs and new monotonic IDs;
- principal bindings, verified external identity subjects, emails, public profile, and independently versioned payout destinations;
- KYC/liveliness attestations, encrypted-evidence references, deletion/anti-evasion tombstones;
- ban votes, deterministic UTC voting epochs, payment/evaluation holds and compensation eligibility;
- GDP/configuration and deterministic salary/share snapshots;
- role assignments, incident pause state, durable outbox/inbox, migration receipts for core collections, and append-only audit metadata.

The core method body authenticates the caller and authorizes the exact resource/action before it mutates a ZenDB collection. Native Motoko saga state records each remote database intent, response, retry receipt, and reconciliation result. This preserves multi-record invariants across remote calls without treating ZenDB indexes or constraints as authorization. High-volume payloads and wallet execution are separated. Sharding is introduced only through a versioned router after measured thresholds, not prematurely.

KYC and identity evidence cannot be activated merely because encryption exists. Before collection/import, G2 records its purpose, data controller/legal basis, minimization, retention and cryptographic-erasure schedule, backup/restore behavior, access-audit roles, and financial/anti-evasion retention exceptions. Certified user-profile and ban-voting projections default to excluding raw social identities and user wallet addresses; a G2 product/privacy decision must permit each disclosed field and purpose. Published treasury receiving addresses remain separately governed asset/scope configuration.

### `workflow_canister` — Motoko enforcement with ZenDB collections

- Versioned first, repeat, and quarterly evaluator functions execute the fixed 14/6/5-operation workflows through direct `llm` calls. Dependencies pass as typed local values within the invocation; no live task, DAG edge, claim/lease, provider-batch/item, or intermediate-operation record is written to stable memory or ZenDB.
- Canonical AI result/status/source metadata and exact user/evaluation-operation indexes. Only a complete validated result/source set is published under its deterministic cycle/result key; an interrupted or failed invocation publishes no partial result and may restart whole.
- Stable non-AI job schedules, aggregate quarterly due cursors, final completion reports, and outbox/inbox receipts. A direct evaluation writes no execution record before its first `llm` call, and these durable records must not encode resumable AI task state or intermediate evaluation outputs.
- ICP timers replace cron-job.org and in-process intervals. Timer IDs are transient; deadlines and cursors are stable and re-registered after upgrades. ICP timers are best-effort and may interleave after `await`, so jobs are designed at-least-once; see [timers](https://docs.internetcomputer.org/guides/backends/timers/) and [upgrade guidance](https://docs.internetcomputer.org/guides/security/canister-upgrades/).
- External calls share an allowlisted HTTPS adapter with explicit operation/request/response/cycle/spend limits, bounded parsing, deadline, redirect policy, circuit/backoff state, and correlation ID. Credential-bearing calls are HTTPS-only except a documented loopback development configuration. Deterministic transforms apply when replicated consensus requires them. The deterministic evaluation cycle/result key makes final publication idempotent without persisting provider attempts or a task queue. See [HTTPS outcalls](https://docs.internetcomputer.org/guides/backends/https-outcalls/).

The webhook HTTP interface may be implemented here or as a small same-controller ingress canister. Conventional webhooks use `http_request` followed by `http_request_update`; the update method re-verifies method/path/body limit, HMAC/signature, freshness, provider event ID, session binding, and monotonic state before forwarding an idempotent event. OAuth does not use an unauthenticated HTTP update callback to establish login: the provider redirect goes to the allowlisted certified frontend and only the bound Candid caller can complete the M2 exchange. If a provider requires a server callback, it may only stage data against the pre-existing caller-bound attempt; it cannot bind or recover an account until that caller completes the exchange. The protocol supports this update upgrade path; see the [HTTP gateway specification](https://docs.internetcomputer.org/references/http-gateway-protocol-spec/).

### `archive_router` and ZenDB collections

- Routes versioned core, workflow, treasury, `ai_artifact_vN`, audit-view, and migration-evidence collections to pinned ZenDB canisters. Collection data may be authoritative only after the M1 proof for its mutation/recovery protocol succeeds.
- A ZenDB failure cannot authorize, complete, delete, or duplicate a canonical evaluation result or payment. The native final-publication saga record holds the expected hash, idempotency key, and pending/available/reconciled state; it is not execution-task storage.
- Every document has an application logical ID/idempotency key, schema version, content hash, created epoch, typed ownership references, and size cap. That logical ID is a unique indexed document field unless the exact pinned ZenDB API proves caller-supplied document IDs; ZenDB's generated internal document ID is otherwise non-authoritative storage metadata. Every query uses a suitable index and stable cursor.
- Shards are replaceable: canonical export is the portability boundary. Schema changes create a new `collection_vN`, migrate in bounded batches, compare hashes/counts, switch the router, and retain the old collection read-only through rollback.

### `treasury_canister` — unified Chain Fusion treasury

- Is the sole application authority for the double-entry liability/reserve/accounting journal, payment cycles, immutable payment intents, destination snapshots, attempts, confirmation/reorg state, and reconciliation reports. Its pinned ZenDB canister is a storage dependency with treasury-only application roles and governance-only administration, not a second business authority or vault.
- Receives idempotent obligations from an allowlisted `core_canister`, validates policy version/eligibility snapshot, and creates exactly one stable `operationId` per user/scope/asset/obligation epoch.
- Uses integer base units. USD/GDP presentation values never drive token conservation through floating point.
- Before any cross-canister/chain call, records a prepared attempt. After `await`, it reloads and validates current state/epoch rather than assuming pre-call state still holds. ICP explicitly warns that inter-canister calls are non-atomic and recommends journaling; see [inter-canister call security](https://docs.internetcomputer.org/guides/security/inter-canister-calls/).
- Owns ICRC accounts/subaccounts and Chain Fusion key-derivation paths in the treasury canister, and controls immutable operation receipts plus chain nonce/sequence/UTXO reservations in treasury-only ZenDB collections. Before signing/sending it persists a native intent, obtains logical-ID/content-hash acknowledgement for the remote receipt, rejects a conflicting replay, and enforces allowlisted assets/networks, caps, fee bounds, destination encoding validation, and pause state in its own method body.
- Has no endpoint to expose a seed/private key because Chain Fusion threshold private keys never exist in the canister. It is never blackholed: SNS is the production controller, so security relies on reviewed governance, delay, reproducible upgrade evidence, a pause-only role, caps, monitoring, and recovery drills.

### Governance and operations

- Development: named developer principals with no funds.
- Pre-production: one reviewed governance canister is the sole controller. Listing multiple human controllers is not multisig; any controller can upgrade. An `icp-cli` account may operate the approved governance workflow but is not a controller of an application canister.
- Production: SNS is the sole controller of every canister, including `treasury_canister`, with proposal quorum, delay, reproducible Wasm hash, stable/Candid compatibility evidence, and post-deploy controller/module verification. No production canister has an empty controller list.
- SNS control is a G3-blocking product/governance decision, not an implicit property of a test deployment: an SNS is per application and requires the recorded launch/ownership model, applicable `sns_init`/tokenomics or existing-SNS configuration, quorum/delay, cycle-management, root-handoff, and recovery policy. Local SNS tooling or PocketIC proves the controller contract before G3. The signed G4 runbook then authorizes one isolated, non-custodial mainnet testflight to prove testflight-SNS-root handoff/recovery mechanics before the separately reviewed production handoff/deployment; it uses separate canister IDs and test-only derivation/environment, has a bounded approved cycle budget, and contains no production data or custodial assets.
- ZenDB controller authority and ZenDB application roles are audited separately. For every collection, only its owning application canister receives the minimum read/write capability; sensitive evidence and financial collections have no public reader. Where the pinned API cannot express a per-collection role, separate ZenDB deployments enforce each distinct grant boundary. ZenDB administration belongs only to the approved governance/SNS principal. Bootstrap owners/deployers and temporary migration roles are revoked before authority or finalization, and post-deploy/post-upgrade grant audits must exactly match the approved matrix. Any built-in ZenDB self-grant is inventoried, justified as an internal implementation requirement, and tested to expose no unauthorized ingress path.
- Incident role: named principals can only pause integrations/payments and request evidence; they cannot resume, send, change caps, install code, or change controllers.
- Cycles: per-canister alarms, public health, automated top-up with capped allowance, at least 90-day production freezing threshold, and a tested low-cycle mode that stops optional archive/outcalls before core/treasury work.
- ICP warns that controllers can replace code and steal canister-held assets; governance or immutability must be verified, not merely documented. See [canister control](https://docs.internetcomputer.org/guides/security/canister-control/) and [trust in canisters](https://docs.internetcomputer.org/guides/canister-management/trust-in-canisters/).

## Authentication and authorization

1. Internet Identity and OAuth are peer authentication mechanisms, but a provider redirect/callback does not itself carry a Candid caller. II supplies an origin-specific principal and bounded delegation. OAuth uses an exact G2-pinned Motoko `indentify` package: a non-anonymous Candid caller creates a short-lived one-use attempt containing provider, purpose, caller principal, state/nonce, PKCE challenge, and allowed redirect; the allowlisted certified React callback immediately passes code/state/verifier only to `completeOAuth` through that same authenticated Candid actor. The canister validates caller equality, attempt state/expiry, PKCE, configured client/redirect, provider-specific authorization-code/token/profile response, and immutable provider subject; issuer/audience claims are validated where the provider supplies them. No public Candid method accepts a bearer token, callback, code, state, or caller-supplied user/principal as authority.
2. A user record can bind multiple approved principals and OAuth subjects through this recovery/change process. A successful verified OAuth subject can authorize a new caller-principal binding only under the documented recovery policy, with immutable audit, notification, step-up/hold where required, and no cross-account merge. OAuth codes, verifiers, and access/refresh tokens are never logged, retained in browser history, or exported; tokens are discarded after subject verification unless an approved provider feature requires an encrypted, scope-minimized, rotatable, access-audited record. Alternative frontend origins are configured before domain cutover so a domain change does not strand accounts.
3. Payout destinations are distinct versioned records. A login Ethereum address is the default payout address. Changes require step-up authentication through the bound II/OAuth policy, chain ownership proof where available, a delay/cancel window, notifications, and a snapshot on every payment intent.
4. Admin becomes named on-chain roles/governance proposals. Static `ADMIN_PASSWORD` and `CRON_JOB_AUTHORIZATION` have no target equivalent.
5. All Candid methods authorize in the method body, including inter-canister callers. `canister_inspect_message` may cheaply reject ingress but is not relied upon for inter-canister authorization.
6. Application quotas are bound to the authenticated caller principal, provider, action, and bounded cost/bytes. A canister does not receive a trustworthy end-user IP; it neither accepts caller-supplied IP data nor treats a forwarded IP as authorization. If IP-based abuse protection is required, it is a separately configured and tested edge control.
7. Public views have an explicit field allowlist. Until G2 records the product/privacy/consent decision, ban-voting and other certified public projections expose eligibility, aggregate, or connection evidence rather than correlating raw social identifiers with wallet addresses.

## External integrations

| Legacy integration | Target path | Trust/security treatment |
| --- | --- | --- |
| OpenAI immediate/batch/web search | Direct calls through the `llm` Motoko package; legacy provider batch mode retired | The package does not provide batch submission/polling, so fixed bounded operations execute directly in code with no persisted task/provider-item state; provider remains centralized; scoped spend-limited key, bounded/redacted payload, deterministic cycle/result key, result schema validation, no payment authority |
| GitHub/ORCID/Bitbucket/GitLab | `indentify` caller-bound OAuth start/certified-frontend callback/complete flow plus canister token/profile outcalls | One-use caller-bound state/nonce and PKCE; configured client/redirect plus provider-specific response and immutable-subject verification, with issuer/audience validation where present; no callback/bearer authority. A provider without a proven secure flow is blocked or explicitly G2-approved as retired, never silently weakened |
| Didit | Canister creates session through an evaluated `join-proxy` deployment or the direct provider; HTTP-update webhook ingress | At M2, pin and review `join-proxy` and `join-proxy-client.mo`; use only an allowlisted configurable HTTPS URL. Bind reusable proof to subject/consent/freshness, deduplicate provider and proxy events, retain AML rejection precedence, account for cost, and test the direct fallback. No proxy response alone is KYC authority. Apply the G2-approved evidence lifecycle and outbound-call bounds. |
| Nodemailer/SMTP | HTTPS email API | Canisters do not open SMTP sockets; durable delivery intent/idempotency, no sensitive data in subject/log, bounce/retry state |
| World Bank GDP | HTTPS outcall via HTTPS endpoint or an approved certified source | Multiple-source/freshness validation; data version stored; invalid/stale data fails closed for new calculations |
| CoinGecko prices | HTTPS outcall or XRC where applicable | Presentation/valuation only; timestamp/source/confidence recorded; never used as token balance |
| Chain RPCs | NNS-controlled Bitcoin/EVM/SOL services where available; otherwise multi-provider bounded HTTPS RPC | Finality/reorg rules and provider consistency per adapter; custom-provider maturity risk explicit |

Canister-held API credentials are not equivalent to Chain Fusion keys. A malicious controller upgrade can make code expose or misuse an API secret. Scope, spend/rate limits, governance, rotation, and separation contain that risk; they cannot make a third-party secret cryptographically inaccessible to canister code.

## Persistence decision and ZenDB evaluation

### Current ZenDB due diligence

As of this document date, current ZenDB main describes:

- embedded or remote document collections with Candid serialization, B-tree document storage, composite and one-per-collection text indexes, query planning, partial updates, unique/field constraints, count/statistics, and offset/cursor pagination;
- heap or stable-memory modes; project documentation reports heap at roughly 20–30% fewer instructions and stable memory up to the ICP per-canister 500 GiB limit;
- batch index creation/population for large collections;
- AGPL-3.0 licensing for the Motoko project;
- no automatic indexes; an unindexed scan can hit the instruction limit around ten thousand records;
- remote deployments have their own role checks and grants, independent of the calling application's authorization; and
- no indexes within arrays, weak complex-OR planning, inefficient large skip/offset, 64-bit bounds for indexed `Nat`/`Int`, a 64 KiB indexed-field limit, one text index per collection, no aggregation, and no supported in-place schema update/migration. A schema change therefore requires a new collection and application-managed migration. Pull request 53 proposes long-running upgrade support but is not an accepted dependency unless its exact merged commit is selected, pinned, and tested at G2; the baseline design does not assume it is available.

Primary project evidence: [ZenDB repository/readme](https://github.com/NatLabs/ZenDB), [current documentation](https://github.com/NatLabs/ZenDB/blob/main/zendb-doc.md), and the maintainer's [architecture/31-million-transaction report](https://forum.dfinity.org/t/introducing-zendb-embedded-database-with-mongodb-style-queries-for-motoko/61569).

License direction: G1 evidence must first inventory every license/notice, package/distribution artifact, third-party obligation, and contributor/licensor-rights record, and resolve every authority exception. This plan makes no legal conclusion: missing authority blocks G1 rather than permitting a silent relicensing. Once G1 records sufficient authority and approves the disposition, relicensing the repository to AGPL-3.0 is the first M1 implementation change. That one reviewable commit updates the applicable license/notice/metadata and distribution artifacts together while preserving required third-party notices; no toolchain, canister, or application change precedes it.

### Structure choice

| Data class | Chosen structure | Reason |
| --- | --- | --- |
| Users, principal/identity bindings, roles, emails, KYC state, payout destinations, bans/holds | Versioned ZenDB collections with Motoko mutation-saga records and explicit unique/sorted indexes | ZenDB can store Candid/Blob/Text records; Motoko enforces caller authorization and relation/uniqueness policy across remote writes |
| Canonical AI results/sources, redacted audit, stable schedules, completion receipts, outbox/inbox | Versioned ZenDB collections with Motoko final-publication/idempotency saga | Direct evaluators keep dependencies local and create no task/DAG/lease/provider-batch records; durable records remain queryable without unbounded scans |
| Liabilities, reserves, journal, operation/attempt receipts, finality/reorg state | ZenDB journal/receipt collections with Motoko operation protocol and bounded lookup indexes | Money/replay authority only after M1 proves failure-safe intent/write/acknowledgement recovery, exact base units, and an independently auditable state machine |
| Large AI/provider request/response payloads and derived audit documents | Versioned ZenDB collections | Document-shaped, append-heavy, varied nested payloads, multiple metadata filters, high growth; replaceable and hash-addressed |
| KYC raw evidence | Encrypted, access-logged ZenDB collection with Motoko access/hash indexes | G2-approved purpose/legal basis, minimization, retention/cryptographic erasure, backup, access audit, and accounting/anti-evasion exception policy; minimize indexed sensitive fields |
| Frontend assets | ICP asset canister | Certified static hosting, compression, SPA routing, security headers |

ZenDB storage still requires explicit indexes and bounded pagination. Before each remote mutation, Motoko enhanced orthogonal persistence records a bounded durable intent containing collection, application logical ID, desired content hash, expected prior version/hash for a CAS update, operation/attempt ID, and phase. After `await`, it reloads the intent and looks up that logical key: the desired version/hash is acknowledged success; an absent insert or unchanged expected prior version/hash permits an identical insert/CAS retry; any other result is a conflict that fails closed. Pending records do not become application-visible until acknowledgement. A multi-document invariant is either staged and activated through a separately acknowledged manifest/version pointer or performed by one bounded ZenDB-side method whose atomic behavior is proven against the exact pin; it is never described as atomic across the inter-canister call. Completed intent detail may be compacted only into the immutable remote receipt plus a native hash checkpoint without deleting required audit history. This bounded saga/configuration state rejects incompatible stable changes and avoids large `preupgrade` serialization. See [Motoko persistence and upgrade compatibility](https://docs.internetcomputer.org/languages/motoko/fundamentals/actors/data-persistence/) and [enhanced orthogonal persistence](https://docs.internetcomputer.org/languages/motoko/fundamentals/actors/orthogonal-persistence/enhanced/).

### Capacity and cost envelopes

These are design targets to make limits testable; they are not production-count claims. G2 replaces them with measured current counts and approved forecasts.

| Store | Initial tested envelope | Hard operational action before limit | Query/pagination rule |
| --- | --- | --- | --- |
| Core user/profile | 10 million users, 50 million identity/email/destination records | Introduce hash-prefix router before 60% measured memory/instruction limit | Point lookup; ordered `(created,id)` and leaderboard cursor; no full user scan |
| Voting/holds | 100 million events per epoch shard | Seal old epoch and create next shard | `(target,epoch,id)` and `(voter,epoch,id)` cursors |
| Workflow results/audit | 10 million retained result/audit metadata records per shard | Archive payload/metadata by retention policy; route by result ID/epoch | Exact owner/kind/time cursor; no AI task queue index |
| ZenDB collection shard | 25 million documents or 50 GiB, whichever first | Create a new collection/shard; never approach theoretical 500 GiB | Fully covered composite/text index; cursor only; max 256 KiB document, max 1 MiB batch |
| Financial journal | 100 million immutable entries per treasury | Add a read-only archive/index collection while authoritative balances/receipts remain in the pinned ZenDB authority collection | operation ID point lookup; account/asset/sequence cursor |
| Migration import | max 500 ordinary records and <1 MiB encoded payload per call; large record fragments bounded separately | Split before encoding; reject over-limit | `(migration,table,chunk)` receipt point lookup |

ICP currently charges storage for heap and stable memory alike; on a 13-node subnet the published reference is about 329B cycles per GiB per 30 days, with 34-node costs about 2.6×, plus execution/messaging/outcall costs. The exact cycle counts, not approximate USD, are budget authority. See [current cycle costs](https://docs.internetcomputer.org/references/cycle-costs/). Each benchmark must report bytes/document, index multiplier, instructions/insert/query/update/delete, reindex cost, archive cross-canister bytes, and monthly storage at the then-current cycle table.

## Query, pagination, uniqueness, and referential integrity

- Every public list has a maximum page size and opaque cursor containing index key plus unique ID. Cursor version/query hash prevents reuse under another filter. Offset is not used for large collections.
- Composite index order is equality fields, sort fields, then range fields. Queries that cannot prove an index plan are rejected or implemented as bounded background materializations.
- Optional unique values reproduce PostgreSQL null semantics: `null` is not inserted into a unique-value index. Non-null normalized values map to exactly one record.
- Addresses are stored as `{chainId, network, canonicalBytes/text, displayText}`. Normalization is chain-specific; Base58 identifiers are never lowercased.
- Relations are validated before insert/update. Deletes are tombstones; historical child references remain. Cross-canister relations use source ID plus operation receipt and are repaired through an inbox/outbox saga.
- No secondary index is authoritative: each index entry points to a primary record/version. Primary-plus-index atomicity may be claimed only inside one proven ZenDB-side update method with no intervening `await`; application-to-ZenDB work still follows the durable intent/acknowledgement protocol. Consistency scanners compare records and indexes in bounded batches.

## Upgrade compatibility

- Pin the compiler and dependencies; commit generated Candid `.did`, Motoko stable `.most`, Wasm hash, and reproducible build instructions.
- Require Candid subtype and stable-compatibility checks in CI for every canister.
- Use additive versioned records and explicit bounded migrations. Never use production `reinstall`.
- Re-register timers and resume durable jobs after upgrade; run old->new->rollback upgrade tests with near-limit data.
- For ZenDB, pin exact source/dependency/Candid/Wasm hashes and approved RBAC matrix; test the old stable store with the proposed version. Schema changes use a shared migration epoch, bounded collection-vN copy with logical-ID/hash reconciliation, read-only old collections, and a router switch only after pending intents are drained, counts/hashes match, and grants on the new collection pass audit. Retain the old collection and its prior grant record until rollback closes.
- Exportable canonical state is the disaster-recovery and dependency-exit boundary; a canister snapshot alone is not the only backup.

## Chain Fusion placement

The wallet options and state machines are specified in `WALLET_SECURITY.md`. The architectural preference is:

1. ICP/ICRC accounts owned by the unified treasury canister.
2. Direct canister-controlled external addresses through Chain Fusion when the approved native-chain adapter has passed finality/reorg/replay tests.
3. ckBTC/ckETH/ckERC20 only where their ledger/minter flow is the approved asset path.
4. No new third-party/server-custodial hot wallet. Legacy keys are quarantined and retired after a separately approved, reconciled cutover.

ICP Chain Fusion supports threshold ECDSA/Schnorr addresses, native Bitcoin integration, EVM RPC, SOL RPC, and HTTPS RPC paths; chain-key tokens are ICRC assets backed by native assets. See [Chain Fusion](https://docs.internetcomputer.org/concepts/chain-fusion/), [chain-key tokens](https://docs.internetcomputer.org/guides/digital-assets/chain-key-tokens/), [Bitcoin](https://docs.internetcomputer.org/guides/chain-fusion/bitcoin/), and [Ethereum/EVM RPC](https://docs.internetcomputer.org/guides/chain-fusion/ethereum/).

## Verification strategy

- Motoko unit/property tests: constraints, indexes, canonical encodings, rounding, state transitions, roles.
- PocketIC/local replica: Candid calls, caller auth, timers, awaits/reentrancy, upgrades, cycle depletion, archive failures, migration interruption.
- Differential fixtures: run legacy and ICP transformations over the same sanitized records and explain every intended difference.
- Chain simulators/testnets: local ICRC ledgers, Bitcoin regtest/testnet, EVM Sepolia, Solana devnet, and equivalent valueless networks. Mainnet paths are configuration-disabled in ordinary test builds. Local/PocketIC SNS tests prove controller behavior; the only planned mainnet exception before production is the G4-approved, isolated non-custodial SNS testflight, which uses a separately reviewed signed configuration, a bounded approved cycle budget, and test-only derivation/environment to prevent access to production data, payment authority, or custodial assets.
- Migration: deterministic byte/hash golden tests; a PostgreSQL logical-slot/exported-snapshot rehearsal that proves contiguous complete transactions through a final barrier under decoder restart, replica-identity failure, WAL pressure, and redaction-leak injection; fault injection before, during, and after every local-intent/remote-write/acknowledgement transition; logical-ID conflict and unknown-result reconciliation; direct-ZenDB authorization negatives and post-upgrade grant audits; and independent record/relation/financial reconciliation. No unmerged or future ZenDB change is assumed.
- Security: authorization matrix, malicious SNS/governance, frontend supply chain, `join-proxy` reuse/fallback/privacy, webhook replay/order, ambiguous sends, reorg/finality, treasury caps/pause/recovery path.
- Supply chain: inventory actual legacy rollback and target frontend dependencies; remove unused wallet/browser adapters, run production advisory scans, and document exploitability/containment for every remaining high/critical advisory before shipping an affected bundle.
- Privacy: test the default-deny public field allowlist, PII retention/cryptographic-erasure and backup-restore behavior, access-audit queries, and every approved social/wallet disclosure.
- Reproducibility: rebuild Wasm/assets in clean CI and compare hashes before governance proposal.

## G1 decision requested

Approve or amend these six architecture choices:

1. Retain the React/Vite/TypeScript frontend and deploy its pinned reproducible static bundle to the certified frontend canister. Remove the legacy Node backend/REST bearer-token deployment only at M10 after the rollback window closes; Node.js remains a build-time dependency, never a canister runtime.
2. Use ZenDB collections as the proposed PostgreSQL/Prisma destination, including candidate authoritative core/workflow/financial/replay/migration collections, subject to the M1 atomicity/recovery proof and collection-specific G2 exceptions.
3. Enforce authorization, relationship, uniqueness, money, and replay invariants in Motoko method bodies and durable sagas; ZenDB schemas, constraints, and indexes never replace those controls.
4. Treat Internet Identity and OAuth through `indentify` as peer authentication methods, while binding every authorization decision to the authenticated Candid caller and separating payout destinations from login identities.
5. Replace server-held keys with a unified treasury's Chain Fusion authority for approved native networks, retaining ICRC/ck assets only where their ledger/minter path is selected; every adapter still requires testnet approval.
6. Use one SNS-controlled, independently audited treasury canister for accounting and custody. Do not blackhole any canister; require governance delay, caps, pause/recovery controls, reproducible upgrades, and controller verification instead.

Approval of G1 does not select or launch an SNS. The named SNS launch/ownership, applicable tokenomics/configuration, controller-handoff, cycle-management, and recovery decision remains an explicit human G3 requirement. G1 also does not approve the final database schema, data migration, wallet policy/caps, production deployment, production data mutation, or any asset transfer. Those remain G2, G3, and G4.
