# M1 private-store bounded benchmark

Status: local-envelope proof recorded 2026-11-06. This does not project
production size, price, or downtime; those remain G2/G4 evidence.

Run after building the fixture and installing the separately pinned local
PocketIC tooling:

```sh
mops build private_store_recovery_fixture
npm run test:m1-private-store-benchmark
```

The proof creates a disposable PocketIC instance and owner-only fixture with
synthetic data. It inserts exactly the M1 store bound of 128 immutable records
of 4,096 bytes (524,288 payload bytes), then looks up every hash. It verifies
that record 129 and a 4,097-byte payload are rejected. The fixture contains no
secondary index, so the observed index multiplier is 1; archive traffic is 0.
It records wall-clock insert/query timings, aggregate memory bytes, cycle
balance, and query-instruction delta under a mode-0600 `/tmp` report. The
stock PIC status decoder expects newer optional metrics than PocketIC 12.0.0
supplies, so the runner uses a minimal compatible management-canister status
record containing only the counters it needs.

This remains a local bounded envelope, not a production capacity or low-cycle
measurement. The M1 failure limits themselves are proven; G2 supplies
production-shaped cost and freezing-threshold evidence.
