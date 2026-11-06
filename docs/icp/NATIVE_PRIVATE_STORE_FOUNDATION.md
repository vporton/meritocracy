# M1 native private-store foundation

Status: implemented local foundation; incomplete M1 evidence. No production
data, canister, provider, asset, or database was accessed.

On 2026-10-30 the owner selected native Motoko private storage after the exact
ZenDB `v2.0.1` compatibility probe failed. The rejected candidate and its
hashes remain in `ZENDB_TOOLCHAIN_ISOLATION.md`; it is not imported by target
actors.

`canisters/shared/VersionedPrivateStore.mo` is intentionally a module, not an
actor. It exposes no Candid method and therefore cannot be called directly by
a browser, importer, unrelated canister, or controller. `core_canister` owns a
`State` value in persistent actor state; future public methods must bind their
authorization to `caller` before invoking the module.

The current bounded foundation accepts at most 128 immutable records with a
64-character collection name, 256-character logical ID, and 4,096-byte
payload. It calculates SHA-256 of every payload, acknowledges an identical
`(collection, logicalId, version, hash, payload)` retry as a duplicate, and
rejects every replacement tuple as a conflict. It persists only plain stable
values, not iterators, timers, maps, or capabilities.

Its explicit v1-to-v2 stable-layout checkpoint preserves entry bytes, is
idempotent at v2, and rejects unknown future layouts. `put` refuses an
unmigrated state, so an owning actor must complete this checkpoint before a
post-upgrade mutation. This is a generic M1 layout proof, not a G2 collection
catalogue or domain-schema decision.

`test/VersionedPrivateStore.test.mo` covers v1-to-v2 migration, idempotence,
unknown-version rejection, initial insertion, identical duplicate
acknowledgement, conflicting replacement rejection, incorrect hash, and
payload limit rejection. `mops check-stable` validates the core actor's
stable signature against its committed baseline.

`fixtures/private_store_recovery` is a separate local-only actor, never a
target service. Its exact-Wasm PocketIC 12.0.0 proof is run with:

```sh
mops build private_store_recovery_fixture
npm run test:m1-private-store-upgrade
```

The runner builds and installs a separate historical v1 fixture Wasm, inserts
a record, then upgrades it to the current v2 fixture Wasm with
enhanced-orthogonal-persistence `#keep`. The first post-upgrade owner mutation
runs the explicit v1-to-v2 checkpoint and must acknowledge the original
logical ID as a duplicate; the proof then verifies its hash and entry count.
The runner resolves the Mops-pinned PocketIC binary, copies it to a
disposable temporary path because the cache is read-only, and uses only
deterministic synthetic principals. It verifies owner-only update/query access
and denies anonymous, browser/user, import-operator, and unrelated-service
direct ingress before and after the upgrade. It also installs an unrelated
local attacker canister and proves its inter-canister mutation attempt is
denied. It never uses reinstall or replacement
memory, returns no raw payload, starts no external network service, and removes
its temporary binary copy.

This is not a G2 schema: the collection catalogue, index/cursor design,
collection-vN migration, actual external-call crash recovery, low-cycle
behavior, capacity benchmarks, and canonical export remain mandatory M1 work.

`canisters/shared/DurableMutationJournal.mo` adds the corresponding local
state-machine vector for a mutation that crosses an `await`. An owning actor
must persist its operation ID, target logical ID, and desired 32-byte content
hash before calling out. A pending intent is non-authoritative. On an unknown
result, only the same operation may be retried; a matching hash marks it
acknowledged, while a changed operation or observed hash is a conflict. The
vector in `test/DurableMutationJournal.test.mo` covers those paths, including
the persisted-pending state left by interruption after an external commit but
before local acknowledgement. It is deliberately a pure local state-machine
proof: it does not claim that a PocketIC external call was interrupted, so a
fault-injected inter-canister crash/recovery proof remains required before M1
can complete.
