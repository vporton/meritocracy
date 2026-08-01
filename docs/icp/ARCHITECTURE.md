# Target ICP architecture

Status: G1 approval candidate, 2026-08-01. This is a design document; no application code has been changed.

## Decision summary

The proposed target is a set of Motoko application canisters, standards-based certified ICP assets replacing the Node.js/TypeScript frontend, ZenDB as the proposed persistent store for PostgreSQL/Prisma data and target collections, and one explicitly journaled Chain Fusion treasury canister controlled by an SNS. The legacy Node/PostgreSQL application remains the production authority until parity and migration reconciliation pass.

ZenDB is capable of storing Candid-encoded identity, balance, payment-operation, replay-journal, and migration-receipt documents. Whether each such collection can be authoritative is an M1 proof obligation, not an assumption: authorization and financial constraints stay in Motoko application code, and remote ZenDB calls require durable idempotent sagas around every `await`. A collection that cannot meet that proof must have a G2-approved, narrowly scoped native-Motoko exception.

The architecture intentionally does **not** reproduce unsafe legacy behavior. Existing ambiguous payments, mutable-handle identities, exact-timestamp “daily” uniqueness, destructive KYC backlog handling, process-local locks, and textual user-ID searches become migration exceptions or explicitly corrected behavior.

## Repository facts driving the design

- The physical database has 21 Prisma models plus unmanaged `ai_result_migration_exceptions`; there are 17 explicit Prisma transaction sites.
- Core mutations span identity/email/KYC, ban holds, task graphs, AI results, and multi-stage financial history. Cross-canister calls cannot replace SQL transactions transparently.
- Current wallet authority is server-custodial: private keys/mnemonics/PEM are process or plaintext database secrets. ICP transfers use a local Ed25519 identity, not a canister account.
- Current payment retries are not safely idempotent, and external sends have a send-before-commit ambiguity window.
- Current jobs rely on a process-local lock and external cron triggers. Task ownership is not a durable atomic lease.
- The application depends on OpenAI, Didit, GitHub/ORCID/Bitbucket/GitLab OAuth, email delivery, World Bank GDP, CoinGecko, blockchain RPCs, and Reown browser wallets. “Fully on-chain” means application state machines, authorization, scheduling, custody policy, audit, and frontend hosting live on ICP; it does not make those external providers decentralized.
- Live row counts and sizes are unknown. A read-only production inventory is mandatory before G2.

## Target topology

