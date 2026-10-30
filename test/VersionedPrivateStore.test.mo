import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Nat8 "mo:base/Nat8";
import Sha256 "mo:sha2/Sha256";
import Store "../canisters/shared/VersionedPrivateStore";

func entry(collection : Text, logicalId : Text, version : Nat, payload : Blob) : Store.Entry {
  {
    collection;
    logicalId;
    version;
    payload;
    contentHash = Sha256.fromBlob(#sha256, payload);
  };
};

let first = entry("identity_v1", "principal:aaaaa-aa", 1, "synthetic-payload");
let inserted = switch (Store.put(Store.empty, first)) {
  case (#ok(value)) value;
  case (#err(_)) { assert false; (Store.empty, #duplicate) };
};
assert inserted.1 == #inserted;
assert Store.get(inserted.0, "identity_v1", "principal:aaaaa-aa") == ?first;

let duplicate = Store.put(inserted.0, first);
assert duplicate == #ok((inserted.0, #duplicate));

let conflicting = entry("identity_v1", "principal:aaaaa-aa", 1, "different-payload");
assert Store.put(inserted.0, conflicting) == #err(#conflict);

let mismatchedHash : Store.Entry = {
  collection = "identity_v1";
  logicalId = "bad-hash";
  version = 1;
  payload = "synthetic-payload";
  contentHash = "not-a-sha256";
};
assert Store.put(Store.empty, mismatchedHash) == #err(#contentHashMismatch);

let oversized = entry("identity_v1", "too-large", 1, Blob.fromArray(Array.tabulate<Nat8>(Store.maxPayloadBytes + 1, func _ = 7)));
assert Store.put(Store.empty, oversized) == #err(#payloadTooLarge);
