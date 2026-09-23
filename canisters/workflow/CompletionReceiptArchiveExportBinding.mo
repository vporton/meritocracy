import Blob "mo:base/Blob";
import Sha256 "mo:sha2@0.1/Sha256";
import Archive "CompletionReceiptArchiveRecovery";
import Export "CompletionReceiptArchiveExport";
import Receipt "CompletionReceiptIntent";

/// Re-derives canonical archive bytes and their SHA-256 receipt tuple for an
/// immutable workflow completion receipt. A later durable saga must retain
/// this binding before delivery and use `Archive.decide` after an unknown
/// outcome; this module has no transport or workflow behavior.
module {
  public type Binding = { tuple : Archive.ArchiveTuple; bytes : Blob };

  public func prepare(input : Receipt.Input) : ?Binding {
    let ?bytes = Export.encode(input) else return null;
    let tuple = {
      logicalId = input.logicalId;
      version = input.desiredVersion;
      contentHash = Sha256.fromBlob(#sha256, bytes);
    };
    if (not Export.archiveTupleNamesReceipt(tuple.logicalId, tuple.version, tuple.contentHash, input)) return null;
    ?{ tuple; bytes };
  };

  /// Fails closed when immutable receipt metadata, canonical bytes, or the
  /// canonical-byte SHA-256 differs from the re-derived binding.
  public func matches(input : Receipt.Input, binding : Binding) : Bool {
    let ?expected = prepare(input) else return false;
    expected.tuple == binding.tuple and expected.bytes == binding.bytes;
  };
};
