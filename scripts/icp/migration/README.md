# Stage 7 offline migration tools

These modules operate on an approved read-only snapshot. They never connect to
production implicitly. The executable database adapter itself opens a
`REPEATABLE READ, READ ONLY` transaction and passes only reviewed column
allowlists to `buildExport`; `export-plan.sql` documents the same boundary for
independent database review.

`lib.mjs` provides deterministic canonical JSON/JSONL, forbidden-field
scanning, per-file and export-root SHA-256 commitments, identity/audit
commitments, shadow reconciliation, Ed25519-signed reports, and the
three-consecutive-round evidence ledger. Any unexplained difference fails a
round; a code/config/export-root change resets the consecutive count.

For a reviewed snapshot JSON, run:

```sh
node scripts/icp/migration/export-cli.mjs snapshot.json output legacy-git-sha 2026-11-07T00:00:00.000Z
```

The output directory must be new: files are opened with `wx` so an earlier
evidence set cannot be overwritten accidentally.

`export-postgres.mjs` is the executable adapter for the reviewed Prisma schema.
It begins a `REPEATABLE READ READ ONLY` transaction and uses explicit column
allowlists for profiles, identity commitments, eligibility commitments,
canonical AI outcomes/sources, payout candidates, and historical
distributions. It never selects session/email/KYC evidence/provider payload
columns. Run only with separately approved read-only credentials:

Token-unit PostgreSQL `Decimal` values are converted to exact integer atom
strings using `tokenDecimals`; excess fractional precision aborts the export.
Canonical millisecond ISO timestamps are converted to integer nanoseconds for
the Registry importer, preserving banned-until timestamps exactly at the
legacy database's precision.

```sh
DATABASE_URL=... node scripts/icp/migration/export-postgres.mjs output legacy-git-sha
```

Run `npm run test:icp:migration`. Real production export, migration signing,
staging asset funding, and reviewer approval are separate governed operations.