```text
                        Internet Identity / passkeys
                                   |
                                   v
  certified standards-based assets ---> authenticated Candid calls
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
          |            | task DAG, |  | accounting, jobs, |
          |            | timers    |  | reconciliation    |
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

- Hosts a standards-based static build with no Node.js runtime or TypeScript source/toolchain dependency, certified assets, SPA aliasing, strict CSP, immutable hashed assets, and raw access disabled.
- Contains no admin password or bearer token. It uses generated Candid actors and supports Internet Identity and OAuth as peer authentication methods.
- Loads no third-party executable JavaScript. Browser-wallet support must be bundled and pinned.
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

### `workflow_canister` — Motoko enforcement with ZenDB collections

- Typed task DAG replacing serialized runner-class/runner-data discovery.
- Atomic claim state: `queued -> leased(epoch, owner, expires) -> running -> terminal`, with compare-and-set operation IDs and bounded retry policy.
- Canonical AI result/status/source metadata and exact user/task indexes.
- Stable job schedules, cursors, attempts, completion reports, and outbox/inbox receipts.
- ICP timers replace cron-job.org and in-process intervals. Timer IDs are transient; deadlines and cursors are stable and re-registered after upgrades. ICP timers are best-effort and may interleave after `await`, so jobs are designed at-least-once; see [timers](https://docs.internetcomputer.org/guides/backends/timers/) and [upgrade guidance](https://docs.internetcomputer.org/guides/security/canister-upgrades/).
- External calls use bounded HTTPS outcalls with explicit response limits, cycles budgets, deterministic transforms when replicated consensus is needed, redaction, circuit breakers, and durable idempotency keys. See [HTTPS outcalls](https://docs.internetcomputer.org/guides/backends/https-outcalls/).

The webhook/OAuth HTTP interface may be implemented here or as a small same-controller ingress canister. Conventional webhooks use `http_request` followed by `http_request_update`; the update method re-verifies method/path/body limit, HMAC/signature, freshness, provider event ID, session binding, and monotonic state before forwarding an idempotent event. The protocol supports this update upgrade path; see the [HTTP gateway specification](https://docs.internetcomputer.org/references/http-gateway-protocol-spec/).

### `archive_router` and ZenDB collections

- Routes versioned core, workflow, treasury, `ai_artifact_vN`, audit-view, and migration-evidence collections to pinned ZenDB canisters. Collection data may be authoritative only after the M1 proof for its mutation/recovery protocol succeeds.
- A ZenDB failure cannot authorize, complete, delete, or duplicate a core task/payment. The native saga record holds the expected hash, idempotency key, and pending/available/reconciled state.
- Every document has an application-assigned stable ID, schema version, content hash, created epoch, typed ownership references, and size cap. Every query uses a suitable index and stable cursor.
- Shards are replaceable: canonical export is the portability boundary. Schema changes create a new `collection_vN`, migrate in bounded batches, compare hashes/counts, switch the router, and retain the old collection read-only through rollback.

### `treasury_canister` — unified Chain Fusion treasury

- Owns the double-entry liability/reserve/accounting journal, payment cycles, immutable payment intents, destination snapshots, attempts, confirmation/reorg state, and reconciliation reports.
- Receives idempotent obligations from an allowlisted `core_canister`, validates policy version/eligibility snapshot, and creates exactly one stable `operationId` per user/scope/asset/obligation epoch.
- Uses integer base units. USD/GDP presentation values never drive token conservation through floating point.
- Before any cross-canister/chain call, records a prepared attempt. After `await`, it reloads and validates current state/epoch rather than assuming pre-call state still holds. ICP explicitly warns that inter-canister calls are non-atomic and recommends journaling; see [inter-canister call security](https://docs.internetcomputer.org/guides/security/inter-canister-calls/).
- Owns ICRC accounts/subaccounts, Chain Fusion key-derivation paths, immutable operation receipts, and chain nonce/sequence/UTXO reservations in the same canister as the accounting journal. It persists an operation receipt before signing/sending, rejects a conflicting replay, and enforces allowlisted assets/networks, caps, fee bounds, destination encoding validation, and pause state in its own method body.
- Has no endpoint to expose a seed/private key because Chain Fusion threshold private keys never exist in the canister. It is never blackholed: SNS is the production controller, so security relies on reviewed governance, delay, reproducible upgrade evidence, a pause-only role, caps, monitoring, and recovery drills.

### Governance and operations

- Development: named developer principals with no funds.
- Pre-production: one reviewed governance canister is the sole controller. Listing multiple human controllers is not multisig; any controller can upgrade. An `icp-cli` account may operate the approved governance workflow but is not a controller of an application canister.
- Production: SNS is the sole controller of every canister, including `treasury_canister`, with proposal quorum, delay, reproducible Wasm hash, stable/Candid compatibility evidence, and post-deploy controller/module verification. No production canister has an empty controller list.
- Incident role: named principals can only pause integrations/payments and request evidence; they cannot resume, send, change caps, install code, or change controllers.
- Cycles: per-canister alarms, public health, automated top-up with capped allowance, at least 90-day production freezing threshold, and a tested low-cycle mode that stops optional archive/outcalls before core/treasury work.
- ICP warns that controllers can replace code and steal canister-held assets; governance or immutability must be verified, not merely documented. See [canister control](https://docs.internetcomputer.org/guides/security/canister-control/) and [trust in canisters](https://docs.internetcomputer.org/guides/canister-management/trust-in-canisters/).

## Authentication and authorization

1. Internet Identity and OAuth are peer authentication mechanisms. II provides an origin-specific principal and bounded delegation; OAuth uses the Motoko `indentify` package and immutable provider subject evidence. Each public Candid method authorizes its protocol-provided authenticated `caller`; no bearer session or caller-supplied user ID grants access.
2. A user record can bind multiple approved principals and OAuth subjects through a recovery/change process. Alternative frontend origins are configured before domain cutover so a domain change does not strand accounts.
3. Payout destinations are distinct versioned records. A login Ethereum address is the default payout address. Changes require step-up authentication through the bound II/OAuth policy, chain ownership proof where available, a delay/cancel window, notifications, and a snapshot on every payment intent.
4. Admin becomes named on-chain roles/governance proposals. Static `ADMIN_PASSWORD` and `CRON_JOB_AUTHORIZATION` have no target equivalent.
5. All Candid methods authorize in the method body, including inter-canister callers. `canister_inspect_message` may cheaply reject ingress but is not relied upon for inter-canister authorization.

## External integrations

| Legacy integration | Target path | Trust/security treatment |
| --- | --- | --- |
| OpenAI immediate/batch/web search | `llm` Motoko package | Provider remains centralized; scoped spend-limited key, bounded/redacted payload, stable request ID, result schema validation, no payment authority |
| GitHub/ORCID/Bitbucket/GitLab | Frontend OAuth redirect + canister token/profile outcalls | PKCE where supported; remove the authorization method where unsupported |
| Didit | Canister creates session through an evaluated `join-proxy` deployment or the direct provider; HTTP-update webhook ingress | At M2, pin and review `join-proxy` and `join-proxy-client.mo`; use only an allowlisted configurable HTTPS URL. Bind reusable proof to subject/consent/freshness, deduplicate provider and proxy events, retain AML rejection precedence, account for cost, and test the direct fallback. No proxy response alone is KYC authority. |
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
- no indexes within arrays, weak complex-OR planning, inefficient large skip/offset, 64-bit bounds for indexed `Nat`/`Int`, a 64 KiB indexed-field limit, one text index per collection, no aggregation, and no supported in-place schema update/migration. A schema change requires a new collection and application-managed migration (see also https://github.com/NatLabs/ZenDB/pull/53 for accomplishing large migrations; work for a future version of ZenDB where this PR has been accepted).

Primary project evidence: [ZenDB repository/readme](https://github.com/NatLabs/ZenDB), [current documentation](https://github.com/NatLabs/ZenDB/blob/main/zendb-doc.md), and the maintainer's [architecture/31-million-transaction report](https://forum.dfinity.org/t/introducing-zendb-embedded-database-with-mongodb-style-queries-for-motoko/61569).

License direction: the repository will be relicensed to AGPL-3.0 as the first approved M1 implementation change. Before doing so, the implementation prompt must inventory every license/notice, package/distribution artifact, third-party obligation, and contributor-rights record; it must update the applicable license/notice/metadata files together and preserve required third-party notices. This plan makes no legal conclusion, and the inventory must identify any missing authority as a G1 blocker rather than silently relicensing.

### Structure choice

| Data class | Chosen structure | Reason |
| --- | --- | --- |
| Users, principal/identity bindings, roles, emails, KYC state, payout destinations, bans/holds | Versioned ZenDB collections with Motoko mutation-saga records and explicit unique/sorted indexes | ZenDB can store Candid/Blob/Text records; Motoko enforces caller authorization and relation/uniqueness policy across remote writes |
| Task DAG, leases, canonical results, outbox/inbox | Versioned ZenDB collections with Motoko lease/idempotency saga | Queryable target representation; no unbounded scan/query-plan dependence |
| Liabilities, reserves, journal, operation/attempt receipts, finality/reorg state | ZenDB journal/receipt collections with Motoko operation protocol and bounded lookup indexes | Money/replay authority only after M1 proves atomic recovery, exact base units, and independently auditable state machine |
| Large AI/provider request/response payloads and derived audit documents | Versioned ZenDB collections | Document-shaped, append-heavy, varied nested payloads, multiple metadata filters, high growth; replaceable and hash-addressed |
| KYC raw evidence | Encrypted, access-logged ZenDB collection with Motoko access/hash indexes | PII/retention/access policy outweighs flexible queries; minimize indexed sensitive fields |
| Frontend assets | ICP asset canister | Certified static hosting, compression, SPA routing, security headers |

ZenDB storage still requires explicit indexes and bounded pagination. Motoko enhanced orthogonal persistence retains only the bounded saga/configuration state needed to enforce and recover authoritative ZenDB mutations, rejects incompatible stable changes, and avoids large `preupgrade` serialization. See [Motoko persistence and upgrade compatibility](https://docs.internetcomputer.org/languages/motoko/fundamentals/actors/data-persistence/) and [enhanced orthogonal persistence](https://docs.internetcomputer.org/languages/motoko/fundamentals/actors/orthogonal-persistence/enhanced/).

### Capacity and cost envelopes

These are design targets to make limits testable; they are not production-count claims. G2 replaces them with measured current counts and approved forecasts.

| Store | Initial tested envelope | Hard operational action before limit | Query/pagination rule |
| --- | --- | --- | --- |
| Core user/profile | 10 million users, 50 million identity/email/destination records | Introduce hash-prefix router before 60% measured memory/instruction limit | Point lookup; ordered `(created,id)` and leaderboard cursor; no full user scan |
| Voting/holds | 100 million events per epoch shard | Seal old epoch and create next shard | `(target,epoch,id)` and `(voter,epoch,id)` cursors |
| Workflow active | 10 million nonterminal/retained metadata records per shard | Archive terminal payload/metadata; route by task ID/epoch | Queue index plus exact owner/status cursor |
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
- No secondary index is authoritative: each index entry points to a primary record/version; writes update primary and indexes in one no-`await` message, and consistency scanners compare them in bounded batches.

## Upgrade compatibility

- Pin the compiler and dependencies; commit generated Candid `.did`, Motoko stable `.most`, Wasm hash, and reproducible build instructions.
- Require Candid subtype and stable-compatibility checks in CI for every canister.
- Use additive versioned records and explicit bounded migrations. Never use production `reinstall`.
- Re-register timers and resume durable jobs after upgrade; run old->new->rollback upgrade tests with near-limit data.
- For ZenDB, pin exact source/Wasm; test the old stable store with the proposed version; schema changes use collection-vN copy/hash/switch and retain the old collection until rollback closes.
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
- Chain simulators/testnets: local ICRC ledgers, Bitcoin regtest/testnet, EVM Sepolia, Solana devnet, and equivalent valueless networks. Mainnet paths are configuration-disabled in test builds.
- Migration: deterministic byte/hash golden tests, fault injection after every chunk/state transition, independent record/relation/financial reconciliation. Assume https://github.com/NatLabs/ZenDB/pull/53 is merged.
- Security: authorization matrix, malicious SNS/governance, frontend supply chain, `join-proxy` reuse/fallback/privacy, webhook replay/order, ambiguous sends, reorg/finality, treasury caps/pause/recovery path.
- Reproducibility: rebuild Wasm/assets in clean CI and compare hashes before governance proposal.

## G1 decision requested

Approve or amend these six architecture choices:

1. Replace the target React/TypeScript frontend with standards-based certified assets; remove the Node.js/TypeScript target toolchain only at M10 after the legacy rollback window closes.
2. Use ZenDB collections as the proposed PostgreSQL/Prisma destination, including candidate authoritative core/workflow/financial/replay/migration collections, subject to the M1 atomicity/recovery proof and collection-specific G2 exceptions.
3. Enforce authorization, relationship, uniqueness, money, and replay invariants in Motoko method bodies and durable sagas; ZenDB schemas, constraints, and indexes never replace those controls.
4. Treat Internet Identity and OAuth through `indentify` as peer authentication methods, while binding every authorization decision to the authenticated Candid caller and separating payout destinations from login identities.
5. Replace server-held keys with a unified treasury's Chain Fusion authority for approved native networks, retaining ICRC/ck assets only where their ledger/minter path is selected; every adapter still requires testnet approval.
6. Use one SNS-controlled, independently audited treasury canister for accounting and custody. Do not blackhole any canister; require governance delay, caps, pause/recovery controls, reproducible upgrades, and controller verification instead.

Approval of G1 does not approve the final database schema, data migration, wallet policy/caps, production deployment, production data mutation, or any asset transfer. Those remain G2, G3, and G4.
