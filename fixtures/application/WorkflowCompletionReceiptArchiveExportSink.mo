// Disposable sink for the workflow-completion archive-binding proof. It is
// neither an archive service nor a target application interface.
import Array "mo:base/Array";
import Error "mo:base/Error";
import Principal "mo:base/Principal";
import Sha256 "mo:sha2@0.1/Sha256";
import Archive "../../canisters/workflow/CompletionReceiptArchiveRecovery";
import Binding "../../canisters/workflow/CompletionReceiptArchiveExportBinding";

shared ({ caller = installer }) persistent actor class (application : Principal) = this {
  assert not Principal.isAnonymous(application);
  var retained : [Binding.Binding] = [];
  func onlyApplication(caller : Principal) { assert caller == application };
  func valid(binding : Binding.Binding) : Bool {
    Archive.validTuple(binding.tuple) and binding.tuple.contentHash == Sha256.fromBlob(#sha256, binding.bytes);
  };

  public shared ({ caller }) func retain(binding : Binding.Binding) : async Archive.ArchiveTuple {
    onlyApplication(caller);
    if (not valid(binding)) throw Error.reject("invalid synthetic workflow archive binding");
    for (saved in retained.vals()) {
      if (saved.tuple.logicalId == binding.tuple.logicalId) {
        if (saved == binding) return saved.tuple else throw Error.reject("synthetic workflow archive conflict");
      };
    };
    if (retained.size() >= 2) throw Error.reject("synthetic workflow archive limit");
    retained := Array.append(retained, [binding]);
    binding.tuple;
  };

  public shared ({ caller }) func lookup(logicalId : Text) : async ?Archive.ArchiveTuple {
    onlyApplication(caller);
    for (saved in retained.vals()) { if (saved.tuple.logicalId == logicalId) return ?saved.tuple };
    null;
  };
  public shared ({ caller }) func count() : async Nat { onlyApplication(caller); retained.size() };
};
