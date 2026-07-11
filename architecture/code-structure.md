# Code structure

## Purpose and boundary

`meritocracy_core` owns canonical state. ZenDB is reached only through projection/history repositories and is never the source of an authorization, uniqueness, eligibility, balance, reserve, or state-transition decision. This is a target structure, not an instruction to create production files now.

```text
src/
  api/
    public/             Candid public interface handlers and request/response mappers
    internal/           worker and governance Candid handlers
    certification/      certified-query handlers and witness assembly
  domain/
    types/              pure IDs, values, records, variants, typed errors and results
    validators/         pure syntax, size, cursor, fixed-point and schema validators
    transitions/        pure state-machine transition tables
    calculations/       pure vote, allocation, reserve and policy calculations
  services/
    account-service
    assessment-service
    attestation-service
    governance-service
    payment-service
    work-service
    query-service
    migration-service
  repositories/
    ports/              repository interfaces owned by the domain/application boundary
    stable/             adapters for canonical stable maps, indexes, receipts and audit log
    zendb/              ZenDB adapters for the three bounded document collections
    projection/         projection coordination/rebuild support; no policy decisions
  auth/
    authentication      caller/principal and worker identity extraction
    authorization       centralized role, ownership and capability policy
  workflows/
    commands/           durable work-item payload references and workflow event types
    handlers/           worker callback adapters and reconciliation orchestration
    outbox/             rebuildable projection/notification/erasure intents if needed
  migrations/
    import/             snapshot readers, transforms and bounded batch orchestration
    reconciliation/     ledger/source comparison and quarantine reports
  certification/
    model/              certified public-status, vote-period and reserve aggregate models
    builder/            hash-tree/witness construction from canonical public projections
  adapters/
    zendb/              concrete ZenDB client, schemas, index and transaction capability adapter
    workers/            outbound evaluation, identity, executor and oracle clients
    ledger/             ledger observations and transfer client
    private-services/   off-chain identity, evidence, erasure, secrets and notification clients
  tests/
    unit/               isolated tests by layer; no real ZenDB or canister calls
    fakes/              in-memory repository, clock, ID and external-adapter fakes
    contract/           Candid and serialization compatibility tests
```

## Module responsibilities

|Module|Owns|May depend on|Must not depend on|
|---|---|---|---|
|`api/public`|mapping `public.did` requests to service commands/queries; returning typed API errors|services, domain request/response types, authentication|repositories, ZenDB client, policy implementation details|
|`api/internal`|mapping the four internal Candid interfaces; worker/governance caller authentication|services, domain types, authentication|ZenDB and external adapters directly|
|`api/certification`|public certified-query presentation only|query/certification services|private data, ZenDB as authority|
|`domain/types`|stable, transport-independent vocabulary: IDs, money, versions, statuses, commands, results and error taxonomy|nothing outside `domain`|Candid, ZenDB, stable-state APIs, network clients|
|`domain/validators`|deterministic bounds and shape validation, including no-private-data checks|`domain/types`, policy values supplied as inputs|repositories, caller identity, I/O|
|`domain/transitions`|allowed account, assessment, work, period and obligation transitions|`domain/types`|repositories, clock access, I/O|
|`domain/calculations`|deterministic arithmetic and threshold calculations|`domain/types`|floating point, ZenDB, external calls|
|each `services/*` module|command orchestration: authorize, load, validate, calculate, commit a defined atomic group and emit workflow events|ports, auth policy, domain|concrete ZenDB/stable/ledger clients; raw Candid records|
|`repositories/ports`|language-independent persistence contracts and unit-of-work semantics|domain types only|ZenDB SDK, authorization policy|
|`repositories/stable`|canonical maps, secondary indexes, idempotency receipts, audit append and atomic stable transaction implementation|ports, domain, platform stable state|API and business authorization policy|
|`repositories/zendb`|bounded document persistence and declared indexed reads for the three collections|ports, domain projection types, ZenDB adapter|canonical decisions, roles/ownership policy|
|`repositories/projection`|translate already-authorized committed canonical facts into replaceable ZenDB views and verify/rebuild them|ports, domain projection types|new domain transitions or external side effects|
|`auth/authentication`|authenticated principal and configured worker/governance identity|platform caller facilities|repositories and business state mutation|
|`auth/authorization`|all ownership, role, worker allow-list and capability decisions|domain facts supplied by services|ZenDB queries, API transport types|
|`workflows`|durable intent/event vocabulary, work lease protocol and external-result correlation|services/ports/domain|direct mutation of account, reserve, vote or obligation state|
|`migrations`|versioned transformations, import receipts, quarantine and bounded resumption|migration service/ports/domain|normal API handlers and reusable production mutation shortcuts|
|`certification`|canonical public projections and certificate construction|domain/public query ports|private projections and external adapter writes|
|`adapters/*`|translate external SDK/protocol errors to typed boundary errors|ports/domain|domain-policy decisions and direct canonical mutation|

## Composition and ownership

The composition root creates concrete adapters, stable and ZenDB repositories, the authorization policy, services, then API handlers—in that dependency direction. A service receives a transaction-capable `CoreUnitOfWork`; it does not open a ZenDB transaction itself. The stable adapter coordinates the atomic canonical commit, audit receipt, indexes, and (only after the required ZenDB guarantee is verified) synchronous projection writes. If that guarantee is unavailable, it commits a rebuildable projection outbox event instead.

The only ZenDB document schemas are `PublicProfileProjection`, `AssessmentRunProjection`, and `PaymentObligationProjection`. They intentionally differ from the aggregate types so adding a document index cannot contaminate domain logic.
