# M1 PostgreSQL read-only inventory

Status: command implemented 2026-10-30; no production inventory has been run.

## Local fixture evidence (2026-11-06)

The command was exercised against an isolated, loopback-only disposable
PostgreSQL 16 Alpine container (`postgres:16-alpine`, digest
`sha256:aa6cb33cf4c19c765cefcf48d96176258800870a9a1e930ad126200f9d825139`).
All checked-in Prisma migrations were applied only inside that container; it
contained no production data and was stopped with `--rm` after the check. The
serializable read-only report contained 22 physical tables and 207 columns,
including the unmanaged `ai_result_migration_exceptions` table. The report was
written with mode `0600` to `/tmp/meritocracy-m1-fixture-inventory.json` and
contains no row values.

This proves the inventory command can inspect the complete migrated fixture
schema. It does not satisfy M1's remaining per-table count/size/length/status/
relation/decimal/sequence evidence, nor is it a production inventory.

An operator-supplied local PostgreSQL inventory was also run on 2026-11-06.
Its restricted report contains 23 tables: the 22 application physical tables
plus Prisma's `_prisma_migrations` metadata table, and 215 columns. It found
zero prepared transactions, logical slots, and publications. The report is
stored only at `/tmp/meritocracy-m1-local-inventory.json`; no connection
details, row values, or raw secret/token values are recorded here.

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
