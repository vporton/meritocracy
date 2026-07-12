# Cutover matrix

Each slice advances independently; a later state is forbidden until its stated evidence is recorded.  Payment execution has no dual-write or real-transfer shadow state.

|State|Old system|New system|Permitted use|Exit evidence|Return path|
|---|---|---|---|---|---|
|Old only|Authoritative reader/writer|Disabled or seeded only|Baseline characterization and snapshot|Target contract, migration receipt format, and observability ready|Remain old only|
|Shadow read|Authoritative reader/writer|Non-user-visible read/projection, no authority|S1 reads; S4/S5/S6/S7 calculations|Normalized result/count/hash comparison within tolerance; no sensitive target data|Discard/reseed target projection|
|Dual read|Authoritative writer; default reader initially|Read candidate behind flag/canary|Read-only slices only; compare per request and monitor divergence|SLO and divergence threshold met for a full release window|Switch traffic fully to old reader|
|New read, old write|Only writer|Default reader; old fallback only|S1 public profile/status, where versioned snapshot makes staleness visible|Reconciliation lag bounded and no unresolved divergence|Route reads to old; resync projection|
|New authoritative|Disabled for that slice|Only authoritative writer and reader|S2–S8 after a bounded cutover command; legacy becomes read-only archive|Writer fencing confirmed; audit/reconciliation clean; rollback deadline passed or reconciliation plan accepted|Pause target and forward-reconcile; never introduce an uncoordinated old writer|
|Old disabled|No serving endpoint or scheduled job; retained read-only archive|Authoritative|After client migration and data/export validation|No legacy traffic; archive restore tested|Read-only archive may be temporarily exposed for investigation, never as a writer|
|Old removed|Archived/purged under retention policy|Authoritative|S9 only|Retention/legal approval, export checksum, recovery test, credentials revoked|Recover from approved archive into isolated investigation environment; forward-fix target|

## Slice-to-state constraints

|Slice|Allowed progression|Explicit prohibition|
|---|---|---|
|S1 public reads|Old only → shadow read → dual read → new read/old write → new authoritative → old disabled|New public profile writes before S2|
|S2 account/profile|Old only → shadow claim/read → new authoritative → old disabled|Dual-write/dual-delete; mapping numeric IDs to principals without claimant proof|
|S3 identity/KYC|Old only → shadow verification → new authoritative → old disabled|Migrating bearer sessions/tokens or PII to core|
|S4 assessment|Old only → shadow execution → new authoritative → old disabled|Accepting a shadow result as authoritative|
|S5 governance|Old only → shadow calculation → new authoritative at period boundary → old disabled|Dual finalization, overlapping vote periods, or vote import mid-period|
|S6 policy/reserves|Old only → shadow accounting → new authoritative → old disabled|Activating un-reconciled policy/reserves|
|S7 ICP/ICRC payments|Old only → shadow allocation → new authoritative (capped canary) → old disabled|Dual-write payments, duplicate transfer/shadow broadcast, auto-resend after ambiguity|
|S8 external chains|Old only → shadow instruction → new authoritative per chain → old disabled|Dual broadcast or migration of keys|
|S9 retirement|New authoritative → old disabled → old removed|Returning PostgreSQL to a business writer|

