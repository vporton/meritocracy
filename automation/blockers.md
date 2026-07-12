# Migration automation blockers

## B-001 — Operational migration runbook is absent

- **Affected tasks:** S1-01 through S9-01.
- **Evidence:** `migration/vertical-slices.md`, “Rules used for every slice,” says
  that `migration/runbook.md` is absent and must be supplied and rehearsed before
  state-changing or financial cutover.
- **Impact:** no state-changing migration, cutover, financial action, or retirement
  task may advance to implementation/cutover on the basis of the current artifacts.
- **Safe action:** retain PostgreSQL as authoritative and perform only planning or
  non-mutating characterization work.
- **Required human resolution:** supply and approve a runbook covering snapshot,
  reconciliation, rollback, recovery, access control, and rehearsal evidence.
- **Status:** OPEN.

## B-002 — No human-approved task or named approver record

- **Affected tasks:** S1-01 through S9-01.
- **Evidence:** the initial checkout had no `automation/task-queue.md`, no completed
  task record, and no approval record. `development/ownership.md` requires matching
  named human owners for critical-file and migration work.
- **Impact:** an AI cannot move a task to `APPROVED` or `MERGED`; implementation
  would violate the task-template and workflow requirements.
- **Safe action:** keep all tasks `PROPOSED` and do not alter application behavior.
- **Required human resolution:** nominate the matching reviewers/approver(s), approve
  one completed task record with an explicit file allowlist, and record the approval.
- **Status:** OPEN.
