# Review ownership

Assign named people to these roles in repository settings or the task record. A role may be held by more than one person, but the author cannot be the sole required reviewer for their own change. “Human” means a designated human maintainer, not an automated or AI review.

| Area | Required review owner | Required when |
|---|---|---|
| Domain logic | Domain owner | Aggregate rules, invariants, service contracts, state transitions, or public behavior change |
| Security | Security owner | Authentication/authorization, principals, roles, privacy, secrets, certification, external callbacks, or privileged interface change |
| Data migration | Migration/data owner | Export, transform, import, schema/version, reconciliation, archival, retention, or quarantine change |
| ICP architecture | ICP architecture owner | Canister boundaries, Candid, stable state, ZenDB, certification, controllers, await/transaction model, or upgrade change |
| Frontend integration | Frontend owner | UI/client API use, delegation/login, public/owner visibility, compatibility, or user-visible migration change |
| Operations | Operations/release owner | CI gates, deployment, monitoring, runbook, rollback, alerts, environment, or production privilege change |
| Financial or governance logic | Financial/governance owner | Votes, eligibility, holds, policy/oracle, reserve, allocation, obligations, settlement, custody, or payment execution change |

## Critical-file human approval

Human approval is mandatory for any change under `architecture/`, `migration/`, `quality/`, `domain/`, `deploy/`, or production configuration; any canister/Candid/stable-state, authentication/authorization, identity/KYC, secret-management, migration script, ledger/payment, governance, reserve, controller, CI gate, release, rollback, or operational runbook change is also critical regardless of path.

The approving human must have the matching role above. Changes spanning areas require every matching owner; financial/governance, security, migration, ICP architecture, and operations changes additionally require their named human approval before merge. Emergency changes still require retrospective human review, a documented incident record, and follow-up remediation before the next release.
