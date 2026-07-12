# AI escalation policy

AI agents must stop the affected task, preserve evidence, and request a human decision when any condition below occurs. Escalation is not a failure: it prevents an agent from converting an unresolved architectural or production decision into code.

## Mandatory human escalation

| Trigger | Required escalation package | AI action while pending |
|---|---|---|
| Financial logic changes | Affected asset/reserve/rounding/allocation/settlement paths, invariants, tests, external-effect and reconciliation impact. | Do not alter financial semantics, initiate transfers, or approve execution. |
| Governance logic changes | Affected roles, policy versions, voting/holds/finalization, controller authority, and compatibility impact. | Do not change governance semantics or controllers. |
| Privacy classification is uncertain | Data examples/classification alternatives, replication/publication paths, retention/redaction evidence. | Treat data as sensitive; do not store, emit, or expose it. |
| Architecture artifacts conflict | Exact conflicting file/heading quotations or concise summaries, impact, and options. | Do not select an interpretation or implement the disputed behavior. |
| Source behavior is ambiguous | Reproduction/characterization evidence, competing interpretations, and affected contract. | Preserve current behavior where safe; do not invent target behavior. |
| A migration repairs invalid data | Row/snapshot hashes, validation failure, proposed quarantine/correction, counts, and reversibility. | Quarantine/report; do not repair, merge, or discard the row. |
| A security invariant lacks evidence | Missing invariant, exposed boundary/threat, attempted evidence, and conservative alternatives. | Block the sensitive/privileged change. |
| Rollback is impossible | Exact irreversible boundary, external effects, snapshot/restore limits, reconciliation plan, and user impact. | Do not cross the boundary or enable cutover. |
| A canister split is proposed | Atomicity, controller, interface, state ownership, cost/cycle, migration, and rollback analysis. | Do not create/split/deploy canisters. |
| Production controllers change | Proposed principals/roles, authority rationale, approval record, rollback/emergency process. | Do not alter controllers or deployment permissions. |

## Procedure

1. Record the task ID, trigger, affected files/records, source citations, and safe reproduction details. Never include secrets, raw PII, or private credentials.
2. Mark the affected acceptance criterion blocked; continue only independent, non-mutating work that cannot prejudge the decision.
3. Provide bounded options, their invariant/security/rollback consequences, and a recommended conservative default.
4. Require an identified human approver to record the decision, scope, and any required follow-up task. A human decision changes only the stated scope.
5. Re-run the relevant review and test evidence after the approved resolution. For migration/cutover decisions, retain hashes, counts, receipts, and reconciliation evidence.

No response, informal preference, or an AI-generated rationale constitutes approval. If an urgent production condition exists, follow the approved human incident procedure; AI agents may collect read-only diagnostics but may not deploy or change controllers.
