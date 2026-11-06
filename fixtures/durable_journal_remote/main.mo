/// Local-only M1 remote side of an inter-canister mutation proof.
///
/// It retains only an operation ID and a 32-byte digest.  It never accepts a
/// payload, so the recovery fixture cannot accidentally make raw collection
/// data observable through this test seam.
import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Principal "mo:base/Principal";
import Result "mo:base/Result";

persistent actor class DurableJournalRemote(owner : Principal) = this {
  type Receipt = { operationId : Text; contentHash : Blob };
  let maxReceipts : Nat = 16;
  var receipts : [Receipt] = [];

  func authorized(caller : Principal) : Bool {
    not Principal.isAnonymous(caller) and Principal.equal(caller, owner);
  };

  public shared ({ caller }) func write(operationId : Text, contentHash : Blob) : async Result.Result<(), Text> {
    if (not authorized(caller)) return #err("unauthorized");
    if (operationId.size() == 0 or operationId.size() > 256 or contentHash.size() != 32) return #err("bounds");
    for (receipt in receipts.vals()) {
      if (receipt.operationId == operationId) {
        if (Blob.equal(receipt.contentHash, contentHash)) return #ok(());
        return #err("conflict");
      };
    };
    if (receipts.size() >= maxReceipts) return #err("capacity");
    receipts := Array.append(receipts, [{ operationId; contentHash }]);
    #ok(());
  };

  public shared query ({ caller }) func lookup(operationId : Text) : async Result.Result<?Blob, Text> {
    if (not authorized(caller)) return #err("unauthorized");
    for (receipt in receipts.vals()) {
      if (receipt.operationId == operationId) return #ok(?receipt.contentHash);
    };
    #ok(null);
  };
};
