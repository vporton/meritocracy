/// Local-only M1 proof actor for the private-store upgrade contract.
///
/// This is deliberately not an application canister and may never be deployed
/// as one. It exposes only fixed test operations: the owner may insert one
/// hash-bound record and inspect its hash/count; every other caller is denied.
/// The production `core_canister` continues to expose no storage Candid API.
import Principal "mo:base/Principal";
import Result "mo:base/Result";
import Sha256 "mo:sha2/Sha256";
import PrivateStore "../../canisters/shared/VersionedPrivateStore";

persistent actor class PrivateStoreRecoveryFixture(owner : Principal) = this {
  let collection = "m1_upgrade_fixture_v1";
  var store : PrivateStore.State = PrivateStore.empty;

  func authorized(caller : Principal) : Bool {
    not Principal.isAnonymous(caller) and Principal.equal(caller, owner);
  };

  public shared ({ caller }) func putBounded(logicalId : Text, payload : Blob) : async Result.Result<PrivateStore.PutResult, Text> {
    if (not authorized(caller)) return #err("unauthorized");
    let entry : PrivateStore.Entry = {
      collection;
      logicalId;
      version = 1;
      payload;
      contentHash = Sha256.fromBlob(#sha256, payload);
    };
    switch (PrivateStore.put(store, entry)) {
      case (#ok((next, result))) {
        store := next;
        #ok(result);
      };
      case (#err(error)) #err(debug_show (error));
    };
  };

  public shared query ({ caller }) func lookupHash(logicalId : Text) : async Result.Result<?Blob, Text> {
    if (not authorized(caller)) return #err("unauthorized");
    #ok(
      switch (PrivateStore.get(store, collection, logicalId)) {
        case null null;
        case (?entry) ?entry.contentHash;
      }
    );
  };

  public shared query ({ caller }) func entryCount() : async Result.Result<Nat, Text> {
    if (not authorized(caller)) return #err("unauthorized");
    #ok(store.entries.size());
  };
};
