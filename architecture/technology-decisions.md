# Technology decisions

Status terms: **decided** is the target recommendation; **conditional** requires stated evidence before adoption. These are architecture decisions, not implementation commitments.

## ADR-001 — Motoko versus Rust

**Context.** The core needs principal-based authorization, stable state, bounded state machines, Candid interfaces, and ICRC calls. The current TypeScript services include external adapters and AI workflows.

**Options.** Motoko core; Rust core; mixed language canisters.

**Decision.** **Decided:** implement `meritocracy_core` in Motoko. **Conditional:** add a small Rust component only for a benchmarked/resource-critical deterministic primitive or a verified cryptography/library gap that Motoko cannot meet safely.

**Rationale.** The core is domain-state-heavy rather than CPU-heavy. One language reduces interface, upgrade, and audit surface. Existing Node code is not evidence that Rust is required.

**Consequences.** Define stable types and bounded collections carefully; keep external integrations out of the core. Any Rust addition gets its own ADR, benchmarks, controller rationale, and inter-canister failure design.

**Risks.** Motoko library maturity or performance may be inadequate for a later proof scheme. Premature mixed languages create needless asynchronous boundaries.

**Unresolved questions.** Which wallet proofs and cryptographic verification schemes must run on-chain, and what are their measured limits?

## ADR-002 — ZenDB versus direct stable structures

**Context.** The current normalized database has profile, assessment, vote, distribution, and pending-transfer history. Some need unique atomic constraints; others need indexed pagination.

**Options.** Direct stable maps only; ZenDB for all data; direct stable authority plus selective ZenDB documents.

**Decision.** **Conditional:** use direct stable structures for canonical accounts, vote uniqueness/aggregates, policy, current obligation state, and idempotency. Use ZenDB only after validating its transaction, index, stable-memory, and upgrade guarantees for bounded `public_profiles`, `assessment_runs`, and payment-history projections.

**Rationale.** ZenDB is useful for indexed document reads, not a reason to duplicate authority or reproduce every SQL table. Payment and vote correctness must not depend on an unverified secondary abstraction.

**Consequences.** The core canonical record contains IDs/status/amount/version; derived documents are rebuildable. Cursor pagination and document-size caps are mandatory.

**Risks.** Projection drift, index/storage cost, and unbounded evidence. If ZenDB guarantees are insufficient, retain direct stable indexes and export search off-chain.

**Unresolved questions.** What are ZenDB’s exact atomicity, migration, certification, query-cost, and index-size guarantees at target scale?

## ADR-003 — Frontend framework retention or replacement

**Context.** The current frontend is React 18/Vite with wallet integrations. It is a static SPA, while the backend currently supplies REST/session semantics.

**Options.** Retain React/Vite; replace with another framework; retain server-rendered Node frontend.

**Decision.** **Decided:** retain React/Vite and replace REST/session access with generated Candid actor bindings and delegation identity. Serve its build from the asset canister.

**Rationale.** No evidence shows the framework is the problem; the boundary/authentication model is. Rewriting UI framework would not reduce core risk.

**Consequences.** Remove bearer-session assumptions, verify certified outputs in client code, and preserve wallet providers only for explicit proof/transfer UX.

**Risks.** A compromised asset release can phish users; release governance and CSP need review.

**Unresolved questions.** Is SSR required for discoverability, and which current browser-wallet flows are product requirements?

## ADR-004 — Internet Identity or other authentication

**Context.** Existing auth relies on database bearer tokens, unsafe direct social handlers, and private email/KYC state.

**Options.** Internet Identity; a compatible delegation wallet/identity; preserve server sessions; external OAuth as primary auth.

**Decision.** **Decided:** Internet Identity is the default authentication mechanism. Permit another delegation-compatible identity only if it yields a stable ICP principal. OAuth/email/KYC become off-chain verification/linking evidence, not a bearer credential or direct authority.

**Rationale.** Principal-authenticated canister calls eliminate the replicated bearer-token model and bind authorization to caller identity.

**Consequences.** Identity recovery/multiple-principal linking requires an explicit governed claim policy; social login cannot silently create authority.

**Risks.** User recovery and multi-device expectations may be unmet without a documented linking process.

**Unresolved questions.** Can one person bind multiple principals, and what proof/appeal process governs recovery?

## ADR-005 — Certified versus uncertified reads

**Context.** Ordinary queries are fast but not certified; current public endpoints expose sensitive data and may inform governance/financial decisions.

**Options.** All ordinary queries; all certified outputs; risk-based split.

**Decision.** **Decided:** use certified outputs for public facts users rely on to verify governance, policy, accepted decision/aggregate, and financial aggregate. Use ordinary bounded queries for display-only, caller-authorized, or easily refreshed views.

**Rationale.** Certification has complexity/cost; making every read certified is unnecessary, but using uncertified display data as a payment/governance proof is unsafe.

**Consequences.** Document each API output’s certification class and make the frontend verify certificates.

**Risks.** Misclassification can mislead users; certificate implementation needs dedicated tests.

**Unresolved questions.** Which profile/assessment fields must be independently publicly auditable?

## ADR-006 — Off-chain search and analytics

**Context.** Logs, AI evidence, history, and public data can grow without bound; the current system offers unsafe broad log access.

**Options.** On-chain full-text/analytics; off-chain derived store; no search/analytics.

**Decision.** **Decided:** use an off-chain, redacted, derived search/analytics store. It has no authority over eligibility, voting, or payments.

**Rationale.** Full-text indexes, raw logs, privacy retention, and large scans consume cycles/storage and are not consensus-critical.

