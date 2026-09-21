// Disposable archive half of the canonical payment-operation export proof.
// It stores only canonical bytes plus their derived receipt tuple.  It is not
// an archive canister, target interface, or custody component.
import Array "mo:base/Array";
import Error "mo:base/Error";
import Principal "mo:base/Principal";
import Sha256 "mo:sha2@0.1/Sha256";
import Archive "../../canisters/treasury/PaymentOperationArchiveRecovery";
import Binding "../../canisters/treasury/PaymentOperationArchiveExportBinding";

shared ({ caller = installer }) persistent actor class (treasury : Principal) = this {
  assert not Principal.isAnonymous(treasury);
  var retained : [Binding.Binding] = [];

  func onlyTreasury(caller : Principal) { assert caller == treasury };
  func valid(binding : Binding.Binding) : Bool {
    Archive.validTuple(binding.tuple) and
    binding.tuple.contentHash == Sha256.fromBlob(#sha256, binding.bytes);
  };

  public shared ({ caller }) func retain(binding : Binding.Binding) : async Archive.ArchiveTuple {
    onlyTreasury(caller);
    if (not valid(binding)) throw Error.reject("invalid synthetic payment-operation archive binding");
    for (saved in retained.vals()) {
      if (saved.tuple.logicalId == binding.tuple.logicalId) {
        if (saved == binding) return saved.tuple
        else throw Error.reject("synthetic payment-operation archive conflict");
      };
    };
    if (retained.size() >= 2) throw Error.reject("synthetic payment-operation archive limit");
    retained := Array.append(retained, [binding]);
    binding.tuple;
  };

  public shared ({ caller }) func lookup(logicalId : Text) : async ?Archive.ArchiveTuple {
    onlyTreasury(caller);
    for (saved in retained.vals()) {
      if (saved.tuple.logicalId == logicalId) return ?saved.tuple;
    };
    null;
  };

  public shared ({ caller }) func count() : async Nat { onlyTreasury(caller); retained.size() };
};
