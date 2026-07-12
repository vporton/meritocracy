# Security gate checklist

Complete this checklist for every migration slice. Mark each item pass/fail/not-applicable with evidence (test ID, code location, command/report hash). A failed item is blocking unless a human records a time-bounded waiver in the gate report.

## Identity and authorization

- [ ] Authentication derives from the approved caller identity; no caller-supplied owner/role substitutes for it.
- [ ] Every method has an explicit public, owner, worker, governance, executor, or deny-by-default authorization rule.
- [ ] Owner-only reads and writes deny another principal; restricted history and projections are scoped.
- [ ] Privileged methods use explicit, least-privilege roles/allow-lists and have negative tests for anonymous, owner, stale/revoked role, and wrong worker/executor callers.
- [ ] No legacy password/header/session authority is imported as a core role; controller changes are excluded or human-approved.
- [ ] Authorization decisions and resulting mutation occur atomically, without an await between check and commit.

## Replay, workflow, and external boundaries

- [ ] Every update/callback has a bounded idempotency key or producer event ID; same payload replays the stored typed result and a changed payload conflicts.
- [ ] Expected state/version, lease, duplicate, and reordered-callback tests cover the affected workflow.
- [ ] Intent/claim, receipt, audit event, and invariant-preserving state are durable before an await.
- [ ] Payment/external execution uses deterministic instruction/memo/receipt identity; ambiguous execution becomes reconciliation, never automatic resend.
- [ ] External workers, oracles, identity services, ledgers, and HTTP integrations authenticate provenance, validate schemas/bounds, and have failure/timeout behavior tested.

## Privacy and trusted results

- [ ] Inputs, canonical records, projections, audit events, errors, logs, and test fixtures exclude secrets, credentials, private keys, sessions/tokens, raw PII/KYC evidence, and raw private prompts/responses.
- [ ] Public views contain only consented/allow-listed fields; consent withdrawal/tombstone removes the projection without deleting required canonical facts.
- [ ] Sensitive public facts use the specified certified-query/certified-HTTP path; ordinary query output is not presented as certified.
- [ ] Error and audit payloads are typed and redacted; oversized/private payload rejection leaves no persisted mutation.

## Machine evidence

- [ ] Authorization and privacy negative tests pass.
- [ ] Replay/concurrency tests (`C` where applicable) pass.
- [ ] Secret/PII scanner runs against source, generated output, fixtures, logs, and release artifact with reviewed allowlist only.
- [ ] Privileged API/controller/worker allowlist diff is empty or has recorded human approval.
