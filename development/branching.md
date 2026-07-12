# Branching policy

Use one short-lived branch per bounded implementation task or vertical slice. Do not use one branch for the whole rewrite.

Name migration branches:

```
migration/<phase>-<slice>-<task>
```

Examples:

```
migration/03-project-read-api
migration/04-project-zendb-repository
migration/05-project-importer
```

`<phase>` follows the approved migration ordering; `<slice>` identifies the capability; `<task>` is a concise, unique bounded change. Lowercase hyphenated names only. A prerequisite may use `migration/<phase>-<prerequisite>-<task>` when its task template states the dependent slice.

Before opening the branch, record the task ID, slice, permitted files, specification references, and acceptance criteria. Rebase or merge the current integration branch as required by repository policy, resolving only conflicts within the approved task boundary. Do not bring unrelated cleanup or another slice into the branch.

Each branch produces one reviewable PR. Follow-up work, redesigns, discovered gaps, and deferred migration/cutover work receive separate branches and task records. Delete the branch after merge when its task is complete; retain release tags and gate artifacts as the audit record.
