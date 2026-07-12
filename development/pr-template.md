# Pull request template

Copy the following into every implementation PR. All fields are required; write `none` or `not applicable` with evidence where appropriate. Unknowns require escalation.

```md
## Task and scope
- Task ID / vertical slice / branch:
- Owner and approving human:
- Source behavior being replaced: links and observable behavior
- Approved architecture references: links/headings
- Files changed: explain each; confirm they are within the task allowlist
- Boundedness analysis: item/byte/page/attempt/runtime/cycle limits, cursor behavior, and work explicitly out of scope

## Contract and state
- Public API changes: Candid/HTTP/UI contract, callers, typed errors, compatibility, pagination/certification
- Data model changes: canonical/derived state, schema versions, classification, retention, indexes, migration receipts
- Preserved invariants: IDs and evidence
- Intentional differences: approval and user-visible impact
- Authorization implications: caller/role/owner/worker boundaries, negative tests, privacy/certification implications
- Transaction and await analysis: atomic records written before await; idempotency/lease/retry/reconciliation behavior

## Migration and release
- Migration impact: deterministic export/transform/import, replay, count/hash/quarantine evidence, or why none applies
- Upgrade impact: supported versions, schema decoding, interrupted migration/workflow behavior, or why none applies
- Rollback implications: stop condition, compatibility window, reversible boundary, reconciliation and user-visible state

## Verification
- Tests added: unit, contract, behavioral, invariant, authorization, concurrency, migration, upgrade, and failure injection as applicable
- Test results: commands, results, artifact/build hashes, and gate-report link
- Required reviewers and approvals: roles from `development/ownership.md`; waivers with scope, expiry, control, follow-up

## Unresolved questions
- Questions, decision owner, and escalation status (or `none`)
```

Do not merge with an unresolved blocking question, a missing applicable gate, or a waiver that lacks a named human approver and expiry.
