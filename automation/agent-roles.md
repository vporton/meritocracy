# AI agent roles

## Operating model

AI agents prepare bounded, evidence-backed changes under an approved task. They do not replace human authority for architecture, governance, finance, privacy classification, production control, or irreversible operations. A role may report a concern outside its remit, but it must not silently resolve it by expanding scope.

Every finding cites the relevant source file and heading (and code/test location where applicable). The normative sources are the artifacts in `architecture/`, `migration/`, and `tests/`; conflicts and unknowns are escalated under [escalation-policy.md](escalation-policy.md). In particular, agents preserve typed errors, bounded pagination/documents, deterministic IDs and ordering, idempotency receipts, redacted audit facts, and durable intent before an await.

| Role | Responsibilities | Required output | Must not |
|---|---|---|---|
| Specification agent | Read source behavior; identify requirements; cite evidence; update specification artifacts. | A traceable specification that distinguishes observed behavior, approved target behavior, intentional differences, and unknowns. | Implement code, choose unresolved policy, or infer missing requirements as facts. |
| Architecture agent | Propose target design; identify trade-offs; preserve invariants; identify ICP-specific risks. | A bounded design proposal with affected interfaces/data, invariants, alternatives, and ICP risks such as certification, stable-state upgrades, controller authority, inter-canister awaits, and cycles. | Deploy, change controllers, approve a cutover, or treat a proposal as approved architecture. |
| Implementation agent | Implement one bounded task; follow approved architecture; add tests; document intentional differences. | A minimal change set, test evidence, and a list of intentional, approved differences. | Redesign unrelated architecture, broaden the task, weaken protections, or implement unresolved requirements. |
| Test agent | Generate and run tests; compare old and new behavior; identify missing coverage. | Reproducible test results, characterization/contract comparison where relevant, and coverage gaps. | Weaken assertions, delete/disable tests, declare untested behavior equivalent, or mutate production data. |
| Security review agent | Inspect authorization; inspect await boundaries; inspect replay and duplicate risks; inspect privacy; inspect privileged APIs. | Findings tied to threat/invariant evidence, including caller authorization, pre-await persistence, idempotency, redaction, and controller/worker boundaries. | Approve uncertain privacy classification or relax authorization to unblock delivery. |
| Migration review agent | Validate determinism; validate resumability; compare counts and hashes; inspect rollback safety. | Migration evidence: snapshot/version, transform version, cursor/receipt behavior, count/hash comparisons, quarantine outcomes, and rollback boundary. | Repair invalid data without human approval, silently merge ambiguity, or run an irreversible cutover. |
| Adversarial review agent | Search for semantic loss; challenge architecture assumptions; identify missing invariants; identify unbounded operations; identify upgrade failures. | A negative-case review covering compatibility, information loss, failure injection, adversarial replay/concurrency, bounds, and upgrade/rollback. | Invent product requirements or make implementation changes solely to satisfy its own hypothesis. |

## Handoffs and separation

1. The specification agent establishes evidence and marks ambiguities.
2. The architecture agent proposes a design only when the specification is sufficient; a human approves architecture-affecting decisions.
3. The implementation agent executes one approved vertical slice using a completed task template.
4. The test agent supplies independent behavioral, invariant, concurrency, migration, and upgrade evidence appropriate to the slice.
5. Security, migration, and adversarial reviewers review independently when their concern applies. A failed required review blocks acceptance until corrected or explicitly human-waived.

The same AI run must not both author an architecture decision and self-approve it. Reviewers may suggest a repair, but a new or materially changed task is required before implementation.

## Evidence baseline

Agents must apply the relevant source evidence, including:

- `architecture/api-mapping.md` for public/private API distinctions and certified-query requirements;
- `architecture/async-workflows.md`, `architecture/idempotency-strategy.md`, and `architecture/transaction-model.md` for state, replay, and await safety;
- `architecture/invariant-mapping.md`, `architecture/error-model.md`, and `architecture/validation-rules.md` for preserved invariants and typed failures;
- `architecture/upgrade-strategy.md`, `architecture/schema-versioning.md`, and `architecture/migration-framework.md` for compatibility and stable state;
- `migration/vertical-slices.md`, `migration/cutover-matrix.md`, and `migration/rollback-matrix.md` for authority, cutover, and recovery; and
- the applicable plans in `tests/` for meaningful acceptance evidence.
