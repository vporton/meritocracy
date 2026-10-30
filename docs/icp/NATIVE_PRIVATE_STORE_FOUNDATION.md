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

This is not a G2 schema: the collection catalogue, index/cursor design,
collection-vN migration, external-call intent journal, exact old-to-new
PocketIC upgrade, crash recovery, low-cycle behavior, capacity benchmarks,
canonical export, and direct-ingress authorization proof remain mandatory M1
work.
