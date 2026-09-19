// Disposable M1 archive sink for the canonical treasury-journal export proof.
// It retains one immutable derived binding only; it never accepts a posting,
// balance, account, asset, destination, signer, transaction, or chain value.
import Error "mo:base/Error";
import Principal "mo:base/Principal";
import Sha256 "mo:sha2@0.1/Sha256";
import Archive "../../canisters/treasury/TreasuryJournalArchiveRecovery";
import Binding "../../canisters/treasury/TreasuryJournalArchiveExportBinding";
import Export "../../canisters/treasury/TreasuryJournalArchiveExport";

shared ({ caller = installer }) persistent actor class (
  treasury : Principal,
  operator : Principal,
  expectedLogicalId : Text,
) = this {
  assert not Principal.isAnonymous(treasury);
  assert not Principal.isAnonymous(operator);
  assert treasury != operator;

  var permitted = false;
  var retained : ?Binding.Binding = null;

  func onlyTreasury(caller : Principal) { assert caller == treasury };
  func onlyOperator(caller : Principal) { assert caller == operator };

  // The sink can verify that bytes are bounded and hash-bound, while the
  // sending fixture independently re-derives their canonical journal-set
  // encoding before every dispatch and recovery operation.
  func validBinding(binding : Binding.Binding) : Bool {
    Archive.validTuple(binding.tuple) and
    binding.tuple.logicalId == expectedLogicalId and
    binding.bytes.size() > 0 and
    binding.bytes.size() <= Export.maxEncodedBytes and
    Sha256.fromBlob(#sha256, binding.bytes) == binding.tuple.contentHash;
  };

  public shared ({ caller }) func permit() : async () {
    onlyOperator(caller);
    permitted := true;
  };

  public shared ({ caller }) func revoke() : async () {
    onlyOperator(caller);
    permitted := false;
  };

  public shared ({ caller }) func archive(binding : Binding.Binding) : async Archive.ArchiveTuple {
    onlyTreasury(caller);
    if (not permitted or not validBinding(binding)) {
      throw Error.reject("synthetic treasury-journal canonical archive unavailable");
    };
    switch (retained) {
      case null { retained := ?binding };
      case (?saved) {
        if (saved != binding) {
          throw Error.reject("synthetic treasury-journal canonical archive conflict");
        };
      };
    };
    binding.tuple;
  };

  public shared ({ caller }) func lookup(logicalId : Text) : async ?Archive.ArchiveTuple {
    onlyTreasury(caller);
    switch (retained) {
      case (?saved) { if (saved.tuple.logicalId == logicalId) ?saved.tuple else null };
      case null null;
    };
  };

  // This exposes only an equality result to the fixed fixture; neither the
  // archive bytes nor their posting source can be queried through this sink.
  public shared ({ caller }) func retainsExact(binding : Binding.Binding) : async Bool {
    onlyTreasury(caller);
    retained == ?binding;
  };
};
