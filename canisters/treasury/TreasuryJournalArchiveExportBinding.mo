import Blob "mo:base/Blob";
import Nat64 "mo:base/Nat64";
import Sha256 "mo:sha2@0.1/Sha256";
import Archive "TreasuryJournalArchiveRecovery";
import Export "TreasuryJournalArchiveExport";
import BalancedSet "TreasuryJournalBalancedSet";

/// Binds the canonical immutable archive bytes for one balanced journal set to
/// its acknowledgement tuple. This is a pure codec/hash boundary: it has no
/// actor state, archive transport, balance projection, or chain material.
///
/// A durable archive owner must retain the returned binding before its first
/// archive await. It must not accept a caller-supplied hash or substitute
/// bytes while retrying an unknown archive result.
module {
  public type Binding = {
    tuple : Archive.ArchiveTuple;
    bytes : Blob;
  };

  /// Produces the sole valid tuple for these exact canonical bytes. The
  /// version is explicit because an archive format evolution is a separately
  /// reviewed protocol/version decision; it cannot change the logical set ID.
  public func prepare(input : BalancedSet.Input, version : Nat64) : ?Binding {
    if (version == 0) return null;
    let ?bytes = Export.encode(input) else return null;
    let tuple = {
      logicalId = input.logicalId;
      version;
      contentHash = Sha256.fromBlob(#sha256, bytes);
    };
    if (not Export.tupleNamesSet(tuple, input)) return null;
    ?{ tuple; bytes };
  };

  /// Re-derives both the canonical bytes and SHA-256 binding. A receipt can
  /// only acknowledge this result after the durable owner has retained it;
  /// this function never treats an acknowledgement as activation or deletion.
  public func matches(input : BalancedSet.Input, binding : Binding) : Bool {
    let ?expected = prepare(input, binding.tuple.version) else return false;
    expected.tuple == binding.tuple and expected.bytes == binding.bytes;
  };
};
