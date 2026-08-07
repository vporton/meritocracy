# Read-only PostgreSQL inventory

This is M1 evidence collection, not an export or cutover action. The command opens a `SERIALIZABLE, READ ONLY, DEFERRABLE` transaction and asks PostgreSQL to default every transaction to read-only at connection startup. It has no SQL that creates or changes a publication, logical slot, trigger, outbox, table, row, index, or replication acknowledgement.

Run it only with a DBA-approved account that has catalog and application-table `SELECT` access but no write, DDL, replication, or role-management privileges. The command purposely fails if the expected 22 physical application tables are not present; do not weaken that check without updating the source inventory and M1 approval evidence.

Place that account's PostgreSQL connection string in the ignored `backend/.env` file, never in a tracked file or command-line argument:

```dotenv
DATABASE_URL="postgresql://m1_inventory:<password>@<host>:5432/<database>?sslmode=require"
```

`inventory:postgres` explicitly loads `backend/.env` when it is present and does not override a `DATABASE_URL` already supplied by the operator's environment. Create a dedicated login restricted to `CONNECT` plus the required schema/table/catalog `SELECT` permissions; it must not have `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `CREATE`, `ALTER`, `DROP`, `REPLICATION`, or role-management capability. Do not put a production-superuser, application-writer, or any wallet/API credential in this file.

```sh
nvm use stable
npm run inventory:postgres --workspace backend -- --output /secure/operator-only/m1-inventory.json
```

The output file is created with mode `0600` and is never overwritten. It contains a one-way database-endpoint fingerprint (not its name or address), aggregate-only counts, relation/index/TOAST sizes, null counts, non-sensitive maximum field sizes, numeric ranges, status buckets, FK orphan counts, unique-collision counts, sequence state, replica identity/key, publication membership, PostgreSQL logical-decoding/WAL/slot/prepared-transaction capability, and the redaction classification for every source column.

It never selects or writes the values of `SystemSecret.value`, bearer/session tokens, email or KYC verification tokens, `users.email`, raw KYC fields, private-key/credential-shaped columns, provider request/response payloads, pending transaction payloads, or unmanaged exception response payloads. Such columns are represented only as `REDACTED_METADATA_OR_DIGEST_ONLY`; their exact approved one-way source-evidence projection remains a later G2 design/proof item.

Connection failures disclose only one safe operational category: `INVENTORY_DATABASE_AUTH_FAILED`, `INVENTORY_DATABASE_PERMISSION_DENIED`, `INVENTORY_DATABASE_UNREACHABLE`, or the generic `INVENTORY_QUERY_FAILED`. They never print the connection string, host, database name, username, SQL text, server error message, or row data.

This command does not prove a production logical-decoding protocol. In particular, a production publication/slot can be created only as part of the G4-approved runbook after G2 has proven the exported-snapshot, redaction, commit-order, replica-identity, and WAL-retention design.