**Consequences.** Export only approved/redacted events; support audit reconciliation back to canonical core IDs.

**Risks.** Analytics lag or outage; privacy leakage through overbroad exports.

**Unresolved questions.** Required reports, retention period, legal basis, and access roles.

## ADR-007 — Asset storage

**Context.** React build/public files have different volume, cache, and deployment cadence from governance state.

**Options.** Core canister assets; separate asset canister; third-party CDN only.

**Decision.** **Decided:** use a dedicated ICP asset canister for the public bundle and immutable release assets.

**Rationale.** It isolates storage/cache and permits UI rollback independently. A third-party CDN may cache only public immutable content and cannot be trusted as the source of certified application state.

**Consequences.** Asset release is independently versioned and governed; no user PII belongs in assets.

**Risks.** Asset-release compromise and cache inconsistency.

**Unresolved questions.** Asset budget, CSP, custom domain, and release approval policy.

## ADR-008 — External API access

**Context.** Current flows call OpenAI, OAuth/KYC/email providers, GDP/price sources, and many blockchain RPCs, often with secrets or long execution.

**Options.** Canister HTTPS outcalls; protected worker; browser direct calls.

**Decision.** **Decided:** protected workers are the default. Canister HTTPS outcalls are conditional on public/no-secret endpoint, bounded response, explicit cycle budget, validation, and non-financial authority. Browser calls only user-chosen public wallet/provider UX.

**Rationale.** Canisters cannot keep conventional API secrets confidential and external calls are non-atomic. Worker proposals preserve a small trusted core.

**Consequences.** Use signed/authorized, versioned, idempotent proposals and explicit oracle policy. No public endpoint may trigger an external financial operation.

**Risks.** Worker compromise, oracle manipulation, provider outages, and ambiguous external sends.

**Unresolved questions.** Worker attestation/key rotation, oracle quorum, providers, and permissible direct outcalls.

## ADR-009 — Testing framework

**Context.** Existing coverage is Mocha integration tests for Node payment services; route-level coverage is absent. The target has state-machine, upgrade, certification, and inter-canister risks.

**Options.** Retain Mocha only; use the Motoko ecosystem’s current maintained unit/property test tooling plus `dfx` integration tests; primarily browser E2E tests.

**Decision.** **Conditional:** select the maintained Motoko test tool compatible with the chosen toolchain after a small spike; require `dfx` local-replica integration tests and retain TypeScript tests for React/actor clients. Do not select a framework solely because Mocha is present.

**Rationale.** Correctness depends on deterministic canister and upgrade tests, not the legacy Node test runner.

**Consequences.** Test invariants/property cases: duplicate vote, idempotency, money conservation, every await crash point, certification verification, migration resume, and pre/post-upgrade decoding.

**Risks.** Tool churn and incomplete replica fidelity for ledger/external failures.

**Unresolved questions.** Chosen DFINITY/Motoko toolchain version and whether property/fuzz tooling meets the invariants.

## ADR-010 — Deployment tooling

**Context.** Existing CI deploys Node/React to Fly; the target needs canister IDs, controlled controllers, and upgrade evidence.

**Options.** Preserve Fly scripts; `dfx`/reproducible canister deployment; custom deployment service.

**Decision.** **Decided:** use pinned `dfx` and reproducible build/deploy scripts in CI for ICP; separate staging and production identities; require reviewable WASM/interface/schema artifacts and controller checks. Keep Fly only for approved off-chain workers.

**Rationale.** ICP deployment and upgrades must be coupled to canister controllers and stable-state checks, which Fly scripts do not provide.

**Consequences.** CI has no unilateral production controller; release approval is governance-controlled.

**Risks.** Credential loss/misconfigured controllers; mitigate with documented recovery and preflight checks.

**Unresolved questions.** Governance signer technology, environments, and release quorum.

## ADR-011 — Observability

**Context.** Current logs can expose requests, responses, and sessions publicly. Target workflows need auditability without publishing private data.

**Options.** Public raw logs; no telemetry; redacted on-chain audit plus protected off-chain telemetry.

**Decision.** **Decided:** emit minimal, redacted core audit events and metrics/status; send detailed logs/traces to protected off-chain observability. Provide certified public aggregates only where policy requires them.

**Rationale.** Operational debugging needs searchable detail; consensus state must remain small and privacy-minimized.

**Consequences.** Correlation IDs link core event, worker job, and payment instruction without exposing content/secrets.

**Risks.** Redaction defects and observability outage. The core’s state remains recoverable without the telemetry system.

**Unresolved questions.** Provider, retention, alert ownership, and public transparency metrics.

## ADR-012 — Schema migration mechanism

**Context.** PostgreSQL migrations, numeric IDs, floats, weak status constraints, duplicate-date inconsistency, and PII cannot be copied directly into stable state.

**Options.** Big-bang import; dual write; versioned resumable import with core schema migrations.

**Decision.** **Decided:** use versioned stable-state schemas plus bounded, idempotent import batches keyed by source snapshot and source row. Use one-way domain cutovers, not unconstrained dual writes. Migrate only minimized, validated domain facts; shadow/reconcile financial state before execution.

**Rationale.** It controls duplication and makes retry/rollback observable. Principal claim prevents assigning legacy identities without proof.

**Consequences.** Every schema has an explicit version, conversion, pre/post-upgrade test, reconciliation report, and rollback/cutover procedure. Convert money to integer units and statuses to finite variants.

**Risks.** Incomplete source mapping, ambiguous payment sends, and policy changes during migration.

**Unresolved questions.** Source freeze window, accepted historical evidence, retention obligations, and cutover owner.
