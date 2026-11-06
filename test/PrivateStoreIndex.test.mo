import Blob "mo:base/Blob";
import Sha256 "mo:sha2/Sha256";
import Store "../canisters/shared/VersionedPrivateStore";
import Index "../canisters/shared/PrivateStoreIndex";

func entry(collection : Text, id : Text, payload : Blob) : Store.Entry = {
  collection; logicalId = id; version = 1; payload; contentHash = Sha256.fromBlob(#sha256, payload);
};
func mustPut(state : Store.State, value : Store.Entry) : Store.State {
  switch (Store.put(state, value)) { case (#ok((next, _))) next; case (#err(_)) { assert false; state } };
};
let primary = mustPut(mustPut(Store.empty, entry("identity_v1", "a", "a")), entry("identity_v1", "b", "b"));
let digest = Sha256.fromBlob(#sha256, "query:identity");
let cursor : Index.Cursor = { formatVersion = 1; queryHash = digest; afterIndexKey = null; afterLogicalId = null };
let firstIndex : Index.IndexEntry = { indexName = "by-id"; indexKey = "a"; collection = "identity_v1"; logicalId = "a"; version = 1; contentHash = entry("identity_v1", "a", "a").contentHash };
let secondIndex : Index.IndexEntry = { indexName = "by-id"; indexKey = "b"; collection = "identity_v1"; logicalId = "b"; version = 1; contentHash = entry("identity_v1", "b", "b").contentHash };
let indexes = switch (Index.addUnique(Index.empty, firstIndex)) { case (#ok(value)) value; case (#err(_)) { assert false; Index.empty } };
let indexes2 = switch (Index.addUnique(indexes, secondIndex)) { case (#ok(value)) value; case (#err(_)) { assert false; indexes } };
assert Index.addUnique(indexes2, firstIndex) == #ok(indexes2);
let conflicting = { firstIndex with logicalId = "b" };
assert Index.addUnique(indexes2, conflicting) == #err(#duplicateIndexKey);
let firstPage = switch (Index.page(indexes2, "by-id", digest, cursor, 1)) { case (#ok(value)) value; case (#err(_)) { assert false; ([], null) } };
assert firstPage.0.size() == 1 and firstPage.0[0].logicalId == "a";
assert firstPage.1 != null;
assert Index.page(indexes2, "by-id", Sha256.fromBlob(#sha256, "other"), cursor, 1) == #err(#cursorMismatch);
let started = switch (Index.startMigration(indexes2, "identity_v1", "identity_v2", 1, 2)) { case (#ok(value)) value; case (#err(_)) { assert false; indexes2 } };
let migrated = switch (Index.migrateBatch(started, primary)) { case (#ok(value)) value; case (#err(_)) { assert false; (started, primary, 0) } };
assert migrated.2 == 2;
assert Store.get(migrated.1, "identity_v2", "a") != null;
assert Store.get(migrated.1, "identity_v2", "b") != null;
let replay = switch (Index.migrateBatch(migrated.0, migrated.1)) { case (#ok(value)) value; case (#err(_)) { assert false; (migrated.0, migrated.1, 99) } };
assert replay.2 == 0;
