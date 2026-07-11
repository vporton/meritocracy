# Dependency rules

## Enforceable direction

```text
api ───────────────► services ───────────────► repository ports ◄──────────── adapters
                         │                         ▲                         │
                         ├────────► auth policy    │                         └── ZenDB / stable state / ledger
                         ├────────► domain ◄───────┘
                         └────────► workflows

certification ─────► query service / canonical read ports
migrations ────────► migration service / ports (separate entry path)
```

1. API handlers may call services and pure API/domain mappers only. They may not import a repository, ZenDB client, stable map, ledger client, migration transform, or authorization rule implementation.
2. Services may call domain functions, authorization policy, repository ports, workflow event ports, clocks/ID generators, and certification collaborators. They must not import concrete ZenDB, stable-state, Candid, or external SDK implementations.
3. Repository implementations may call their storage adapter: stable repositories may call stable-state facilities and ZenDB repositories may call ZenDB. They may not call services, API handlers, Candid types, workflow handlers, or authorization policy.
4. Domain types, validators, state transitions, and calculations must not depend on ZenDB, stable-state APIs, Candid, platform caller APIs, clocks, random sources, network clients, or adapters. Money is integer/fixed-point only.
5. Authorization policy is centralized in `auth/authorization`. API handlers authenticate; services ask policy questions; repositories enforce only caller-independent storage scope/consistency. A repository must not contain ownership, role, eligibility, governance, or worker allow-list policy unless a storage-engine access capability is technically required and documented as a defense-in-depth check.
6. External adapters may translate calls and publish observations, but must not mutate canonical domain state directly. They submit typed commands/events to a service; the service re-reads and validates state after any await.
7. ZenDB repositories contain only bounded projection/history document operations. Canonical keys, active state, reserve math, vote uniqueness, eligibility and authorization remain stable-state repositories.
8. Migration code is isolated under `migrations/`, called only by `MigrationService` through the internal governance interface. Normal API modules and ordinary services must not import migration readers/transforms. Migration writes carry immutable receipts and bounded cursors.
9. Certification reads canonical public facts and must not certify arbitrary ZenDB documents. A projection can be rebuilt from canonical data; certification cannot depend on a rebuild completing.
10. Workflows own external-effect orchestration and lease/outbox mechanics. They cannot bypass the aggregate-owning service to alter Account, Vote, Period, Reserve, or Obligation state.

## Enforcement

Use separate package/module targets for `domain`, `application` (services/ports/auth), `infrastructure` (repositories/adapters), `interfaces` (api), and `migration`. CI should run import-boundary checks that reject forbidden imports, plus a `domain` build/test target with no platform or ZenDB dependencies. Construct concrete implementations only in the composition root. Expose repository interfaces from `repositories/ports`, never concrete adapter classes.

## Circular-dependency review

No circular dependency is permitted. Two likely cycles are specifically prohibited:

|Potential cycle|Why it is harmful|Required break|
|---|---|---|
|`services → ZenDB repository → services` for projection rebuilding|would let persistence invoke business transitions and make ZenDB authoritative|repository returns data only; `ProjectionCoordinator` is called by a service or outbox handler and uses ports.
|`auth → AccountRepository → auth` for role checks|would embed policy in persistence and cause authorization recursion|service loads account facts, then passes them to pure `AuthorizationPolicy`; repository never asks auth.
|`workflows → PaymentService → workflows` for settlement retries|would couple external await handling to state mutation|services emit immutable workflow events; handlers submit a new service command.
|`migrations → normal API → migrations`|would make privileged imports reachable through browser flows|both depend on ports/services as appropriate; API never imports migration code.

At design time, a direct `domain → repositories`, `repositories → api/services/auth`, `adapters → domain-service mutation`, or `api → migration` import is a build failure.
