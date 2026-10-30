# M1 PostgreSQL read-only inventory

Status: command implemented 2026-10-30; no production inventory has been run.

The operator runs this only with a DBA-approved, read-only PostgreSQL
connection. The command does not load an environment file, print a connection
string, or accept a connection string as a command argument. Supply it through
the process environment and explicitly acknowledge the authorization:

```sh
M1_INVENTORY_READ_ONLY_APPROVED=yes \
DATABASE_URL='[operator-supplied; do not paste into tickets or chat]' \
npm run inventory:postgres --workspace backend -- \
  --output /secure/operator-only/m1-inventory.json
```

The process starts `SERIALIZABLE READ ONLY DEFERRABLE`, checks
`transaction_read_only`, applies statement/lock timeouts, performs bounded
catalog and aggregate queries, rolls back, and creates the report with mode
`0600` only if its requested output path does not already exist. It contains
no table rows or connection details. Secret-like column names receive an
`EXCLUDE_RAW_VALUE` disposition; all other fields remain explicitly pending
the G2-approved source-side projection. The operator must retain the report in
the approved restricted evidence location and attach only redacted aggregate
findings to review records.

The command never creates or alters publications, replication slots, triggers,
outboxes, tables, indexes, or rows. Its facts are planning evidence only and do
not authorize production logical-decoding artifacts or a migration.
