// Disposable bounded archive-sink capacity fixture. It is synthetic-only and
// contains no target archive API, payment destination, signer, ledger, or chain call.
import Array "mo:base/Array";
import Error "mo:base/Error";
import Principal "mo:base/Principal";
import Sha256 "mo:sha2@0.1/Sha256";
import Archive "../../canisters/treasury/PaymentOperationArchiveRecovery";
import Binding "../../canisters/treasury/PaymentOperationArchiveExportBinding";

shared ({ caller = installer }) persistent actor class (treasury : Principal) = this {
  assert not Principal.isAnonymous(treasury);
  let maxBindings : Nat = 32;
  var retained : [Binding.Binding] = [];

  func onlyTreasury(caller : Principal) { assert caller == treasury };
  func valid(binding : Binding.Binding) : Bool {
    Archive.validTuple(binding.tuple) and
    binding.tuple.contentHash == Sha256.fromBlob(#sha256, binding.bytes);
  };

  public shared ({ caller }) func retain(binding : Binding.Binding) : async Archive.ArchiveTuple {
    onlyTreasury(caller);
    if (not valid(binding)) throw Error.reject("invalid synthetic payment-operation archive capacity binding");
    for (saved in retained.vals()) {
      if (saved.tuple.logicalId == binding.tuple.logicalId) {
        if (saved == binding) return saved.tuple
        else throw Error.reject("synthetic payment-operation archive capacity conflict");
      };
    };
    if (retained.size() >= maxBindings) throw Error.reject("synthetic payment-operation archive capacity limit");
    retained := Array.append(retained, [binding]);
    binding.tuple;
  };

  public shared ({ caller }) func count() : async Nat { onlyTreasury(caller); retained.size() };
};
