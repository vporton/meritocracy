# Commit policy

Every commit must be small, coherent, reviewable, and within its task's file allowlist. The commit message should identify the task or slice and describe one meaningful change.

- Do not include generated artifacts or unrelated formatting, renames, cleanup, dependency changes, or drive-by edits. Put necessary generated output in a dedicated, explained commit only when repository policy requires it.
- Separate specification, decision-record, and test-plan changes from implementation where practical. A tightly coupled correction may be combined only when separation would obscure the behavior change.
- Commit migration scripts together with their deterministic verification/reconciliation scripts and their fixtures or manifest updates. They must be replayable and support count/hash/quarantine evidence.
- Never commit secret material: credentials, private keys, tokens, production exports containing sensitive data, or unredacted logs. Use documented configuration examples/placeholders instead.
- Never disable, skip, weaken, or delete a test to obtain a green result. A changed expectation needs an approved specification change and a replacement meaningful test.
- Keep refactors separate from behavior changes unless the refactor is indispensable to the bounded task. Do not mix slices or cutover work in one commit.

Before pushing, inspect the diff for accidental files and run the task's proportionate checks. A PR may be squashed only if its resulting commit retains task traceability and the migration/verification evidence remains linked.
