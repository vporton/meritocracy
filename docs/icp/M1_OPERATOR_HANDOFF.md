# M1 operator handoff and settled decisions

Last updated: 2026-08-07.

This document records decisions already supplied by the project owner. A new
session must treat them as established context and must not ask for the same
RBAC design choice or `DATABASE_URL` location again.

## Storage authorization boundary

**Decision:** ZenDB is an in-process library inside a persistent Motoko
**storage-authority canister**. It is not a separately reachable remote ZenDB
canister and it is not the RBAC authority.

The storage-authority canister is the only Candid boundary around its ZenDB
instance. Each public method must reject anonymous callers, authenticate the
calling application canister or governance principal against a fixed
allowlist, authorize the exact collection/action, and derive the permitted
logical-ID scope from the authenticated caller. It must never expose generic
collection CRUD, ZenDB role/grant administration, caller-selected owner/role,
arbitrary collection names, arbitrary filters, or a browser/user/importer
direct path. Domain canisters retain their own resource authorization; the
storage authority is a second enforcement layer, not a replacement for it.

The recorded ZenDB v2.0.1 remote-actor upgrade proof that restored a bootstrap
grant is diagnostic evidence about the rejected remote-RBAC topology. It does
not authorize remote use and does not invalidate the chosen in-process
topology, whose Candid boundary contains no ZenDB grant API. The exact source,
dependency, Candid, and Wasm pin remains required.

Before G2, the new canister must prove direct-ingress, unrelated-canister,
wrong-collection/action, bootstrap/deployer, and post-upgrade negatives;
logical-ID/hash idempotency after lost replies; bounded pagination and limits;
and durable recovery for cross-canister calls, interruption, upgrade, archive,
low-cycle, and repair/resume cases. G2 remains unapproved: this decision does
not authorize deployment, production data access beyond the M1 inventory, or
later milestones.

## PostgreSQL M1 inventory configuration

**Configuration location is settled:** `DATABASE_URL` is present in the
ignored `backend/.env` file. It must never be committed, printed, copied into
documentation, or pasted into a conversation. `npm run inventory:postgres
--workspace backend` loads this file automatically when present; an explicitly
supplied process environment value takes precedence.

The account must remain a DBA-approved read-only inventory account with only
the required `CONNECT` and catalog/application-table `SELECT` privileges. It
must not have write, DDL, replication, or role-management privileges. Do not
run database-backed integration tests against it: those tests are separately
blocked until a disposable-database guard exists.

On 2026-08-07, the command confirmed that `DATABASE_URL` was loaded, but its
connection/query returned the intentionally redacted
`INVENTORY_QUERY_FAILED` category. No report was created and no URL, endpoint,
credentials, SQL, or row data was emitted. The remaining action is for the
DBA/operator to remedy the direct PostgreSQL endpoint, TLS/network access, or
read-only query permissions. Do not ask the project owner to supply the URL
again. Once that condition is repaired, rerun only:

```sh
npm run inventory:postgres --workspace backend -- --output /secure/operator-only/m1-inventory.json
```

The command is aggregate-only, opens `SERIALIZABLE, READ ONLY, DEFERRABLE`,
and has no DDL, replication, publication, slot, trigger, outbox, row-write, or
replication-acknowledgement SQL.
