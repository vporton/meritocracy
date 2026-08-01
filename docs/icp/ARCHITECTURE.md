# Target ICP architecture

Status: G1 approval candidate, 2026-07-31. This is a design document; no application code has been changed.

## Decision summary

The recommended target is a set of Motoko application canisters, a certified ICP asset canister for the existing React frontend, native Motoko persistence for all authoritative state, replaceable ZenDB archive shards only for high-volume document payloads, and an explicitly journaled Chain Fusion treasury. The Node/PostgreSQL application remains the production authority until parity and migration reconciliation pass.

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
  certified React assets ---> authenticated Candid calls
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
          |        HTTPS outcalls |        authorized op ID
          |                |   v                v
          |                | archive_router --> immutable vault_canister
          |                |   |                |
          |                | ZenDB shards       +--> ICP/ICRC ledgers
          |                |                    +--> ckBTC/ckETH/ckERC20
          |                +--> OpenAI/Didit/   +--> BTC API / EVM RPC /
          |                     OAuth/email/         SOL RPC / HTTPS RPC
          |                     GDP/prices
          |
          +--> browser-owned wallets for donations/funding

       SNS or reviewed multisig-governance canister controls mutable canisters. (Until it switches to SNS, let it be controlled by an `icp-cli` account.)
       A pause-only incident role cannot send funds, resume, or upgrade.
