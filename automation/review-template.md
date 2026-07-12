# AI change review template

Use this template for implementation, security, migration, and adversarial review. Each answer is **Yes**, **No**, or **Not applicable**, followed by evidence citations and, for “No”, a blocking finding or an approved human waiver. “Not applicable” must explain why the concern cannot apply to this task.

## Review record

- **Task ID / change set:**
- **Reviewer role and independence from author:**
- **Approved specification and architecture evidence:**
- **Files reviewed:**
- **Test evidence reviewed:**
- **Overall decision:** approve / block / approve with human waiver

## Required questions

1. Does the implementation match the specification?
2. Were any invariants lost?
3. Are authorization checks complete?
4. Are ordinary query calls being mistaken for certified results?
5. Is sensitive data exposed?
6. Is any loop or result set unbounded?
7. Is state mutated before an await?
8. Is the operation idempotent?
9. Does the code survive upgrades?
10. Are migrations resumable?
11. Are errors typed?
12. Are tests meaningful?
13. Were unrelated files changed?
14. Were requirements invented?

## Findings

| ID | Question | Evidence | Severity | Required resolution / human waiver | Status |
|---|---:|---|---|---|---|
| | | | blocking / high / medium / low | | open / resolved / waived |

## Minimum review checks

- For authorization, verify `msg.caller`/role/allow-list checks at the service boundary and that no caller identity is accepted as a substitute for authentication.
- For certification, verify that public decision facts use the specified certified query or certified HTTP path; ordinary queries are display-only.
- For await safety, verify durable intent/claim, expected state/version, bounded payload, and safe retry/reconciliation behavior; ambiguous payment execution must not resend automatically.
- For idempotency, verify same-key/same-command replay, same-key/different-command conflict, durable receipts, and duplicate/concurrent callback behavior.
- For migrations/upgrades, verify deterministic transform/versioned receipts, atomic cursor advancement, count/hash comparison, quarantine of invalid/ambiguous data, compatible decoding, and bounded rollback/reconciliation.
- For tests, verify assertions would fail on semantic loss—not merely that they execute—and include relevant negative, boundary, concurrency, replay, and upgrade cases.
