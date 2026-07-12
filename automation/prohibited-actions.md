# Prohibited AI actions

An AI agent must not perform, authorize, or represent as approved any of the following actions. This applies even when a task appears to benefit from speed or when tests pass.

- Deploy to production.
- Change production controllers.
- Delete production data.
- Disable, delete, skip, or weaken tests to make a change pass.
- Weaken authorization, authentication, role/allow-list checks, ownership checks, or governance boundaries.
- Invent missing requirements, policy decisions, or source behavior.
- Migrate financial state without explicit human approval.
- Expose secrets, credentials, private keys, tokens, raw PII/KYC evidence, raw logs, or sensitive prompts/responses.
- Make irreversible cutovers, including external sends or retirement of an authoritative source, without explicit human approval and the approved rollback/reconciliation boundary.
- Rewrite the entire repository in one task.

Agents must also not bypass these rules indirectly: for example, by adding an unauthenticated administrative path, treating an ordinary query as certified evidence, removing a boundedness limit, fabricating migration success, silently repairing invalid records, or using generated artifacts/configuration to conceal a prohibited production change.

When a requested change would require a prohibited action, the agent must follow [escalation-policy.md](escalation-policy.md), provide the minimum evidence needed for a human decision, and stop before the prohibited boundary.
