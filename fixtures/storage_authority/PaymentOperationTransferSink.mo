// Disposable valueless downstream half of the M1 at-most-one-dispatch proof.
// It receives only an immutable operation tuple: no amount, destination,
// signer, transaction bytes, chain receipt, or external-chain call exists.
import Error "mo:base/Error";
import Principal "mo:base/Principal";
import Array "mo:base/Array";
import Archive "../../canisters/treasury/PaymentOperationArchiveRecovery";

shared ({ caller = installer }) persistent actor class (treasury : Principal) = this {
  assert not Principal.isAnonymous(treasury);
  var dispatched : [Archive.ArchiveTuple] = [];

  func onlyTreasury(caller : Principal) { assert caller == treasury };

  public shared ({ caller }) func dispatch(tuple : Archive.ArchiveTuple) : async Archive.ArchiveTuple {
    onlyTreasury(caller);
    if (not Archive.validTuple(tuple)) throw Error.reject("invalid synthetic transfer tuple");
    for (stored in dispatched.vals()) {
      if (stored.logicalId == tuple.logicalId) {
        if (stored == tuple) return stored else throw Error.reject("synthetic transfer conflict");
      };
    };
    // This fixture proves one fixed operation only. A real adapter's bounded
    // idempotency store must be sized and measured before G2/G3 approval.
    if (dispatched.size() >= 1) throw Error.reject("synthetic transfer limit");
    dispatched := Array.append(dispatched, [tuple]);
    tuple;
  };

  public shared ({ caller }) func lookup(logicalId : Text) : async ?Archive.ArchiveTuple {
    onlyTreasury(caller);
    for (stored in dispatched.vals()) { if (stored.logicalId == logicalId) return ?stored };
    null;
  };

  public shared ({ caller }) func dispatchCount() : async Nat {
    onlyTreasury(caller);
    dispatched.size();
  };
};
