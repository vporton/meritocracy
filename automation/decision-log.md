# Migration automation decision log

## D-001 — Do not infer task approval

- **Date:** 2026-07-12
- **Scope:** migration orchestration intake.
- **Decision:** no vertical-slice implementation task is selected or marked
  `APPROVED`.
- **Evidence:** `automation/task-template.md` requires completed, cited task fields
  before implementation; `development/workflow.md` requires this task record;
  `development/ownership.md` requires matching human approval for critical migration
  work. The checkout contained neither a task queue nor a human approval record.
- **Effect on API/data/authorization/transactions/canisters/upgrades/privacy:** none.
  This is a process decision only; no runtime artifact changed.
- **Follow-up:** a matching human owner must approve a fully specified task and its
  file allowlist before implementation begins.
