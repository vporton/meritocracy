/// Historical local-only M1 fixture Wasm. It intentionally models the
/// pre-v2 stable layout and is built only to prove a state-preserving upgrade.
import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Principal "mo:base/Principal";
import Result "mo:base/Result";
import Sha256 "mo:sha2/Sha256";

persistent actor class PrivateStoreRecoveryFixtureV1(owner : Principal) = this {
  type Entry = { collection : Text; logicalId : Text; version : Nat; contentHash : Blob; payload : Blob };
  type State = { schemaVersion : Nat; entries : [Entry] };
  type PutResult = { #inserted; #duplicate };
  let collection = "m1_upgrade_fixture_v1";
  var store : State = { schemaVersion = 1; entries = [] };

  func authorized(caller : Principal) : Bool {
    not Principal.isAnonymous(caller) and Principal.equal(caller, owner);
  };

  public shared ({ caller }) func putBounded(logicalId : Text, payload : Blob) : async Result.Result<PutResult, Text> {
    if (not authorized(caller)) return #err("unauthorized");
    let hash = Sha256.fromBlob(#sha256, payload);
    for (entry in store.entries.vals()) {
      if (entry.collection == collection and entry.logicalId == logicalId) {
        if (entry.version == 1 and Blob.equal(entry.contentHash, hash) and Blob.equal(entry.payload, payload)) return #ok(#duplicate);
        return #err("conflict");
      };
    };
    if (store.entries.size() >= 128 or logicalId.size() == 0 or logicalId.size() > 256 or payload.size() > 4096) return #err("bounds");
    let entry : Entry = { collection; logicalId; version = 1; payload; contentHash = hash };
    store := { schemaVersion = 1; entries = Array.append(store.entries, [entry]) };
    #ok(#inserted);
  };

  public shared query ({ caller }) func lookupHash(logicalId : Text) : async Result.Result<?Blob, Text> {
    if (not authorized(caller)) return #err("unauthorized");
    for (entry in store.entries.vals()) {
      if (entry.collection == collection and entry.logicalId == logicalId) return #ok(?entry.contentHash);
    };
    #ok(null);
  };

  public shared query ({ caller }) func entryCount() : async Result.Result<Nat, Text> {
    if (not authorized(caller)) return #err("unauthorized");
    #ok(store.entries.size());
  };
};
