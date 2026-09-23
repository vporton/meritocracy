// Disposable sink for the migration-receipt archive-binding proof. It stores
// only bounded canonical bytes and their SHA-256-derived receipt tuple.
import Array "mo:base/Array";
import Error "mo:base/Error";
import Principal "mo:base/Principal";
import Sha256 "mo:sha2@0.1/Sha256";
import Archive "../../canisters/archive_router/MigrationReceiptArchiveRecovery";
import Binding "../../canisters/archive_router/MigrationReceiptArchiveExportBinding";

shared ({ caller = installer }) persistent actor class (application : Principal) = this {
  assert not Principal.isAnonymous(application);
  var retained : [Binding.Binding] = [];

  func onlyApplication(caller : Principal) { assert caller == application };
  func valid(binding : Binding.Binding) : Bool {
    Archive.validTuple(binding.tuple) and binding.tuple.contentHash == Sha256.fromBlob(#sha256, binding.bytes);
  };

  public shared ({ caller }) func retain(binding : Binding.Binding) : async Archive.ArchiveTuple {
    onlyApplication(caller);
    if (not valid(binding)) throw Error.reject("invalid synthetic migration archive binding");
    for (saved in retained.vals()) {
      if (saved.tuple.logicalId == binding.tuple.logicalId) {
        if (saved == binding) return saved.tuple else throw Error.reject("synthetic migration archive conflict");
      };
    };
    if (retained.size() >= 2) throw Error.reject("synthetic migration archive limit");
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
