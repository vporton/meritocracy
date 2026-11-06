# M1 local-replica freeze/import/rollback rehearsal

Status: verified on 2026-11-06 using only synthetic data in a disposable,
loopback-only PostgreSQL 16 container. No production connection, credential,
canister, provider, or asset is accepted or accessed.

Run:

```sh
M1_REHEARSAL_APPROVED=yes env -u DATABASE_URL \
  npm run test:m1-local-replica-rehearsal
```

The runner fails if `DATABASE_URL` is present, requires an explicit approval
flag, starts `postgres:16-alpine` on a random `127.0.0.1` port, and removes the
container in `finally`. Its restricted report is mode `0600` under `/tmp` and
contains only count/hash/control facts.

It proves the M1 protocol boundary with explicit synthetic controls named
`legacy-api`, `legacy-cron`, and `legacy-payment-sender`: an in-flight write is
rolled back; all controls stop before one repeatable-read/read-only snapshot;
the redacted projection excludes the synthetic session token; a canonical
chunk is imported idempotently by logical key/hash; a changed duplicate is
rejected; and an abort clears staging before target activation. Rollback leaves
only `legacy-api` as the synthetic writer authority and leaves ICP writes
disabled.

This is not a production dress rehearsal and does not establish G2/G4
downtime, source-writer inventory, financial reconciliation, or live-data
capacity. Those require their corresponding approval evidence.
