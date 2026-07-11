# Invariant test plan

Test IDs correspond to `architecture/invariant-mapping.md`. Each row specifies the
required coverage for that invariant. **B** is a behavioral canister/API test and
**L** is a lower-level unit/property/repository test; every critical invariant has
both. `D` is a replay with the same idempotency key, `C` uses two interleaved calls,
`M` imports a representative legacy record/batch, `U` decodes state written by the
previous supported schema and validates it after an upgrade, and `X` injects an
impossible persisted/index state to ensure controlled detection. “N/A” means the
invariant deliberately has no migratable legacy value; the test verifies exclusion.

|Invariant|Positive test|Negative test|Duplicate request test|Concurrent execution test|Migration-data test|Upgrade-survival test|Corrupted-state detection test|
|---|---|---|---|---|---|---|---|
|INV-001|IT-001-B create/read each canonical ID; IT-001-L deterministic-ID collision check|Reject reused ID|D same create returns original result|C same generated ID yields one record|M duplicate source keys rejected/receipted|U IDs/indexes preserve lookup|X key/index disagreement → `Corruption`|
|INV-002|IT-002-B/L claim normalized identity once|Claim identity to different Account rejected|D same claimant replay succeeds|C two claimants leaves exactly one owner|M proven unique identities import; collision quarantined|U commitment map remains unique|X duplicate commitment mapping detected|
|INV-003|IT-003-B/L consented bounded profile projects once|Reject PII/unconsented/oversize profile|D profile replay is no-op|C consent change/profile write has one final version|M renewed-consent fields only|U projection schema decodes/rebuilds|X profile not matching Account consent detected|
|INV-004|IT-004-B/L create valid child/reference|Reject missing parent; optional relation remains absent|D child creation replay returns same child|C parent tombstone vs child create has no dangling child|M dangling FK rejected|U reference decoder validates target kind|X dangling stable reference detected|
|INV-005|IT-005-B/L constructors provide all required/default fields|Reject missing/null/invalid required field|D complete create replays|C partial competing update cannot persist partial record|M required field validation/rejected default ambiguity|U explicit defaults decode correctly|X absent required field → `Corruption`|
|INV-006|IT-006-B/L allocate allowed non-negative integer asset|Reject negative/fractional/NaN/overflow/unapproved asset|D allocation replay preserves amount|C allocations cannot cross reserve bound|M decimal/float conversion requires approved exact result|U fixed-point encoding retained|X negative amount/reserve detected|
|INV-007|IT-007-B/L tombstone removes public projection but retains audit/obligation|Reject forbidden deletion with open obligation|D deletion replay is stable|C delete vs update gives deleted/denied outcome only|M deleted legacy account becomes tombstone|U tombstone survives upgrade|X deleted account still public/indexed detected|
|INV-008|IT-008-B/L successful mutation increments version/time and audit|Reject terminal mutation/stale version|D replay does not increment twice|C updates yield one winner|M temporal sequence validated|U versions/timestamps decode|X audit/version mismatch detected|
|INV-009|IT-009-B authenticate valid delegation/attestation|Reject expired/replayed/unverified credential|D consumed token remains consumed off-chain|C two consumes yield one attestation|M sessions/tokens excluded|U no secret-bearing state introduced|X secret/token in core state detected|
|INV-010|IT-010-B/L verified attestation permits eligibility|Expired/revoked/missing attestation blocks request|D verification callback replay safe|C revoke vs assessment request resolves by version|M invalid legacy verification requires reverify|U attestation state/version decodes|X Account eligibility contradicts attestation detected|
|INV-011|IT-011-B/L owner can alter/read own restricted record|Other principal and unscoped worker denied|D authorized replay stable|C role revocation vs action denies stale authorization|M header-secret authority not imported|U role map preserves scopes|X unauthorized role/reference detected|
|INV-012|IT-012-B/L eligible Account creates one requested run|Ineligible/blocked/onboarded-active request rejected|D returns original run|C two starts produce one active run|M accepted safe summaries only|U active-run key preserved|X two active runs/account-policy detected|
|INV-013|IT-013-B/L eligible non-self vote updates aggregate once|Self/invalid type/closed period rejected|D replay returns original vote|C same composite key yields one vote/aggregate increment|M mapped unique vote imports|U vote key/aggregate decode|X aggregate differs from vote keys detected|
|INV-014|IT-014-B/L finalize eligible period applies hold/compensation once|Reject invalid finalization/hold transition|D finalization returns existing outcome|C finalizers yield one outcome|M recomputed/approved historical outcome only|U policy-versioned outcome persists|X hold/outcome policy mismatch detected|
|INV-015|IT-015-B/L worker graph accepts acyclic unique edge and runnable dependency|Reject duplicate edge/cycle|D graph command replay safe|C edge insertion cannot create a cycle|M legacy DAG excluded/recreated|U work lease state persists|X dependency cycle/work index inconsistency detected|
|INV-016|IT-016-B/L accept capped unique source list/result once|Reject duplicate custom ID/ordinal/url or oversize result|D callback returns prior accepted result|C duplicate callbacks accept once|M transformed accepted results only|U source/result schema version reads|X duplicate ordinal or noncanonical run detected|
|INV-017|IT-017-B/L one obligation per period/account/asset and receipt|Reject timestamp-only duplicate, reused memo/receipt|D allocation replay returns same obligation|C allocators create one reservation|M same-day legacy rows reconciled/grouped|U allocation/receipt indexes persist|X obligation index/document mismatch detected|
|INV-018|IT-018-B/L reserve and obligation arithmetic conserves funds|Reject over-allocation/negative reserve|D no second reservation|C allocations cannot oversubscribe|M ledger reconciliation proves imported balance|U integer balances unchanged|X balance/obligation sum mismatch detected|
|INV-019|IT-019-B/L claim then settle with valid receipt|Reject invalid edge/missing receipt; ambiguity becomes reconcile-required|D settlement callback replay safe|C two executors: one lease/send authority|M uncertain hashes import as reconcile-required|U lease/status/attempt count survives|X settled-without-receipt or invalid state detected|
|INV-020|IT-020-B/L every declared transition accepted|Unknown status/edge rejected|D terminal command replays only|C competing edges retain valid one|M unknown legacy status quarantined|U old variants mapped/versioned|X invalid decoded variant detected|
|INV-021|IT-021-B/L activate one policy and read singleton|Reject competing/missing active pointer|D same activation replays|C activation CAS has one winner|M one reconciled legacy global row selected; stats rebuilt|U singleton/version history survives|X zero/multiple active policies detected|
|INV-022|IT-022-B/L cursor pages deterministic complete ordered set|Reject altered filter/sort/bad limit/cursor|D read cursor produces same page|C write/page interleaving has no duplicate under cursor semantics|M indexes rebuilt and compared|U cursor/index schema version behavior|X index key missing/misordered detected|
|INV-023|IT-023-B/L injected write failure leaves no partial canonical/index/profile/audit change|Reject/rollback failed atomic mutation|D retry after failure commits once|C multi-record operation preserves all-or-none|M per-row receipt prevents partial reimport|U atomic record bundle decodes|X orphaned audit/projection/index detected|
|INV-024|IT-024-B/L exact command retry returns original typed success|Same key/different request rejected|D all mutators covered|C replay/race creates one effect|M source-hash receipt skips reimport|U receipts remain readable|X receipt response/command hash mismatch detected|
|INV-025|IT-025-B/L allow-listed bounded commitment/document accepted|Reject secret, raw PII/log, raw evidence, excessive bytes/items|D rejected input has no persisted mutation|C oversize competing writes cannot bypass caps|M secret-bearing records excluded/redacted|U cap/schema enforcement retained|X injected secret/oversize document detected|
|INV-026|IT-026-B/L create one valid asset/request/worker key|Reject reused operational key|D callback/request replay returns original result|C duplicate callback/configuration has one owner|M secrets/tokens/logs excluded; asset/hash keys reconciled|U key maps retain uniqueness|X operational key/index disagreement detected|

## Execution requirements

- Run each `B` test through the public Candid/service boundary and each `L` test
  against validators, transition tables, arithmetic, indexes, or repository state.
- `C` tests must deliberately interleave operations at the read/claim/commit boundary;
  payment tests additionally simulate an await after durable claim.
- `M` tests use a frozen PostgreSQL fixture with both valid and invalid rows, verify
  immutable migration receipts, and verify no sessions, tokens, secrets, raw logs, or
  raw AI payloads are imported.
- `U` tests serialize a prior-version stable-state fixture, upgrade the canister, then
  run the corresponding behavioral invariant assertion and index/projection rebuild.
- `X` tests use test-only state injection or a decoder fixture. Production endpoints
  must return `Corruption`/maintenance status and emit a redacted audit/alert, never
  trap for those cases.
