import Blob "mo:base/Blob";
import Sha256 "mo:sha2@0.1/Sha256";
import Archive "MigrationReceiptArchiveRecovery";
import Export "MigrationReceiptArchiveExport";
import Receipt "MigrationReceiptIntent";

/// Re-derives the canonical archive bytes and their SHA-256 receipt tuple.
/// A future durable archive saga must retain this binding before delivery and
/// reconcile an unknown outcome through `Archive.decide` only.
module {
  public type Binding = { tuple : Archive.ArchiveTuple; bytes : Blob };

  public func prepare(input : Receipt.Input) : ?Binding {
    let ?bytes = Export.encode(input) else return null;
    let tuple = {
      logicalId = input.logicalId;
      version = input.desiredVersion;
      contentHash = Sha256.fromBlob(#sha256, bytes);
    };
    if (not Export.archiveTupleNamesReceipt(tuple, input)) return null;
    ?{ tuple; bytes };
  };

  /// Recovery fails closed if receipt metadata, canonical bytes, or archive
  /// hash differ from the immutable input's re-derived binding.
  public func matches(input : Receipt.Input, binding : Binding) : Bool {
    let ?expected = prepare(input) else return false;
    expected.tuple == binding.tuple and expected.bytes == binding.bytes;
  };
};
