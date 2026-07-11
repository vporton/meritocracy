# Behavioral characterization tests

`current-api.characterization.test.ts` tests observable HTTP behavior against a running, disposable instance. It does not alter the application. The suite is outside `backend/tests` because that runner migrates a fixed local PostgreSQL database and runs service integration tests rather than starting Express.

Known missing executable coverage (recorded rather than fabricated): successful OAuth/KYC flows require real provider fixtures; duplicate votes and rollback/concurrent transfer tests need isolated database fixtures; external failures need injectable adapters; cleanup and distribution are intentionally not invoked by this black-box suite because the current endpoints can mutate global state. Existing `backend/tests/payment-cycle.test.ts` and `crypto-distribution.test.ts` characterize several payment, backlog, and adapter-failure cases.
