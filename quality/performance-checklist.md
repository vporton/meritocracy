# Resource and performance gate checklist

Use approved policy limits for every value below. If a limit is not yet approved, the slice cannot pass this gate; record it as an architecture escalation rather than selecting an arbitrary number.

## Boundedness

- [ ] Every loop has a data-independent cap, bounded cursor batch, or validated maximum collection size.
- [ ] Every query/result has validated page limits, deterministic ordering/tie-breaker, cursor/filter binding, and no full scan on a request path.
- [ ] All documents, callback payloads, source lists, attempts, strings, and audit metadata enforce item and byte caps before persistence.
- [ ] Migration/rebuild/maintenance progresses through a durable cursor; the cursor advances atomically with all row outcomes and never requires a one-message full scan.
- [ ] Retry/work queues use bounded claims/leases and backoff; terminal/reconcile states prevent unbounded automatic retry.

## Measured workload

- [ ] Run representative-volume fixtures at approved account/run/vote/obligation/work/audit counts, maximum document size, and expected index skew.
- [ ] Record worst-case per-message items, bytes, elapsed execution, cycles, stable-memory delta, ZenDB/storage delta, and response size for each affected operation.
- [ ] All measurements are at or below approved limits with a reproducible build, fixture, and benchmark report hash.
- [ ] Estimate steady-state and migration storage growth from measured record/index/audit sizes and planned volume; include headroom and retention/rebuild assumptions.
- [ ] Simulate interrupted/outage/retry behavior at volume and confirm bounded work, monotonic cursor progress, and no duplicate/missing keys.

## Automated enforcement

CI must fail if a declared operation has no bound metadata, a benchmark omits a metric, any measurement exceeds its limit, the representative fixture is smaller than the approved profile, or a response/batch exceeds configured item/byte caps. Static analysis may flag loops and collection materialization, but the benchmark and code review remain required to validate runtime bounds.
