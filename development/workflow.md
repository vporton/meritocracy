# Incremental implementation workflow

Implement the migration as small, independently reviewable vertical slices. A task moves one observable capability and only the minimum authoritative state required for it; it never becomes a repository-wide rewrite. The slice order and cutover conditions are defined in [vertical-slices.md](../migration/vertical-slices.md).

## 1. Define a bounded task

1. Choose one named slice (or a narrow prerequisite) and create one branch under the rules in [branching.md](branching.md).
2. Complete [the task template](../automation/task-template.md) before implementation. Cite the source behaviour, approved architecture, applicable invariants, authorization path, bounds, test plan, rollback boundary, explicit file allowlist, and what is out of scope. Unknowns require escalation; they are not permission to invent requirements.
3. Identify the applicable quality gates in [gates.md](../quality/gates.md): `L` for every mutation, plus `C`, `M`, `U`, and `X` when their triggering conditions apply.

## 2. Implement and verify

1. Make the smallest coherent implementation in small commits following [commit-policy.md](commit-policy.md).
2. Preserve the architecture's atomic transaction boundary: validate and commit canonical state, indexes/projections, receipt, and redacted audit before any await. External effects need durable intent/claim, idempotency, and reconciliation evidence.
3. Run the task's required tests, including negative authorization, boundedness, replay/concurrency, migration, upgrade, and failure-injection tests where applicable. Record commands and results in the task completion record.
4. Generate the versioned gate report for the proposed release artifact. It must include the hashes, schema versions, limits, test evidence, fixtures/snapshots, review artifacts, and any time-bounded waiver required by `quality/gates.md`.

## 3. Review and merge

1. Open a PR using [pr-template.md](pr-template.md), linked to its completed task record and gate report.
2. Obtain independent review using [the review template](../automation/review-template.md). Required owners are selected under [ownership.md](ownership.md); critical files require human approval.
3. Resolve blocking findings. A waiver must name its human approver, scope, expiry, compensating control, and follow-up task. No unresolved blocker or expired waiver may merge.
4. Merge only when CI passes on the proposed artifact, required approvals are present, the PR is bounded, and its rollback/reconciliation boundary is documented.

## 4. Release and learn

1. Cut over only when the slice-specific condition and Release gate pass. Use shadow comparison where the slice requires it; never dual-write an irreversible or financial effect.
2. Monitor the declared stop conditions. On divergence, authorization failure, unbounded result, unsafe resend, or unapproved irreversible boundary, halt advancement and follow the documented rollback or reconciliation process.
3. Close the task with changed files, evidence, reviewer resolutions, intentional differences delivered, rollback rehearsal, and follow-up IDs. Start the next task on a new branch.

## Non-negotiable boundaries

- PostgreSQL remains authoritative for capabilities not explicitly cut over.
- A source numeric user ID is migration metadata, never proof of a principal claim.
- Sensitive data, bearer sessions, tokens, KYC payloads, and secrets do not enter core/ZenDB state.
- Financial execution is single-writer; ambiguous sends are reconciled, never blindly resent.
