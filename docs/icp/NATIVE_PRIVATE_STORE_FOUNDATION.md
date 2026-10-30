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

`test/VersionedPrivateStore.test.mo` covers initial insertion, identical
duplicate acknowledgement, conflicting replacement rejection, incorrect hash,
and payload limit rejection. `mops check-stable` validates the core actor's
stable signature against its committed baseline.

`fixtures/private_store_recovery` is a separate local-only actor, never a
target service. Its exact-Wasm PocketIC 12.0.0 proof is run with:

```sh
mops build private_store_recovery_fixture
npm run test:m1-private-store-upgrade
```

The runner resolves the Mops-pinned PocketIC binary, copies it to a
disposable temporary path because the cache is read-only, and uses only
deterministic synthetic principals. It verifies owner-only update/query access
and denies anonymous, browser/user, import-operator, and unrelated-service
direct ingress before and after the upgrade. It then inserts a bounded
hash-bound record, upgrades with the same Wasm and explicit
enhanced-orthogonal-persistence `#keep`, and verifies the identical hash, one
stable record, and a duplicate no-op. It never uses reinstall or replacement
memory, returns no raw payload, starts no external network service, and removes
its temporary binary copy.

This is not a G2 schema: the collection catalogue, index/cursor design,
collection-vN migration, external-call intent journal, old-to-new compatibility
upgrade, crash recovery, low-cycle behavior, capacity benchmarks, canonical
export, and an actual inter-canister authorization-denial proof remain mandatory
M1 work.
