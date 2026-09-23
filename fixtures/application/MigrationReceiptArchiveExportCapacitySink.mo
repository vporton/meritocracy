// Disposable bounded archive-sink capacity fixture. It is synthetic-only and
// contains no importer, source row, credential, archive service, or target API.
import Array "mo:base/Array";
import Error "mo:base/Error";
import Principal "mo:base/Principal";
import Sha256 "mo:sha2@0.1/Sha256";
import Archive "../../canisters/archive_router/MigrationReceiptArchiveRecovery";
import Binding "../../canisters/archive_router/MigrationReceiptArchiveExportBinding";

shared ({ caller = installer }) persistent actor class (application : Principal) = this {
  assert not Principal.isAnonymous(application);
  let maxBindings : Nat = 32;
  var retained : [Binding.Binding] = [];

  func onlyApplication(caller : Principal) { assert caller == application };
  func valid(binding : Binding.Binding) : Bool {
    Archive.validTuple(binding.tuple) and binding.tuple.contentHash == Sha256.fromBlob(#sha256, binding.bytes);
  };

  public shared ({ caller }) func retain(binding : Binding.Binding) : async Archive.ArchiveTuple {
    onlyApplication(caller);
    if (not valid(binding)) throw Error.reject("invalid synthetic migration archive capacity binding");
    for (saved in retained.vals()) {
      if (saved.tuple.logicalId == binding.tuple.logicalId) {
        if (saved == binding) return saved.tuple
        else throw Error.reject("synthetic migration archive capacity conflict");
      };
    };
    if (retained.size() >= maxBindings) throw Error.reject("synthetic migration archive capacity limit");
    retained := Array.append(retained, [binding]);
    binding.tuple;
  };

  public shared ({ caller }) func count() : async Nat { onlyApplication(caller); retained.size() };
};
