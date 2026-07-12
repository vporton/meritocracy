# AI implementation task template

Copy this template for every implementation task. Fields marked **Required** must be completed with source citations before implementation starts. “Unknown”, “TBD”, or an unresolved conflict is an escalation, not permission to guess.

## Identity and scope

- **Task ID:**
- **Title:**
- **Owner / approving human:**
- **Vertical slice:** one named slice from `migration/vertical-slices.md`, or a narrowly scoped prerequisite.
- **Approved source specification:** **Required.** Links/headings from `architecture/`, `migration/`, `tests/`, and relevant characterization/source behavior.
- **Change rationale and intentional differences:** State every approved difference from old behavior; otherwise write “none”.
- **Files permitted to change:** **Required.** Explicit allowlist.
- **Files prohibited from changing:** **Required.** Explicit denylist, including unrelated architecture, deployment/controller, generated artifacts, and production configuration unless expressly approved.

## Required design contract

- **Expected behavior:** **Required.** Observable success, failure, and replay behavior.
- **Invariants:** **Required.** Include source IDs/headings and how each will be preserved.
- **API contract:** Method/call type; caller and authorization; input/output variants; versions; pagination/order/certificate behavior; typed errors; idempotency key/event semantics.
- **Data model:** Canonical and derived records, schema/version compatibility, keys/indexes, data classification/redaction, retention, and audit events.
- **Security requirements:** Authorization matrix; public versus owner/worker/governance boundary; privacy constraints; secrets prohibition; trusted/certified result requirements; replay/duplicate and await-boundary protections.
- **Boundedness limits:** Maximum items, bytes, pages, attempts, work/runtime/cycle limits, batch cursor behavior, and prohibited full scans. Cite policy/configuration source.

## Delivery and verification

- **Implementation boundary:** The smallest coherent change. Identify explicitly what this task will not implement.
- **Required tests:** **Required.** Unit, service/Candid, behavioral comparison, invariant, concurrency, migration, and upgrade tests as applicable. Name fixtures and failure injection.
- **Acceptance criteria:** **Required.** Concrete observable criteria, including test commands/results, no unrelated changes, evidence citations, and required review roles.
- **Rollback considerations:** **Required.** Compatibility window, feature gate/stop condition, snapshot/manifest needs, reversible state boundary, external-effect reconciliation, and user-visible failure state. State “human escalation required” when rollback is impossible.
- **Human approvals / escalation decisions:** Required for each triggered condition in `escalation-policy.md`.

## Completion record

- **Changed files:**
- **Tests run and results:**
- **Reviewer findings and resolutions:**
- **Known gaps / follow-up task IDs:**
- **Intentional differences actually delivered:**
- **Rollback rehearsal/result:**