```

## Canister responsibilities

### `frontend_assets`

- Hosts the Vite/React static build as certified assets with SPA aliasing, strict CSP, immutable hashed assets, and raw access disabled.
- Contains no admin password or bearer token. It uses Internet Identity and generated Candid actors.
- Loads no third-party executable JavaScript. Browser-wallet support must be bundled and pinned.
- The ICP asset canister provides certified HTTP responses and configurable security policy/SPA aliasing; see the [official asset-canister guide](https://docs.internetcomputer.org/guides/frontends/asset-canister/).

### `core_canister` — native Motoko persistence

Authoritative state:

- stable legacy user IDs and new monotonic IDs;
- principal bindings, verified external identity subjects, emails, public profile, and independently versioned payout destinations;
- KYC/liveliness attestations, encrypted-evidence references, deletion/anti-evasion tombstones;
- ban votes, deterministic UTC voting epochs, payment/evaluation holds and compensation eligibility;
- GDP/configuration and deterministic salary/share snapshots;
- role assignments, incident pause state, durable outbox/inbox, migration receipts for core collections, and append-only audit metadata.

Why one core canister initially: identity/profile/voting/hold transitions currently need atomic multi-record invariants. A single Motoko update message can enforce them without an `await`. High-volume payloads and wallet execution are separated. Sharding is introduced only through a versioned router after measured thresholds, not prematurely.

### `workflow_canister` — native Motoko persistence

- Typed task DAG replacing serialized runner-class/runner-data discovery.
- Atomic claim state: `queued -> leased(epoch, owner, expires) -> running -> terminal`, with compare-and-set operation IDs and bounded retry policy.
- Canonical AI result/status/source metadata and exact user/task indexes.
- Stable job schedules, cursors, attempts, completion reports, and outbox/inbox receipts.
- ICP timers replace cron-job.org and in-process intervals. Timer IDs are transient; deadlines and cursors are stable and re-registered after upgrades. ICP timers are best-effort and may interleave after `await`, so jobs are designed at-least-once; see [timers](https://docs.internetcomputer.org/guides/backends/timers/) and [upgrade guidance](https://docs.internetcomputer.org/guides/security/canister-upgrades/).
- External calls use bounded HTTPS outcalls with explicit response limits, cycles budgets, deterministic transforms when replicated consensus is needed, redaction, circuit breakers, and durable idempotency keys. See [HTTPS outcalls](https://docs.internetcomputer.org/guides/backends/https-outcalls/).

The webhook/OAuth HTTP interface may be implemented here or as a small same-controller ingress canister. Conventional webhooks use `http_request` followed by `http_request_update`; the update method re-verifies method/path/body limit, HMAC/signature, freshness, provider event ID, session binding, and monotonic state before forwarding an idempotent event. The protocol supports this update upgrade path; see the [HTTP gateway specification](https://docs.internetcomputer.org/references/http-gateway-protocol-spec/).

### `archive_router` and ZenDB archive shards

- Holds only routing metadata and hashes in native state.
- Routes versioned `ai_artifact_vN`, large redacted request/response documents, public audit-view documents, and migration evidence to bounded remote ZenDB shard canisters.
- Archive failure cannot authorize, complete, delete, or duplicate a core task/payment. Native metadata records the expected archive hash and pending/available state.
- Every document has an application-assigned stable ID, schema version, content hash, created epoch, typed ownership references, and size cap. Every query uses a suitable index and stable cursor.
- Shards are replaceable: canonical export is the portability boundary. Schema changes create a new `collection_vN`, migrate in bounded batches, compare hashes/counts, switch the router, and retain the old collection read-only through rollback.

### `treasury_canister` — native Motoko persistence

Human note: It seems better to join `treasury_canister`
and `vault_canister` into one canister.

- Owns the double-entry liability/reserve/accounting journal, payment cycles, immutable payment intents, destination snapshots, attempts, confirmation/reorg state, and reconciliation reports.
- Receives idempotent obligations from an allowlisted `core_canister`, validates policy version/eligibility snapshot, and creates exactly one stable `operationId` per user/scope/asset/obligation epoch.
- Uses integer base units. USD/GDP presentation values never drive token conservation through floating point.
- Before any cross-canister/chain call, records a prepared attempt. After `await`, it reloads and validates current state/epoch rather than assuming pre-call state still holds. ICP explicitly warns that inter-canister calls are non-atomic and recommends journaling; see [inter-canister call security](https://docs.internetcomputer.org/guides/security/inter-canister-calls/).
- Cannot directly sign. It asks the vault to execute an exact approved operation; both canisters enforce replay protection.

### `vault_canister` — minimal custody boundary

Recommended production direction, subject to G3 approval:

- A small, independently audited Motoko canister owns ICRC accounts/subaccounts and Chain Fusion key derivation paths.
- It stores an immutable operation receipt before signing/sending and refuses a second, conflicting request for the same operation ID.
- It enforces hard per-transaction/per-asset/time-window caps, allowlisted asset/network encodings, a global pause, destination encoding validation, and a delayed successor-vault escape path.
- It has no endpoint to expose a seed/private key because Chain Fusion threshold private keys never exist in the canister.
- After testnet audit and policy finalization, the proposed vault is blackholed (empty controller list). Mutable orchestration remains upgradeable. A compromised governance/controller can alter frontend/core/treasury behavior and cause denial of service, but cannot upgrade the vault or exceed its immutable caps/timelocks. It could still attempt slow drain within those limits, so public monitoring and pause response remain necessary.
- Blackholing trades patchability for containment; the exact caps, delayed migration method, and whether to blackhole are part of G3, not silently assumed.

### Governance and operations

- Development: named developer principals with no funds.
- Pre-production: one reviewed multisig/governance canister is the sole controller. Listing multiple human controllers is not multisig; any controller can upgrade.
- Production mutable canisters: SNS or equivalent on-chain governance as sole controller, with proposal quorum, delay, reproducible Wasm hash, stable/Candid compatibility evidence, and post-deploy controller/module verification.
- Incident role: named principals can only pause integrations/payments and request evidence; they cannot resume, send, change caps, install code, or change controllers.
- Cycles: per-canister alarms, public health, automated top-up with capped allowance, at least 90-day production freezing threshold, and a tested low-cycle mode that stops optional archive/outcalls before core/vault work.
- ICP warns that controllers can replace code and steal canister-held assets; governance or immutability must be verified, not merely documented. See [canister control](https://docs.internetcomputer.org/guides/security/canister-control/) and [trust in canisters](https://docs.internetcomputer.org/guides/canister-management/trust-in-canisters/).

## Authentication and authorization

1. Internet Identity is an authorization method on-par with our OAuth methods. The frontend receives a bounded delegation; canisters authorize the protocol-provided `caller`. No caller-supplied user ID grants access. II provides origin-specific principals and expiring delegations; see [Internet Identity](https://docs.internetcomputer.org/guides/authentication/internet-identity/).
2. A user record can bind multiple approved principals through a recovery/change process. Alternative frontend origins are configured before domain cutover so a domain change does not strand accounts.
3. (removed)
4. Payout destinations are distinct versioned records. A login Ethereum address is the default payout address. Changes require II step-up, chain ownership proof or OAuth where available, a delay/cancel window, notifications, and a snapshot on every payment intent.
5. Admin becomes named on-chain roles/governance proposals. Static `ADMIN_PASSWORD` and `CRON_JOB_AUTHORIZATION` have no target equivalent.
6. All Candid methods authorize in the method body, including inter-canister callers. `canister_inspect_message` may cheaply reject ingress but is not relied upon for inter-canister authorization.

## External integrations

| Legacy integration | Target path | Trust/security treatment |
| --- | --- | --- |
| OpenAI immediate/batch/web search | `llm` Motoko package | Provider remains centralized; scoped spend-limited key, bounded/redacted payload, stable request ID, result schema validation, no payment authority |
| GitHub/ORCID/Bitbucket/GitLab | Frontend OAuth redirect + canister token/profile outcalls | PKCE where supported; remove the authorization method where unsupported |
| Didit | Canister creates session; HTTP-update webhook ingress | HMAC/signature, bounded raw body, provider event ID, freshness, exact workflow/session, expiry, AML rejection precedence, monotonic state, https://github.com/vporton/join-proxy if needed to save money; https://github.com/vporton/join-proxy-client.mo as the client |
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

License consequence: the repository currently contains Apache-2.0 and MIT license texts, while ZenDB is AGPL-3.0. Before distribution/deployment, counsel or an authorized project owner must record whether using an unmodified remote ZenDB canister and publishing corresponding source satisfies the project's intended licensing. This document does not make a legal conclusion. G1 approves only a conditional archive dependency; failure to obtain an acceptable disposition selects the native-shard fallback without changing core interfaces.

Human note: Switch this repository to AGPL-3.0.

### Structure choice

| Data class | Chosen structure | Reason |
| --- | --- | --- |
| Users, principal/identity bindings, roles, emails, KYC state, payout destinations, bans/holds | Native persistent typed maps plus explicit unique/sorted indexes | Security-critical referential/unique/transaction invariants; frequent schema evolution; exact point/range queries |
| Task DAG, leases, canonical results, outbox/inbox | Native persistent typed maps/sets/queues | Atomic claim and graph invariants; no scan/query-planner dependence |
| Liabilities, reserves, journal, operation/attempt receipts, finality/reorg state | Native append-only typed journal plus lookup indexes | Money/replay authority; exact base units; independently auditable state machine |
| Large AI/provider request/response payloads and derived audit documents | Remote versioned ZenDB shards, conditional | Document-shaped, append-heavy, varied nested payloads, multiple metadata filters, high growth; replaceable and hash-addressed |
| KYC raw evidence | Encrypted, access-logged evidence shard with native hash/index metadata; ZenDB not selected initially | PII/retention/access policy outweighs flexible queries; minimize indexed sensitive fields |
| Frontend assets | ICP asset canister | Certified static hosting, compression, SPA routing, security headers |

Native storage still requires explicit indexes and bounded pagination. Enhanced Motoko orthogonal persistence is enabled by default and rejects incompatible stable changes; large `preupgrade` serialization is avoided. See [Motoko persistence and upgrade compatibility](https://docs.internetcomputer.org/languages/motoko/fundamentals/actors/data-persistence/) and [enhanced orthogonal persistence](https://docs.internetcomputer.org/languages/motoko/fundamentals/actors/orthogonal-persistence/enhanced/).

### Capacity and cost envelopes

These are design targets to make limits testable; they are not production-count claims. G2 replaces them with measured current counts and approved forecasts.

| Store | Initial tested envelope | Hard operational action before limit | Query/pagination rule |
| --- | --- | --- | --- |
| Core user/profile | 10 million users, 50 million identity/email/destination records | Introduce hash-prefix router before 60% measured memory/instruction limit | Point lookup; ordered `(created,id)` and leaderboard cursor; no full user scan |
| Voting/holds | 100 million events per epoch shard | Seal old epoch and create next shard | `(target,epoch,id)` and `(voter,epoch,id)` cursors |
| Workflow active | 10 million nonterminal/retained metadata records per shard | Archive terminal payload/metadata; route by task ID/epoch | Queue index plus exact owner/status cursor |
| ZenDB archive shard | 25 million documents or 50 GiB, whichever first | Create new shard; never approach theoretical 500 GiB | Fully covered composite/text index; cursor only; max 256 KiB document, max 1 MiB batch |
| Financial journal | 100 million immutable entries per vault/treasury pair | Add read-only archive/index canister while authoritative balances/receipts stay native | operation ID point lookup; account/asset/sequence cursor |
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

1. ICP/ICRC accounts owned by the vault canister.
2. ckBTC/ckETH/ckERC20 for supported assets when ICP-native settlement meets product needs.
3. Direct canister-controlled external addresses through threshold signatures only when native-chain custody/payout is required and the adapter has passed finality/reorg/replay tests.
4. No new third-party/server-custodial hot wallet. Legacy keys are quarantined and retired after a separately approved, reconciled cutover.

ICP Chain Fusion supports threshold ECDSA/Schnorr addresses, native Bitcoin integration, EVM RPC, SOL RPC, and HTTPS RPC paths; chain-key tokens are ICRC assets backed by native assets. See [Chain Fusion](https://docs.internetcomputer.org/concepts/chain-fusion/), [chain-key tokens](https://docs.internetcomputer.org/guides/digital-assets/chain-key-tokens/), [Bitcoin](https://docs.internetcomputer.org/guides/chain-fusion/bitcoin/), and [Ethereum/EVM RPC](https://docs.internetcomputer.org/guides/chain-fusion/ethereum/).

## Verification strategy

- Motoko unit/property tests: constraints, indexes, canonical encodings, rounding, state transitions, roles.
- PocketIC/local replica: Candid calls, caller auth, timers, awaits/reentrancy, upgrades, cycle depletion, archive failures, migration interruption.
- Differential fixtures: run legacy and ICP transformations over the same sanitized records and explain every intended difference.
- Chain simulators/testnets: local ICRC ledgers, Bitcoin regtest/testnet, EVM Sepolia, Solana devnet, and equivalent valueless networks. Mainnet paths are configuration-disabled in test builds.
- Migration: deterministic byte/hash golden tests, fault injection after every chunk/state transition, independent record/relation/financial reconciliation. Assume https://github.com/NatLabs/ZenDB/pull/53 is merged.
- Security: authorization matrix, malicious controller/governance, frontend supply chain, webhook replay/order, ambiguous sends, reorg/finality, vault caps/pause/successor path.
- Reproducibility: rebuild Wasm/assets in clean CI and compare hashes before governance proposal.

## G1 decision requested

Approve or amend these six architecture choices:

1. Keep React/TypeScript but host it as certified ICP assets; all application backends become Motoko canisters. NO
2. Use native typed Motoko persistence for all authoritative core/workflow/financial/replay state. NO
3. Use ZenDB only as a conditional, remote, replaceable archive for large AI/audit documents, never as authority for balances, authorization, payments, or migration control. NO
4. Use Internet Identity principals as the authentication root; retain social/email/KYC/wallet proofs as separately verified evidence, and separate payout destinations from login identities. NO
5. Prefer vault-owned ICRC/ck-token accounts, add direct Chain Fusion adapters only after per-chain testnet review, and retire server-held legacy keys. NO
6. Pursue an independently audited minimal vault with immutable caps/pause and potential blackholing, while SNS/reviewed governance controls all mutable canisters. YES

Approval of G1 does not approve the final database schema, data migration, wallet policy/caps, production deployment, production data mutation, or any asset transfer. Those remain G2, G3, and G4.
