# Migration-slice quality gates

Every vertical slice in `migration/vertical-slices.md` must pass every applicable gate before advancing from implementation to cutover. A gate is pass/fail: a waiver requires a named human approver, expiry, scope, compensating control, and follow-up task. AI confidence, a narrative assertion, or a green test without its required artifact is not evidence.

## Enforceable evidence model

CI must emit a versioned gate report for each slice containing the task/slice ID, commit and build/Wasm hashes, source and target schema versions, test command/output hashes, fixture/snapshot hashes, policy/batch limits, results, waivers, and approvers. The pipeline must fail on a missing required field, failed command, changed checksum/count without an approved explanation, unresolved blocking finding, or an expired waiver. Where a check cannot be automated, the report must link the signed review/rehearsal artifact; it remains a release blocker.

`B`, `L`, `C`, `M`, `U`, and `X` refer to the behavioral, local/invariant, concurrency, migration, upgrade, and corruption test classes in `tests/invariant-test-plan.md`.

| Gate | Mandatory pass criteria | Machine-checkable evidence where possible |
|---|---|---|
| Specification | Source behavior is documented; unknowns are marked; intentional differences are approved; applicable invariants are identified. | Lint task/spec metadata for required citations, unknown status, invariant IDs, and approval ID; fail on empty/uncited fields. |
| API | Candid contract is valid; errors are typed; pagination is bounded; compatibility is reviewed. | Build/IDL compatibility check; contract/serialization tests; static/API tests for page limit/cursor binding and typed variants; supported-client matrix artifact. |
| Correctness | Unit, integration, behavioral-equivalence, invariant, and concurrency tests pass for applicable scope. | Execute recorded suites; require mapped `B/L/C` cases and coverage manifest. A genuinely unavailable legacy behavior is marked as a gap and blocks cutover unless human-approved with containment. |
| Security | Authentication, authorization, privileged methods, replay, privacy, and external integrations are reviewed. | Run [security-checklist.md](security-checklist.md); authorization/negative tests; secret/PII scan; privileged-interface allowlist diff; replay/duplicate tests. |
| Resource | No unbounded loops or responses; representative data volume is tested; cycle usage is measured; storage growth is estimated. | Static boundedness checks/review markers; max-size fixture benchmark; per-message item/byte/cycle metrics against approved limits; storage projection calculation. |
| Upgrade | Fresh install and every supported previous-version upgrade pass; interrupted migration resumes; rollback is tested. | Exact artifact/fixture matrix from `tests/upgrade-test-plan.md`, serialized test report, snapshot/manifest hash verification, and `U` cases. |
| Migration | Export and transform are deterministic; import is idempotent; counts and checksums match; invariants are verified. | Re-run export/transform and compare hashes; replay import; compare per-entity counts/digests/quarantine counts; execute mapped `M` and invariant verifier. |
| Release | Cutover criteria are met; rollback conditions are documented; monitoring is active; production privileges are reviewed. | Signed release manifest, checklist completion, dashboard/alert test evidence, controller/privilege diff review, and approved cutover/rollback runbook. |

## Gate execution rules

1. Derive applicable invariants from `architecture/invariant-mapping.md` and legacy constraints from `database/invariants.md`; include ownership/privilege paths from `domain/authorization-matrix.md`.
2. Each mutating slice requires `L`, idempotency/replay coverage, and an injected-write-failure assertion. Concurrent or callback/workflow paths additionally require `C`; data import requires `M`; stable-state/interface changes require `U`; decoder/rebuild changes require `X`.
3. A missing test category is only non-applicable when the slice demonstrably has no corresponding behavior. Record the reason in the gate report.
4. Preserve `architecture/transaction-model.md`: validate and commit canonical state, indexes/projections, receipt, and redacted audit atomically before an await. An external effect must have durable claim/idempotency/reconciliation evidence.
5. Preserve `architecture/upgrade-strategy.md`: test exact release artifacts, schema versions, compatible readers, bounded migration batches, and the declared restoration/reconciliation boundary.
6. Gates must run on the proposed release artifact, not merely on source branches. A later artifact/configuration change invalidates affected gates.

## Stop conditions

Do not advance a slice when an invariant fails, a privileged path lacks a negative authorization test, a result can be unbounded, an external effect can be resent after ambiguity, data divergence lacks a documented/quarantined cause, or rollback/reconciliation crosses an unapproved irreversible boundary.
