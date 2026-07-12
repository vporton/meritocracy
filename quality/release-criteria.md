# Release acceptance criteria by vertical slice

These criteria apply independently to every vertical slice defined in `migration/vertical-slices.md`, including prerequisites that alter its contract, data, authorization, workflow, or deployment artifact. A release may combine slices only when each slice has its own passing gate record and their combined invariant/compatibility tests pass.

## Non-negotiable measurable thresholds

| Criterion | Required threshold | Evidence |
|---|---|---|
| Critical test failures | **Zero.** All applicable unit, integration, behavioral, invariant, concurrency, migration, upgrade, and corruption suites exit successfully. | Immutable CI report with commands, result hashes, mapped `B/L/C/M/U/X` test IDs, and artifact hash. |
| Critical security findings | **Zero unresolved.** | Signed security checklist/findings report; no open critical finding or expired waiver. |
| Data divergence | **Zero unexplained rows, counts, or digest differences.** Every expected difference is approved, mapped, and either transformed or quarantined with a redacted reason. | Source/target count and checksum manifest, transform version, receipt/quarantine digest, invariant verifier. |
| Worst-case execution | **Bounded and within every approved item, byte, response, execution-time, cycle, and storage-growth limit.** | Representative-volume benchmark tied to release artifact and approved limit manifest. |
| Upgrade rehearsal | **Successful** for fresh install and every supported predecessor, including interrupted migration and pending workflows where applicable. | Exact artifact/fixture matrix with `U` results and schema/fixture hashes. |
| Rollback rehearsal | **Successful where technically possible**, at the declared compatibility/snapshot boundary. Where impossible, human approval of the irreversible boundary and reconciliation runbook is mandatory before release. | Snapshot/restore/rebuild report, or signed approval plus reconciliation rehearsal. |
| Intentional behavior differences | **All approved before implementation and fully tested/documented. Zero unapproved differences.** | Specification diff mapping old/new behavior to approval and behavioral test evidence. |

## Slice acceptance record

Each slice must publish a release record containing:

- slice ID, commit/build/Wasm and schema versions, deployment target, and source/target authority state;
- applicable invariants and authorization paths; gate outcomes and evidence hashes;
- API/Candid compatibility result and boundedness-limit manifest;
- source/target counts, checksums, quarantine counts/reasons, and migration receipt digest when data moves;
- dashboard/alert test evidence, cutover stop condition, rollback/reconciliation runbook, and production privilege/controller review; and
- named human approvals for intentional differences, waivers, financial/governance/privacy decisions, and irreversible boundaries.

## Decision rule

Release is accepted only when every applicable gate in [gates.md](gates.md) passes and every threshold above is met. The release owner must reject a release with missing evidence even if an AI or reviewer expresses high confidence. Confidence is never a substitute for reproducible tests, hashes, measured bounds, review evidence, or human approval where required.
